import http from "node:http";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
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
import { createRoom } from "./rooms.js";
import { canResetAccountPassword } from "./account-permissions.js";
import { managementRouter } from "./management.js";
import { mediaRouter } from "./media.js";
import { audioRouter, pauseRoomAudio } from "./audio.js";
import { attachRealtime, broadcastRoom, broadcastRoomByRole, disconnectAccount, sendToRoomGms } from "./realtime.js";
import { npcRouter } from "./npcs.js";
import { DEFAULT_TABLE_ROLL_NOTICE, tableRouter } from "./tables.js";
import { tagRouter } from "./table-tags.js";
import { roomTagRouter } from "./room-tags.js";
import { tableSetRouter } from "./table-sets.js";
import { tablesLinkRouter } from "./tables-link.js";
import { asyncRoute, parse, publicAccount, sessionRouter } from "./session-routes.js";
import { systemRouter } from "./system-routes.js";
import { isSystemOffered, loadInstalledSystems } from "./system-registry.js";
import { groupRouter } from "./group.js";
import { encounterRouter } from "./encounters.js";
import { mapNotationRouter } from "./map-notations.js";
import { roomConfigRouter } from "./room-config.js";
import { campaignRouter } from "./campaign-routes.js";
import { roomItemRouter } from "./room-item-routes.js";
import { playlistRouter } from "./playlists.js";
import { helpRouter } from "./help.js";
import { roomAccessRole } from "./room-config-permissions.js";
import { projectFile } from "./paths.js";
import { rulesMarkdown, systemIdSchema, systemOrThrow } from "./systems.js";
import { roomRules, setRoomRules, systemRules } from "./system-rules.js";
import {
  calendarForRole,
  calendarNowMessage,
  damageExpression,
  THEME_IDS,
  type AccountRole,
  type CalendarEvent,
  type RoomCalendar,
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

// Before anything can be served: an installed system has to be in the registry
// or every room on it would 500 on its first request.
loadInstalledSystems();

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
app.use("/api", roomTagRouter);
app.use("/api", tablesLinkRouter);
app.use("/api", groupRouter);
app.use("/api", encounterRouter);
app.use("/api", roomAdminRouter);
app.use("/api", managementRouter);
app.use("/api", sessionRouter);
app.use("/api", mapNotationRouter);
app.use("/api", roomConfigRouter);
app.use("/api", roomItemRouter);
app.use("/api", playlistRouter);
app.use("/api", campaignRouter);
app.use("/api", helpRouter);
app.use("/api", systemRouter);
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
  // The guides cite two of these by filename, so they are reachable rather than
  // dead links out of `docs/guide/` into a repository nobody reading has.
  const files: Record<string, string> = {
    credits: "credits.md",
    changelog: "changelog.md",
    roadmap: "roadmap.md",
    "devils-tables": "devils-tables.md",
    notice: "NOTICE.md"
  };
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
    systemName: string;
    theme: ThemeId;
    role: "gm" | "player";
    archived: number;
    calendar_enabled: number;
    map_notation_enabled: number;
    music_enabled: number;
  }>(
    // The system's display name comes from the registry rather than from its
    // definition, so a room on a system that is retired — or whose bundle will
    // not load — still says what it is rather than showing a bare id.
    `SELECT r.id, r.name, r.system, s.name AS systemName, r.theme, m.role, r.archived, r.calendar_enabled,
            r.map_notation_enabled, r.music_enabled FROM rooms r
     JOIN memberships m ON m.room_id = r.id
     JOIN systems s ON s.id = r.system WHERE m.account_id = ? ORDER BY r.archived, r.name`,
    req.account!.id
  ).map(({ calendar_enabled, map_notation_enabled, music_enabled, ...room }) => ({
    ...room,
    archived: Boolean(room.archived),
    calendarEnabled: Boolean(calendar_enabled),
    mapNotationEnabled: Boolean(map_notation_enabled),
    musicEnabled: Boolean(music_enabled),
    rules: roomRules(room.id, room.system)
  }));
  res.json({ rooms });
});

