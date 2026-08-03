import { z } from "zod";
import { all, db, one } from "./db.js";

/**
 * The group's roster as rows: hirelings, the shared property a system gives its
 * party, and what the party owes. Each is a record with its own id and its own
 * sheet, in the shape `characters` already uses — a row for what the database
 * has to know about, and one JSON column for the definition-driven fields it
 * must not have to know about.
 *
 * They were entries inside `room_state.group_json` until the migration in
 * `db.ts` moved them. `group_json` still exists, and still holds the group's own
 * fields; it just no longer holds the roster.
 */

export type GroupRowTable = "group_hirelings" | "group_assets" | "group_obligations";

interface BaseRow {
  id: number;
  room_id: number;
  name: string;
  sort_order: number;
  legacy_id: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
}

export interface SheetRow extends BaseRow {
  sheet_json: string;
  portrait_filename: string | null;
  portrait_stored_name: string | null;
  portrait_mime_type: string | null;
  portrait_size: number | null;
}

export interface AssetRow extends SheetRow {
  kind: string;
}

export interface ObligationRow extends BaseRow {
  owed_to: string;
  amount: string;
  details: string;
}

export const groupSheetSchema = z.record(z.unknown()).refine((value) => JSON.stringify(value).length <= 100_000, {
  message: "That sheet is too large."
});

function parseSheet(json: string | null | undefined) {
  try {
    const parsed: unknown = JSON.parse(json ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * A row's portrait, as an address rather than a path. The stored name is in the
 * query so a replaced picture is a different address and no cache serves the old
 * one — the same trick the image tables used before they became columns.
 */
function portraitUrl(kind: "hirelings" | "assets", roomId: number, row: SheetRow) {
  return row.portrait_stored_name
    ? `/api/rooms/${roomId}/group/${kind}/${row.id}/image?v=${encodeURIComponent(row.portrait_stored_name)}`
    : null;
}

export function publicHireling(row: SheetRow) {
  return {
    id: row.id,
    name: row.name,
    sheet: parseSheet(row.sheet_json),
    sortOrder: row.sort_order,
    imageUrl: portraitUrl("hirelings", row.room_id, row),
    revision: row.revision,
    updatedAt: row.updated_at
  };
}

export function publicAsset(row: AssetRow) {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    sheet: parseSheet(row.sheet_json),
    sortOrder: row.sort_order,
    imageUrl: portraitUrl("assets", row.room_id, row),
    revision: row.revision,
    updatedAt: row.updated_at
  };
}

export function publicObligation(row: ObligationRow) {
  return {
    id: row.id,
    name: row.name,
    owedTo: row.owed_to,
    amount: row.amount,
    details: row.details,
    sortOrder: row.sort_order,
    revision: row.revision,
    updatedAt: row.updated_at
  };
}

export function hirelingsFor(roomId: number) {
  return all<SheetRow>("SELECT * FROM group_hirelings WHERE room_id = ? ORDER BY sort_order, id", roomId);
}

export function assetsFor(roomId: number) {
  return all<AssetRow>("SELECT * FROM group_assets WHERE room_id = ? ORDER BY sort_order, id", roomId);
}

export function obligationsFor(roomId: number) {
  return all<ObligationRow>("SELECT * FROM group_obligations WHERE room_id = ? ORDER BY sort_order, id", roomId);
}

export function groupRow<T>(table: GroupRowTable, roomId: number, id: number) {
  if (!Number.isInteger(id) || id <= 0) return;
  return one<T>(`SELECT * FROM ${table} WHERE id = ? AND room_id = ?`, id, roomId);
}

/** Where a new row goes: after everything already there. */
export function nextSortOrder(table: GroupRowTable, roomId: number) {
  return (
    (one<{ next: number }>(`SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM ${table} WHERE room_id = ?`, roomId)
      ?.next ?? 0) | 0
  );
}

/**
 * A stale write, answered the way the calendar answers one. The unit is the row
 * rather than the document, so two people editing two different hirelings never
 * collide — which is the practical difference between this and the blob.
 * The counter is what the check reads, not `updated_at`. `CURRENT_TIMESTAMP` is
 * whole seconds, so two writes inside the same second carry the same timestamp
 * and a clash between them would go unnoticed.
 */
export function staleWrite(current: { revision: number }, sentRevision: number | null | undefined) {
  return typeof sentRevision === "number" && sentRevision !== current.revision;
}

export function touchRow(table: GroupRowTable, id: number) {
  db.prepare(`UPDATE ${table} SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id);
}

/**
 * Reorder by listing ids in the order they should sit. Ids that are not in the
 * room are ignored rather than refused: a reorder is a presentation change, and
 * one arriving beside a deletion made elsewhere should still place the rest.
 */
export function reorderRows(table: GroupRowTable, roomId: number, ids: number[]) {
  const present = new Set(all<{ id: number }>(`SELECT id FROM ${table} WHERE room_id = ?`, roomId).map((r) => r.id));
  const ordered = ids.filter((id) => present.has(id));
  const update = db.prepare(`UPDATE ${table} SET sort_order = ? WHERE id = ? AND room_id = ?`);
  db.exec("BEGIN IMMEDIATE");
  try {
    ordered.forEach((id, index) => update.run(index, id, roomId));
    // Anything the list did not mention keeps its place after what it did.
    let next = ordered.length;
    for (const id of present) if (!ordered.includes(id)) update.run(next++, id, roomId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
