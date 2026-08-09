import { z } from "zod";
import type { CharacterItem, SystemId } from "@devils-toys/shared";
import { classifyItem } from "@devils-toys/shared";
import { all, db, one } from "./db.js";
import { systems } from "./systems.js";

/**
 * A room's own additions to its system's gear.
 *
 * `systems/<id>/items.json` stays the authority for the system, exactly as
 * `AGENTS.md` says: it is hand-edited, seeded once from the book, and compiled
 * into the server bundle. A room cannot write to it — it is inlined by esbuild
 * and read-only in the container — and should not: gear a table invented is that
 * table's, not the system's.
 *
 * So a room gets an overlay instead, resolved the same way the catalogue's own
 * merge resolves the book:
 *
 *     system list  −  ids this room retired  +  items this room added
 *
 * Two things make that safe. A room item's id is namespaced with the room, which
 * `itemId()` can never produce, so a room item and a book item can never collide
 * and a slot's weapon record is never ambiguous. And retiring an id only takes it
 * out of the pickers: slots hold plain text, so gear already written on a sheet
 * stays exactly where it is. That is the same promise `retired` makes in
 * `items.json`.
 */

/** Room item ids are `room:<roomId>:<slug>`, a shape `itemId()` cannot produce. */
export function roomItemId(roomId: number, name: string, spec = "") {
  const slug = (value: string) =>
    value
      .toLocaleLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  const base = `room:${roomId}:${slug(name) || "item"}`;
  const qualifier = slug(spec);
  return qualifier ? `${base}--${qualifier}` : base;
}

export function isRoomItemId(id: string) {
  return id.startsWith("room:");
}

interface RoomItemRow {
  id: number;
  room_id: number;
  item_id: string;
  list_key: string;
  item_json: string;
  updated_at: string;
}

export const roomItemInput = z.object({
  listKey: z.string().min(1).max(80),
  name: z.string().trim().min(1).max(120),
  spec: z.string().trim().max(200).default(""),
  detail: z.string().trim().max(2000).default(""),
  cost: z.string().trim().max(60).default(""),
  category: z.string().trim().max(120).default("")
});

export type RoomItemInput = z.infer<typeof roomItemInput>;

/**
 * Reads a room's entry on exactly the terms the book's own entries are read, so
 * a weapon typed in here is judged a weapon by the same rules — not by a second,
 * looser reading kept for hand-written gear.
 */
export function readRoomItem(system: SystemId, roomId: number, input: RoomItemInput): CharacterItem {
  const definition = systems[system].characterSheet.lists.find((list) => list.key === input.listKey);
  const reading = classifyItem({
    name: input.name,
    category: input.category,
    spec: input.spec,
    detail: input.detail,
    weaponCategories: definition?.weaponCategories,
    weaponRange: systems[system].npcStatblock.weaponRange
  });
  const label = input.spec ? `${input.name} (${input.spec})` : input.name;
  return {
    id: roomItemId(roomId, input.name, input.spec),
    category: input.category,
    name: input.name,
    spec: input.spec,
    detail: input.detail,
    cost: input.cost,
    bulky: /\bbulky\b/i.test(input.spec),
    weapon: reading.weapon,
    ...(reading.damage ? { damage: reading.damage } : {}),
    ...(reading.traits?.length ? { traits: reading.traits } : {}),
    ...(reading.range ? { range: reading.range } : {}),
    label
  };
}

export function roomItemRows(roomId: number) {
  return all<RoomItemRow>("SELECT * FROM room_items WHERE room_id = ? ORDER BY list_key, id", roomId);
}

export function retiredIds(roomId: number) {
  return all<{ item_id: string }>("SELECT item_id FROM room_retired_items WHERE room_id = ?", roomId).map(
    (row) => row.item_id
  );
}

function parseItem(json: string): CharacterItem | undefined {
  try {
    const parsed: unknown = JSON.parse(json);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as CharacterItem) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The system's lists with the room's overlay applied. Given no room — a
 * character sitting in a pool belongs to no room — the system's own lists are
 * returned untouched.
 */
export function applyRoomOverlay(
  lists: Readonly<Record<string, readonly CharacterItem[]>>,
  roomId: number | undefined
): Record<string, CharacterItem[]> {
  const base = Object.fromEntries(Object.entries(lists).map(([key, items]) => [key, [...items]]));
  if (roomId === undefined) return base;

  const retired = new Set(retiredIds(roomId));
  const resolved: Record<string, CharacterItem[]> = {};
  for (const [key, items] of Object.entries(base)) resolved[key] = items.filter((item) => !retired.has(item.id));

  for (const row of roomItemRows(roomId)) {
    const item = parseItem(row.item_json);
    if (!item || retired.has(item.id)) continue;
    (resolved[row.list_key] ??= []).push(item);
  }
  return resolved;
}

export function writeRoomItem(roomId: number, accountId: number, listKey: string, item: CharacterItem) {
  db.prepare(
    `INSERT INTO room_items (room_id, item_id, list_key, item_json, created_by)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(room_id, item_id) DO UPDATE SET
       list_key = excluded.list_key, item_json = excluded.item_json, updated_at = CURRENT_TIMESTAMP`
  ).run(roomId, item.id, listKey, JSON.stringify(item), accountId);
  return one<RoomItemRow>("SELECT * FROM room_items WHERE room_id = ? AND item_id = ?", roomId, item.id)!;
}

export function retireForRoom(roomId: number, id: string) {
  db.prepare("INSERT OR IGNORE INTO room_retired_items (room_id, item_id) VALUES (?, ?)").run(roomId, id);
}

export function restoreForRoom(roomId: number, id: string) {
  return db.prepare("DELETE FROM room_retired_items WHERE room_id = ? AND item_id = ?").run(roomId, id).changes > 0;
}

export function deleteRoomItem(roomId: number, id: string) {
  return db.prepare("DELETE FROM room_items WHERE room_id = ? AND item_id = ?").run(roomId, id).changes > 0;
}

/** Guards against handing back an id the system could also mint. */
export function itemBelongsToRoom(roomId: number, id: string) {
  return id.startsWith(`room:${roomId}:`);
}
