import crypto from "node:crypto";
import path from "node:path";
import express from "express";
import multer from "multer";
import { z } from "zod";
import type { SystemId } from "@devils-toys/shared";
import type { AuthedRequest } from "./auth.js";
import { requireAuth, roomRole } from "./auth.js";
import { config } from "./config.js";
import { storedUploadBytes } from "./upload-usage.js";
import { characterItemsFor } from "./character-items.js";
import { all, db, one } from "./db.js";
import { inGameDisplayName } from "./display-name.js";
import {
  portraitImageTypes,
  PORTRAIT_UPLOAD_LIMIT_BYTES,
  removeStoredPortrait,
  removeUploadedPortrait,
  validPortraitFile
} from "./portrait-files.js";
import { broadcastRoom, refreshRoomPresence } from "./realtime.js";
import { systemMarkdown, systemOrThrow } from "./systems.js";
import { characterVicesFor } from "./character-vices.js";

export const characterRouter = express.Router();

export interface CharacterRow {
  id: number;
  system: SystemId;
  owner_account_id: number | null;
  owner_username: string | null;
  pool_room_id: number | null;
  name: string;
  sheet_json: string;
  portrait_filename: string | null;
  portrait_stored_name: string | null;
  portrait_mime_type: string | null;
  portrait_size: number | null;
  updated_at: string;
}

const sheetSchema = z.record(z.unknown()).refine((value) => JSON.stringify(value).length <= 250_000, {
  message: "Character data is too large."
});

const uploadsDir = path.join(config.dataDir, "uploads");
const portraitUpload = multer({
  storage: multer.diskStorage({
    destination: uploadsDir,
    filename(_req, file, callback) {
      callback(null, `${crypto.randomUUID()}${portraitImageTypes.get(file.mimetype) ?? ""}`);
    }
  }),
  limits: { fileSize: PORTRAIT_UPLOAD_LIMIT_BYTES, files: 1 },
  fileFilter(_req, file, callback) {
    if (portraitImageTypes.has(file.mimetype)) callback(null, true);
    else callback(new Error("Only PNG, JPEG, and WebP portraits are supported."));
  }
});

function roomContext(accountId: number, roomId: number) {
  const role = roomRole(accountId, roomId);
  if (!role) return;
  const room = one<{ system: SystemId }>("SELECT system FROM rooms WHERE id = ?", roomId);
  return room && { role, system: room.system };
}

