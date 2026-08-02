import express from "express";
import { z } from "zod";
import type { SystemId } from "@devils-toys/shared";
import type { AuthedRequest } from "./auth.js";
import { requireAuth, roomRole } from "./auth.js";
import { all, db, one } from "./db.js";
import { broadcastRoom } from "./realtime.js";
import { systemMarkdown, systems } from "./systems.js";
import { parseNpcStatblock } from "./npc-statblocks.js";

export const npcRouter = express.Router();

export function npcCatalog(system: SystemId) {
  const metadata = systems[system].npcCatalog;
  const lines = systemMarkdown(system).split("\n");
  const rootIndex = lines.findIndex((line) => {
    const match = /^(#+)\s+(.+?)\s*$/.exec(line);
    return match?.[2].toLocaleLowerCase() === metadata.heading.toLocaleLowerCase();
  });
  if (rootIndex < 0) return [];
  const rootLevel = /^(#+)/.exec(lines[rootIndex])![1].length;
  const entries: { name: string; markdown: string }[] = [];
  for (let index = rootIndex + 1; index < lines.length; index += 1) {
    const heading = /^(#+)\s+(.+?)\s*$/.exec(lines[index]);
    if (heading && heading[1].length <= rootLevel) break;
    if (heading?.[1].length !== metadata.entryLevel || metadata.exclude.includes(heading[2])) continue;
    const body = [lines[index]];
    for (index += 1; index < lines.length; index += 1) {
      const next = /^(#+)\s+/.exec(lines[index]);
      if (next && next[1].length <= metadata.entryLevel) {
        index -= 1;
        break;
      }
      body.push(lines[index]);
    }
    entries.push({ name: heading[2], markdown: body.join("\n").trim() });
  }
  return entries;
}

function parseStatblock(json: string | null | undefined) {
  try {
    const parsed: unknown = JSON.parse(json ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function validateStatblock(system: SystemId, value: Record<string, string | number>) {
  const definitions = new Map(systems[system].npcStatblock.fields.map((field) => [field.key, field]));
  for (const [key, fieldValue] of Object.entries(value)) {
    const definition = definitions.get(key);
    if (!definition) return "Unknown NPC statblock field.";
    if (definition.kind === "number" && typeof fieldValue !== "number") return `${definition.label} must be a number.`;
    if (definition.kind === "text" && typeof fieldValue !== "string") return `${definition.label} must be text.`;
  }
  return;
}

function room(req: AuthedRequest, res: express.Response) {
  const roomId = Number(req.params.roomId);
  if (roomRole(req.account!.id, roomId) !== "gm") {
    res.status(403).json({ error: "The NPC catalog is reserved for the room GM." });
    return;
  }
  return roomId;
}

npcRouter.get("/rooms/:roomId/npcs", requireAuth, (req: AuthedRequest, res) => {
  const roomId = room(req, res);
  if (!roomId) return;
  const system = one<{ system: SystemId }>("SELECT system FROM rooms WHERE id = ?", roomId)!.system;
  // Spawned records are the copies made to put something into a fight. They are
  // listed by the spawned-NPC view, not here beside the entries they came from.
  const custom = all<{ id: number; name: string; notes: string; statblock_json: string; updated_at: string }>(
    "SELECT id, name, notes, statblock_json, updated_at FROM custom_npcs WHERE room_id = ? AND spawned = 0 ORDER BY name",
    roomId
  ).map((item) => ({
    id: item.id,
    name: item.name,
    notes: item.notes,
    statblock: parseStatblock(item.statblock_json),
    updatedAt: item.updated_at
  }));
  res.json({ catalog: npcCatalog(system), custom });
});

/**
 * Every NPC currently standing in an encounter, newest first. These are the live
 * combatants rather than the records behind them, so the same bestiary entry
 * appearing three times is three rows with three hit-point pools.
 */
npcRouter.get("/rooms/:roomId/npcs/spawned", requireAuth, (req: AuthedRequest, res) => {
  const roomId = room(req, res);
  if (!roomId) return;
  const spawned = all<{
    id: number;
    name: string;
    hp_current: number | null;
    hp_max: number | null;
    statblock_json: string;
    included: number;
    encounter_id: number;
    encounter_name: string;
    encounter_active: number;
  }>(
    `SELECT c.id, c.name, c.hp_current, c.hp_max, c.statblock_json, c.included,
            e.id AS encounter_id, e.name AS encounter_name, e.active AS encounter_active
       FROM encounter_combatants c
       JOIN encounters e ON e.id = c.encounter_id
      WHERE e.room_id = ? AND c.kind = 'npc'
      ORDER BY e.active DESC, e.name, c.sort_order, c.id`,
    roomId
  ).map((item) => ({
    combatantId: item.id,
    name: item.name,
    hpCurrent: item.hp_current,
    hpMax: item.hp_max,
    statblock: parseStatblock(item.statblock_json),
    included: Boolean(item.included),
    encounterId: item.encounter_id,
    encounterName: item.encounter_name,
    encounterActive: Boolean(item.encounter_active)
  }));
  res.json({ spawned });
});

npcRouter.post("/rooms/:roomId/npcs", requireAuth, (req: AuthedRequest, res) => {
  const roomId = room(req, res);
  if (!roomId) return;
  const system = one<{ system: SystemId }>("SELECT system FROM rooms WHERE id = ?", roomId)!.system;
  const parsed = z
    .object({
      name: z.string().trim().min(1).max(100),
      notes: z.string().max(10000).default(""),
      statblock: z.record(z.union([z.string(), z.number()])).default({})
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Give the NPC a name and valid notes." });
  const statblockError = validateStatblock(system, parsed.data.statblock);
  if (statblockError) return res.status(400).json({ error: statblockError });
  const result = db
    .prepare("INSERT INTO custom_npcs (room_id, created_by, name, notes, statblock_json) VALUES (?, ?, ?, ?, ?)")
    .run(roomId, req.account!.id, parsed.data.name, parsed.data.notes, JSON.stringify(parsed.data.statblock));
  broadcastRoom(roomId, { type: "npcs-updated" });
  res.status(201).json({ npc: { id: Number(result.lastInsertRowid), ...parsed.data } });
});

npcRouter.patch("/rooms/:roomId/npcs/:npcId", requireAuth, (req: AuthedRequest, res) => {
  const roomId = room(req, res);
  if (!roomId) return;
  const parsed = z
    .object({
      name: z.string().trim().min(1).max(100),
      notes: z.string().max(10000),
      statblock: z.record(z.union([z.string(), z.number()])).optional()
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Give the NPC a name and valid notes." });
  const system = one<{ system: SystemId }>("SELECT system FROM rooms WHERE id = ?", roomId)!.system;
  const statblockError = parsed.data.statblock ? validateStatblock(system, parsed.data.statblock) : undefined;
  if (statblockError) return res.status(400).json({ error: statblockError });
  const result = db
    .prepare(
      `UPDATE custom_npcs SET name = ?, notes = ?, statblock_json = COALESCE(?, statblock_json),
       updated_at = CURRENT_TIMESTAMP WHERE id = ? AND room_id = ?`
    )
    .run(
      parsed.data.name,
      parsed.data.notes,
      parsed.data.statblock ? JSON.stringify(parsed.data.statblock) : null,
      Number(req.params.npcId),
      roomId
    );
  if (!result.changes) return res.status(404).json({ error: "Custom NPC not found." });
  broadcastRoom(roomId, { type: "npcs-updated" });
  res.status(204).end();
});

npcRouter.post("/rooms/:roomId/npcs/:npcId/clone", requireAuth, (req: AuthedRequest, res) => {
  const roomId = room(req, res);
  if (!roomId) return;
  const source = one<{ name: string; notes: string; statblock_json: string }>(
    "SELECT name, notes, statblock_json FROM custom_npcs WHERE id = ? AND room_id = ?",
    Number(req.params.npcId),
    roomId
  );
  if (!source) return res.status(404).json({ error: "Custom NPC not found." });
  const name = `${source.name} (copy)`.slice(0, 100);
  const result = db
    .prepare("INSERT INTO custom_npcs (room_id, created_by, name, notes, statblock_json) VALUES (?, ?, ?, ?, ?)")
    .run(roomId, req.account!.id, name, source.notes, source.statblock_json);
  broadcastRoom(roomId, { type: "npcs-updated" });
  res.status(201).json({
    npc: {
      id: Number(result.lastInsertRowid),
      name,
      notes: source.notes,
      statblock: parseStatblock(source.statblock_json)
    }
  });
});

npcRouter.post("/rooms/:roomId/npcs/from-catalog", requireAuth, (req: AuthedRequest, res) => {
  const roomId = room(req, res);
  if (!roomId) return;
  const parsed = z.object({ name: z.string().trim().min(1).max(200) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Choose a built-in bestiary entry." });
  const system = one<{ system: SystemId }>("SELECT system FROM rooms WHERE id = ?", roomId)!.system;
  const entry = npcCatalog(system).find((candidate) => candidate.name === parsed.data.name);
  if (!entry) return res.status(404).json({ error: "Built-in bestiary entry not found." });
  const parsedStatblock = parseNpcStatblock(system, entry.markdown);
  const result = db
    .prepare("INSERT INTO custom_npcs (room_id, created_by, name, notes, statblock_json) VALUES (?, ?, ?, ?, ?)")
    .run(roomId, req.account!.id, entry.name, entry.markdown, JSON.stringify(parsedStatblock.fields));
  broadcastRoom(roomId, { type: "npcs-updated" });
  res.status(201).json({
    npc: {
      id: Number(result.lastInsertRowid),
      name: entry.name,
      notes: entry.markdown,
      statblock: parsedStatblock.fields,
      parseWarning:
        typeof parsedStatblock.fields[systems[system].npcStatblock.hitPointsKey] !== "number"
          ? "stats could not be read — fill them in"
          : null
    }
  });
});

npcRouter.delete("/rooms/:roomId/npcs/:npcId", requireAuth, (req: AuthedRequest, res) => {
  const roomId = room(req, res);
  if (!roomId) return;
  const result = db
    .prepare("DELETE FROM custom_npcs WHERE id = ? AND room_id = ?")
    .run(Number(req.params.npcId), roomId);
  if (!result.changes) return res.status(404).json({ error: "Custom NPC not found." });
  broadcastRoom(roomId, { type: "npcs-updated" });
  broadcastRoom(roomId, { type: "encounters-updated" });
  res.status(204).end();
});
