import express from "express";
import { z } from "zod";
import type { AuthedRequest } from "./auth.js";
import { requireAuth } from "./auth.js";
import { all, db, one } from "./db.js";
import { broadcastRoom } from "./realtime.js";
import { requireRoomConfig, roomAccessRole } from "./room-config-permissions.js";

/**
 * Named, ordered lists of a room's music.
 *
 * The room had one flat library and one playback state, and no way to say "this
 * is the combat music". A playlist is a view over the library rather than a
 * gate on it: a track in no playlist is still in the room and still playable,
 * and deleting a track takes it out of every playlist by foreign key rather
 * than by anything remembering to.
 *
 * Building them is setup, so it is behind `requireRoomConfig`. Choosing which
 * one is playing is a live act and stays with the room's own playback route.
 */
export const playlistRouter = express.Router();

interface PlaylistRow {
  id: number;
  room_id: number;
  name: string;
  sort_order: number;
}

export interface PublicPlaylist {
  id: number;
  name: string;
  sortOrder: number;
  trackIds: number[];
}

export function playlistsFor(roomId: number): PublicPlaylist[] {
  const rows = all<PlaylistRow>("SELECT * FROM room_playlists WHERE room_id = ? ORDER BY sort_order, id", roomId);
  if (!rows.length) return [];
  const tracks = all<{ playlist_id: number; media_id: number }>(
    `SELECT t.playlist_id, t.media_id FROM room_playlist_tracks t
       JOIN room_playlists p ON p.id = t.playlist_id
      WHERE p.room_id = ? ORDER BY t.sort_order, t.media_id`,
    roomId
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    sortOrder: row.sort_order,
    trackIds: tracks.filter((track) => track.playlist_id === row.id).map((track) => track.media_id)
  }));
}

function playlist(roomId: number, id: number) {
  return one<PlaylistRow>("SELECT * FROM room_playlists WHERE id = ? AND room_id = ?", id, roomId);
}

function changed(roomId: number, res: express.Response, body: unknown, status = 200) {
  broadcastRoom(roomId, { type: "audio-updated" });
  res.status(status).json(body);
}

playlistRouter.get("/rooms/:roomId/playlists", requireAuth, (req: AuthedRequest, res) => {
  const roomId = requireRoomConfig(req, res);
  if (!roomId) return;
  res.json({ playlists: playlistsFor(roomId) });
});

playlistRouter.post("/rooms/:roomId/playlists", requireAuth, (req: AuthedRequest, res) => {
  const roomId = requireRoomConfig(req, res);
  if (!roomId) return;
  const parsed = z.object({ name: z.string().trim().min(1).max(80) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Give the playlist a name." });
  const next =
    one<{ next: number }>(
      "SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM room_playlists WHERE room_id = ?",
      roomId
    )?.next ?? 0;
  const result = db
    .prepare("INSERT INTO room_playlists (room_id, name, sort_order) VALUES (?, ?, ?)")
    .run(roomId, parsed.data.name, next);
  changed(
    roomId,
    res,
    { playlist: playlistsFor(roomId).find((entry) => entry.id === Number(result.lastInsertRowid)) },
    201
  );
});

playlistRouter.patch("/rooms/:roomId/playlists/:playlistId", requireAuth, (req: AuthedRequest, res) => {
  const roomId = requireRoomConfig(req, res);
  if (!roomId) return;
  const row = playlist(roomId, Number(req.params.playlistId));
  if (!row) return res.status(404).json({ error: "Playlist not found." });
  const parsed = z
    .object({
      name: z.string().trim().min(1).max(80).optional(),
      /** The tracks it holds, in the order it holds them. */
      trackIds: z.array(z.number().int().positive()).max(500).optional()
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid playlist." });

  db.exec("BEGIN IMMEDIATE");
  try {
    if (parsed.data.name)
      db.prepare("UPDATE room_playlists SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(
        parsed.data.name,
        row.id
      );
    if (parsed.data.trackIds) {
      // Only this room's own audio can be listed, so a playlist can never point
      // at a track from another room.
      const mine = new Set(
        all<{ id: number }>("SELECT id FROM media WHERE room_id = ? AND kind = 'audio'", roomId).map(
          (track) => track.id
        )
      );
      const ordered = parsed.data.trackIds.filter((id) => mine.has(id));
      db.prepare("DELETE FROM room_playlist_tracks WHERE playlist_id = ?").run(row.id);
      const insert = db.prepare(
        "INSERT OR IGNORE INTO room_playlist_tracks (playlist_id, media_id, sort_order) VALUES (?, ?, ?)"
      );
      ordered.forEach((id, index) => insert.run(row.id, id, index));
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  changed(roomId, res, { playlist: playlistsFor(roomId).find((entry) => entry.id === row.id) });
});

playlistRouter.delete("/rooms/:roomId/playlists/:playlistId", requireAuth, (req: AuthedRequest, res) => {
  const roomId = requireRoomConfig(req, res);
  if (!roomId) return;
  const row = playlist(roomId, Number(req.params.playlistId));
  if (!row) return res.status(404).json({ error: "Playlist not found." });
  db.prepare("DELETE FROM room_playlists WHERE id = ?").run(row.id);
  // A room playing this list falls back to its whole library rather than to
  // nothing; the playback route reads the id and finds it gone.
  broadcastRoom(roomId, { type: "audio-updated" });
  res.status(204).end();
});

/**
 * Renaming a track. The tag reader fills artist and title on upload, and gets
 * them wrong often enough that a GM needs somewhere to fix them.
 */
playlistRouter.patch("/rooms/:roomId/audio/:mediaId/tags", requireAuth, (req: AuthedRequest, res) => {
  const roomId = Number(req.params.roomId);
  if (roomAccessRole(req.account!, roomId) !== "gm")
    return res.status(403).json({ error: "Only the room GM can manage media." });
  const parsed = z
    .object({
      artist: z.string().trim().max(200).nullable().optional(),
      title: z.string().trim().max(200).nullable().optional()
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid track details." });
  const result = db
    .prepare(
      `UPDATE media SET artist = COALESCE(?, artist), title = COALESCE(?, title), metadata_loaded = 1
       WHERE id = ? AND room_id = ? AND kind = 'audio'`
    )
    .run(parsed.data.artist ?? null, parsed.data.title ?? null, Number(req.params.mediaId), roomId);
  if (!result.changes) return res.status(404).json({ error: "Track not found." });
  changed(roomId, res, { updated: true });
});
