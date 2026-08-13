import path from "node:path";
import express from "express";
import multer from "multer";
import { z } from "zod";
import { groupAssetDefinitions, type SystemId } from "@devils-toys/shared";
import type { AuthedRequest } from "./auth.js";
import { requireAuth } from "./auth.js";
import { characterItemsFor } from "./character-items.js";
import { config } from "./config.js";
import { all, db, one } from "./db.js";
import {
  assetsFor,
  groupRow,
  groupSheetSchema,
  hirelingsFor,
  nextSortOrder,
  obligationsFor,
  publicAsset,
  publicHireling,
  publicObligation,
  reorderRows,
  staleWrite,
  type AssetRow,
  type GroupRowTable,
  type ObligationRow,
  type SheetRow
} from "./group-rows.js";
import {
  portraitImageTypes,
  PORTRAIT_UPLOAD_LIMIT_BYTES,
  removeStoredPortrait,
  removeUploadedPortrait,
  validPortraitFile
} from "./portrait-files.js";
import { broadcastRoom } from "./realtime.js";
import { roomAccessRole } from "./room-config-permissions.js";
import { starshipPartsFor } from "./starship-parts.js";
import { rollHirelingCreation } from "./hireling-creation.js";
import { hasSystem, systemOrThrow } from "./systems.js";
import { storedUploadBytes } from "./upload-usage.js";

export const groupRouter = express.Router();

/**
 * `group_json` no longer holds the roster — hirelings, ships, and obligations are
 * rows — but it still holds the group's own definition-driven fields, so the
 * schema that bounds it stays.
 */
export const groupStateSchema = z.record(z.unknown()).refine((value) => JSON.stringify(value).length <= 250_000, {
  message: "Group data is too large."
});

const uploadsDir = path.join(config.dataDir, "uploads");
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

function groupContext(account: AuthedRequest["account"], roomId: number) {
  const role = roomAccessRole(account!, roomId);
  if (!role) return;
  const room = one<{ system: SystemId }>("SELECT system FROM rooms WHERE id = ?", roomId);
  if (!room) return;
  if (!hasSystem(room.system)) return;
  const definition = systemOrThrow(room.system).groupPage;
  if (!definition) return;
  // The parts on offer come from the system's own book, so each asset sheet is
  // sent out with them rather than the package restating the list.
  const parts = starshipPartsFor(room.system);
  const groupAssets = groupAssetDefinitions(definition).map((asset) => ({
    ...asset,
    sheet: { ...asset.sheet, parts }
  }));
  const starshipSheet = groupAssets.find((asset) => asset.kind === "starship")?.sheet;
  return { role, system: room.system, definition: { ...definition, starshipSheet, groupAssets } };
}

