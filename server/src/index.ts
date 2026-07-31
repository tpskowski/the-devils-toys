import http from "node:http";
import fs from "node:fs";
import express from "express";
import cookieParser from "cookie-parser";
import bcrypt from "bcryptjs";
import { z } from "zod";
import type { AuthedRequest } from "./auth.js";
import { authMiddleware, createSession, requireAuth, roomRole } from "./auth.js";
import { all, db, one } from "./db.js";
import { inGameDisplayName } from "./display-name.js";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { invitationRouter } from "./invitations.js";
import { evaluateCheck, evaluateSave, parseRollCommand, rollDice } from "./dice.js";
import { characterRouter } from "./characters.js";
import { roomAdminRouter } from "./room-admin.js";
import { canResetAccountPassword } from "./account-permissions.js";
import { managementRouter } from "./management.js";
import { mediaRouter } from "./media.js";
import { audioRouter } from "./audio.js";
import { attachRealtime, broadcastRoom, disconnectAccount, sendToRoomGms } from "./realtime.js";
import { npcRouter } from "./npcs.js";
import { DEFAULT_TABLE_ROLL_NOTICE, tableRouter } from "./tables.js";
import { tagRouter } from "./table-tags.js";
import { tableSetRouter } from "./table-sets.js";
import { tablesLinkRouter } from "./tables-link.js";
import { asyncRoute, parse, publicAccount, sessionRouter } from "./session-routes.js";
import { groupRouter } from "./group.js";
import { mapNotationRouter } from "./map-notations.js";
import { projectFile } from "./paths.js";
import { rulesMarkdown, systems } from "./systems.js";
import {
  calendarNowMessage,
  SYSTEM_IDS,
  THEME_IDS,
  type AccountRole,
  type SystemId,
  type ThemeId
} from "@devils-toys/shared";
import { advanceCalendar, calendarInput, calendarSchema, normalizeCalendar, readCalendar } from "./calendar.js";
import {
  CALENDAR_STRICT_TIME_EGG_ID,
  CALENDAR_STRICT_TIME_EGG_MESSAGE,
  MAP_NOTATION_ROAD_EGG_ID,
  MAP_NOTATION_ROAD_EGG_MESSAGE,
  claimRoomEasterEgg
} from "./easter-eggs.js";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.use(authMiddleware);
app.use("/api", invitationRouter);
app.use("/api", characterRouter);
app.use("/api", mediaRouter);
app.use("/api", audioRouter);

app.use("/api", npcRouter);
app.use("/api", tableRouter);
app.use("/api", tableSetRouter);
app.use("/api", tagRouter);
app.use("/api", tablesLinkRouter);
app.use("/api", groupRouter);
app.use("/api", roomAdminRouter);
app.use("/api", managementRouter);
app.use("/api", sessionRouter);
app.use("/api", mapNotationRouter);
function publicMessage(row: {
  id: number;
  room_id: number;
  account_id: number;
  username: string;
  character_name?: string | null;
  kind: "chat" | "roll" | "system";
  body: string;
  detail?: string;
  created_at: string;
}) {
  return {
    id: row.id,
    roomId: row.room_id,
    accountId: row.account_id,
    username: row.username,
    displayName: inGameDisplayName(row.username, row.character_name),
    kind: row.kind,
    body: row.body,
    detail: row.detail,
    createdAt: row.created_at
  };
}

function recordSystemMessage(roomId: number, accountId: number, body: string) {
  const result = db
    .prepare("INSERT INTO messages (room_id, account_id, kind, body) VALUES (?, ?, 'system', ?)")
    .run(roomId, accountId, body);
  return publicMessage(
    one<any>(
      `SELECT m.id, m.room_id, m.account_id, a.username, c.name AS character_name,
              m.kind, m.body, m.detail, m.created_at
       FROM messages m JOIN accounts a ON a.id = m.account_id
       LEFT JOIN memberships rm ON rm.room_id = m.room_id AND rm.account_id = m.account_id
       LEFT JOIN characters c ON c.id = rm.active_character_id
       WHERE m.id = ?`,
      Number(result.lastInsertRowid)
    )!
  );
}

/**
 * Records that the GM rolled without saying what it was, so the table knows a
 * roll happened. The expression is left out; only the fact is shared.
 */