app.post("/api/rooms", requireAuth, (req: AuthedRequest, res) => {
  if (req.account!.role === "player") return res.status(403).json({ error: "A GM or admin account is required." });
  const body = parse(
    z.object({
      name: z.string().trim().min(2).max(80),
      system: systemIdSchema,
      theme: z.enum(THEME_IDS).optional()
    }),
    req.body,
    res
  );
  if (!body) return;
  // Registered but retired: the rooms already on it keep working, and this is
  // the difference between retiring a system and deleting one.
  if (!isSystemOffered(body.system))
    return res.status(409).json({ error: `${systemOrThrow(body.system).name} is retired and cannot take new rooms.` });
  const theme = body.theme ?? systemOrThrow(body.system).defaultTheme;
  const roomId = createRoom({ name: body.name, system: body.system, theme, gmAccountId: req.account!.id });
  res.status(201).json({
    room: {
      id: roomId,
      name: body.name,
      system: body.system,
      systemName: systemOrThrow(body.system).name,
      theme,
      role: "gm",
      archived: false,
      calendarEnabled: false,
      mapNotationEnabled: false,
      musicEnabled: false,
      // Nothing is recorded for a room this new, so these are the system's
      // own defaults — which is what the room is actually playing by.
      rules: roomRules(roomId, body.system)
    }
  });
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
    music_enabled: number;
  }>(
    `SELECT id, name, system, theme, archived, calendar_enabled, calendar_json, map_notation_enabled, music_enabled
     FROM rooms WHERE id = ?`,
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
  const { calendar_enabled, calendar_json, map_notation_enabled, music_enabled, ...roomFields } = room;
  res.json({
    room: {
      ...roomFields,
      archived: Boolean(room.archived),
      role,
      calendarEnabled: Boolean(calendar_enabled),
      calendar: calendarForRole(readCalendar(calendar_json), role),
      mapNotationEnabled: Boolean(map_notation_enabled),
      musicEnabled: Boolean(music_enabled),
      rules: roomRules(roomId, room.system)
    },
    members,
    // The declarations rather than the settings: the labels and hints belong to
    // the system, and only the GM's settings panel has anywhere to put them.
    optionalRules: systemRules(room.system)
  });
});