function requireGroupGm(req: AuthedRequest, res: express.Response, roomId: number) {
  const context = groupContext(req.account, roomId);
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

function stateRow(roomId: number) {
  return one<{ group_json: string; updated_at: string }>(
    "SELECT group_json, updated_at FROM room_state WHERE room_id = ?",
    roomId
  );
}

function changed(roomId: number, res: express.Response, body: unknown, status = 200) {
  broadcastRoom(roomId, { type: "group-updated" });
  res.status(status).json(body);
}

groupRouter.get("/rooms/:roomId/group", requireAuth, (req: AuthedRequest, res) => {
  const roomId = Number(req.params.roomId);
  const context = groupContext(req.account, roomId);
  if (!context) return res.status(404).json({ error: "Group page not found." });
  const row = stateRow(roomId);
  res.json({
    state: parseGroupState(row?.group_json),
    definition: context.definition,
    // Hirelings fill the same slots out of the same tables a character does, so
    // the page is given the same gear rather than a second, thinner copy of it.
    itemCatalogue: characterItemsFor(context.system, roomId),
    hirelings: hirelingsFor(roomId).map(publicHireling),
    assets: assetsFor(roomId).map(publicAsset),
    obligations: obligationsFor(roomId).map(publicObligation),
    updatedAt: row?.updated_at ?? null
  });
});

/** The group's own fields. The roster has its own routes, one per row. */
groupRouter.patch("/rooms/:roomId/group", requireAuth, (req: AuthedRequest, res) => {
  const roomId = Number(req.params.roomId);
  if (!requireGroupGm(req, res, roomId)) return;
  const parsed = z.object({ state: groupStateSchema, updatedAt: z.string().nullable().optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid group data." });
  const existing = stateRow(roomId);
  if (parsed.data.updatedAt !== undefined && parsed.data.updatedAt !== (existing?.updated_at ?? null))
    return res.status(409).json({ error: "The group changed elsewhere. Reload before saving." });
  db.prepare(
    `INSERT INTO room_state (room_id, group_json, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(room_id) DO UPDATE SET group_json = excluded.group_json, updated_at = CURRENT_TIMESTAMP`
  ).run(roomId, JSON.stringify(parsed.data.state));
  changed(roomId, res, { state: parsed.data.state, updatedAt: stateRow(roomId)!.updated_at });
});

/* -------------------------------------------------------------------------- */
/* Hirelings                                                                   */
/* -------------------------------------------------------------------------- */

const sheetWriteSchema = z.object({
  name: z.string().trim().max(120).optional(),
  sheet: groupSheetSchema.optional(),
  /** Omit to write regardless; send the one you read to be told about a clash. */
  revision: z.number().int().min(0).optional()
});

groupRouter.post("/rooms/:roomId/group/hirelings", requireAuth, (req: AuthedRequest, res) => {
  const roomId = Number(req.params.roomId);
  const context = requireGroupGm(req, res, roomId);
  if (!context) return;
  if (!context.definition.hirelings) return res.status(404).json({ error: "This system has no hirelings." });
  const parsed = sheetWriteSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Invalid hireling." });
  const result = db
    .prepare("INSERT INTO group_hirelings (room_id, name, sort_order, sheet_json) VALUES (?, ?, ?, ?)")
    .run(
      roomId,
      parsed.data.name ?? "",
      nextSortOrder("group_hirelings", roomId),
      JSON.stringify(parsed.data.sheet ?? {})
    );
  const row = groupRow<SheetRow>("group_hirelings", roomId, Number(result.lastInsertRowid))!;
  changed(roomId, res, { hireling: publicHireling(row) }, 201);
});

groupRouter.patch("/rooms/:roomId/group/hirelings/:hirelingId", requireAuth, (req: AuthedRequest, res) => {
  const roomId = Number(req.params.roomId);
  if (!requireGroupGm(req, res, roomId)) return;
  const row = groupRow<SheetRow>("group_hirelings", roomId, Number(req.params.hirelingId));
  if (!row) return res.status(404).json({ error: "Hireling not found." });
  const parsed = sheetWriteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid hireling." });
  if (staleWrite(row, parsed.data.revision))
    return res.status(409).json({ error: "That hireling changed elsewhere. Reload before saving." });
  db.prepare(
    `UPDATE group_hirelings SET name = COALESCE(?, name), sheet_json = COALESCE(?, sheet_json),
       revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(parsed.data.name ?? null, parsed.data.sheet === undefined ? null : JSON.stringify(parsed.data.sheet), row.id);
  changed(roomId, res, { hireling: publicHireling(groupRow<SheetRow>("group_hirelings", roomId, row.id)!) });
});

/**
 * Deleting a hireling takes its portrait and its combatants with it. The
 * combatants go by foreign key now rather than by a hand-written DELETE, which
 * is the whole point of the id being a real reference.
 */
groupRouter.delete("/rooms/:roomId/group/hirelings/:hirelingId", requireAuth, (req: AuthedRequest, res) => {
  const roomId = Number(req.params.roomId);
  if (!requireGroupGm(req, res, roomId)) return;
  const row = groupRow<SheetRow>("group_hirelings", roomId, Number(req.params.hirelingId));
  if (!row) return res.status(404).json({ error: "Hireling not found." });
  db.prepare("DELETE FROM group_hirelings WHERE id = ?").run(row.id);
  removeStoredPortrait(row.portrait_stored_name);
  broadcastRoom(roomId, { type: "encounters-updated" });
  changed(roomId, res, { deleted: row.id });
});

groupRouter.post("/rooms/:roomId/group/hirelings/roll", requireAuth, (req: AuthedRequest, res) => {
  const roomId = Number(req.params.roomId);
  const context = groupContext(req.account, roomId);
  const creationRoll = context?.definition.hirelings?.creationRoll;
  if (!context || !creationRoll) return res.status(404).json({ error: "Hireling creation is not available." });

  try {
    res.json({
      hireling: rollHirelingCreation(
        creationRoll,
        { kind: "system", system: context.system },
        undefined,
        context.definition.hirelings?.sheet.lists[0]?.key
      )
    });
  } catch (cause) {
    res.status(500).json({ error: cause instanceof Error ? cause.message : "Hireling creation failed." });
  }
});

/* -------------------------------------------------------------------------- */
/* Group assets: ships today, whatever a system declares later                  */
/* -------------------------------------------------------------------------- */

groupRouter.post("/rooms/:roomId/group/assets", requireAuth, (req: AuthedRequest, res) => {
  const roomId = Number(req.params.roomId);
  const context = requireGroupGm(req, res, roomId);
  if (!context) return;
  const parsed = sheetWriteSchema
    .extend({ kind: z.string().trim().min(1).max(40).default("starship") })
    .safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Invalid group asset." });
  if (!context.definition.groupAssets?.some((asset) => asset.kind === parsed.data.kind))
    return res.status(404).json({ error: "This system has no shared property of that kind." });
  const result = db
    .prepare("INSERT INTO group_assets (room_id, kind, name, sort_order, sheet_json) VALUES (?, ?, ?, ?, ?)")
    .run(
      roomId,
      parsed.data.kind,
      parsed.data.name ?? "",
      nextSortOrder("group_assets", roomId),
      JSON.stringify(parsed.data.sheet ?? {})
    );
  const row = groupRow<AssetRow>("group_assets", roomId, Number(result.lastInsertRowid))!;
  changed(roomId, res, { asset: publicAsset(row) }, 201);
});

groupRouter.patch("/rooms/:roomId/group/assets/:assetId", requireAuth, (req: AuthedRequest, res) => {
  const roomId = Number(req.params.roomId);
  if (!requireGroupGm(req, res, roomId)) return;
  const row = groupRow<AssetRow>("group_assets", roomId, Number(req.params.assetId));
  if (!row) return res.status(404).json({ error: "Group asset not found." });
  const parsed = sheetWriteSchema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid group asset." });
  if (staleWrite(row, parsed.data.revision))
    return res.status(409).json({ error: "That asset changed elsewhere. Reload before saving." });
  db.prepare(
    `UPDATE group_assets SET name = COALESCE(?, name), sheet_json = COALESCE(?, sheet_json),
       revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(parsed.data.name ?? null, parsed.data.sheet === undefined ? null : JSON.stringify(parsed.data.sheet), row.id);
  changed(roomId, res, { asset: publicAsset(groupRow<AssetRow>("group_assets", roomId, row.id)!) });
});

groupRouter.delete("/rooms/:roomId/group/assets/:assetId", requireAuth, (req: AuthedRequest, res) => {
  const roomId = Number(req.params.roomId);
  if (!requireGroupGm(req, res, roomId)) return;
  const row = groupRow<AssetRow>("group_assets", roomId, Number(req.params.assetId));
  if (!row) return res.status(404).json({ error: "Group asset not found." });
  db.prepare("DELETE FROM group_assets WHERE id = ?").run(row.id);
  removeStoredPortrait(row.portrait_stored_name);
  changed(roomId, res, { deleted: row.id });
});

/* -------------------------------------------------------------------------- */
/* Obligations                                                                 */
/* -------------------------------------------------------------------------- */

const obligationSchema = z.object({
  name: z.string().trim().max(120).optional(),
  owedTo: z.string().trim().max(120).optional(),
  amount: z.string().trim().max(60).optional(),
  details: z.string().max(4000).optional(),
  revision: z.number().int().min(0).optional()
});

groupRouter.post("/rooms/:roomId/group/obligations", requireAuth, (req: AuthedRequest, res) => {
  const roomId = Number(req.params.roomId);
  if (!requireGroupGm(req, res, roomId)) return;
  const parsed = obligationSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Invalid obligation." });
  const result = db
    .prepare(
      "INSERT INTO group_obligations (room_id, name, owed_to, amount, details, sort_order) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .run(
      roomId,
      parsed.data.name ?? "",
      parsed.data.owedTo ?? "",
      parsed.data.amount ?? "",
      parsed.data.details ?? "",
      nextSortOrder("group_obligations", roomId)
    );
  const row = groupRow<ObligationRow>("group_obligations", roomId, Number(result.lastInsertRowid))!;
  changed(roomId, res, { obligation: publicObligation(row) }, 201);
});

groupRouter.patch("/rooms/:roomId/group/obligations/:obligationId", requireAuth, (req: AuthedRequest, res) => {
  const roomId = Number(req.params.roomId);
  if (!requireGroupGm(req, res, roomId)) return;
  const row = groupRow<ObligationRow>("group_obligations", roomId, Number(req.params.obligationId));
  if (!row) return res.status(404).json({ error: "Obligation not found." });
  const parsed = obligationSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid obligation." });
  if (staleWrite(row, parsed.data.revision))
    return res.status(409).json({ error: "That obligation changed elsewhere. Reload before saving." });
  db.prepare(
    `UPDATE group_obligations SET name = COALESCE(?, name), owed_to = COALESCE(?, owed_to),
       amount = COALESCE(?, amount), details = COALESCE(?, details),
       revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(
    parsed.data.name ?? null,
    parsed.data.owedTo ?? null,
    parsed.data.amount ?? null,
    parsed.data.details ?? null,
    row.id
  );
  changed(roomId, res, { obligation: publicObligation(groupRow<ObligationRow>("group_obligations", roomId, row.id)!) });
});

groupRouter.delete("/rooms/:roomId/group/obligations/:obligationId", requireAuth, (req: AuthedRequest, res) => {
  const roomId = Number(req.params.roomId);
  if (!requireGroupGm(req, res, roomId)) return;
  const row = groupRow<ObligationRow>("group_obligations", roomId, Number(req.params.obligationId));
  if (!row) return res.status(404).json({ error: "Obligation not found." });
  db.prepare("DELETE FROM group_obligations WHERE id = ?").run(row.id);
  changed(roomId, res, { deleted: row.id });
});

/* -------------------------------------------------------------------------- */
/* Order                                                                       */
/* -------------------------------------------------------------------------- */

const orderTables: Record<string, GroupRowTable> = {
  hirelings: "group_hirelings",
  assets: "group_assets",
  obligations: "group_obligations"
};

groupRouter.patch("/rooms/:roomId/group/order", requireAuth, (req: AuthedRequest, res) => {
  const roomId = Number(req.params.roomId);
  if (!requireGroupGm(req, res, roomId)) return;
  const parsed = z
    .object({
      kind: z.enum(["hirelings", "assets", "obligations"]),
      ids: z.array(z.number().int().positive()).max(500)
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Say what to reorder, and in what order." });
  reorderRows(orderTables[parsed.data.kind], roomId, parsed.data.ids);
  changed(roomId, res, { ordered: parsed.data.ids.length });
});

/* -------------------------------------------------------------------------- */
/* Portraits, on the rows themselves                                           */
/* -------------------------------------------------------------------------- */

const portraitTables = { hirelings: "group_hirelings", assets: "group_assets" } as const;
type PortraitKind = keyof typeof portraitTables;

function portraitKind(value: string): PortraitKind | undefined {
  return value === "hirelings" || value === "assets" ? value : undefined;
}

groupRouter.get("/rooms/:roomId/group/:kind/:rowId/image", requireAuth, (req: AuthedRequest, res) => {
  const roomId = Number(req.params.roomId);
  const kind = portraitKind(String(req.params.kind));
  if (!kind || !groupContext(req.account, roomId)) return res.status(404).json({ error: "Image not found." });
  const row = groupRow<SheetRow>(portraitTables[kind], roomId, Number(req.params.rowId));
  if (!row?.portrait_stored_name || path.basename(row.portrait_stored_name) !== row.portrait_stored_name)
    return res.status(404).json({ error: "Image not found." });
  res.type(row.portrait_mime_type ?? "application/octet-stream");
  res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
  res.setHeader(
    "Content-Disposition",
    `inline; filename*=UTF-8''${encodeURIComponent(row.portrait_filename ?? "image")}`
  );
  res.sendFile(row.portrait_stored_name, { root: uploadsDir });
});

groupRouter.post(
  "/rooms/:roomId/group/:kind/:rowId/image",
  requireAuth,
  groupImageUpload.single("file"),
  (req: AuthedRequest, res) => {
    const roomId = Number(req.params.roomId);
    const kind = portraitKind(String(req.params.kind));
    if (!kind || !requireGroupGm(req, res, roomId)) {
      removeUploadedPortrait(req.file);
      if (!kind) res.status(404).json({ error: "Image not found." });
      return;
    }
    const table = portraitTables[kind];
    const row = groupRow<SheetRow>(table, roomId, Number(req.params.rowId));
    if (!row) {
      removeUploadedPortrait(req.file);
      return res.status(404).json({ error: "Nothing here to give a picture to." });
    }
    if (!req.file) return res.status(400).json({ error: "Choose a PNG, JPEG, or WebP image." });
    if (!validPortraitFile(req.file)) {
      removeUploadedPortrait(req.file);
      return res.status(415).json({ error: "The file contents do not match a supported image format." });
    }
    if (storedUploadBytes() - (row.portrait_size ?? 0) + req.file.size > config.uploadLimitMb * 1024 * 1024) {
      removeUploadedPortrait(req.file);
      return res.status(413).json({ error: "The server upload-storage allowance has been reached." });
    }

    try {
      db.prepare(
        `UPDATE ${table} SET portrait_filename = ?, portrait_stored_name = ?, portrait_mime_type = ?,
           portrait_size = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
      ).run(
        path.basename(req.file.originalname).slice(0, 200) || `image${portraitImageTypes.get(req.file.mimetype)}`,
        req.file.filename,
        req.file.mimetype,
        req.file.size,
        row.id
      );
    } catch (error) {
      removeUploadedPortrait(req.file);
      throw error;
    }
    if (row.portrait_stored_name !== req.file.filename) removeStoredPortrait(row.portrait_stored_name);
    const updated = groupRow<SheetRow>(table, roomId, row.id)!;
    changed(
      roomId,
      res,
      {
        [kind === "hirelings" ? "hireling" : "asset"]:
          kind === "hirelings" ? publicHireling(updated) : publicAsset(updated as AssetRow)
      },
      201
    );
  }
);

groupRouter.delete("/rooms/:roomId/group/:kind/:rowId/image", requireAuth, (req: AuthedRequest, res) => {
  const roomId = Number(req.params.roomId);
  const kind = portraitKind(String(req.params.kind));
  if (!kind || !requireGroupGm(req, res, roomId)) {
    if (!kind) res.status(404).json({ error: "Image not found." });
    return;
  }
  const table = portraitTables[kind];
  const row = groupRow<SheetRow>(table, roomId, Number(req.params.rowId));
  if (!row?.portrait_stored_name) return res.status(404).json({ error: "Image not found." });
  db.prepare(
    `UPDATE ${table} SET portrait_filename = NULL, portrait_stored_name = NULL, portrait_mime_type = NULL,
       portrait_size = NULL, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(row.id);
  removeStoredPortrait(row.portrait_stored_name);
  changed(roomId, res, { removed: row.id });
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

/** Every hireling in a room, for anything that needs the roster rather than one of it. */
export function roomHirelings(roomId: number) {
  return all<SheetRow>("SELECT * FROM group_hirelings WHERE room_id = ? ORDER BY sort_order, id", roomId);
}
