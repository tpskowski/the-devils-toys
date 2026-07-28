import express from "express";
import { z } from "zod";
import type { SystemId } from "@devils-toys/shared";
import type { AuthedRequest } from "./auth.js";
import { requireAuth, roomRole } from "./auth.js";
import { db, one } from "./db.js";
import { broadcastRoom } from "./realtime.js";
import { starshipPartsFor } from "./starship-parts.js";
import { systems } from "./systems.js";

export const groupRouter = express.Router();

export const groupStateSchema = z.record(z.unknown()).refine((value) => JSON.stringify(value).length <= 250_000, {
  message: "Group data is too large."
});

function groupContext(accountId: number, roomId: number) {
  const role = roomRole(accountId, roomId);
  if (!role) return;
  const room = one<{ system: SystemId }>("SELECT system FROM rooms WHERE id = ?", roomId);
  if (!room) return;
  const definition = systems[room.system].groupPage;
  if (!definition) return;
  // The parts on offer come from the system's own book, so the sheet is sent out
  // with them rather than the package restating the list.
  const starshipSheet = definition.starshipSheet
    ? { ...definition.starshipSheet, parts: starshipPartsFor(room.system) }
    : undefined;
  return { role, system: room.system, definition: { ...definition, starshipSheet } };
}

export function parseGroupState(json: string | null | undefined) {
  try {
    const parsed: unknown = JSON.parse(json ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

groupRouter.get("/rooms/:roomId/group", requireAuth, (req: AuthedRequest, res) => {
  const roomId = Number(req.params.roomId);
  const context = groupContext(req.account!.id, roomId);
  if (!context) return res.status(404).json({ error: "Group page not found." });
  const row = one<{ group_json: string; updated_at: string }>(
    "SELECT group_json, updated_at FROM room_state WHERE room_id = ?",
    roomId
  );
  res.json({
    state: parseGroupState(row?.group_json),
    definition: context.definition,
    updatedAt: row?.updated_at ?? null
  });
});

groupRouter.patch("/rooms/:roomId/group", requireAuth, (req: AuthedRequest, res) => {
  const roomId = Number(req.params.roomId);
  const context = groupContext(req.account!.id, roomId);
  if (!context) return res.status(404).json({ error: "Group page not found." });
  const parsed = z.object({ state: groupStateSchema }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid group data." });
  const groupJson = JSON.stringify(parsed.data.state);
  db.prepare(
    `INSERT INTO room_state (room_id, group_json, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(room_id) DO UPDATE SET group_json = excluded.group_json, updated_at = CURRENT_TIMESTAMP`
  ).run(roomId, groupJson);
  const updatedAt = one<{ updated_at: string }>(
    "SELECT updated_at FROM room_state WHERE room_id = ?",
    roomId
  )!.updated_at;
  broadcastRoom(roomId, { type: "group-updated" });
  res.json({ state: parsed.data.state, updatedAt });
});
