import express from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import type { AccountRole, SystemId } from "@devils-toys/shared";
import type { AuthedRequest, AuthAccount } from "./auth.js";
import { requireAuth } from "./auth.js";
import { all, db, one } from "./db.js";
import { removeStoredPortrait } from "./portrait-files.js";
import { broadcastRoom, disconnectAccount, refreshRoomAccess } from "./realtime.js";
import { allSystems, systemIdSchema, systemOrThrow } from "./systems.js";
import { canCreateAccountRole, requiresRoomTransferConfirmation } from "./account-role-permissions.js";

export const managementRouter = express.Router();

interface ManagedRoom {
  id: number;
  name: string;
  system: SystemId;
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

function managedRooms(account: AuthAccount): ManagedRoom[] {
  if (account.isAdmin) return all<ManagedRoom>("SELECT id, name, system FROM rooms ORDER BY archived, name");
  if (account.role === "player") return [];
  return all<ManagedRoom>(
    `SELECT r.id, r.name, r.system FROM rooms r
       JOIN memberships m ON m.room_id = r.id
       WHERE m.account_id = ? AND m.role = 'gm'
       ORDER BY r.archived, r.name`,
    account.id
  );
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
    warnings: systemOrThrow(row.system).characterWarnings(sheet),
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
    rooms: context.rooms,
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