app.patch("/api/rooms/:roomId", requireAuth, (req: AuthedRequest, res) => {
  const roomId = Number(req.params.roomId);
  if (roomAccessRole(req.account!, roomId) !== "gm")
    return res.status(403).json({ error: "Only the room GM can change room settings." });
  const body = parse(
    z
      .object({
        theme: z.enum(THEME_IDS).optional(),
        archived: z.boolean().optional(),
        calendarEnabled: z.boolean().optional(),
        mapNotationEnabled: z.boolean().optional(),
        musicEnabled: z.boolean().optional(),
        /** Only the rules being moved, by the ids the system declared them under. */
        rules: z.record(z.string(), z.boolean()).optional()
      })
      .refine(
        (value) =>
          value.theme !== undefined ||
          value.archived !== undefined ||
          value.calendarEnabled !== undefined ||
          value.mapNotationEnabled !== undefined ||
          value.musicEnabled !== undefined ||
          value.rules !== undefined
      ),
    req.body,
    res
  );
  if (!body) return;
  const currentRoom = one<{
    system: SystemId;
    calendar_enabled: number;
    map_notation_enabled: number;
    music_enabled: number;
  }>("SELECT system, calendar_enabled, map_notation_enabled, music_enabled FROM rooms WHERE id = ?", roomId);
  if (!currentRoom) return res.status(404).json({ error: "Room not found." });
  if (body.rules) {
    const refused = setRoomRules(roomId, currentRoom.system, body.rules);
    if (refused) return res.status(400).json(refused);
  }
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
  if (body.musicEnabled !== undefined) {
    db.prepare("UPDATE rooms SET music_enabled = ? WHERE id = ?").run(body.musicEnabled ? 1 : 0, roomId);
    if (!body.musicEnabled && currentRoom.music_enabled) pauseRoomAudio(roomId);
  }
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
  if (roomAccessRole(req.account!, roomId) !== "gm")
    return res.status(403).json({ error: "Only the room GM can configure the calendar." });
  const parsedCalendar = parse(calendarSchema, calendarInput(req.body), res);
  if (!parsedCalendar) return;
  let calendar: ReturnType<typeof normalizeCalendar>;
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = one<{ calendar_json: string | null }>("SELECT calendar_json FROM rooms WHERE id = ?", roomId);
    if (!row) {
      db.exec("ROLLBACK");
      return res.status(404).json({ error: "Room not found." });
    }
    const current = readCalendar(row.calendar_json);
    if (parsedCalendar.revision !== current.revision) {
      db.exec("ROLLBACK");
      return res
        .status(409)
        .json({ error: "The calendar changed while you were editing. Review the latest calendar and try again." });
    }
    calendar = normalizeCalendar({ ...parsedCalendar, revision: current.revision + 1 });
    db.prepare("UPDATE rooms SET calendar_json = ? WHERE id = ?").run(JSON.stringify(calendar), roomId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  broadcastRoomByRole(roomId, (role) => ({ type: "calendar-updated", calendar: calendarForRole(calendar, role) }));
  res.json({ calendar });
});

const calendarEntrySchema = z.object({
  name: z.string().trim().min(1).max(100),
  year: z.number().int().min(-99999).max(99999),
  month: z.number().int().min(0).max(99),
  day: z.number().int().min(1).max(400),
  hidden: z.boolean().optional()
});

app.post("/api/rooms/:roomId/calendar/events", requireAuth, (req: AuthedRequest, res) => {
  const roomId = Number(req.params.roomId);
  const role = roomRole(req.account!.id, roomId);
  if (!role) return res.status(404).json({ error: "Room not found." });
  const body = parse(calendarEntrySchema, req.body, res);
  if (!body) return;
  if (body.hidden && role !== "gm")
    return res.status(403).json({ error: "Only the room GM can add a hidden calendar entry." });

  let calendar: RoomCalendar;
  let entry: CalendarEvent;
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = one<{ calendar_json: string | null }>("SELECT calendar_json FROM rooms WHERE id = ?", roomId);
    if (!row) {
      db.exec("ROLLBACK");
      return res.status(404).json({ error: "Room not found." });
    }
    const current = readCalendar(row.calendar_json);
    if (body.month >= current.monthNames.length || body.day > current.daysPerMonth) {
      db.exec("ROLLBACK");
      return res.status(400).json({ error: "That date does not exist on this calendar." });
    }
    if (current.events.length >= 500) {
      db.exec("ROLLBACK");
      return res.status(409).json({ error: "This calendar already has the maximum number of entries." });
    }
    entry = {
      id: randomUUID(),
      name: body.name,
      cadence: "once",
      startYear: body.year,
      month: body.month,
      day: body.day,
      intervalDays: current.daysPerWeek,
      durationDays: 1,
      hidden: role === "gm" && Boolean(body.hidden)
    };
    calendar = { ...current, revision: current.revision + 1, events: [...current.events, entry] };
    db.prepare("UPDATE rooms SET calendar_json = ? WHERE id = ?").run(JSON.stringify(calendar), roomId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  broadcastRoomByRole(roomId, (readerRole) => ({
    type: "calendar-updated",
    calendar: calendarForRole(calendar, readerRole)
  }));
  res.status(201).json({ calendar: calendarForRole(calendar, role), entry });
});

app.post("/api/rooms/:roomId/calendar/advance", requireAuth, (req: AuthedRequest, res) => {
  const roomId = Number(req.params.roomId);
  if (roomRole(req.account!.id, roomId) !== "gm")
    return res.status(403).json({ error: "Only the room GM can advance time." });
  let calendar: ReturnType<typeof advanceCalendar> & { revision: number };
  let message: ReturnType<typeof recordSystemMessage>;
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = one<{ calendar_json: string | null }>("SELECT calendar_json FROM rooms WHERE id = ?", roomId);
    if (!row) {
      db.exec("ROLLBACK");
      return res.status(404).json({ error: "Room not found." });
    }
    const current = readCalendar(row.calendar_json);
    calendar = { ...advanceCalendar(current), revision: current.revision + 1 };
    db.prepare("UPDATE rooms SET calendar_json = ? WHERE id = ?").run(JSON.stringify(calendar), roomId);
    message = recordSystemMessage(roomId, req.account!.id, calendarNowMessage(calendar));
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  broadcastRoomByRole(roomId, (role) => ({ type: "calendar-updated", calendar: calendarForRole(calendar, role) }));
  broadcastRoom(roomId, { type: "message", message });
  res.json({ calendar, message });
});

const calendarTimeSchema = z.object({
  year: z.number().int().min(-99999).max(99999),
  month: z.number().int().min(0).max(99),
  day: z.number().int().min(1).max(400),
  segment: z.number().int().min(0).max(99)
});

app.post("/api/rooms/:roomId/calendar/set-time", requireAuth, (req: AuthedRequest, res) => {
  const roomId = Number(req.params.roomId);
  if (roomRole(req.account!.id, roomId) !== "gm")
    return res.status(403).json({ error: "Only the room GM can set time." });
  const body = parse(calendarTimeSchema, req.body, res);
  if (!body) return;

  let calendar: RoomCalendar;
  let message: ReturnType<typeof recordSystemMessage>;
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = one<{ calendar_json: string | null }>("SELECT calendar_json FROM rooms WHERE id = ?", roomId);
    if (!row) {
      db.exec("ROLLBACK");
      return res.status(404).json({ error: "Room not found." });
    }
    const current = readCalendar(row.calendar_json);
    if (
      body.month >= current.monthNames.length ||
      body.day > current.daysPerMonth ||
      body.segment >= current.segmentsPerDay
    ) {
      db.exec("ROLLBACK");
      return res.status(400).json({ error: "That time does not exist on this calendar." });
    }
    calendar = { ...current, ...body, revision: current.revision + 1 };
    db.prepare("UPDATE rooms SET calendar_json = ? WHERE id = ?").run(JSON.stringify(calendar), roomId);
    message = recordSystemMessage(roomId, req.account!.id, calendarNowMessage(calendar));
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  broadcastRoomByRole(roomId, (role) => ({ type: "calendar-updated", calendar: calendarForRole(calendar, role) }));
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
      expression: z.string().min(1).max(24).optional(),
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
        .optional(),
      /**
       * A weapon's damage as the book writes it. The system decides what that
       * means — Cairn and Monolith count only the highest die of an attack — so
       * the caller sends the notation rather than an expression it worked out.
       */
      attack: z
        .object({
          // Long enough for a holder, a weapon, its die, and what the book says
          // the weapon does: "Captain · Laser Rifle (D8) [thermal]".
          label: z.string().trim().min(1).max(100),
          damage: z.string().trim().min(1).max(24)
        })
        .optional()
    }),
    req.body,
    res
  );
  if (!body) return;
  if (!body.expression && !body.attack) return res.status(400).json({ error: "Give a dice expression to roll." });
  const hidden = body.private || body.invisible;
  // Anyone may keep a roll between themselves and the GM. Leaving no trace at
  // all stays the GM's own privilege.
  if (body.invisible && role !== "gm")
    return res.status(403).json({ error: "Invisible rolls are reserved for the GM." });
  const system = one<{ system: SystemId }>("SELECT system FROM rooms WHERE id = ?", roomId)!.system;
  const diceRules = systemOrThrow(system).dice;
  if (body.check && !diceRules.skillCheck)
    return res.status(400).json({ error: `${systemOrThrow(system).name} does not define skill checks.` });
  if (body.save && body.save.position !== "normal" && !diceRules.save.outcomes[body.save.position])
    return res.status(400).json({
      error: `${systemOrThrow(system).name} does not define ${body.save.position} for saves.`
    });
  let attackExpression;
  if (body.attack && !body.save) {
    attackExpression = damageExpression(body.attack.damage, diceRules.damage?.multipleRolls);
    if (!attackExpression)
      return res.status(400).json({
        error: `${body.attack.damage} is not one roll; roll it in the dice builder.`
      });
  }
  let rolled;
  let saveOutcome;
  let checkOutcome;
  try {
    rolled = rollDice(body.save ? "1d20" : (attackExpression ?? body.expression!));
    if (body.attack && !body.save) rolled = { ...rolled, detail: `${rolled.detail} · ${body.attack.damage}` };
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
      : body.attack
        ? body.attack.label
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
