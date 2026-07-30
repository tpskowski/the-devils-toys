import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import multer from "multer";
import { z } from "zod";
import type { MediaAsset } from "@devils-toys/shared";
import type { AuthedRequest } from "./auth.js";
import { requireAuth, roomRole } from "./auth.js";
import { config } from "./config.js";
import { all, db, one } from "./db.js";
import { broadcastRoom } from "./realtime.js";

export const mediaRouter = express.Router();

interface MediaRow {
  id: number;
  room_id: number;
  kind: "map" | "scene" | "reference" | "audio";
  filename: string;
  display_name: string | null;
  stored_name: string;
  mime_type: string;
  size: number;
  visible: number;
  created_at: string;
}

const imageTypes = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/webp", ".webp"]
]);
const markdownTypes = new Set(["text/markdown", "text/plain", "application/octet-stream"]);
const uploadsDir = path.join(config.dataDir, "uploads");
function isMarkdownUpload(file: Express.Multer.File) {
  return path.extname(file.originalname).toLowerCase() === ".md" && markdownTypes.has(file.mimetype);
}

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadsDir,
    filename(_req, file, callback) {
      const extension = imageTypes.get(file.mimetype) ?? (isMarkdownUpload(file) ? ".md" : "");
      callback(null, `${crypto.randomUUID()}${extension}`);
    }
  }),
  limits: { fileSize: config.sceneImageUploadLimitMb * 1024 * 1024, files: 1 },
  fileFilter(_req, file, callback) {
    if (imageTypes.has(file.mimetype) || isMarkdownUpload(file)) callback(null, true);
    else callback(new Error("Only PNG, JPEG, WebP, and Markdown files are supported."));
  }
});

function publicMedia(row: MediaRow): MediaAsset {
  return {
    id: row.id,
    roomId: row.room_id,
    kind: row.kind,
    filename: row.filename,
    displayName: row.display_name,
    mimeType: row.mime_type,
    size: row.size,
    visible: Boolean(row.visible),
    createdAt: row.created_at,
    url: `/api/media/${row.id}/file`
  };
}

function removeUploaded(file?: Express.Multer.File) {
  if (!file || path.basename(file.filename) !== file.filename) return;
  try {
    fs.rmSync(file.path, { force: true });
  } catch {
    // A failed request remains authoritative even if an already-missing temporary file cannot be removed.
  }
}

