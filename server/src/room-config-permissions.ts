import type express from "express";
import type { RoomConfigAccess, RoomRuleSettings, SystemId, ThemeId } from "@devils-toys/shared";
import type { AuthAccount, AuthedRequest } from "./auth.js";
import { roomRole } from "./auth.js";
import { all, one } from "./db.js";
import { roomRules } from "./system-rules.js";

/**
 * Who may open a room's configuration, in one place because Room Config is a
 * second surface onto rooms and a second copy of this rule is a second chance to
 * get it wrong. It says three things:
 *
 * - a **player** configures nothing, in any room, ever;
 * - a **GM** configures the rooms their membership makes them GM of, and no
 *   others — being a GM-level account is not on its own enough;
 * - an **admin** configures every room on the server, member or not.
 *
 * The admin case is the reason this module exists. `roomRole` answers from
 * `memberships` alone, so an admin who never joined a room has no role in it and
 * reaches nothing. Widening `roomRole` to cover them would hand admins GM
 * presence, GM-only broadcasts, and GM roll privacy in every room at the same
 * time, so the widening lives here and applies only to configuration routes.
 *
 * Nothing here makes an admin a member. `roomMembers` and presence keep reading
 * `memberships`, and an admin configuring a room is not at its table.
 */

/** A room as the panel's selector lists it. */
export interface ConfigurableRoom {
  id: number;
  name: string;
  system: SystemId;
  theme: ThemeId;
  archived: boolean;
  calendarEnabled: boolean;
  mapNotationEnabled: boolean;
  musicEnabled: boolean;
  /** Where the room stands on its system's optional rules, already resolved. */
  rules: RoomRuleSettings;
  access: RoomConfigAccess;
}

interface RoomRow {
  id: number;
  name: string;
  system: SystemId;
  theme: ThemeId;
  archived: number;
  calendar_enabled: number;
  map_notation_enabled: number;
  music_enabled: number;
}

const roomColumns = "id, name, system, theme, archived, calendar_enabled, map_notation_enabled, music_enabled";
const prefixedRoomColumns = roomColumns
  .split(", ")
  .map((column) => `r.${column}`)
  .join(", ");

function publicRoom(row: RoomRow, access: RoomConfigAccess): ConfigurableRoom {
  return {
    id: row.id,
    name: row.name,
    system: row.system,
    theme: row.theme,
    archived: Boolean(row.archived),
    calendarEnabled: Boolean(row.calendar_enabled),
    mapNotationEnabled: Boolean(row.map_notation_enabled),
    musicEnabled: Boolean(row.music_enabled),
    rules: roomRules(row.id, row.system),
    access
  };
}

/**
 * Whether this account may configure this room, and on what footing. Returns
 * undefined for a room that does not exist as well as for one the account may
 * not reach, so a caller cannot accidentally tell the two apart.
 */
export function roomConfigAccess(account: AuthAccount, roomId: number): RoomConfigAccess | undefined {
  if (!Number.isInteger(roomId) || roomId <= 0) return;
  if (account.role === "player") return;
  // `is_admin` is written from `account_role` at the single site that changes a
  // role, so the two cannot disagree; this reads the same field the rest of the
  // server's admin checks read.
  if (account.isAdmin) return one<{ id: number }>("SELECT id FROM rooms WHERE id = ?", roomId) ? "admin" : undefined;
  return roomRole(account.id, roomId) === "gm" ? "gm" : undefined;
}

/**
 * The role a room's own routes should treat this account as having.
 *
 * Anyone who may configure the room sees it as its GM: that is what configuring
 * it means, and a Library the admin cannot list is not a Library they can
 * manage. Everyone else is whatever their membership says.
 *
 * Two consequences worth being explicit about:
 *
 * - **Nothing here touches membership.** Presence, chat, private rolls, and the
 *   room list all keep reading `memberships`, so an admin holding this is still
 *   not at the table.
 * - **An admin who plays in a room sees it as its GM**, in the game as well as
 *   in the panel. That follows from admins reaching every room, and one answer
 *   that holds everywhere is worth more than a narrower one that disagrees with
 *   itself depending on which screen asked.
 *
 * Room routes call this instead of `roomRole` where the panel needs them; it is
 * the same check in both places rather than a second one bolted alongside.
 */
export function roomAccessRole(account: AuthAccount, roomId: number): "gm" | "player" | undefined {
  if (roomConfigAccess(account, roomId)) return "gm";
  return roomRole(account.id, roomId);
}

/**
 * The rooms this account may configure. Archived rooms are included and marked:
 * retiring a room is exactly when a GM wants to go and tidy it up.
 */
export function configurableRooms(account: AuthAccount): ConfigurableRoom[] {
  if (account.role === "player") return [];
  if (account.isAdmin)
    return all<RoomRow>(`SELECT ${roomColumns} FROM rooms ORDER BY archived, name`).map((row) =>
      publicRoom(row, "admin")
    );
  return all<RoomRow>(
    `SELECT ${prefixedRoomColumns} FROM rooms r
       JOIN memberships m ON m.room_id = r.id
       WHERE m.account_id = ? AND m.role = 'gm'
       ORDER BY r.archived, r.name`,
    account.id
  ).map((row) => publicRoom(row, "gm"));
}

/** One room this account may configure, or undefined. */
export function configurableRoom(account: AuthAccount, roomId: number): ConfigurableRoom | undefined {
  const access = roomConfigAccess(account, roomId);
  if (!access) return;
  const row = one<RoomRow>(`SELECT ${roomColumns} FROM rooms WHERE id = ?`, roomId);
  return row && publicRoom(row, access);
}

/**
 * Route gate. Resolves `:roomId`, answers the request itself when the account
 * may not have it, and otherwise returns the id.
 *
 * A room the account may not configure and a room that does not exist get the
 * same 404, matching how `media.ts` and `group.ts` already refuse: a GM must not
 * be able to enumerate another GM's rooms by watching status codes.
 */
export function requireRoomConfig(req: AuthedRequest, res: express.Response): number | undefined {
  if (!req.account) {
    res.status(401).json({ error: "Sign in required." });
    return;
  }
  if (req.account.role === "player") {
    res.status(403).json({ error: "Room configuration is reserved for GMs and admins." });
    return;
  }
  const roomId = Number(req.params.roomId);
  if (!roomConfigAccess(req.account, roomId)) {
    res.status(404).json({ error: "Room not found." });
    return;
  }
  return roomId;
}
