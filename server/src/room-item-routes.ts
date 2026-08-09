import express from "express";
import { z } from "zod";
import type { CharacterItem, SystemId } from "@devils-toys/shared";
import type { AuthedRequest } from "./auth.js";
import { requireAuth } from "./auth.js";
import { characterItemsFor } from "./character-items.js";
import { db, one } from "./db.js";
import { broadcastRoom } from "./realtime.js";
import { requireRoomConfig, roomConfigAccess } from "./room-config-permissions.js";
import {
  deleteRoomItem,
  isRoomItemId,
  itemBelongsToRoom,
  readRoomItem,
  restoreForRoom,
  retireForRoom,
  retiredIds,
  roomItemInput,
  roomItemRows,
  writeRoomItem
} from "./room-items.js";
import { systems } from "./systems.js";

/**
 * A room's own gear. Every route here is behind `requireRoomConfig`, because the
 * catalogue is set up rather than played with — the pickers that use it live on
 * the character sheet and the group page, and read it through
 * `characterItemsFor`.
 */
export const roomItemRouter = express.Router();

function systemOf(roomId: number) {
  return one<{ system: SystemId }>("SELECT system FROM rooms WHERE id = ?", roomId)!.system;
}

/** What the panel needs to show the whole catalogue and say where each entry came from. */
roomItemRouter.get("/rooms/:roomId/items", requireAuth, (req: AuthedRequest, res) => {
  const roomId = requireRoomConfig(req, res);
  if (!roomId) return;
  const system = systemOf(roomId);
  const definition = systems[system].characterSheet;
  const retired = new Set(retiredIds(roomId));
  const added = new Set(roomItemRows(roomId).map((row) => row.item_id));
  const lists = characterItemsFor(system, roomId);

  // The retired entries are not in the resolved lists by definition, so they are
  // read back off the system's own catalogue to be offered for restoring.
  const systemLists = characterItemsFor(system);
  const retiredItems = Object.entries(systemLists).flatMap(([listKey, items]) =>
    items.filter((item) => retired.has(item.id)).map((item) => ({ listKey, item }))
  );

  res.json({
    lists: definition.lists.map((list) => ({
      key: list.key,
      label: list.label,
      items: (lists[list.key] ?? []).map((item) => ({ ...item, source: added.has(item.id) ? "room" : "system" }))
    })),
    retired: retiredItems,
    counts: { added: added.size, retired: retired.size }
  });
});

roomItemRouter.post("/rooms/:roomId/items", requireAuth, (req: AuthedRequest, res) => {
  const roomId = requireRoomConfig(req, res);
  if (!roomId) return;
  const parsed = roomItemInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid item." });
  const system = systemOf(roomId);
  if (!systems[system].characterSheet.lists.some((list) => list.key === parsed.data.listKey))
    return res.status(400).json({ error: "That is not a list this system's sheet has." });
  const item = readRoomItem(system, roomId, parsed.data);
  if (roomItemRows(roomId).some((row) => row.item_id === item.id))
    return res.status(409).json({ error: "This room already has an item by that name." });
  writeRoomItem(roomId, req.account!.id, parsed.data.listKey, item);
  broadcastRoom(roomId, { type: "items-updated" });
  res.status(201).json({ item });
});

