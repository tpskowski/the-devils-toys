import path from "node:path";
import express from "express";
import multer from "multer";
import { z } from "zod";
import type { SystemId } from "@devils-toys/shared";
import type { AuthedRequest } from "./auth.js";
import { requireAuth, roomRole } from "./auth.js";
import { config } from "./config.js";
import { all, db, one } from "./db.js";
import {
  portraitImageTypes,
  PORTRAIT_UPLOAD_LIMIT_BYTES,
  removeStoredPortrait,
  removeUploadedPortrait,
  validPortraitFile
} from "./portrait-files.js";
import { broadcastRoom } from "./realtime.js";
import { starshipPartsFor } from "./starship-parts.js";
import { systems } from "./systems.js";

export const groupRouter = express.Router();

interface StarshipImageRow {
  room_id: number;
  starship_id: string;
  filename: string;
  stored_name: string;
  mime_type: string;
  size: number;
}

export const groupStateSchema = z.record(z.unknown()).refine((value) => JSON.stringify(value).length <= 250_000, {
  message: "Group data is too large."
});

const uploadsDir = path.join(config.dataDir, "uploads");
const starshipIdSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9_-]+$/);
const starshipImageUpload = multer({
  storage: multer.diskStorage({
    destination: uploadsDir,
    filename(_req, file, callback) {
      callback(null, `${crypto.randomUUID()}${portraitImageTypes.get(file.mimetype) ?? ""}`);
    }
  }),
  limits: { fileSize: PORTRAIT_UPLOAD_LIMIT_BYTES, files: 1 },
  fileFilter(_req, file, callback) {
    if (portraitImageTypes.has(file.mimetype)) callback(null, true);
    else callback(new Error("Only PNG, JPEG, and WebP starship images are supported."));
  }
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

function publicStarshipImage(row: StarshipImageRow) {
  return {
    starshipId: row.starship_id,
    url: `/api/rooms/${row.room_id}/group/starships/${encodeURIComponent(row.starship_id)}/image?v=${encodeURIComponent(row.stored_name)}`,
    filename: row.filename
  };
}

function starshipImage(accountId: number, roomId: number, rawStarshipId: string) {
  if (!groupContext(accountId, roomId)) return;
  const parsedId = starshipIdSchema.safeParse(rawStarshipId);
  if (!parsedId.success) return;
  return one<StarshipImageRow>(
    "SELECT * FROM starship_images WHERE room_id = ? AND starship_id = ?",
    roomId,
    parsedId.data
  );
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
    images: all<StarshipImageRow>("SELECT * FROM starship_images WHERE room_id = ? ORDER BY updated_at", roomId).map(
      publicStarshipImage
    ),
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

groupRouter.get("/rooms/:roomId/group/starships/:starshipId/image", requireAuth, (req: AuthedRequest, res) => {
  const roomId = Number(req.params.roomId);
  const image = starshipImage(req.account!.id, roomId, String(req.params.starshipId));
  if (!image || path.basename(image.stored_name) !== image.stored_name)
    return res.status(404).json({ error: "Starship image not found." });
  res.type(image.mime_type);
  res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
  res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(image.filename)}`);
  res.sendFile(image.stored_name, { root: uploadsDir });
});

groupRouter.post(
  "/rooms/:roomId/group/starships/:starshipId/image",
  requireAuth,
  starshipImageUpload.single("file"),
  (req: AuthedRequest, res) => {
    const roomId = Number(req.params.roomId);
    const context = groupContext(req.account!.id, roomId);
    const parsedId = starshipIdSchema.safeParse(req.params.starshipId);
    if (!context || !parsedId.success) {
      removeUploadedPortrait(req.file);
      return res.status(404).json({ error: "Starship not found." });
    }
    if (!req.file) return res.status(400).json({ error: "Choose a PNG, JPEG, or WebP image." });
    if (!validPortraitFile(req.file)) {
      removeUploadedPortrait(req.file);
      return res.status(415).json({ error: "The file contents do not match a supported image format." });
    }

    const mediaBytes = one<{ size: number }>("SELECT COALESCE(SUM(size), 0) AS size FROM media")?.size ?? 0;
    const portraitBytes =
      one<{ size: number }>("SELECT COALESCE(SUM(portrait_size), 0) AS size FROM characters")?.size ?? 0;
    const starshipBytes =
      one<{ size: number }>("SELECT COALESCE(SUM(size), 0) AS size FROM starship_images")?.size ?? 0;
    const previous = one<StarshipImageRow>(
      "SELECT * FROM starship_images WHERE room_id = ? AND starship_id = ?",
      roomId,
      parsedId.data
    );
    if (
      mediaBytes + portraitBytes + starshipBytes - (previous?.size ?? 0) + req.file.size >
      config.uploadLimitMb * 1024 * 1024
    ) {
      removeUploadedPortrait(req.file);
      return res.status(413).json({ error: "The server upload-storage allowance has been reached." });
    }

    try {
      db.prepare(
        `INSERT INTO starship_images
           (room_id, starship_id, filename, stored_name, mime_type, size, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(room_id, starship_id) DO UPDATE SET
           filename = excluded.filename, stored_name = excluded.stored_name,
           mime_type = excluded.mime_type, size = excluded.size, updated_at = CURRENT_TIMESTAMP`
      ).run(
        roomId,
        parsedId.data,
        path.basename(req.file.originalname).slice(0, 200) || `starship${portraitImageTypes.get(req.file.mimetype)}`,
        req.file.filename,
        req.file.mimetype,
        req.file.size
      );
    } catch (error) {
      removeUploadedPortrait(req.file);
      throw error;
    }
    if (previous?.stored_name !== req.file.filename) removeStoredPortrait(previous?.stored_name);
    const image = one<StarshipImageRow>(
      "SELECT * FROM starship_images WHERE room_id = ? AND starship_id = ?",
      roomId,
      parsedId.data
    )!;
    broadcastRoom(roomId, { type: "group-updated" });
    res.status(201).json({ image: publicStarshipImage(image) });
  }
);

groupRouter.delete("/rooms/:roomId/group/starships/:starshipId/image", requireAuth, (req: AuthedRequest, res) => {
  const roomId = Number(req.params.roomId);
  const image = starshipImage(req.account!.id, roomId, String(req.params.starshipId));
  if (!image) return res.status(404).json({ error: "Starship image not found." });
  db.prepare("DELETE FROM starship_images WHERE room_id = ? AND starship_id = ?").run(roomId, image.starship_id);
  removeStoredPortrait(image.stored_name);
  broadcastRoom(roomId, { type: "group-updated" });
  res.status(204).end();
});

groupRouter.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (error instanceof multer.MulterError) {
    return res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({
      error: error.code === "LIMIT_FILE_SIZE" ? "Starship images may be at most 5 MB." : error.message
    });
  }
  if (error instanceof Error && error.message.includes("PNG, JPEG, and WebP starship images"))
    return res.status(415).json({ error: error.message });
  next(error);
});
