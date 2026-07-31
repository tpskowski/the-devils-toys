import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import multer from "multer";
import { z } from "zod";
import type { AudioPlaybackState, MediaAsset, RoomAudioState } from "@devils-toys/shared";
import type { AuthedRequest } from "./auth.js";
import { requireAuth, roomRole } from "./auth.js";
import { config } from "./config.js";
import { all, db, one } from "./db.js";
import { broadcastRoom } from "./realtime.js";
import { readMp3Metadata } from "./mp3-metadata.js";

export const audioRouter = express.Router();
const uploadsDir = path.join(config.dataDir, "uploads");

interface AudioRow {
  id: number;
  room_id: number;
  kind: "audio";
  filename: string;
  stored_name: string;
  mime_type: string;
  artist: string | null;
  title: string | null;
  metadata_loaded: number;
  size: number;
  created_at: string;
}

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadsDir,
    filename(_req, _file, callback) {
      callback(null, `${crypto.randomUUID()}.mp3`);
    }
  }),
  limits: { fileSize: config.audioUploadLimitMb * 1024 * 1024, files: 1 },
  fileFilter(_req, file, callback) {
    if (file.mimetype === "audio/mpeg" || file.mimetype === "audio/mp3") callback(null, true);
    else callback(new Error("Only MP3 audio is supported."));
  }
});

function publicAudio(row: AudioRow): MediaAsset {
  return {
    id: row.id,
    roomId: row.room_id,
    kind: row.kind,
    filename: row.filename,
    artist: row.artist,
    title: row.title,
    mimeType: row.mime_type,
    size: row.size,
    visible: true,
    createdAt: row.created_at,
    url: `/api/media/${row.id}/file`
  };
}

function withMetadata(row: AudioRow) {
  if (row.metadata_loaded) return row;
  let metadata = { artist: null as string | null, title: null as string | null };
  try {
    if (path.basename(row.stored_name) === row.stored_name)
      metadata = readMp3Metadata(path.join(uploadsDir, row.stored_name));
  } catch {
    // A missing or malformed tag must not make the room's playlist unavailable.
  }
  db.prepare("UPDATE media SET artist = ?, title = ?, metadata_loaded = 1 WHERE id = ?").run(
    metadata.artist,
    metadata.title,
    row.id
  );
  return { ...row, ...metadata, metadata_loaded: 1 };
}

function requireGm(req: AuthedRequest, res: express.Response) {
  const roomId = Number(req.params.roomId);
  if (!Number.isInteger(roomId) || roomRole(req.account!.id, roomId) !== "gm") {
    res.status(403).json({ error: "Only the room GM can manage shared audio." });
    return;
  }
  return roomId;
}

function removeUpload(file?: Express.Multer.File) {
  if (file && path.basename(file.filename) === file.filename) fs.rmSync(file.path, { force: true });
}

function isMp3(file: Express.Multer.File) {
  const bytes = Buffer.alloc(3);
  const descriptor = fs.openSync(file.path, "r");
  try {
    fs.readSync(descriptor, bytes, 0, 3, 0);
  } finally {
    fs.closeSync(descriptor);
  }
  return bytes.toString("ascii") === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
}

function storedPlayback(roomId: number): AudioPlaybackState {
  const raw = one<{ audio_json: string }>("SELECT audio_json FROM room_state WHERE room_id = ?", roomId)?.audio_json;
  let state: Partial<AudioPlaybackState> = {};
  try {
    state = JSON.parse(raw || "{}");
  } catch {
    state = {};
  }
  const updatedAt = typeof state.updatedAt === "string" ? state.updatedAt : new Date().toISOString();
  const elapsed = state.playing ? Math.max(0, (Date.now() - Date.parse(updatedAt)) / 1000) : 0;
  return {
    trackId: typeof state.trackId === "number" ? state.trackId : null,
    playing: Boolean(state.playing),
    position: Math.max(0, Number(state.position ?? 0) + elapsed),
    repeat: state.repeat === "all" || state.repeat === "one" ? state.repeat : "off",
    shuffle: Boolean(state.shuffle),
    updatedAt: new Date().toISOString()
  };
}

function savePlayback(roomId: number, state: Omit<AudioPlaybackState, "updatedAt">) {
  const playback: AudioPlaybackState = {
    ...state,
    position: Math.max(0, state.position),
    updatedAt: new Date().toISOString()
  };
  db.prepare(
    `INSERT INTO room_state (room_id, audio_json, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(room_id) DO UPDATE SET audio_json = excluded.audio_json, updated_at = CURRENT_TIMESTAMP`
  ).run(roomId, JSON.stringify(playback));
  return playback;
}

audioRouter.get("/rooms/:roomId/audio", requireAuth, (req: AuthedRequest, res) => {
  const roomId = Number(req.params.roomId);
  if (!roomRole(req.account!.id, roomId)) return res.status(404).json({ error: "Room not found." });
  const tracks = all<AudioRow>(
    `SELECT id, room_id, kind, filename, stored_name, mime_type, artist, title, metadata_loaded, size, created_at
     FROM media WHERE room_id = ? AND kind = 'audio' ORDER BY id`,
    roomId
  )
    .map(withMetadata)
    .map(publicAudio);
  const playback = storedPlayback(roomId);
  if (playback.trackId && !tracks.some((track) => track.id === playback.trackId))
    Object.assign(playback, { trackId: null, playing: false, position: 0 });
  res.json({ tracks, playback } satisfies RoomAudioState);
});