function validImageSignature(file: Express.Multer.File) {
  const bytes = Buffer.alloc(12);
  const descriptor = fs.openSync(file.path, "r");
  try {
    fs.readSync(descriptor, bytes, 0, bytes.length, 0);
  } finally {
    fs.closeSync(descriptor);
  }
  if (file.mimetype === "image/png") return bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"));
  if (file.mimetype === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
}

function validMarkdownFile(file: Express.Multer.File) {
  try {
    const bytes = fs.readFileSync(file.path);
    if (bytes.includes(0)) return false;
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

function requireGm(req: AuthedRequest, res: express.Response) {
  const roomId = Number(req.params.roomId);
  if (!Number.isInteger(roomId) || roomRole(req.account!.id, roomId) !== "gm") {
    res.status(403).json({ error: "Only the room GM can manage media." });
    return;
  }
  return roomId;
}

function setActiveMedia(roomId: number, kind: "map" | "scene", mediaId: number | null) {
  const column = kind === "map" ? "map_id" : "scene_id";
  db.exec("BEGIN IMMEDIATE");
  try {
    if (mediaId) db.prepare("UPDATE media SET visible = 1 WHERE id = ? AND room_id = ?").run(mediaId, roomId);
    db.prepare(
      `INSERT INTO room_state (room_id, ${column}, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(room_id) DO UPDATE SET ${column} = excluded.${column}, updated_at = CURRENT_TIMESTAMP`
    ).run(roomId, mediaId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

mediaRouter.get("/rooms/:roomId/media", requireAuth, (req: AuthedRequest, res) => {
  const roomId = Number(req.params.roomId);
  const role = roomRole(req.account!.id, roomId);
  if (!role) return res.status(404).json({ error: "Room not found." });
  const roomState = one<{ map_id: number | null; scene_id: number | null }>(
    "SELECT map_id, scene_id FROM room_state WHERE room_id = ?",
    roomId
  );
  const activeMap = roomState?.map_id
    ? one<MediaRow>(
        `SELECT id, room_id, COALESCE(category, kind) AS kind, filename, display_name, stored_name, visible, mime_type, size, created_at
         FROM media WHERE id = ? AND room_id = ? AND COALESCE(category, kind) = 'map'`,
        roomState.map_id,
        roomId
      )
    : undefined;
  const activeScene = roomState?.scene_id
    ? one<MediaRow>(
        `SELECT id, room_id, COALESCE(category, kind) AS kind, filename, display_name, stored_name, visible, mime_type, size, created_at
         FROM media WHERE id = ? AND room_id = ? AND COALESCE(category, kind) = 'scene'`,
        roomState.scene_id,
        roomId
      )
    : undefined;
  const map = activeMap && (role === "gm" || Boolean(activeMap.visible)) ? publicMedia(activeMap) : null;
  const scene = activeScene && (role === "gm" || Boolean(activeScene.visible)) ? publicMedia(activeScene) : null;

  if (role === "gm") {
    const library = all<MediaRow>(
      `SELECT id, room_id, COALESCE(category, kind) AS kind, filename, display_name, stored_name, visible, mime_type, size, created_at
       FROM media WHERE room_id = ? AND COALESCE(category, kind) IN ('map', 'scene', 'reference')
       ORDER BY id DESC`,
      roomId
    ).map(publicMedia);
    const revealedReferenceIds = library
      .filter((item) => item.kind === "reference" && item.visible)
      .map((item) => item.id);
    return res.json({
      map,
      scene,
      references: library.filter((item) => item.kind === "reference"),
      library,
      revealedReferenceIds
    });
  }

  const library = all<MediaRow>(
    `SELECT id, room_id, COALESCE(category, kind) AS kind, filename, display_name, stored_name, visible, mime_type, size, created_at
     FROM media
     WHERE room_id = ? AND visible = 1 AND COALESCE(category, kind) IN ('map', 'scene', 'reference')
     ORDER BY id DESC`,
    roomId
  ).map(publicMedia);
  res.json({
    map,
    scene,
    references: library.filter((item) => item.kind === "reference"),
    library
  });
});
mediaRouter.post(
  "/rooms/:roomId/media",
  requireAuth,
  upload.single("file"),
  (req: AuthedRequest, res: express.Response) => {
    const roomId = requireGm(req, res);
    if (!roomId) {
      removeUploaded(req.file);
      return;
    }
    const parsed = z.enum(["map", "scene", "reference"]).safeParse(req.body.kind);
    if (!parsed.success || !req.file) {
      removeUploaded(req.file);
      return res.status(400).json({ error: "Choose a supported file and classify it." });
    }
    const markdown = isMarkdownUpload(req.file);
    if (markdown && parsed.data !== "reference") {
      removeUploaded(req.file);
      return res.status(400).json({ error: "Markdown files can only be uploaded as References." });
    }
    const uploadLimitMb =
      parsed.data === "reference" ? config.referenceImageUploadLimitMb : config.sceneImageUploadLimitMb;
    if (req.file.size > uploadLimitMb * 1024 * 1024) {
      removeUploaded(req.file);
      const label = parsed.data === "map" ? "Maps" : parsed.data === "scene" ? "Scenes" : "References";
      return res.status(413).json({ error: `${label} may be at most ${uploadLimitMb} MB.` });
    }
    if (markdown ? !validMarkdownFile(req.file) : !validImageSignature(req.file)) {
      removeUploaded(req.file);
      return res.status(415).json({
        error: markdown
          ? "The file is not valid UTF-8 Markdown."
          : "The file contents do not match a supported image format."
      });
    }
    const mediaBytes = one<{ size: number }>("SELECT COALESCE(SUM(size), 0) AS size FROM media")?.size ?? 0;
    const portraitBytes =
      one<{ size: number }>("SELECT COALESCE(SUM(portrait_size), 0) AS size FROM characters")?.size ?? 0;
    const starshipBytes =
      one<{ size: number }>("SELECT COALESCE(SUM(size), 0) AS size FROM starship_images")?.size ?? 0;
    const used = mediaBytes + portraitBytes + starshipBytes;
    if (used + req.file.size > config.uploadLimitMb * 1024 * 1024) {
      removeUploaded(req.file);
      return res.status(413).json({ error: "The server upload-storage allowance has been reached." });
    }
    const result = db
      .prepare(
        `INSERT INTO media (room_id, uploaded_by, kind, category, filename, stored_name, mime_type, size)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        roomId,
        req.account!.id,
        parsed.data === "map" ? "scene" : parsed.data,
        parsed.data,
        path.basename(req.file.originalname).slice(0, 200) ||
          (markdown ? "reference.md" : `image${imageTypes.get(req.file.mimetype)}`),
        req.file.filename,
        markdown ? "text/markdown" : req.file.mimetype,
        req.file.size
      );
    const row = one<MediaRow>(
      `SELECT id, room_id, COALESCE(category, kind) AS kind, filename, display_name, stored_name, visible, mime_type, size, created_at
       FROM media WHERE id = ?`,
      Number(result.lastInsertRowid)
    )!;
    broadcastRoom(roomId, { type: "media-updated" });
    res.status(201).json({ media: publicMedia(row) });
  }
);

mediaRouter.patch("/rooms/:roomId/map", requireAuth, (req: AuthedRequest, res) => {
  const roomId = requireGm(req, res);
  if (!roomId) return;
  const parsed = z.object({ mediaId: z.number().int().positive().nullable() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Choose a valid Map." });
  if (
    parsed.data.mediaId &&
    !one(
      "SELECT 1 FROM media WHERE id = ? AND room_id = ? AND COALESCE(category, kind) = 'map'",
      parsed.data.mediaId,
      roomId
    )
  )
    return res.status(404).json({ error: "Map not found." });
  setActiveMedia(roomId, "map", parsed.data.mediaId);
  broadcastRoom(roomId, { type: "media-updated" });
  res.status(204).end();
});

mediaRouter.patch("/rooms/:roomId/scene", requireAuth, (req: AuthedRequest, res) => {
  const roomId = requireGm(req, res);
  if (!roomId) return;
  const parsed = z.object({ mediaId: z.number().int().positive().nullable() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Choose a valid Scene." });
  if (
    parsed.data.mediaId &&
    !one(
      "SELECT 1 FROM media WHERE id = ? AND room_id = ? AND COALESCE(category, kind) = 'scene'",
      parsed.data.mediaId,
      roomId
    )
  )
    return res.status(404).json({ error: "Scene not found." });
  setActiveMedia(roomId, "scene", parsed.data.mediaId);
  broadcastRoom(roomId, { type: "media-updated" });
  res.status(204).end();
});

mediaRouter.patch("/rooms/:roomId/media/:mediaId/visibility", requireAuth, (req: AuthedRequest, res) => {
  const roomId = requireGm(req, res);
  if (!roomId) return;
  const mediaId = Number(req.params.mediaId);
  const parsed = z.object({ visible: z.boolean() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Choose whether this asset is visible." });
  const result = db
    .prepare(
      `UPDATE media SET visible = ?
       WHERE id = ? AND room_id = ? AND COALESCE(category, kind) IN ('map', 'scene', 'reference')`
    )
    .run(parsed.data.visible ? 1 : 0, mediaId, roomId);
  if (!result.changes) return res.status(404).json({ error: "Media not found." });
  broadcastRoom(roomId, { type: "media-updated" });
  res.status(204).end();
});
mediaRouter.patch("/rooms/:roomId/media/:mediaId", requireAuth, (req: AuthedRequest, res) => {
  const roomId = requireGm(req, res);
  if (!roomId) return;
  const mediaId = Number(req.params.mediaId);
  const parsed = z.object({ displayName: z.string().trim().max(120).nullable() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Names may be at most 120 characters." });
  const displayName = parsed.data.displayName || null;
  const result = db
    .prepare(
      `UPDATE media SET display_name = ?
       WHERE id = ? AND room_id = ? AND COALESCE(category, kind) IN ('map', 'scene', 'reference')`
    )
    .run(displayName, mediaId, roomId);
  if (!result.changes) return res.status(404).json({ error: "Media not found." });
  const row = one<MediaRow>(
    `SELECT id, room_id, COALESCE(category, kind) AS kind, filename, display_name, stored_name, visible, mime_type, size, created_at
     FROM media WHERE id = ? AND room_id = ?`,
    mediaId,
    roomId
  )!;
  broadcastRoom(roomId, { type: "media-updated" });
  res.json({ media: publicMedia(row) });
});

mediaRouter.post("/rooms/:roomId/references/:mediaId/reveal", requireAuth, (req: AuthedRequest, res) => {
  const roomId = requireGm(req, res);
  if (!roomId) return;
  const mediaId = Number(req.params.mediaId);
  if (
    !one("SELECT 1 FROM media WHERE id = ? AND room_id = ? AND COALESCE(category, kind) = 'reference'", mediaId, roomId)
  )
    return res.status(404).json({ error: "Reference not found." });
  db.prepare("UPDATE media SET visible = 1 WHERE id = ? AND room_id = ?").run(mediaId, roomId);
  broadcastRoom(roomId, { type: "media-updated" });
  res.status(204).end();
});

mediaRouter.delete("/rooms/:roomId/media/:mediaId", requireAuth, (req: AuthedRequest, res) => {
  const roomId = requireGm(req, res);
  if (!roomId) return;
  const row = one<MediaRow>(
    `SELECT id, room_id, COALESCE(category, kind) AS kind, filename, display_name, stored_name, visible, mime_type, size, created_at
     FROM media WHERE id = ? AND room_id = ?`,
    Number(req.params.mediaId),
    roomId
  );
  if (!row) return res.status(404).json({ error: "Media not found." });
  db.prepare("DELETE FROM media WHERE id = ?").run(row.id);
  if (path.basename(row.stored_name) === row.stored_name)
    fs.rmSync(path.join(uploadsDir, row.stored_name), { force: true });
  broadcastRoom(roomId, { type: "media-updated" });
  res.status(204).end();
});

mediaRouter.get("/media/:mediaId/file", requireAuth, (req: AuthedRequest, res) => {
  const row = one<MediaRow>(
    `SELECT id, room_id, COALESCE(category, kind) AS kind, filename, display_name, stored_name, visible, mime_type, size, created_at
     FROM media WHERE id = ?`,
    Number(req.params.mediaId)
  );
  if (!row) return res.status(404).json({ error: "Media not found." });
  const role = roomRole(req.account!.id, row.room_id);
  const allowed = role === "gm" || (role === "player" && (row.kind === "audio" || Boolean(row.visible)));
  if (!allowed) return res.status(404).json({ error: "Media not found." });
  if (path.basename(row.stored_name) !== row.stored_name)
    return res.status(404).json({ error: "Media file not found." });
  res.type(row.mime_type);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(row.filename)}`);
  res.sendFile(row.stored_name, { root: uploadsDir });
});

mediaRouter.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (error instanceof multer.MulterError) {
    return res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({
      error:
        error.code === "LIMIT_FILE_SIZE"
          ? `Maps and Scenes may be at most ${config.sceneImageUploadLimitMb} MB; References at most ${config.referenceImageUploadLimitMb} MB.`
          : error.message
    });
  }
  if (error instanceof Error && error.message.includes("PNG, JPEG, WebP, and Markdown"))
    return res.status(415).json({ error: error.message });
  next(error);
});
