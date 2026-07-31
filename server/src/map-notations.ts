import express from "express";
import { z } from "zod";
import { MAP_NOTATION_COLORS, type MapNotation } from "@devils-toys/shared";
import type { AuthedRequest } from "./auth.js";
import { requireAuth, roomRole } from "./auth.js";
import { all, db, one } from "./db.js";
import { broadcastRoom } from "./realtime.js";

export const mapNotationRouter = express.Router();

const coordinate = z.number().finite().min(0).max(1);
const color = z.enum(MAP_NOTATION_COLORS);
const notation = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("line"),
    color,
    points: z
      .array(z.object({ x: coordinate, y: coordinate }))
      .min(2)
      .max(1000)
  }),
  z.object({
    kind: z.literal("label"),
    color,
    x: coordinate,
    y: coordinate,
    text: z.string().trim().min(1).max(200),
    fontSize: z.number().int().min(8).max(72)
  }),
  z.object({ kind: z.literal("box"), color, x: coordinate, y: coordinate, width: coordinate, height: coordinate }),
  z.object({ kind: z.literal("circle"), color, x: coordinate, y: coordinate, width: coordinate, height: coordinate })
]);

function access(req: AuthedRequest, res: express.Response) {
  const roomId = Number(req.params.roomId);
  const mediaId = Number(req.params.mediaId);
  const role = roomRole(req.account!.id, roomId);
  if (!role) {
    res.status(404).json({ error: "Room not found." });
    return;
  }
  const media = one<{ visible: number; map_notation_enabled: number }>(
    `SELECT media.visible, rooms.map_notation_enabled FROM media
     JOIN rooms ON rooms.id = media.room_id
     WHERE media.id = ? AND media.room_id = ? AND COALESCE(media.category, media.kind) = 'map'`,
    mediaId,
    roomId
  );
  if (!media || (role !== "gm" && !media.visible)) {
    res.status(404).json({ error: "Map not found." });
    return;
  }
  if (!media.map_notation_enabled) {
    res.status(409).json({ error: "Map notation is not enabled for this room." });
    return;
  }
  return { roomId, mediaId, role };
}

function list(roomId: number, mediaId: number): MapNotation[] {
  return all<{ id: number; notation_json: string }>(
    "SELECT id, notation_json FROM map_notations WHERE room_id = ? AND media_id = ? ORDER BY id",
    roomId,
    mediaId
  ).flatMap((row) => {
    try {
      return [{ id: row.id, ...JSON.parse(row.notation_json) } as MapNotation];
    } catch {
      return [];
    }
  });
}

function updated(roomId: number, mediaId: number) {
  broadcastRoom(roomId, { type: "map-notations-updated", mediaId });
}

mapNotationRouter.get("/rooms/:roomId/maps/:mediaId/notations", requireAuth, (req: AuthedRequest, res) => {
  const allowed = access(req, res);
  if (!allowed) return;
  res.json({ notations: list(allowed.roomId, allowed.mediaId) });
});

mapNotationRouter.post("/rooms/:roomId/maps/:mediaId/notations", requireAuth, (req: AuthedRequest, res) => {
  const allowed = access(req, res);
  if (!allowed) return;
  const parsed = notation.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid map notation." });
  const result = db
    .prepare("INSERT INTO map_notations (room_id, media_id, notation_json, created_by) VALUES (?, ?, ?, ?)")
    .run(allowed.roomId, allowed.mediaId, JSON.stringify(parsed.data), req.account!.id);
  const created = { id: Number(result.lastInsertRowid), ...parsed.data };
  updated(allowed.roomId, allowed.mediaId);
  res.status(201).json({ notation: created });
});

mapNotationRouter.delete(
  "/rooms/:roomId/maps/:mediaId/notations/:notationId",
  requireAuth,
  (req: AuthedRequest, res) => {
    const allowed = access(req, res);
    if (!allowed) return;
    db.prepare("DELETE FROM map_notations WHERE id = ? AND room_id = ? AND media_id = ?").run(
      Number(req.params.notationId),
      allowed.roomId,
      allowed.mediaId
    );
    updated(allowed.roomId, allowed.mediaId);
    res.status(204).end();
  }
);

mapNotationRouter.post("/rooms/:roomId/maps/:mediaId/notations/undo", requireAuth, (req: AuthedRequest, res) => {
  const allowed = access(req, res);
  if (!allowed) return;
  db.prepare(
    `DELETE FROM map_notations WHERE id = (
    SELECT id FROM map_notations WHERE room_id = ? AND media_id = ? ORDER BY id DESC LIMIT 1
  )`
  ).run(allowed.roomId, allowed.mediaId);
  updated(allowed.roomId, allowed.mediaId);
  res.status(204).end();
});

mapNotationRouter.delete("/rooms/:roomId/maps/:mediaId/notations", requireAuth, (req: AuthedRequest, res) => {
  const allowed = access(req, res);
  if (!allowed) return;
  if (allowed.role !== "gm") return res.status(403).json({ error: "Only the room GM can clear map notation." });
  db.prepare("DELETE FROM map_notations WHERE room_id = ? AND media_id = ?").run(allowed.roomId, allowed.mediaId);
  updated(allowed.roomId, allowed.mediaId);
  res.status(204).end();
});
