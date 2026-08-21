import express from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { THEME_IDS, type AccountRole, type SystemId, type ThemeId } from "@devils-toys/shared";
import type { AuthedRequest, AuthAccount } from "./auth.js";
import { requireAuth } from "./auth.js";
import { all, db, one } from "./db.js";
import { removeStoredPortrait } from "./portrait-files.js";
import { broadcastRoom, disconnectAccount, refreshRoomAccess } from "./realtime.js";
import { allSystems, characterWarningsFor, systemIdSchema, systemOrThrow } from "./systems.js";
import { isSystemOffered } from "./system-registry.js";
import { canCreateAccountRole, requiresRoomTransferConfirmation } from "./account-role-permissions.js";
import {
  canAssignRoomGm,
  canCreateRoomForAnother,
  canDeleteRoom,
  canHoldRoomGm
} from "./room-management-permissions.js";
import { assignRoomGm, createRoom, deleteRoom } from "./rooms.js";

export const managementRouter = express.Router();

interface ManagedRoom {
  id: number;
  name: string;
  system: SystemId;
}

/**
 * A room as the Rooms section lists it: the room itself, whoever runs it, and
 * whoever plays in it. The panel manages a room from the room's own side, so it
 * needs the cast in one payload rather than assembling it from the accounts.
 */
interface ManagedRoomRecord extends ManagedRoom {
  theme: ThemeId;
  archived: boolean;
  gm: { id: number; username: string } | null;
  players: { id: number; username: string }[];
}

interface RoomRow extends ManagedRoom {
  theme: ThemeId;
  archived: number;
}

interface ManagedPlayer {
  id: number;
  username: string;
  is_admin: number;
  account_role: AccountRole;
  created_by: number | null;
  created_at: string;
}

interface ManagedCharacter {
  id: number;
  system: SystemId;
  owner_account_id: number | null;
  owner_username: string | null;
  pool_room_id: number | null;
  room_name: string | null;
  created_by: number | null;
  name: string;
  sheet_json: string;
  portrait_stored_name: string | null;
  updated_at: string;
}

const usernameSchema = z
  .string()
  .trim()
  .min(2)
  .max(32)
  .regex(/^[a-zA-Z0-9._-]+$/, "Use letters, numbers, dots, dashes, or underscores.");

const asyncRoute =
  (handler: (req: AuthedRequest, res: express.Response) => Promise<unknown> | unknown) =>
  async (req: AuthedRequest, res: express.Response, next: express.NextFunction) => {
    try {
      await handler(req, res);
    } catch (error) {
      next(error);
    }
  };

function managedRooms(account: AuthAccount): RoomRow[] {
  if (account.isAdmin)
    return all<RoomRow>("SELECT id, name, system, theme, archived FROM rooms ORDER BY archived, name");
  if (account.role === "player") return [];
  return all<RoomRow>(
    `SELECT r.id, r.name, r.system, r.theme, r.archived FROM rooms r
       JOIN memberships m ON m.room_id = r.id
       WHERE m.account_id = ? AND m.role = 'gm'
       ORDER BY r.archived, r.name`,
    account.id
  );
}

/**
 * The managed rooms with their cast attached. One query for every membership
 * rather than one per room, since an admin's ledger is every room on the server.
 */
function roomRecords(rooms: RoomRow[]): ManagedRoomRecord[] {
  if (rooms.length === 0) return [];
  const members = all<{ room_id: number; id: number; username: string; role: "gm" | "player" }>(
    `SELECT m.room_id, a.id, a.username, m.role FROM memberships m
       JOIN accounts a ON a.id = m.account_id
       WHERE m.room_id IN (${rooms.map(() => "?").join(",")})
       ORDER BY a.username`,
    ...rooms.map((room) => room.id)
  );
  return rooms.map((room) => {
    const cast = members.filter((member) => member.room_id === room.id);
    const gm = cast.find((member) => member.role === "gm");
    return {
      id: room.id,
      name: room.name,
      system: room.system,
      theme: room.theme,
      archived: Boolean(room.archived),
      gm: gm ? { id: gm.id, username: gm.username } : null,
      players: cast
        .filter((member) => member.role === "player")
        .map((member) => ({ id: member.id, username: member.username }))
    };
  });
}