function parseSheet(json: string) {
  try {
    const parsed: unknown = JSON.parse(json);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function publicCharacter(row: CharacterRow, roomId: number) {
  const sheet = parseSheet(row.sheet_json);
  const activeBy = all<{ account_id: number; username: string }>(
    `SELECT m.account_id, a.username FROM memberships m
       JOIN accounts a ON a.id = m.account_id
       WHERE m.room_id = ? AND m.active_character_id = ? ORDER BY a.username`,
    roomId,
    row.id
  ).map((item) => ({
    accountId: item.account_id,
    username: item.username,
    displayName: inGameDisplayName(item.username, row.name)
  }));
  return {
    id: row.id,
    system: row.system,
    ownerAccountId: row.owner_account_id,
    ownerUsername: row.owner_username,
    poolRoomId: row.pool_room_id,
    name: row.name,
    sheet,
    portraitUrl: row.portrait_stored_name
      ? `/api/rooms/${roomId}/characters/${row.id}/portrait?v=${encodeURIComponent(row.portrait_stored_name)}`
      : null,
    portraitFilename: row.portrait_filename,
    warnings: systemOrThrow(row.system).characterWarnings(sheet),
    activeBy,
    updatedAt: row.updated_at
  };
}

export function findVisibleCharacter(accountId: number, roomId: number, characterId: number) {
  const context = roomContext(accountId, roomId);
  if (!context) return;
  const row = one<CharacterRow>(
    `SELECT c.*, a.username AS owner_username FROM characters c
       LEFT JOIN accounts a ON a.id = c.owner_account_id
       WHERE c.id = ? AND c.system = ?`,
    characterId,
    context.system
  );
  if (!row) return;
  if (context.role === "player") {
    const activeInRoom = Boolean(
      one("SELECT 1 FROM memberships WHERE room_id = ? AND active_character_id = ?", roomId, row.id)
    );
    const visible =
      row.owner_account_id === accountId ||
      (row.owner_account_id === null && row.pool_room_id === roomId) ||
      activeInRoom;
    return visible ? { context, row } : undefined;
  }
  const ownerInRoom =
    row.owner_account_id !== null &&
    Boolean(one("SELECT 1 FROM memberships WHERE room_id = ? AND account_id = ?", roomId, row.owner_account_id));
  return row.pool_room_id === roomId || ownerInRoom ? { context, row } : undefined;
}

export function findAccessibleCharacter(accountId: number, roomId: number, characterId: number) {
  const visible = findVisibleCharacter(accountId, roomId, characterId);
  if (!visible) return;
  if (visible.context.role === "player" && visible.row.owner_account_id !== accountId) return;
  return visible;
}

export function broadcastCharacterChange(row: Pick<CharacterRow, "system" | "owner_account_id" | "pool_room_id">) {
  const roomIds = new Set<number>();
  if (row.pool_room_id) roomIds.add(row.pool_room_id);
  if (row.owner_account_id) {
    for (const item of all<{ room_id: number }>(
      `SELECT m.room_id FROM memberships m JOIN rooms r ON r.id = m.room_id
         WHERE m.account_id = ? AND r.system = ?`,
      row.owner_account_id,
      row.system
    ))
      roomIds.add(item.room_id);
  }
  for (const roomId of roomIds) {
    broadcastRoom(roomId, { type: "characters-updated" });
    refreshRoomPresence(roomId);
  }
}

characterRouter.get("/rooms/:roomId/characters", requireAuth, (req: AuthedRequest, res) => {
  const roomId = Number(req.params.roomId);
  const context = roomContext(req.account!.id, roomId);
  if (!context) return res.status(404).json({ error: "Room not found." });
  const select = `SELECT c.*, a.username AS owner_username FROM characters c
    LEFT JOIN accounts a ON a.id = c.owner_account_id`;
  const rows =
    context.role === "gm"
      ? all<CharacterRow>(
          `${select} WHERE c.system = ? AND (c.pool_room_id = ? OR c.owner_account_id IN
            (SELECT account_id FROM memberships WHERE room_id = ?)) ORDER BY c.owner_account_id IS NULL, a.username, c.name`,
          context.system,
          roomId,
          roomId
        )
      : all<CharacterRow>(
          `${select} WHERE c.system = ? AND (c.owner_account_id = ? OR
            (c.owner_account_id IS NULL AND c.pool_room_id = ?) OR
            c.id IN (SELECT active_character_id FROM memberships
              WHERE room_id = ? AND active_character_id IS NOT NULL))
            ORDER BY c.owner_account_id IS NULL, a.username, c.name`,
          context.system,
          req.account!.id,
          roomId,
          roomId
        );
  const activeCharacterId = one<{ active_character_id: number | null }>(
    "SELECT active_character_id FROM memberships WHERE room_id = ? AND account_id = ?",
    roomId,
    req.account!.id
  )?.active_character_id;
  res.json({
    characters: rows.map((row) => publicCharacter(row, roomId)),
    activeCharacterId: activeCharacterId ?? null,
    partyLabel: systemOrThrow(context.system).partyLabel,
    sheetDefinition: systemOrThrow(context.system).characterSheet,
    itemCatalogue: characterItemsFor(context.system, roomId),
    viceCatalogue: context.system === "monolith" ? characterVicesFor("monolith") : []
  });
});

characterRouter.post("/rooms/:roomId/characters", requireAuth, (req: AuthedRequest, res) => {
  const roomId = Number(req.params.roomId);
  const context = roomContext(req.account!.id, roomId);
  if (!context) return res.status(404).json({ error: "Room not found." });
  const parsed = z
    .object({
      name: z.string().trim().min(1).max(80),
      sheet: sheetSchema.default({}),
      unassigned: z.boolean().default(false)
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid character." });
  if (parsed.data.unassigned && context.role !== "gm")
    return res.status(403).json({ error: "Only the room GM can create an unassigned character." });
  const ownerId = parsed.data.unassigned ? null : req.account!.id;
  const poolRoomId = parsed.data.unassigned ? roomId : null;
  db.exec("BEGIN");
  try {
    const result = db
      .prepare(
        `INSERT INTO characters (system, owner_account_id, pool_room_id, created_by, name, sheet_json)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(context.system, ownerId, poolRoomId, req.account!.id, parsed.data.name, JSON.stringify(parsed.data.sheet));
    const characterId = Number(result.lastInsertRowid);
    if (context.role === "player" && ownerId === req.account!.id)
      db.prepare(
        `UPDATE memberships SET active_character_id = ?
         WHERE room_id = ? AND account_id = ? AND active_character_id IS NULL`
      ).run(characterId, roomId, req.account!.id);
    db.exec("COMMIT");
    const row = one<CharacterRow>(
      `SELECT c.*, a.username AS owner_username FROM characters c
       LEFT JOIN accounts a ON a.id = c.owner_account_id WHERE c.id = ?`,
      characterId
    )!;
    broadcastCharacterChange(row);
    res.status(201).json({ character: publicCharacter(row, roomId) });
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
});

characterRouter.patch("/rooms/:roomId/characters/:characterId", requireAuth, (req: AuthedRequest, res) => {
  const roomId = Number(req.params.roomId);
  const characterId = Number(req.params.characterId);
  const parsed = z
    .object({ name: z.string().trim().min(1).max(80).optional(), sheet: sheetSchema.optional() })
    .refine((value) => value.name !== undefined || value.sheet !== undefined)
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid character." });
  const result = updateCharacter(req.account!.id, roomId, characterId, parsed.data);
  if ("error" in result) return res.status(result.status).json({ error: result.error });
  res.json(result);
});

export function updateCharacter(
  accountId: number,
  roomId: number,
  characterId: number,
  changes: { name?: string; sheet?: Record<string, unknown>; sheetPatch?: Record<string, unknown> }
): { character: ReturnType<typeof publicCharacter> } | { error: string; status: number } {
  const accessible = findAccessibleCharacter(accountId, roomId, characterId);
  if (!accessible) return { error: "Character not found.", status: 404 };

  const name = changes.name === undefined ? undefined : changes.name.trim();
  if (name !== undefined && (!name || name.length > 80))
    return { error: "Character names must be between 1 and 80 characters.", status: 400 };

  let sheet: Record<string, unknown> | undefined;
  if (changes.sheet !== undefined && !sheetSchema.safeParse(changes.sheet).success)
    return { error: "Invalid character data.", status: 400 };
  if (changes.sheetPatch !== undefined && !sheetSchema.safeParse(changes.sheetPatch).success)
    return { error: "Invalid character data.", status: 400 };
  if (changes.sheet !== undefined) sheet = changes.sheet;
  if (changes.sheetPatch !== undefined) sheet = { ...parseSheet(accessible.row.sheet_json), ...changes.sheetPatch };
  if (sheet !== undefined && !sheetSchema.safeParse(sheet).success)
    return { error: "Invalid character data.", status: 400 };
  if (name === undefined && sheet === undefined)
    return { error: "Give the character a name or sheet data.", status: 400 };

  db.prepare(
    `UPDATE characters SET name = COALESCE(?, name), sheet_json = COALESCE(?, sheet_json),
       updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(name ?? null, sheet ? JSON.stringify(sheet) : null, characterId);
  const row = one<CharacterRow>(
    `SELECT c.*, a.username AS owner_username FROM characters c
     LEFT JOIN accounts a ON a.id = c.owner_account_id WHERE c.id = ?`,
    characterId
  )!;
  broadcastCharacterChange(row);
  return { character: publicCharacter(row, roomId) };
}

characterRouter.get("/rooms/:roomId/characters/:characterId/portrait", requireAuth, (req: AuthedRequest, res) => {
  const roomId = Number(req.params.roomId);
  const characterId = Number(req.params.characterId);
  const visible = findVisibleCharacter(req.account!.id, roomId, characterId);
  if (!visible?.row.portrait_stored_name || !visible.row.portrait_mime_type)
    return res.status(404).json({ error: "Character portrait not found." });
  if (path.basename(visible.row.portrait_stored_name) !== visible.row.portrait_stored_name)
    return res.status(404).json({ error: "Character portrait not found." });
  res.type(visible.row.portrait_mime_type);
  res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
  res.setHeader(
    "Content-Disposition",
    `inline; filename*=UTF-8''${encodeURIComponent(visible.row.portrait_filename ?? "portrait")}`
  );
  res.sendFile(visible.row.portrait_stored_name, { root: uploadsDir });
});

characterRouter.post(
  "/rooms/:roomId/characters/:characterId/portrait",
  requireAuth,
  portraitUpload.single("file"),
  (req: AuthedRequest, res) => {
    const roomId = Number(req.params.roomId);
    const characterId = Number(req.params.characterId);
    const accessible = findAccessibleCharacter(req.account!.id, roomId, characterId);
    if (!accessible) {
      removeUploadedPortrait(req.file);
      return res.status(404).json({ error: "Character not found." });
    }
    if (!req.file) return res.status(400).json({ error: "Choose a PNG, JPEG, or WebP portrait." });
    if (!validPortraitFile(req.file)) {
      removeUploadedPortrait(req.file);
      return res.status(415).json({ error: "The file contents do not match a supported image format." });
    }
    const used = storedUploadBytes();
    const replacedBytes = accessible.row.portrait_size ?? 0;
    if (used - replacedBytes + req.file.size > config.uploadLimitMb * 1024 * 1024) {
      removeUploadedPortrait(req.file);
      return res.status(413).json({ error: "The server upload-storage allowance has been reached." });
    }

    const previousStoredName = accessible.row.portrait_stored_name;
    try {
      db.prepare(
        `UPDATE characters
         SET portrait_filename = ?, portrait_stored_name = ?, portrait_mime_type = ?, portrait_size = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).run(
        path.basename(req.file.originalname).slice(0, 200) || `portrait${portraitImageTypes.get(req.file.mimetype)}`,
        req.file.filename,
        req.file.mimetype,
        req.file.size,
        characterId
      );
    } catch (error) {
      removeUploadedPortrait(req.file);
      throw error;
    }
    if (previousStoredName !== req.file.filename) removeStoredPortrait(previousStoredName);

    const row = one<CharacterRow>(
      `SELECT c.*, a.username AS owner_username FROM characters c
       LEFT JOIN accounts a ON a.id = c.owner_account_id WHERE c.id = ?`,
      characterId
    )!;
    broadcastCharacterChange(row);
    res.status(201).json({ character: publicCharacter(row, roomId) });
  }
);

characterRouter.delete("/rooms/:roomId/characters/:characterId/portrait", requireAuth, (req: AuthedRequest, res) => {
  const roomId = Number(req.params.roomId);
  const characterId = Number(req.params.characterId);
  const accessible = findAccessibleCharacter(req.account!.id, roomId, characterId);
  if (!accessible) return res.status(404).json({ error: "Character not found." });
  const previousStoredName = accessible.row.portrait_stored_name;
  db.prepare(
    `UPDATE characters
       SET portrait_filename = NULL, portrait_stored_name = NULL, portrait_mime_type = NULL, portrait_size = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
  ).run(characterId);
  removeStoredPortrait(previousStoredName);
  const row = one<CharacterRow>(
    `SELECT c.*, a.username AS owner_username FROM characters c
       LEFT JOIN accounts a ON a.id = c.owner_account_id WHERE c.id = ?`,
    characterId
  )!;
  broadcastCharacterChange(row);
  res.json({ character: publicCharacter(row, roomId) });
});

characterRouter.delete("/rooms/:roomId/characters/:characterId", requireAuth, (req: AuthedRequest, res) => {
  const roomId = Number(req.params.roomId);
  const characterId = Number(req.params.characterId);
  const accessible = findAccessibleCharacter(req.account!.id, roomId, characterId);
  if (!accessible) return res.status(404).json({ error: "Character not found." });
  db.exec("BEGIN");
  try {
    db.prepare("UPDATE memberships SET active_character_id = NULL WHERE active_character_id = ?").run(characterId);
    db.prepare("DELETE FROM characters WHERE id = ?").run(characterId);
    db.exec("COMMIT");
    removeStoredPortrait(accessible.row.portrait_stored_name);
    broadcastCharacterChange(accessible.row);
    res.status(204).end();
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
});

characterRouter.post("/rooms/:roomId/characters/:characterId/claim", requireAuth, (req: AuthedRequest, res) => {
  const roomId = Number(req.params.roomId);
  const characterId = Number(req.params.characterId);
  const context = roomContext(req.account!.id, roomId);
  if (!context) return res.status(404).json({ error: "Room not found." });
  if (context.role !== "player") return res.status(403).json({ error: "Only players can claim pool characters." });
  const original = one<CharacterRow>(
    `SELECT c.*, NULL AS owner_username FROM characters c
     WHERE c.id = ? AND c.system = ? AND c.owner_account_id IS NULL AND c.pool_room_id = ?`,
    characterId,
    context.system,
    roomId
  );
  if (!original) return res.status(409).json({ error: "That character is no longer available to claim." });
  db.exec("BEGIN");
  try {
    const changed = db
      .prepare(
        `UPDATE characters SET owner_account_id = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND owner_account_id IS NULL AND pool_room_id = ?`
      )
      .run(req.account!.id, characterId, roomId);
    if (!changed.changes) {
      db.exec("ROLLBACK");
      return res.status(409).json({ error: "That character was just claimed by someone else." });
    }
    db.prepare("UPDATE memberships SET active_character_id = ? WHERE room_id = ? AND account_id = ?").run(
      characterId,
      roomId,
      req.account!.id
    );
    db.exec("COMMIT");
    const row = one<CharacterRow>(
      `SELECT c.*, a.username AS owner_username FROM characters c
       LEFT JOIN accounts a ON a.id = c.owner_account_id WHERE c.id = ?`,
      characterId
    )!;
    broadcastCharacterChange(original);
    broadcastCharacterChange(row);
    res.json({ character: publicCharacter(row, roomId), activeCharacterId: characterId });
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
});

characterRouter.post("/rooms/:roomId/characters/:characterId/unassign", requireAuth, (req: AuthedRequest, res) => {
  const roomId = Number(req.params.roomId);
  const characterId = Number(req.params.characterId);
  const accessible = findAccessibleCharacter(req.account!.id, roomId, characterId);
  if (!accessible || accessible.context.role !== "gm")
    return res.status(403).json({ error: "Only the room GM can unassign characters." });
  db.exec("BEGIN");
  try {
    db.prepare("UPDATE memberships SET active_character_id = NULL WHERE active_character_id = ?").run(characterId);
    db.prepare(
      `UPDATE characters SET owner_account_id = NULL, pool_room_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).run(roomId, characterId);
    db.exec("COMMIT");
    const row = one<CharacterRow>(`SELECT c.*, NULL AS owner_username FROM characters c WHERE c.id = ?`, characterId)!;
    broadcastCharacterChange(accessible.row);
    broadcastCharacterChange(row);
    res.json({ character: publicCharacter(row, roomId) });
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
});

characterRouter.patch("/rooms/:roomId/active-character", requireAuth, (req: AuthedRequest, res) => {
  const roomId = Number(req.params.roomId);
  const context = roomContext(req.account!.id, roomId);
  if (!context) return res.status(404).json({ error: "Room not found." });
  const parsed = z.object({ characterId: z.number().int().positive().nullable() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Choose a valid character." });
  if (parsed.data.characterId !== null) {
    const character = one<{ id: number }>(
      "SELECT id FROM characters WHERE id = ? AND system = ? AND owner_account_id = ?",
      parsed.data.characterId,
      context.system,
      req.account!.id
    );
    if (!character)
      return res.status(403).json({ error: "You can only activate one of your own compatible characters." });
  }
  db.prepare("UPDATE memberships SET active_character_id = ? WHERE room_id = ? AND account_id = ?").run(
    parsed.data.characterId,
    roomId,
    req.account!.id
  );
  broadcastRoom(roomId, { type: "characters-updated" });
  refreshRoomPresence(roomId);
  res.json({ activeCharacterId: parsed.data.characterId });
});

characterRouter.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (error instanceof multer.MulterError) {
    return res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({
      error: error.code === "LIMIT_FILE_SIZE" ? "Character portraits may be at most 5 MB." : error.message
    });
  }
  if (error instanceof Error && error.message.includes("PNG, JPEG, and WebP portraits"))
    return res.status(415).json({ error: error.message });
  next(error);
});
