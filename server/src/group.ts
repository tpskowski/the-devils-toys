import path from "node:path";
import express from "express";
import multer from "multer";
import { z } from "zod";
import type { SystemId } from "@devils-toys/shared";
import type { AuthedRequest } from "./auth.js";
import { requireAuth, roomRole } from "./auth.js";
import { characterItemsFor } from "./character-items.js";
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
import { rollHirelingCreation } from "./hireling-creation.js";
import { systemMarkdown, systems } from "./systems.js";

export const groupRouter = express.Router();

interface StarshipImageRow {
  room_id: number;
  starship_id: string;
  filename: string;
  stored_name: string;
  mime_type: string;
  size: number;
}

interface HirelingImageRow {
  room_id: number;
  hireling_id: string;
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
const hirelingIdSchema = starshipIdSchema;
const groupImageUpload = multer({
  storage: multer.diskStorage({
    destination: uploadsDir,
    filename(_req, file, callback) {
      callback(null, `${crypto.randomUUID()}${portraitImageTypes.get(file.mimetype) ?? ""}`);
    }
  }),
  limits: { fileSize: PORTRAIT_UPLOAD_LIMIT_BYTES, files: 1 },
  fileFilter(_req, file, callback) {
    if (portraitImageTypes.has(file.mimetype)) callback(null, true);
    else callback(new Error("Only PNG, JPEG, and WebP group images are supported."));
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

function requireGroupGm(req: AuthedRequest, res: express.Response, roomId: number) {
  const context = groupContext(req.account!.id, roomId);
  if (!context) {
    res.status(404).json({ error: "Group page not found." });
    return;
  }
  if (context.role !== "gm") {
    res.status(403).json({ error: "The group page is maintained by the room GM." });
    return;
  }
  return context;
}

export function parseGroupState(json: string | null | undefined) {
  try {
    const parsed: unknown = JSON.parse(json ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Merge one hireling inside the shared group blob without replacing the rest of the state. */
export function updateHireling(
  roomId: number,
  hirelingId: string,
  changes: Record<string, unknown>
): { state: Record<string, unknown> } | { error: string; status: number } {
  if (!hirelingId || !changes || Array.isArray(changes)) return { error: "Invalid hireling update.", status: 400 };
  db.exec("BEGIN IMMEDIATE");
  try {
    const current = one<{ group_json: string }>("SELECT group_json FROM room_state WHERE room_id = ?", roomId);
    const state = parseGroupState(current?.group_json);
    if (!Array.isArray(state.hirelings)) {
      db.exec("ROLLBACK");
      return { error: "Hireling not found.", status: 404 };
    }
    let found = false;
    const hirelings = state.hirelings.map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
      const record = entry as Record<string, unknown>;
      if (record.id !== hirelingId) return entry;
      found = true;
      return { ...record, ...changes, id: hirelingId };
    });
    if (!found) {
      db.exec("ROLLBACK");
      return { error: "Hireling not found.", status: 404 };
    }
    const nextState = { ...state, hirelings };
    const validState = groupStateSchema.safeParse(nextState);
    if (!validState.success) {
      db.exec("ROLLBACK");
      return { error: validState.error.issues[0]?.message ?? "Group data is too large.", status: 400 };
    }
    db.prepare(
      `INSERT INTO room_state (room_id, group_json, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(room_id) DO UPDATE SET group_json = excluded.group_json, updated_at = CURRENT_TIMESTAMP`
    ).run(roomId, JSON.stringify(nextState));
    db.exec("COMMIT");
    return { state: nextState };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function publicStarshipImage(row: StarshipImageRow) {
  return {
    starshipId: row.starship_id,
    url: `/api/rooms/${row.room_id}/group/starships/${encodeURIComponent(row.starship_id)}/image?v=${encodeURIComponent(row.stored_name)}`,
    filename: row.filename
  };
}

function publicHirelingImage(row: HirelingImageRow) {
  return {
    hirelingId: row.hireling_id,
    url: `/api/rooms/${row.room_id}/group/hirelings/${encodeURIComponent(row.hireling_id)}/image?v=${encodeURIComponent(row.stored_name)}`,
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

function hirelingImage(accountId: number, roomId: number, rawHirelingId: string) {
  if (!groupContext(accountId, roomId)) return;
  const parsedId = hirelingIdSchema.safeParse(rawHirelingId);
  if (!parsedId.success) return;
  return one<HirelingImageRow>(
    "SELECT * FROM hireling_images WHERE room_id = ? AND hireling_id = ?",
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
    // Hirelings fill the same slots out of the same tables a character does, so
    // the page is given the same gear rather than a second, thinner copy of it.
    itemCatalogue: characterItemsFor(context.system),
    images: all<StarshipImageRow>("SELECT * FROM starship_images WHERE room_id = ? ORDER BY updated_at", roomId).map(
      publicStarshipImage
    ),
    hirelingImages: all<HirelingImageRow>(
      "SELECT * FROM hireling_images WHERE room_id = ? ORDER BY updated_at",
      roomId
    ).map(publicHirelingImage),
    updatedAt: row?.updated_at ?? null
  });
});

groupRouter.patch("/rooms/:roomId/group", requireAuth, (req: AuthedRequest, res) => {
  const roomId = Number(req.params.roomId);
  if (!requireGroupGm(req, res, roomId)) return;
  const parsed = z.object({ state: groupStateSchema, updatedAt: z.string().nullable().optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid group data." });
  const existing = one<{ group_json: string; updated_at: string }>(
    "SELECT group_json, updated_at FROM room_state WHERE room_id = ?",
    roomId
  );
  if (parsed.data.updatedAt !== undefined && parsed.data.updatedAt !== (existing?.updated_at ?? null))
    return res.status(409).json({ error: "The group changed elsewhere. Reload before saving." });
  const existingState = parseGroupState(existing?.group_json);
  const existingIds = new Set(
    Array.isArray(existingState.hirelings)
      ? existingState.hirelings
          .filter((entry): entry is Record<string, unknown> =>
            Boolean(entry && typeof entry === "object" && !Array.isArray(entry))
          )
          .map((entry) => String(entry.id ?? ""))
          .filter(Boolean)
      : []
  );
  const nextHirelings = Array.isArray(parsed.data.state.hirelings)
    ? parsed.data.state.hirelings
        .filter((entry): entry is Record<string, unknown> =>
          Boolean(entry && typeof entry === "object" && !Array.isArray(entry))
        )
        .map((entry) => String(entry.id ?? ""))
        .filter(Boolean)
    : [];
  if ([...existingIds].some((id) => !nextHirelings.includes(id)))
    return res.status(409).json({ error: "Remove hirelings through the dedicated delete route." });
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

groupRouter.patch("/rooms/:roomId/group/hirelings/:hirelingId", requireAuth, (req: AuthedRequest, res) => {
  const roomId = Number(req.params.roomId);
  if (!requireGroupGm(req, res, roomId)) return;
  const parsedId = hirelingIdSchema.safeParse(req.params.hirelingId);
  if (!parsedId.success) return res.status(404).json({ error: "Hireling not found." });
  const parsed = z.record(z.unknown()).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid hireling update." });
  const result = updateHireling(roomId, parsedId.data, parsed.data);
  if ("error" in result) return res.status(result.status).json({ error: result.error });
  const updatedAt = one<{ updated_at: string }>(
    "SELECT updated_at FROM room_state WHERE room_id = ?",
    roomId
  )!.updated_at;
  broadcastRoom(roomId, { type: "group-updated" });
  res.json({ ...result, updatedAt });
});

groupRouter.post("/rooms/:roomId/group/hirelings/roll", requireAuth, (req: AuthedRequest, res) => {
  const roomId = Number(req.params.roomId);
  const context = groupContext(req.account!.id, roomId);
  const creationRoll = context?.definition.hirelings?.creationRoll;
  if (!context || !creationRoll) return res.status(404).json({ error: "Hireling creation is not available." });

  try {
    res.json({
      hireling: rollHirelingCreation(
        creationRoll,
        systemMarkdown(context.system),
        undefined,
        context.definition.hirelings?.sheet.lists[0]?.key
      )
    });
  } catch (cause) {
    res.status(500).json({ error: cause instanceof Error ? cause.message : "Hireling creation failed." });
  }
});

groupRouter.delete("/rooms/:roomId/group/hirelings/:hirelingId", requireAuth, (req: AuthedRequest, res) => {
  const roomId = Number(req.params.roomId);
  if (!requireGroupGm(req, res, roomId)) return;
  const parsedId = hirelingIdSchema.safeParse(req.params.hirelingId);
  if (!parsedId.success) return res.status(404).json({ error: "Hireling not found." });
  const row = one<{ group_json: string }>("SELECT group_json FROM room_state WHERE room_id = ?", roomId);
  const state = parseGroupState(row?.group_json);
  if (!Array.isArray(state.hirelings)) return res.status(404).json({ error: "Hireling not found." });
  const hirelingId = parsedId.data;
  const hirelings = state.hirelings.filter((hireling) => {
    if (!hireling || typeof hireling !== "object" || Array.isArray(hireling)) return true;
    return (hireling as Record<string, unknown>).id !== hirelingId;
  });
  if (hirelings.length === state.hirelings.length) return res.status(404).json({ error: "Hireling not found." });
  const nextState = { ...state, hirelings };
  const image = one<HirelingImageRow>(
    "SELECT * FROM hireling_images WHERE room_id = ? AND hireling_id = ?",
    roomId,
    hirelingId
  );
  db.exec("BEGIN");
  try {
    db.prepare(
      `INSERT INTO room_state (room_id, group_json, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(room_id) DO UPDATE SET group_json = excluded.group_json, updated_at = CURRENT_TIMESTAMP`
    ).run(roomId, JSON.stringify(nextState));
    db.prepare("DELETE FROM hireling_images WHERE room_id = ? AND hireling_id = ?").run(roomId, hirelingId);
    db.prepare(
      `DELETE FROM encounter_combatants
       WHERE kind = 'hireling' AND hireling_id = ? AND encounter_id IN
         (SELECT id FROM encounters WHERE room_id = ?)`
    ).run(hirelingId, roomId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  if (image) removeStoredPortrait(image.stored_name);
  const updatedAt = one<{ updated_at: string }>(
    "SELECT updated_at FROM room_state WHERE room_id = ?",
    roomId
  )!.updated_at;
  broadcastRoom(roomId, { type: "group-updated" });
  res.json({ state: nextState, updatedAt });
});

groupRouter.get("/rooms/:roomId/group/hirelings/:hirelingId/image", requireAuth, (req: AuthedRequest, res) => {
  const roomId = Number(req.params.roomId);
  const image = hirelingImage(req.account!.id, roomId, String(req.params.hirelingId));
  if (!image || path.basename(image.stored_name) !== image.stored_name)
    return res.status(404).json({ error: "Hireling image not found." });
  res.type(image.mime_type);
  res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
  res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(image.filename)}`);
  res.sendFile(image.stored_name, { root: uploadsDir });
});

groupRouter.post(
  "/rooms/:roomId/group/hirelings/:hirelingId/image",
  requireAuth,
  groupImageUpload.single("file"),
  (req: AuthedRequest, res) => {
    const roomId = Number(req.params.roomId);
    const context = requireGroupGm(req, res, roomId);
    const parsedId = hirelingIdSchema.safeParse(req.params.hirelingId);
    if (!context) {
      removeUploadedPortrait(req.file);
      return;
    }
    if (!parsedId.success) {
      removeUploadedPortrait(req.file);
      return res.status(404).json({ error: "Hireling not found." });
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
    const hirelingBytes =
      one<{ size: number }>("SELECT COALESCE(SUM(size), 0) AS size FROM hireling_images")?.size ?? 0;
    const previous = one<HirelingImageRow>(
      "SELECT * FROM hireling_images WHERE room_id = ? AND hireling_id = ?",
      roomId,
      parsedId.data
    );
    if (
      mediaBytes + portraitBytes + starshipBytes + hirelingBytes - (previous?.size ?? 0) + req.file.size >
      config.uploadLimitMb * 1024 * 1024
    ) {
      removeUploadedPortrait(req.file);
      return res.status(413).json({ error: "The server upload-storage allowance has been reached." });
    }

    try {
      db.prepare(
        `INSERT INTO hireling_images
           (room_id, hireling_id, filename, stored_name, mime_type, size, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(room_id, hireling_id) DO UPDATE SET
           filename = excluded.filename, stored_name = excluded.stored_name,
           mime_type = excluded.mime_type, size = excluded.size, updated_at = CURRENT_TIMESTAMP`
      ).run(
        roomId,
        parsedId.data,
        path.basename(req.file.originalname).slice(0, 200) || `hireling${portraitImageTypes.get(req.file.mimetype)}`,
        req.file.filename,
        req.file.mimetype,
        req.file.size
      );
    } catch (error) {
      removeUploadedPortrait(req.file);
      throw error;
    }
    if (previous?.stored_name !== req.file.filename) removeStoredPortrait(previous?.stored_name);
    const image = one<HirelingImageRow>(
      "SELECT * FROM hireling_images WHERE room_id = ? AND hireling_id = ?",
      roomId,
      parsedId.data
    )!;
    broadcastRoom(roomId, { type: "group-updated" });
    res.status(201).json({ image: publicHirelingImage(image) });
  }
);

groupRouter.delete("/rooms/:roomId/group/hirelings/:hirelingId/image", requireAuth, (req: AuthedRequest, res) => {
  const roomId = Number(req.params.roomId);
  if (!requireGroupGm(req, res, roomId)) return;
  const image = hirelingImage(req.account!.id, roomId, String(req.params.hirelingId));
  if (!image) return res.status(404).json({ error: "Hireling image not found." });
  db.prepare("DELETE FROM hireling_images WHERE room_id = ? AND hireling_id = ?").run(roomId, image.hireling_id);
  removeStoredPortrait(image.stored_name);
  broadcastRoom(roomId, { type: "group-updated" });
  res.status(204).end();
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
  groupImageUpload.single("file"),
  (req: AuthedRequest, res) => {
    const roomId = Number(req.params.roomId);
    const context = requireGroupGm(req, res, roomId);
    const parsedId = starshipIdSchema.safeParse(req.params.starshipId);
    if (!context) {
      removeUploadedPortrait(req.file);
      return;
    }
    if (!parsedId.success) {
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
    const hirelingBytes =
      one<{ size: number }>("SELECT COALESCE(SUM(size), 0) AS size FROM hireling_images")?.size ?? 0;
    const previous = one<StarshipImageRow>(
      "SELECT * FROM starship_images WHERE room_id = ? AND starship_id = ?",
      roomId,
      parsedId.data
    );
    if (
      mediaBytes + portraitBytes + starshipBytes + hirelingBytes - (previous?.size ?? 0) + req.file.size >
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
  if (!requireGroupGm(req, res, roomId)) return;
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
      error: error.code === "LIMIT_FILE_SIZE" ? "Group images may be at most 5 MB." : error.message
    });
  }
  if (error instanceof Error && error.message.includes("PNG, JPEG, and WebP group images"))
    return res.status(415).json({ error: error.message });
  next(error);
});