/**
 * The accounts an admin may seat as a room's GM. A player-level account is not
 * among them — `canHoldRoomGm` says why — and the admin doing the seating is,
 * since making a room for yourself is the ordinary case.
 */
function roomGmCandidates() {
  return all<{ id: number; username: string; account_role: AccountRole }>(
    "SELECT id, username, account_role FROM accounts ORDER BY username"
  )
    .filter((account) => canHoldRoomGm(account.account_role))
    .map((account) => ({ id: account.id, username: account.username, role: account.account_role }));
}

function managerContext(req: AuthedRequest, res: express.Response) {
  const rooms = managedRooms(req.account!);
  if (req.account!.role === "player") {
    res.status(403).json({ error: "Player and character management is reserved for admins and GMs." });
    return;
  }
  const roomIds = new Set(rooms.map((room) => room.id));
  const allPlayers = all<ManagedPlayer>(
    "SELECT id, username, is_admin, account_role, created_by, created_at FROM accounts ORDER BY username"
  );
  const roomPlayers =
    rooms.length === 0
      ? new Set<number>()
      : new Set(
          all<{ account_id: number }>(
            `SELECT DISTINCT account_id FROM memberships
             WHERE role = 'player' AND room_id IN (${rooms.map(() => "?").join(",")})`,
            ...rooms.map((room) => room.id)
          ).map((item) => item.account_id)
        );
  const players = allPlayers.filter(
    (player) =>
      player.id !== req.account!.id &&
      (req.account!.isAdmin ||
        (player.account_role === "player" &&
          !player.is_admin &&
          (player.created_by === req.account!.id || roomPlayers.has(player.id))))
  );
  return { rooms, roomIds, players, playerIds: new Set(players.map((player) => player.id)) };
}

function manageableCharacterRows(context: NonNullable<ReturnType<typeof managerContext>>, account: AuthAccount) {
  const rows = all<ManagedCharacter>(
    `SELECT c.*, a.username AS owner_username, r.name AS room_name
       FROM characters c
       LEFT JOIN accounts a ON a.id = c.owner_account_id
       LEFT JOIN rooms r ON r.id = c.pool_room_id
       ORDER BY c.name`
  );
  return rows.filter(
    (character) =>
      account.isAdmin ||
      character.created_by === account.id ||
      (character.pool_room_id !== null && context.roomIds.has(character.pool_room_id)) ||
      (character.owner_account_id !== null && context.playerIds.has(character.owner_account_id))
  );
}

function playerMemberships(playerId: number, roomIds: Set<number>) {
  return all<{ id: number; name: string; system: SystemId }>(
    `SELECT r.id, r.name, r.system FROM memberships m
       JOIN rooms r ON r.id = m.room_id
       WHERE m.account_id = ? AND m.role = 'player'
       ORDER BY r.name`,
    playerId
  ).filter((room) => roomIds.has(room.id));
}

function managedGameRoomsForAccount(accountId: number) {
  return all<ManagedRoom>(
    `SELECT DISTINCT r.id, r.name, r.system FROM rooms r
       LEFT JOIN memberships m ON m.room_id = r.id AND m.account_id = ? AND m.role = 'gm'
       WHERE r.created_by = ? OR m.account_id IS NOT NULL
       ORDER BY r.name`,
    accountId,
    accountId
  );
}

function publicCharacter(row: ManagedCharacter) {
  let sheet: Record<string, unknown> = {};
  try {
    sheet = JSON.parse(row.sheet_json) as Record<string, unknown>;
  } catch {
    // Existing malformed data is presented as an empty sheet and can be repaired in the room editor.
  }
  return {
    id: row.id,
    system: row.system,
    name: row.name,
    ownerAccountId: row.owner_account_id,
    ownerUsername: row.owner_username,
    roomId: row.pool_room_id,
    roomName: row.room_name,
    warnings: characterWarningsFor(row.system, sheet),
    updatedAt: row.updated_at
  };
}