roomItemRouter.patch("/rooms/:roomId/items/:itemId", requireAuth, (req: AuthedRequest, res) => {
  const roomId = requireRoomConfig(req, res);
  if (!roomId) return;
  const itemId = String(req.params.itemId);
  if (!itemBelongsToRoom(roomId, itemId)) return res.status(404).json({ error: "Item not found." });
  const existing = roomItemRows(roomId).find((row) => row.item_id === itemId);
  if (!existing) return res.status(404).json({ error: "Item not found." });
  const parsed = roomItemInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid item." });
  const system = systemOf(roomId);
  // The same check the create route makes: a list the sheet does not have would
  // store an entry nothing ever offers.
  if (!systems[system].characterSheet.lists.some((list) => list.key === parsed.data.listKey))
    return res.status(400).json({ error: "That is not a list this system's sheet has." });
  const item = readRoomItem(system, roomId, parsed.data);
  // An id is made from the name, so two names can slug to one id — "Bone Saw"
  // and "bone saw" among them. Renaming onto an id another entry already holds
  // would upsert over it, so it is refused the way a duplicate create is.
  if (item.id !== itemId && roomItemRows(roomId).some((row) => row.item_id === item.id))
    return res.status(409).json({ error: "This room already has an item by that name." });
  db.exec("BEGIN IMMEDIATE");
  try {
    // Renaming changes the id, because an id is derived from the name. The old
    // row goes so a rename does not leave the previous entry beside the new one.
    if (item.id !== itemId) deleteRoomItem(roomId, itemId);
    writeRoomItem(roomId, req.account!.id, parsed.data.listKey, item);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  broadcastRoom(roomId, { type: "items-updated" });
  res.json({ item, renamedFrom: item.id === itemId ? null : itemId });
});

roomItemRouter.delete("/rooms/:roomId/items/:itemId", requireAuth, (req: AuthedRequest, res) => {
  const roomId = requireRoomConfig(req, res);
  if (!roomId) return;
  const itemId = String(req.params.itemId);
  if (!itemBelongsToRoom(roomId, itemId) || !deleteRoomItem(roomId, itemId))
    return res.status(404).json({ error: "Item not found." });
  broadcastRoom(roomId, { type: "items-updated" });
  res.status(204).end();
});

/**
 * Retiring takes an entry out of this room's pickers. It does not touch the
 * system's catalogue, and it does not touch a sheet: slots hold plain text, so
 * anything already written down stays written down.
 */
roomItemRouter.post("/rooms/:roomId/items/:itemId/retire", requireAuth, (req: AuthedRequest, res) => {
  const roomId = requireRoomConfig(req, res);
  if (!roomId) return;
  const itemId = String(req.params.itemId);
  const system = systemOf(roomId);
  const known = Object.values(characterItemsFor(system, roomId))
    .flat()
    .some((item) => item.id === itemId);
  if (!known) return res.status(404).json({ error: "Item not found." });
  retireForRoom(roomId, itemId);
  broadcastRoom(roomId, { type: "items-updated" });
  res.status(204).end();
});

roomItemRouter.post("/rooms/:roomId/items/:itemId/restore", requireAuth, (req: AuthedRequest, res) => {
  const roomId = requireRoomConfig(req, res);
  if (!roomId) return;
  if (!restoreForRoom(roomId, String(req.params.itemId)))
    return res.status(404).json({ error: "That item is not retired here." });
  broadcastRoom(roomId, { type: "items-updated" });
  res.status(204).end();
});

/**
 * Customising an entry the book priced: copy it to a room item and retire the
 * original in one write, so the picker shows the changed one rather than both.
 */
roomItemRouter.post("/rooms/:roomId/items/:itemId/customise", requireAuth, (req: AuthedRequest, res) => {
  const roomId = requireRoomConfig(req, res);
  if (!roomId) return;
  const itemId = String(req.params.itemId);
  if (isRoomItemId(itemId)) return res.status(400).json({ error: "That item is already this room's own." });
  const system = systemOf(roomId);
  const lists = characterItemsFor(system, roomId);
  const found = Object.entries(lists).flatMap(([listKey, items]) =>
    items.filter((item) => item.id === itemId).map((item) => ({ listKey, item }))
  )[0];
  if (!found) return res.status(404).json({ error: "Item not found." });
  const copy = readRoomItem(system, roomId, {
    listKey: found.listKey,
    name: found.item.name,
    spec: found.item.spec,
    detail: found.item.detail,
    cost: found.item.cost,
    category: found.item.category
  });
  db.exec("BEGIN IMMEDIATE");
  try {
    writeRoomItem(roomId, req.account!.id, found.listKey, copy);
    retireForRoom(roomId, itemId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  broadcastRoom(roomId, { type: "items-updated" });
  res.status(201).json({ item: copy, retired: itemId });
});

/**
 * Copies this room's own gear into another room the same account configures, on
 * the same double gate the NPC copy uses: both rooms judged separately, and the
 * two systems must agree, because an item is read against its system's rules.
 */
roomItemRouter.post("/rooms/:roomId/items/copy-to", requireAuth, (req: AuthedRequest, res) => {
  const roomId = requireRoomConfig(req, res);
  if (!roomId) return;
  const parsed = z
    .object({ roomId: z.number().int().positive(), itemIds: z.array(z.string().min(1)).min(1).max(500) })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Choose a room and what to copy into it." });
  const targetId = parsed.data.roomId;
  if (targetId === roomId) return res.status(400).json({ error: "That is the room they are already in." });
  if (!roomConfigAccess(req.account!, targetId)) return res.status(404).json({ error: "Room not found." });
  const system = systemOf(roomId);
  if (system !== systemOf(targetId)) return res.status(409).json({ error: "Both rooms must run the same system." });

  const mine = new Map(
    roomItemRows(roomId).map((row) => [
      row.item_id,
      { listKey: row.list_key, item: JSON.parse(row.item_json) as CharacterItem }
    ])
  );
  const chosen = parsed.data.itemIds.map((id) => mine.get(id));
  if (chosen.some((entry) => !entry))
    return res.status(404).json({ error: "One of those items is not this room's own." });

  db.exec("BEGIN IMMEDIATE");
  try {
    for (const entry of chosen)
      writeRoomItem(
        targetId,
        req.account!.id,
        entry!.listKey,
        readRoomItem(system, targetId, {
          listKey: entry!.listKey,
          name: entry!.item.name,
          spec: entry!.item.spec,
          detail: entry!.item.detail,
          cost: entry!.item.cost,
          category: entry!.item.category
        })
      );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  broadcastRoom(targetId, { type: "items-updated" });
  res.status(201).json({ copied: chosen.length });
});
