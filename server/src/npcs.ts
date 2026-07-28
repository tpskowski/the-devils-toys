import fs from "node:fs";
import express from "express";
import { z } from "zod";
import type { SystemId } from "@devils-toys/shared";
import type { AuthedRequest } from "./auth.js";
import { requireAuth, roomRole } from "./auth.js";
import { all, db, one } from "./db.js";
import { broadcastRoom } from "./realtime.js";
import { projectFile } from "./paths.js";
import { systems } from "./systems.js";

export const npcRouter = express.Router();

export function npcCatalog(system: SystemId) {
  const metadata = systems[system].npcCatalog;
  const filename = system === "cairn" ? "Cairn.md" : "Monolith.md";
  const lines = fs.readFileSync(projectFile("raw", filename), "utf8").split("\n");
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
  const custom = all<{ id: number; name: string; notes: string; updated_at: string }>(
    "SELECT id, name, notes, updated_at FROM custom_npcs WHERE room_id = ? ORDER BY name",
    roomId
  ).map((item) => ({ id: item.id, name: item.name, notes: item.notes, updatedAt: item.updated_at }));
  res.json({ catalog: npcCatalog(system), custom });
});

npcRouter.post("/rooms/:roomId/npcs", requireAuth, (req: AuthedRequest, res) => {
  const roomId = room(req, res);
  if (!roomId) return;
  const parsed = z
    .object({ name: z.string().trim().min(1).max(100), notes: z.string().max(10000).default("") })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Give the NPC a name and valid notes." });
  const result = db
    .prepare("INSERT INTO custom_npcs (room_id, created_by, name, notes) VALUES (?, ?, ?, ?)")
    .run(roomId, req.account!.id, parsed.data.name, parsed.data.notes);
  broadcastRoom(roomId, { type: "npcs-updated" });
  res.status(201).json({ npc: { id: Number(result.lastInsertRowid), ...parsed.data } });
});

npcRouter.patch("/rooms/:roomId/npcs/:npcId", requireAuth, (req: AuthedRequest, res) => {
  const roomId = room(req, res);
  if (!roomId) return;
  const parsed = z
    .object({ name: z.string().trim().min(1).max(100), notes: z.string().max(10000) })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Give the NPC a name and valid notes." });
  const result = db
    .prepare("UPDATE custom_npcs SET name = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND room_id = ?")
    .run(parsed.data.name, parsed.data.notes, Number(req.params.npcId), roomId);
  if (!result.changes) return res.status(404).json({ error: "Custom NPC not found." });
  broadcastRoom(roomId, { type: "npcs-updated" });
  res.status(204).end();
});

npcRouter.delete("/rooms/:roomId/npcs/:npcId", requireAuth, (req: AuthedRequest, res) => {
  const roomId = room(req, res);
  if (!roomId) return;
  const result = db
    .prepare("DELETE FROM custom_npcs WHERE id = ? AND room_id = ?")
    .run(Number(req.params.npcId), roomId);
  if (!result.changes) return res.status(404).json({ error: "Custom NPC not found." });
  broadcastRoom(roomId, { type: "npcs-updated" });
  res.status(204).end();
});