function rollNotice(roomId: number, accountId: number) {
  const result = db
    .prepare("INSERT INTO messages (room_id, account_id, kind, body) VALUES (?, ?, 'roll', 'Rolled privately')")
    .run(roomId, accountId);
  const row = one<{
    id: number;
    room_id: number;
    account_id: number;
    username: string;
    character_name: string | null;
    kind: "chat" | "roll" | "system";
    body: string;
    detail?: string;
    created_at: string;
  }>(
    `SELECT m.id, m.room_id, m.account_id, a.username, c.name AS character_name,
            m.kind, m.body, m.detail, m.created_at
     FROM messages m JOIN accounts a ON a.id = m.account_id
     LEFT JOIN memberships rm ON rm.room_id = m.room_id AND rm.account_id = m.account_id
     LEFT JOIN characters c ON c.id = rm.active_character_id
     WHERE m.id = ?`,
    Number(result.lastInsertRowid)
  )!;
  return publicMessage(row);
}

function privateRollMessage(row: {
  id: number;
  room_id: number;
  account_id: number;
  username: string;
  character_name?: string | null;
  expression: string;
  result: string;
  created_at: string;
}) {
  const result = JSON.parse(row.result) as {
    total: number;
    detail?: string;
    visibility?: "private" | "invisible";
  };
  return {
    id: row.id,
    roomId: row.room_id,
    accountId: row.account_id,
    username: row.username,
    displayName: inGameDisplayName(row.username, row.character_name),
    kind: "roll" as const,
    body: `${row.expression} → ${result.total}`,
    detail: result.detail,
    private: true,
    rollVisibility: result.visibility ?? "private",
    createdAt: row.created_at
  };
}

app.post(
  "/api/setup",
  asyncRoute(async (req, res) => {
    const existing = one<{ count: number }>("SELECT COUNT(*) AS count FROM accounts")?.count ?? 0;
    if (existing) return res.status(409).json({ error: "Server setup is already complete." });
    const body = parse(
      z.object({ username: z.string().trim().min(2).max(32), password: z.string().min(8).max(128) }),
      req.body,
      res
    );
    if (!body) return;
    const hash = await bcrypt.hash(body.password, 12);
    const result = db
      .prepare("INSERT INTO accounts (username, password_hash, is_admin, account_role) VALUES (?, ?, 1, 'admin')")
      .run(body.username, hash);
    createSession(res, Number(result.lastInsertRowid));
    res
      .status(201)
      .json({ account: { id: Number(result.lastInsertRowid), username: body.username, isAdmin: true, role: "admin" } });
  })
);

app.get("/api/project/:document", requireAuth, (req, res) => {
  const files: Record<string, string> = { credits: "credits.md", changelog: "changelog.md", roadmap: "roadmap.md" };
  const filename = files[String(req.params.document)];
  if (!filename) return res.status(404).json({ error: "Document not found." });
  res.type("text/markdown").send(fs.readFileSync(projectFile(filename), "utf8"));
});

app.get("/api/accounts", requireAuth, (req: AuthedRequest, res) => {
  if (!req.account!.isAdmin) return res.status(403).json({ error: "Admin access required." });
  const accounts = all<{ id: number; username: string; is_admin: number; account_role: AccountRole }>(
    "SELECT id, username, is_admin, account_role FROM accounts ORDER BY username"
  ).map(publicAccount);
  res.json({ accounts });
});

app.post(
  "/api/accounts",
  requireAuth,
  asyncRoute(async (req, res) => {
    if (!req.account!.isAdmin) return res.status(403).json({ error: "Admin access required." });
    const body = parse(
      z.object({
        username: z.string().trim().min(2).max(32),
        password: z.string().min(8).max(128),
        role: z.enum(["admin", "gm", "player"]).default("player"),
        roomId: z.number().int().positive().optional()
      }),
      req.body,
      res
    );
    if (!body) return;
    const accountRole = body.role ?? "player";
    const hash = await bcrypt.hash(body.password, 12);
    try {
      const result = db
        .prepare(
          "INSERT INTO accounts (username, password_hash, is_admin, account_role, created_by) VALUES (?, ?, ?, ?, ?)"
        )
        .run(body.username, hash, accountRole === "admin" ? 1 : 0, accountRole, req.account!.id);
      const accountId = Number(result.lastInsertRowid);
      if (body.roomId) {
        if (roomRole(req.account!.id, body.roomId) !== "gm")
          return res.status(403).json({ error: "You must be this room's GM." });
        db.prepare("INSERT INTO memberships (room_id, account_id, role) VALUES (?, ?, 'player')").run(
          body.roomId,
          accountId
        );
      }
      res.status(201).json({
        account: { id: accountId, username: body.username, isAdmin: accountRole === "admin", role: accountRole }
      });
    } catch (error) {
      if (String(error).includes("UNIQUE")) return res.status(409).json({ error: "That username is already in use." });
      throw error;
    }
  })
);