audioRouter.post(
  "/rooms/:roomId/audio",
  requireAuth,
  upload.single("file"),
  (req: AuthedRequest, res: express.Response) => {
    const roomId = requireGm(req, res);
    if (!roomId) {
      removeUpload(req.file);
      return;
    }
    if (!req.file) return res.status(400).json({ error: "Choose an MP3 file." });
    if (!isMp3(req.file)) {
      removeUpload(req.file);
      return res.status(415).json({ error: "The file contents do not match MP3 audio." });
    }
    const mediaBytes = one<{ size: number }>("SELECT COALESCE(SUM(size), 0) AS size FROM media")?.size ?? 0;
    const portraitBytes =
      one<{ size: number }>("SELECT COALESCE(SUM(portrait_size), 0) AS size FROM characters")?.size ?? 0;
    const starshipBytes =
      one<{ size: number }>("SELECT COALESCE(SUM(size), 0) AS size FROM starship_images")?.size ?? 0;
    const hirelingBytes =
      one<{ size: number }>("SELECT COALESCE(SUM(size), 0) AS size FROM hireling_images")?.size ?? 0;
    const used = mediaBytes + portraitBytes + starshipBytes + hirelingBytes;
    if (used + req.file.size > config.uploadLimitMb * 1024 * 1024) {
      removeUpload(req.file);
      return res.status(413).json({ error: "The server upload-storage allowance has been reached." });
    }
    const metadata = readMp3Metadata(req.file.path);
    const result = db
      .prepare(
        `INSERT INTO media
           (room_id, uploaded_by, kind, filename, stored_name, artist, title, metadata_loaded, mime_type, size)
         VALUES (?, ?, 'audio', ?, ?, ?, ?, 1, 'audio/mpeg', ?)`
      )
      .run(
        roomId,
        req.account!.id,
        path.basename(req.file.originalname).slice(0, 200) || "track.mp3",
        req.file.filename,
        metadata.artist,
        metadata.title,
        req.file.size
      );
    const track = one<AudioRow>(
      `SELECT id, room_id, kind, filename, stored_name, mime_type, artist, title, metadata_loaded, size, created_at
       FROM media WHERE id = ?`,
      Number(result.lastInsertRowid)
    )!;
    broadcastRoom(roomId, { type: "audio-updated" });
    res.status(201).json({ track: publicAudio(track) });
  }
);

audioRouter.patch("/rooms/:roomId/audio/playback", requireAuth, (req: AuthedRequest, res) => {
  const roomId = requireGm(req, res);
  if (!roomId) return;
  const parsed = z
    .object({
      trackId: z.number().int().positive().nullable(),
      playing: z.boolean(),
      position: z.number().finite().min(0).max(86400),
      repeat: z.enum(["off", "all", "one"]).optional(),
      shuffle: z.boolean().optional()
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Choose a valid track and playback position." });
  if (
    parsed.data.trackId &&
    !one("SELECT 1 FROM media WHERE id = ? AND room_id = ? AND kind = 'audio'", parsed.data.trackId, roomId)
  )
    return res.status(404).json({ error: "Track not found." });
  const current = storedPlayback(roomId);
  const playback = savePlayback(roomId, {
    trackId: parsed.data.trackId,
    playing: parsed.data.trackId ? parsed.data.playing : false,
    position: parsed.data.trackId ? parsed.data.position : 0,
    repeat: parsed.data.repeat ?? current.repeat,
    shuffle: parsed.data.shuffle ?? current.shuffle
  });
  broadcastRoom(roomId, { type: "audio-playback", playback });
  res.json({ playback });
});

audioRouter.delete("/rooms/:roomId/audio/:mediaId", requireAuth, (req: AuthedRequest, res) => {
  const roomId = requireGm(req, res);
  if (!roomId) return;
  const row = one<AudioRow>(
    `SELECT id, room_id, kind, filename, stored_name, mime_type, artist, title, metadata_loaded, size, created_at
     FROM media WHERE id = ? AND room_id = ? AND kind = 'audio'`,
    Number(req.params.mediaId),
    roomId
  );
  if (!row) return res.status(404).json({ error: "Track not found." });
  const playback = storedPlayback(roomId);
  if (playback.trackId === row.id)
    savePlayback(roomId, {
      trackId: null,
      playing: false,
      position: 0,
      repeat: playback.repeat,
      shuffle: playback.shuffle
    });
  db.prepare("DELETE FROM media WHERE id = ?").run(row.id);
  if (path.basename(row.stored_name) === row.stored_name)
    fs.rmSync(path.join(uploadsDir, row.stored_name), { force: true });
  broadcastRoom(roomId, { type: "audio-updated" });
  res.status(204).end();
});

audioRouter.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (error instanceof multer.MulterError)
    return res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({
      error:
        error.code === "LIMIT_FILE_SIZE" ? `MP3 files may be at most ${config.audioUploadLimitMb} MB.` : error.message
    });
  if (error instanceof Error && error.message.includes("MP3")) return res.status(415).json({ error: error.message });
  next(error);
});