function broadcastCharacter(row: Pick<ManagedCharacter, "system" | "owner_account_id" | "pool_room_id">) {
  const roomIds = new Set<number>();
  if (row.pool_room_id) roomIds.add(row.pool_room_id);
  if (row.owner_account_id) {
    for (const membership of all<{ room_id: number }>(
      `SELECT m.room_id FROM memberships m JOIN rooms r ON r.id = m.room_id
       WHERE m.account_id = ? AND r.system = ?`,
      row.owner_account_id,
      row.system
    ))
      roomIds.add(membership.room_id);
  }
  for (const roomId of roomIds) broadcastRoom(roomId, { type: "characters-updated" });
}

managementRouter.get("/management", requireAuth, (req: AuthedRequest, res) => {
  const context = managerContext(req, res);
  if (!context) return;
  res.json({
    viewerRole: req.account!.role,
    // Named rather than implied: the Rooms section offers the reader their own
    // account as a room's GM, and "me" is not something a list of usernames says.
    viewerAccountId: req.account!.id,
    rooms: roomRecords(context.rooms),
    // Only an admin seats somebody else, so nobody else is sent the roster to
    // seat them from.
    gmCandidates: req.account!.isAdmin ? roomGmCandidates() : [],
    players: context.players.map((player) => ({
      id: player.id,
      username: player.username,
      role: player.account_role,
      createdAt: player.created_at,
      rooms: playerMemberships(player.id, context.roomIds),
      ownedRooms: req.account!.isAdmin ? managedGameRoomsForAccount(player.id) : []
    })),
    characters: manageableCharacterRows(context, req.account!).map(publicCharacter),
    systems: allSystems().map(({ id, name, glyph }) => ({ id, name, glyph }))
  });
});

/*
 * The Rooms section.
 *
 * A room's cast is managed from both ends: an account's rooms under Accounts,
 * and a room's accounts under Rooms. Both write the same memberships, so the
 * player assignment routes further down serve either direction, and only the
 * room itself — making one, handing it over, destroying it — is new here.
 */

/** One room as the section lists it, for the response to a change. */
function roomRecord(roomId: number) {
  const row = one<RoomRow>("SELECT id, name, system, theme, archived FROM rooms WHERE id = ?", roomId)!;
  return roomRecords([row])[0];
}

/** The account being seated as a GM, or a refusal saying why it cannot be. */
function gmToSeat(accountId: number, res: express.Response) {
  const account = one<{ id: number; username: string; account_role: AccountRole }>(
    "SELECT id, username, account_role FROM accounts WHERE id = ?",
    accountId
  );
  if (!account) {
    res.status(404).json({ error: "Account not found." });
    return;
  }
  if (!canHoldRoomGm(account.account_role)) {
    res.status(409).json({
      error: `${account.username} is a player account. Make them a game master before giving them a room to run.`
    });
    return;
  }
  return account;
}

