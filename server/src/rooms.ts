import fs from "node:fs";
import path from "node:path";
import type { SystemId, ThemeId } from "@devils-toys/shared";
import { all, db, one } from "./db.js";
import { config } from "./config.js";

/**
 * Making a room, handing one to a different GM, and destroying one — the three
 * things that happen to a room as a whole rather than to what is inside it.
 *
 * They live here because a room is now made and unmade from more than one
 * place: the rail's New room, a campaign import, and the management panel's
 * Rooms section. A second copy of "insert the row, make the creator its GM, and
 * remember the room state row" is a second chance to leave a room without one.
 */

/** A room's GM chair is a membership, so handing it over rewrites memberships. */
export interface RoomCreation {
  name: string;
  system: SystemId;
  theme: ThemeId;
  /** Whoever sits in the GM chair. They are recorded as the room's creator too. */
  gmAccountId: number;
}

/**
 * Inserts a room, seats its GM, and gives it the state row every room is read
 * through. One transaction, because a room missing any of the three is not a
 * half-made room — it is a broken one.
 */
export function createRoom({ name, system, theme, gmAccountId }: RoomCreation): number {
  db.exec("BEGIN");
  try {
    const roomId = Number(
      db
        .prepare("INSERT INTO rooms (name, system, theme, created_by) VALUES (?, ?, ?, ?)")
        .run(name, system, theme, gmAccountId).lastInsertRowid
    );
    db.prepare("INSERT INTO memberships (room_id, account_id, role) VALUES (?, ?, 'gm')").run(roomId, gmAccountId);
    db.prepare("INSERT INTO room_state (room_id) VALUES (?)").run(roomId);
    db.exec("COMMIT");
    return roomId;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/**
 * Seats a new GM at a room that already has one.
 *
 * The outgoing GM keeps their seat at the table as a player rather than being
 * turned out of it, which is what demoting a GM account already does to the
 * rooms it owned. The room's `created_by` follows the chair, so the account
 * that owns the room and the account that runs it never disagree.
 *
 * Returns the accounts whose standing in the room changed, so a caller can tell
 * their open clients.
 */
export function assignRoomGm(roomId: number, gmAccountId: number): { replaced: number[] } {
  const seated = all<{ account_id: number }>(
    "SELECT account_id FROM memberships WHERE room_id = ? AND role = 'gm'",
    roomId
  ).map((row) => row.account_id);
  if (seated.length === 1 && seated[0] === gmAccountId) return { replaced: [] };
  db.exec("BEGIN");
  try {
    for (const accountId of seated) {
      if (accountId === gmAccountId) continue;
      db.prepare("UPDATE memberships SET role = 'player' WHERE room_id = ? AND account_id = ?").run(roomId, accountId);
    }
    db.prepare(
      `INSERT INTO memberships (room_id, account_id, role) VALUES (?, ?, 'gm')
       ON CONFLICT(room_id, account_id) DO UPDATE SET role = 'gm'`
    ).run(roomId, gmAccountId);
    // A GM plays nobody's character, so a chair that was a player's a moment ago
    // stops pointing at the sheet they were holding.
    db.prepare("UPDATE memberships SET active_character_id = NULL WHERE room_id = ? AND account_id = ?").run(
      roomId,
      gmAccountId
    );
    db.prepare("UPDATE rooms SET created_by = ? WHERE id = ?").run(gmAccountId, roomId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return { replaced: seated.filter((accountId) => accountId !== gmAccountId) };
}

/**
 * Deletes a room and every file it owns, so deleting it does not leave its
 * pictures behind. Hireling and ship portraits are columns on their rows now
 * rather than tables of their own.
 */
export function deleteRoom(roomId: number): boolean {
  if (!one<{ id: number }>("SELECT id FROM rooms WHERE id = ?", roomId)) return false;
  const storedNames = all<{ stored_name: string }>(
    `SELECT stored_name FROM media WHERE room_id = ?
     UNION ALL
     SELECT portrait_stored_name AS stored_name FROM group_hirelings
       WHERE room_id = ? AND portrait_stored_name IS NOT NULL
     UNION ALL
     SELECT portrait_stored_name AS stored_name FROM group_assets
       WHERE room_id = ? AND portrait_stored_name IS NOT NULL`,
    roomId,
    roomId,
    roomId
  );
  db.prepare("DELETE FROM rooms WHERE id = ?").run(roomId);
  const uploadsDir = path.join(config.dataDir, "uploads");
  for (const media of storedNames) {
    if (path.basename(media.stored_name) !== media.stored_name) continue;
    try {
      fs.rmSync(path.join(uploadsDir, media.stored_name), { force: true });
    } catch {
      // The database deletion remains authoritative if an already-missing file cannot be removed.
    }
  }
  return true;
}