app.patch(
  "/api/accounts/:accountId/password",
  requireAuth,
  asyncRoute(async (req, res) => {
    const accountId = Number(req.params.accountId);
    const target = one<{ id: number; is_admin: number }>("SELECT id, is_admin FROM accounts WHERE id = ?", accountId);
    if (!target) return res.status(404).json({ error: "Account not found." });
    const managesTarget = Boolean(
      one(
        `SELECT 1 FROM memberships gm
         JOIN memberships player ON player.room_id = gm.room_id
         WHERE gm.account_id = ? AND gm.role = 'gm'
           AND player.account_id = ? AND player.role = 'player' LIMIT 1`,
        req.account!.id,
        accountId
      )
    );
    if (!canResetAccountPassword(req.account!.isAdmin, Boolean(target.is_admin), managesTarget)) {
      const error = target.is_admin
        ? "Game masters cannot reset a server admin’s password."
        : "You can only reset passwords for your room’s players.";
      return res.status(403).json({ error });
    }
    const body = parse(z.object({ password: z.string().min(8).max(128) }), req.body, res);
    if (!body) return;
    const passwordHash = await bcrypt.hash(body.password, 12);
    db.exec("BEGIN");
    try {
      db.prepare("UPDATE accounts SET password_hash = ? WHERE id = ?").run(passwordHash, accountId);
      db.prepare("DELETE FROM sessions WHERE account_id = ?").run(accountId);
      disconnectAccount(accountId);
      db.exec("COMMIT");
      res.status(204).end();
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  })
);
app.get("/api/rooms", requireAuth, (req: AuthedRequest, res) => {
  const rooms = all<{
    id: number;
    name: string;
    system: SystemId;
    theme: ThemeId;
    role: "gm" | "player";
    archived: number;
    calendar_enabled: number;
    map_notation_enabled: number;
  }>(
    `SELECT r.id, r.name, r.system, r.theme, m.role, r.archived, r.calendar_enabled, r.map_notation_enabled FROM rooms r
     JOIN memberships m ON m.room_id = r.id WHERE m.account_id = ? ORDER BY r.archived, r.name`,
    req.account!.id
  ).map(({ calendar_enabled, map_notation_enabled, ...room }) => ({
    ...room,
    archived: Boolean(room.archived),
    calendarEnabled: Boolean(calendar_enabled),
    mapNotationEnabled: Boolean(map_notation_enabled)
  }));
  res.json({ rooms });
});

app.post("/api/rooms", requireAuth, (req: AuthedRequest, res) => {
  if (req.account!.role === "player") return res.status(403).json({ error: "A GM or admin account is required." });
  const body = parse(
    z.object({
      name: z.string().trim().min(2).max(80),
      system: z.enum(SYSTEM_IDS),
      theme: z.enum(THEME_IDS).optional()
    }),
    req.body,
    res
  );
  if (!body) return;
  const theme = body.theme ?? systems[body.system].defaultTheme;
  db.exec("BEGIN");
  try {
    const result = db
      .prepare("INSERT INTO rooms (name, system, theme, created_by) VALUES (?, ?, ?, ?)")
      .run(body.name, body.system, theme, req.account!.id);
    const roomId = Number(result.lastInsertRowid);
    db.prepare("INSERT INTO memberships (room_id, account_id, role) VALUES (?, ?, 'gm')").run(roomId, req.account!.id);
    db.prepare("INSERT INTO room_state (room_id) VALUES (?)").run(roomId);
    db.exec("COMMIT");
    res.status(201).json({
      room: {
        id: roomId,
        name: body.name,
        system: body.system,
        theme,
        role: "gm",
        archived: false,
        calendarEnabled: false,
        mapNotationEnabled: false
      }
    });
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
});

app.get("/api/rooms/:roomId", requireAuth, (req: AuthedRequest, res) => {
  const roomId = Number(req.params.roomId);
  const role = roomRole(req.account!.id, roomId);
  if (!role) return res.status(404).json({ error: "Room not found." });
  const room = one<{
    id: number;
    name: string;
    system: SystemId;
    theme: ThemeId;
    archived: number;
    calendar_enabled: number;
    calendar_json: string | null;
    map_notation_enabled: number;
  }>(
    "SELECT id, name, system, theme, archived, calendar_enabled, calendar_json, map_notation_enabled FROM rooms WHERE id = ?",
    roomId
  )!;
  const members = all<{
    account_id: number;
    username: string;
    character_name: string | null;
    active_character_id: number | null;
    role: "gm" | "player";
    is_admin: number;
  }>(
    `SELECT m.account_id, a.username, c.name AS character_name, m.active_character_id, m.role, a.is_admin FROM memberships m
     JOIN accounts a ON a.id = m.account_id
     LEFT JOIN characters c ON c.id = m.active_character_id
     WHERE m.room_id = ? ORDER BY m.role, a.username`,
    roomId
  ).map((member) => ({
    accountId: member.account_id,
    username: member.username,
    displayName: inGameDisplayName(member.username, member.character_name),
    activeCharacterId: member.active_character_id,
    role: member.role,
    isAdmin: Boolean(member.is_admin)
  }));
  const { calendar_enabled, calendar_json, map_notation_enabled, ...roomFields } = room;
  res.json({
    room: {
      ...roomFields,
      archived: Boolean(room.archived),
      role,
      calendarEnabled: Boolean(calendar_enabled),
      calendar: readCalendar(calendar_json),
      mapNotationEnabled: Boolean(map_notation_enabled)
    },
    members
  });
});

app.patch("/api/rooms/:roomId", requireAuth, (req: AuthedRequest, res) => {
  const roomId = Number(req.params.roomId);
  if (roomRole(req.account!.id, roomId) !== "gm")
    return res.status(403).json({ error: "Only the room GM can change room settings." });
  const body = parse(
    z
      .object({
        theme: z.enum(THEME_IDS).optional(),
        archived: z.boolean().optional(),
        calendarEnabled: z.boolean().optional(),
        mapNotationEnabled: z.boolean().optional()
      })
      .refine(
        (value) =>
          value.theme !== undefined ||
          value.archived !== undefined ||
          value.calendarEnabled !== undefined ||
          value.mapNotationEnabled !== undefined
      ),
    req.body,
    res
  );
  if (!body) return;
  const currentRoom = one<{ calendar_enabled: number; map_notation_enabled: number }>(
    "SELECT calendar_enabled, map_notation_enabled FROM rooms WHERE id = ?",
    roomId
  );
  if (!currentRoom) return res.status(404).json({ error: "Room not found." });
  const firstCalendarEnable =
    body.calendarEnabled === true &&
    !currentRoom.calendar_enabled &&
    claimRoomEasterEgg(roomId, CALENDAR_STRICT_TIME_EGG_ID);
  const firstMapNotationEnable =
    body.mapNotationEnabled === true &&
    !currentRoom.map_notation_enabled &&
    claimRoomEasterEgg(roomId, MAP_NOTATION_ROAD_EGG_ID);
  if (body.theme) db.prepare("UPDATE rooms SET theme = ? WHERE id = ?").run(body.theme, roomId);
  if (body.archived !== undefined)
    db.prepare("UPDATE rooms SET archived = ? WHERE id = ?").run(body.archived ? 1 : 0, roomId);
  if (body.calendarEnabled !== undefined)
    db.prepare("UPDATE rooms SET calendar_enabled = ? WHERE id = ?").run(body.calendarEnabled ? 1 : 0, roomId);
  if (body.mapNotationEnabled !== undefined)
    db.prepare("UPDATE rooms SET map_notation_enabled = ? WHERE id = ?").run(body.mapNotationEnabled ? 1 : 0, roomId);
  const easterEggMessages = [
    firstCalendarEnable ? recordSystemMessage(roomId, req.account!.id, CALENDAR_STRICT_TIME_EGG_MESSAGE) : undefined,
    firstMapNotationEnable ? recordSystemMessage(roomId, req.account!.id, MAP_NOTATION_ROAD_EGG_MESSAGE) : undefined
  ].filter((message) => message !== undefined);
  broadcastRoom(roomId, { type: "room-updated" });
  for (const message of easterEggMessages) broadcastRoom(roomId, { type: "message", message });
  res.status(204).end();
});

app.put("/api/rooms/:roomId/calendar", requireAuth, (req: AuthedRequest, res) => {
  const roomId = Number(req.params.roomId);
  if (roomRole(req.account!.id, roomId) !== "gm")
    return res.status(403).json({ error: "Only the room GM can configure the calendar." });
  const parsedCalendar = parse(calendarSchema, calendarInput(req.body), res);
  if (!parsedCalendar) return;
  const calendar = normalizeCalendar(parsedCalendar);
  db.prepare("UPDATE rooms SET calendar_json = ? WHERE id = ?").run(JSON.stringify(calendar), roomId);
  broadcastRoom(roomId, { type: "calendar-updated", calendar });
  res.json({ calendar });
});

app.post("/api/rooms/:roomId/calendar/advance", requireAuth, (req: AuthedRequest, res) => {
  const roomId = Number(req.params.roomId);
  if (roomRole(req.account!.id, roomId) !== "gm")
    return res.status(403).json({ error: "Only the room GM can advance time." });
  const row = one<{ calendar_json: string | null }>("SELECT calendar_json FROM rooms WHERE id = ?", roomId);
  if (!row) return res.status(404).json({ error: "Room not found." });
  const calendar = advanceCalendar(readCalendar(row.calendar_json));
  db.prepare("UPDATE rooms SET calendar_json = ? WHERE id = ?").run(JSON.stringify(calendar), roomId);
  const message = recordSystemMessage(roomId, req.account!.id, calendarNowMessage(calendar));
  broadcastRoom(roomId, { type: "calendar-updated", calendar });
  broadcastRoom(roomId, { type: "message", message });
  res.json({ calendar, message });
});

app.get("/api/rooms/:roomId/messages", requireAuth, (req: AuthedRequest, res) => {
  const roomId = Number(req.params.roomId);
  const role = roomRole(req.account!.id, roomId);
  if (!role) return res.status(404).json({ error: "Room not found." });
  const publicMessages = all<any>(
    `SELECT m.id, m.room_id, m.account_id, a.username, c.name AS character_name,
            m.kind, m.body, m.detail, m.created_at
     FROM messages m JOIN accounts a ON a.id = m.account_id
     LEFT JOIN memberships rm ON rm.room_id = m.room_id AND rm.account_id = m.account_id
     LEFT JOIN characters c ON c.id = rm.active_character_id
     WHERE m.room_id = ? ORDER BY m.id DESC LIMIT 200`,
    roomId
  )
    .reverse()
    .map(publicMessage)
    .filter((message) => role !== "gm" || message.body !== DEFAULT_TABLE_ROLL_NOTICE);
  const privateMessages = all<{
    id: number;
    room_id: number;
    account_id: number;
    username: string;
    character_name: string | null;
    expression: string;
    result: string;
    created_at: string;
  }>(
    `SELECT pr.id, pr.room_id, pr.account_id, a.username, c.name AS character_name,
            pr.expression, pr.result, pr.created_at
     FROM private_rolls pr JOIN accounts a ON a.id = pr.account_id
     LEFT JOIN memberships rm ON rm.room_id = pr.room_id AND rm.account_id = pr.account_id
     LEFT JOIN characters c ON c.id = rm.active_character_id
     WHERE pr.room_id = ? AND (pr.account_id = ? OR ? = 'gm') ORDER BY pr.id DESC LIMIT 200`,
    roomId,
    req.account!.id,
    // The GM reads every private roll at their table; a player reads only theirs.
    role
  )
    .reverse()
    .map(privateRollMessage);
  const messages = [...publicMessages, ...privateMessages]
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .slice(-200);
  res.json({ messages });
});
app.delete("/api/rooms/:roomId/messages", requireAuth, (req: AuthedRequest, res) => {
  const roomId = Number(req.params.roomId);
  if (roomRole(req.account!.id, roomId) !== "gm")
    return res.status(403).json({ error: "Only the room GM can clear chat history." });
  db.prepare("DELETE FROM messages WHERE room_id = ?").run(roomId);
  broadcastRoom(roomId, { type: "messages-cleared" });
  res.status(204).end();
});

app.post("/api/rooms/:roomId/messages", requireAuth, (req: AuthedRequest, res) => {
  const roomId = Number(req.params.roomId);
  if (!roomRole(req.account!.id, roomId)) return res.status(404).json({ error: "Room not found." });
  const body = parse(z.object({ body: z.string().trim().min(1).max(2000) }), req.body, res);
  if (!body) return;
  const expression = parseRollCommand(body.body);
  let kind: "chat" | "roll" = "chat";
  let messageBody = body.body;
  let detail: string | undefined;
  if (expression) {
    try {
      const rolled = rollDice(expression);
      kind = "roll";
      messageBody = `${rolled.expression} → ${rolled.total}`;
      detail = rolled.detail;
    } catch (error) {
      return res.status(400).json({ error: (error as Error).message });
    }
  }
  const result = db
    .prepare("INSERT INTO messages (room_id, account_id, kind, body, detail) VALUES (?, ?, ?, ?, ?)")
    .run(roomId, req.account!.id, kind, messageBody, detail ?? null);
  const row = one<any>(
    `SELECT m.id, m.room_id, m.account_id, a.username, c.name AS character_name,
            m.kind, m.body, m.detail, m.created_at
     FROM messages m JOIN accounts a ON a.id = m.account_id
     LEFT JOIN memberships rm ON rm.room_id = m.room_id AND rm.account_id = m.account_id
     LEFT JOIN characters c ON c.id = rm.active_character_id
     WHERE m.id = ?`,
    Number(result.lastInsertRowid)
  )!;
  const message = publicMessage(row);
  broadcastRoom(roomId, { type: "message", message });
  res.status(201).json({ message });
});

app.post("/api/rooms/:roomId/rolls", requireAuth, (req: AuthedRequest, res) => {
  const roomId = Number(req.params.roomId);
  const role = roomRole(req.account!.id, roomId);
  if (!role) return res.status(404).json({ error: "Room not found." });
  const body = parse(
    z.object({
      expression: z.string().min(1).max(24),
      private: z.boolean().default(false),
      /** Stricter than private: the room is not even told a roll happened. */
      invisible: z.boolean().default(false),
      save: z
        .object({
          target: z.number().int().min(1).max(20),
          label: z.string().trim().min(1).max(40),
          position: z.enum(["normal", "advantage", "disadvantage"])
        })
        .optional(),
      check: z
        .object({
          difficulty: z.number().int().min(1).max(30),
          label: z.string().trim().min(1).max(40)
        })
        .optional()
    }),
    req.body,
    res
  );
  if (!body) return;
  const hidden = body.private || body.invisible;
  // Anyone may keep a roll between themselves and the GM. Leaving no trace at
  // all stays the GM's own privilege.
  if (body.invisible && role !== "gm")
    return res.status(403).json({ error: "Invisible rolls are reserved for the GM." });
  const system = one<{ system: SystemId }>("SELECT system FROM rooms WHERE id = ?", roomId)!.system;
  const diceRules = systems[system].dice;
  if (body.check && !diceRules.skillCheck)
    return res.status(400).json({ error: `${systems[system].name} does not define skill checks.` });
  if (body.save && body.save.position !== "normal" && !diceRules.save.outcomes[body.save.position])
    return res.status(400).json({
      error: `${systems[system].name} does not define ${body.save.position} for saves.`
    });
  let rolled;
  let saveOutcome;
  let checkOutcome;
  try {
    rolled = rollDice(body.save ? "1d20" : body.expression);
    if (body.save) {
      saveOutcome = evaluateSave(rolled.total, body.save.target, body.save.position, diceRules);
      rolled = {
        ...rolled,
        outcome: saveOutcome,
        detail: `${rolled.detail} · ${body.save.label} ${body.save.target} · ${saveOutcome.label}`
      };
    } else if (body.check) {
      checkOutcome = evaluateCheck(rolled.total, body.check.difficulty);
      rolled = {
        ...rolled,
        outcome: checkOutcome,
        detail: `${rolled.detail} · difficulty ${body.check.difficulty} · ${checkOutcome.label}`
      };
    }
  } catch (error) {
    return res.status(400).json({ error: (error as Error).message });
  }
  const rollLabel = body.save
    ? `${body.save.label} save${body.save.position === "normal" ? "" : ` (${body.save.position === "advantage" ? "ADV" : "DIS"})`}`
    : body.check
      ? body.check.label
      : rolled.expression;
  if (hidden) {
    const visibility = body.invisible ? "invisible" : "private";
    const result = db
      .prepare("INSERT INTO private_rolls (room_id, account_id, expression, result) VALUES (?, ?, ?, ?)")
      .run(roomId, req.account!.id, rollLabel, JSON.stringify({ ...rolled, visibility }));
    const row = one<{
      id: number;
      room_id: number;
      account_id: number;
      username: string;
      character_name: string | null;
      expression: string;
      result: string;
      created_at: string;
    }>(
      `SELECT pr.id, pr.room_id, pr.account_id, a.username, c.name AS character_name,
              pr.expression, pr.result, pr.created_at
       FROM private_rolls pr JOIN accounts a ON a.id = pr.account_id
       LEFT JOIN memberships rm ON rm.room_id = pr.room_id AND rm.account_id = pr.account_id
       LEFT JOIN characters c ON c.id = rm.active_character_id
       WHERE pr.id = ?`,
      Number(result.lastInsertRowid)
    )!;
    const message = privateRollMessage(row);
    // A private roll still tells the room something happened; an invisible one
    // leaves no trace at all.
    if (!body.invisible) broadcastRoom(roomId, { type: "message", message: rollNotice(roomId, req.account!.id) });
    // The GM reads the table's private rolls, so a player's arrives live; the
    // roller already has it in this response.
    if (role !== "gm") sendToRoomGms(roomId, { type: "message", message });
    return res.status(201).json({ roll: rolled, message, private: true });
  }
  const result = db
    .prepare("INSERT INTO messages (room_id, account_id, kind, body, detail) VALUES (?, ?, 'roll', ?, ?)")
    .run(
      roomId,
      req.account!.id,
      `${rollLabel} → ${rolled.total}${body.save ? ` · ${saveOutcome!.label}` : body.check ? ` · ${checkOutcome!.label}` : ""}`,
      rolled.detail
    );
  const row = one<any>(
    `SELECT m.id, m.room_id, m.account_id, a.username, c.name AS character_name,
            m.kind, m.body, m.detail, m.created_at
     FROM messages m JOIN accounts a ON a.id = m.account_id
     LEFT JOIN memberships rm ON rm.room_id = m.room_id AND rm.account_id = m.account_id
     LEFT JOIN characters c ON c.id = rm.active_character_id
     WHERE m.id = ?`,
    Number(result.lastInsertRowid)
  )!;
  const message = publicMessage(row);
  broadcastRoom(roomId, { type: "message", message });
  res.status(201).json({ roll: rolled, message, private: false });
});

app.get("/api/rooms/:roomId/private-rolls", requireAuth, (req: AuthedRequest, res) => {
  const roomId = Number(req.params.roomId);
  if (roomRole(req.account!.id, roomId) !== "gm")
    return res.status(403).json({ error: "Only the room GM can view private rolls." });
  // Every private roll at the table, the GM's own and the players'.
  const rolls = all<{ id: number; expression: string; result: string; created_at: string }>(
    "SELECT id, expression, result, created_at FROM private_rolls WHERE room_id = ? ORDER BY id DESC LIMIT 100",
    roomId
  ).map((row) => ({
    id: row.id,
    expression: row.expression,
    result: JSON.parse(row.result),
    createdAt: row.created_at
  }));
  res.json({ rolls });
});

app.get("/api/rooms/:roomId/rules", requireAuth, (req: AuthedRequest, res) => {
  const roomId = Number(req.params.roomId);
  const role = roomRole(req.account!.id, roomId);
  if (!role) return res.status(404).json({ error: "Room not found." });
  const system = one<{ system: SystemId }>("SELECT system FROM rooms WHERE id = ?", roomId)!.system;
  res.type("text/markdown").send(rulesMarkdown(system, role));
});

const clientDist = projectFile("client", "dist");
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get("/{*splat}", (_req, res) => res.sendFile(projectFile("client", "dist", "index.html")));
}

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error("Request failed", { error: error instanceof Error ? error.message : String(error) });
  res.status(500).json({ error: "The server could not complete that request." });
});

const server = http.createServer(app);
attachRealtime(server);
server.listen(config.port, () =>
  logger.info("The Devil's Toys is ready", { port: config.port, dataDir: config.dataDir })
);