managementRouter.post("/management/rooms", requireAuth, (req: AuthedRequest, res) => {
  const context = managerContext(req, res);
  if (!context) return;
  const parsed = z
    .object({
      name: z.string().trim().min(2).max(80),
      system: systemIdSchema,
      theme: z.enum(THEME_IDS).optional(),
      gmAccountId: z.number().int().positive().optional()
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid room." });
  // Registered but retired: the rooms already on it keep working, and this is
  // the difference between retiring a system and deleting one.
  if (!isSystemOffered(parsed.data.system))
    return res
      .status(409)
      .json({ error: `${systemOrThrow(parsed.data.system).name} is retired and cannot take new rooms.` });
  const gmAccountId = parsed.data.gmAccountId ?? req.account!.id;
  if (gmAccountId !== req.account!.id && !canCreateRoomForAnother(req.account!.role))
    return res.status(403).json({ error: "Only an admin can make a room for somebody else to run." });
  const gm = gmToSeat(gmAccountId, res);
  if (!gm) return;
  const theme = parsed.data.theme ?? systemOrThrow(parsed.data.system).defaultTheme;
  const roomId = createRoom({ name: parsed.data.name, system: parsed.data.system, theme, gmAccountId: gm.id });
  res.status(201).json({ room: roomRecord(roomId) });
});

managementRouter.patch("/management/rooms/:roomId", requireAuth, (req: AuthedRequest, res) => {
  const context = managerContext(req, res);
  if (!context) return;
  const roomId = Number(req.params.roomId);
  if (!context.roomIds.has(roomId)) return res.status(404).json({ error: "Room not found." });
  if (!canAssignRoomGm(req.account!.role))
    return res.status(403).json({ error: "Only an admin can hand a room to a different GM." });
  const parsed = z.object({ gmAccountId: z.number().int().positive() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Choose the account that will run this room." });
  const gm = gmToSeat(parsed.data.gmAccountId, res);
  if (!gm) return;
  assignRoomGm(roomId, gm.id);
  // Whoever was running it a moment ago is sitting in it as a player now, and
  // is told so where they sit rather than being signed out: the session is
  // still theirs, only their standing in this one room has changed.
  refreshRoomAccess(roomId);
  res.json({ room: roomRecord(roomId) });
});

managementRouter.delete("/management/rooms/:roomId", requireAuth, (req: AuthedRequest, res) => {
  const context = managerContext(req, res);
  if (!context) return;
  if (!canDeleteRoom(req.account!.role))
    return res.status(403).json({ error: "Only an admin can delete a room. Archive it instead." });
  const roomId = Number(req.params.roomId);
  if (!context.roomIds.has(roomId) || !deleteRoom(roomId)) return res.status(404).json({ error: "Room not found." });
  refreshRoomAccess(roomId);
  res.status(204).end();
});

managementRouter.post(
  "/management/players",
  requireAuth,
  asyncRoute(async (req, res) => {
    const context = managerContext(req, res);
    if (!context) return;
    const parsed = z
      .object({
        username: usernameSchema,
        password: z.string().min(8).max(128),
        role: z.enum(["admin", "gm", "player"]).default("player")
      })
      .safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid account." });
    if (!canCreateAccountRole(req.account!.role, parsed.data.role))
      return res.status(403).json({ error: "GMs can only create player-level accounts." });
    const passwordHash = await bcrypt.hash(parsed.data.password, 12);
    try {
      const result = db
        .prepare(
          "INSERT INTO accounts (username, password_hash, is_admin, account_role, created_by) VALUES (?, ?, ?, ?, ?)"
        )
        .run(
          parsed.data.username,
          passwordHash,
          parsed.data.role === "admin" ? 1 : 0,
          parsed.data.role,
          req.account!.id
        );
      res.status(201).json({
        player: {
          id: Number(result.lastInsertRowid),
          username: parsed.data.username,
          role: parsed.data.role,
          rooms: [],
          ownedRooms: []
        }
      });
    } catch (error) {
      if (String(error).includes("UNIQUE")) return res.status(409).json({ error: "That username is already in use." });
      throw error;
    }
  })
);

managementRouter.patch(
  "/management/players/:playerId/password",
  requireAuth,
  asyncRoute(async (req, res) => {
    const context = managerContext(req, res);
    if (!context) return;
    const playerId = Number(req.params.playerId);
    if (!context.playerIds.has(playerId)) return res.status(404).json({ error: "Player not found." });
    const parsed = z.object({ password: z.string().min(8).max(128) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Passwords must contain at least 8 characters." });
    const passwordHash = await bcrypt.hash(parsed.data.password, 12);
    db.exec("BEGIN");
    try {
      db.prepare("UPDATE accounts SET password_hash = ? WHERE id = ?").run(passwordHash, playerId);
      db.prepare("DELETE FROM sessions WHERE account_id = ?").run(playerId);
      disconnectAccount(playerId);
      db.exec("COMMIT");
      res.status(204).end();
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  })
);

managementRouter.patch("/management/players/:playerId/role", requireAuth, (req: AuthedRequest, res) => {
  if (!req.account!.isAdmin) return res.status(403).json({ error: "Only admins can change account roles." });
  const context = managerContext(req, res);
  if (!context) return;
  const playerId = Number(req.params.playerId);
  if (!Number.isInteger(playerId) || playerId === req.account!.id || !context.playerIds.has(playerId))
    return res.status(404).json({ error: "Account not found." });
  const parsed = z
    .object({
      role: z.enum(["admin", "gm", "player"]),
      confirmRoomTransfer: z.boolean().default(false)
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Choose a valid account role." });

  const roomsToTransfer = managedGameRoomsForAccount(playerId);
  if (requiresRoomTransferConfirmation(parsed.data.role, roomsToTransfer.length) && !parsed.data.confirmRoomTransfer) {
    return res.status(409).json({
      error: `Downgrading this account will transfer ${roomsToTransfer.length === 1 ? "their room" : "their rooms"} to you. Confirm the role change to continue.`
    });
  }

  db.exec("BEGIN");
  try {
    db.prepare("UPDATE accounts SET account_role = ?, is_admin = ? WHERE id = ?").run(
      parsed.data.role,
      parsed.data.role === "admin" ? 1 : 0,
      playerId
    );
    if (parsed.data.role === "player") {
      for (const room of roomsToTransfer) {
        db.prepare("UPDATE memberships SET role = 'player' WHERE room_id = ? AND account_id = ?").run(
          room.id,
          playerId
        );
        db.prepare(
          `INSERT INTO memberships (room_id, account_id, role) VALUES (?, ?, 'gm')
           ON CONFLICT(room_id, account_id) DO UPDATE SET role = 'gm'`
        ).run(room.id, req.account!.id);
        db.prepare("UPDATE rooms SET created_by = ? WHERE id = ?").run(req.account!.id, room.id);
      }
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  disconnectAccount(playerId);
  for (const room of roomsToTransfer) refreshRoomAccess(room.id);
  res.status(204).end();
});

managementRouter.put("/management/players/:playerId/rooms/:roomId", requireAuth, (req: AuthedRequest, res) => {
  const context = managerContext(req, res);
  if (!context) return;
  const playerId = Number(req.params.playerId);
  const roomId = Number(req.params.roomId);
  if (!context.playerIds.has(playerId)) return res.status(404).json({ error: "Player not found." });
  if (!context.roomIds.has(roomId)) return res.status(403).json({ error: "You cannot manage that room." });
  try {
    db.prepare("INSERT INTO memberships (room_id, account_id, role) VALUES (?, ?, 'player')").run(roomId, playerId);
  } catch (error) {
    if (String(error).includes("UNIQUE"))
      return res.status(409).json({ error: "That account already has room access." });
    throw error;
  }
  refreshRoomAccess(roomId);
  res.status(204).end();
});

managementRouter.delete("/management/players/:playerId/rooms/:roomId", requireAuth, (req: AuthedRequest, res) => {
  const context = managerContext(req, res);
  if (!context) return;
  const playerId = Number(req.params.playerId);
  const roomId = Number(req.params.roomId);
  if (!context.playerIds.has(playerId)) return res.status(404).json({ error: "Player not found." });
  if (!context.roomIds.has(roomId)) return res.status(403).json({ error: "You cannot manage that room." });
  const result = db
    .prepare("DELETE FROM memberships WHERE room_id = ? AND account_id = ? AND role = 'player'")
    .run(roomId, playerId);
  if (!result.changes) return res.status(404).json({ error: "Player does not have access to that room." });
  refreshRoomAccess(roomId);
  res.status(204).end();
});

function validateAssignments(
  context: NonNullable<ReturnType<typeof managerContext>>,
  system: SystemId,
  ownerAccountId: number | null,
  roomId: number | null,
  res: express.Response
) {
  if (ownerAccountId !== null && !context.playerIds.has(ownerAccountId)) {
    res.status(404).json({ error: "Player not found." });
    return false;
  }
  const room = roomId === null ? undefined : context.rooms.find((item) => item.id === roomId);
  if (roomId !== null && !room) {
    res.status(403).json({ error: "You cannot manage that room." });
    return false;
  }
  if (room && room.system !== system) {
    res.status(409).json({ error: `This ${system} character cannot be assigned to a ${room.system} room.` });
    return false;
  }
  if (
    ownerAccountId !== null &&
    roomId !== null &&
    !one("SELECT 1 FROM memberships WHERE room_id = ? AND account_id = ? AND role = 'player'", roomId, ownerAccountId)
  ) {
    res.status(409).json({ error: "Give the player access to the room before assigning their character." });
    return false;
  }
  return true;
}

managementRouter.post("/management/characters", requireAuth, (req: AuthedRequest, res) => {
  const context = managerContext(req, res);
  if (!context) return;
  const parsed = z
    .object({
      name: z.string().trim().min(1).max(80),
      system: systemIdSchema,
      ownerAccountId: z.number().int().positive().nullable().default(null),
      roomId: z.number().int().positive().nullable().default(null)
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid character." });
  if (!validateAssignments(context, parsed.data.system, parsed.data.ownerAccountId, parsed.data.roomId, res)) return;
  const result = db
    .prepare(
      `INSERT INTO characters (system, owner_account_id, pool_room_id, created_by, name, sheet_json)
       VALUES (?, ?, ?, ?, ?, '{}')`
    )
    .run(parsed.data.system, parsed.data.ownerAccountId, parsed.data.roomId, req.account!.id, parsed.data.name);
  const row = one<ManagedCharacter>(
    `SELECT c.*, a.username AS owner_username, r.name AS room_name FROM characters c
     LEFT JOIN accounts a ON a.id = c.owner_account_id LEFT JOIN rooms r ON r.id = c.pool_room_id
     WHERE c.id = ?`,
    Number(result.lastInsertRowid)
  )!;
  broadcastCharacter(row);
  res.status(201).json({ character: publicCharacter(row) });
});

managementRouter.patch("/management/characters/:characterId", requireAuth, (req: AuthedRequest, res) => {
  const context = managerContext(req, res);
  if (!context) return;
  const characterId = Number(req.params.characterId);
  const original = manageableCharacterRows(context, req.account!).find((character) => character.id === characterId);
  if (!original) return res.status(404).json({ error: "Character not found." });
  const parsed = z
    .object({
      name: z.string().trim().min(1).max(80).optional(),
      ownerAccountId: z.number().int().positive().nullable().optional(),
      roomId: z.number().int().positive().nullable().optional()
    })
    .refine((value) => value.name !== undefined || value.ownerAccountId !== undefined || value.roomId !== undefined)
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid character." });
  const ownerAccountId =
    parsed.data.ownerAccountId === undefined ? original.owner_account_id : parsed.data.ownerAccountId;
  const roomId = parsed.data.roomId === undefined ? original.pool_room_id : parsed.data.roomId;
  if (!validateAssignments(context, original.system, ownerAccountId, roomId, res)) return;
  db.exec("BEGIN");
  try {
    if (ownerAccountId !== original.owner_account_id || roomId !== original.pool_room_id)
      db.prepare("UPDATE memberships SET active_character_id = NULL WHERE active_character_id = ?").run(characterId);
    db.prepare(
      `UPDATE characters SET name = COALESCE(?, name), owner_account_id = ?, pool_room_id = ?,
       updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).run(parsed.data.name ?? null, ownerAccountId, roomId, characterId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  const row = one<ManagedCharacter>(
    `SELECT c.*, a.username AS owner_username, r.name AS room_name FROM characters c
     LEFT JOIN accounts a ON a.id = c.owner_account_id LEFT JOIN rooms r ON r.id = c.pool_room_id
     WHERE c.id = ?`,
    characterId
  )!;
  broadcastCharacter(original);
  broadcastCharacter(row);
  res.json({ character: publicCharacter(row) });
});

managementRouter.delete("/management/characters/:characterId", requireAuth, (req: AuthedRequest, res) => {
  const context = managerContext(req, res);
  if (!context) return;
  const characterId = Number(req.params.characterId);
  const original = manageableCharacterRows(context, req.account!).find((character) => character.id === characterId);
  if (!original) return res.status(404).json({ error: "Character not found." });
  db.exec("BEGIN");
  try {
    db.prepare("UPDATE memberships SET active_character_id = NULL WHERE active_character_id = ?").run(characterId);
    db.prepare("DELETE FROM characters WHERE id = ?").run(characterId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  removeStoredPortrait(original.portrait_stored_name);
  broadcastCharacter(original);
  res.status(204).end();
});
