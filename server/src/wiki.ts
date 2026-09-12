import fs from "node:fs";
import path from "node:path";
import express from "express";
import { z } from "zod";
import type { AuthedRequest } from "./auth.js";
import { requireAuth } from "./auth.js";
import { all, db, one } from "./db.js";
import { config } from "./config.js";
import { broadcastRoom } from "./realtime.js";
import {
  markdownForWikiReader,
  markdownForWikiSearch,
  replaceWikiMentions,
  resolveWikiMarkdownUpdate,
  resolveWikiMentions,
  wikiMentionables
} from "./wiki-mentions.js";
import {
  mayEditWikiFile,
  mayManageWikiFolder,
  mayReadWikiFile,
  requireWikiGm,
  wikiRole,
  type WikiFolderPermissionRow,
  type WikiPagePermissionRow
} from "./wiki-permissions.js";
import { isSafeWikiFolderName } from "./wiki-paths.js";

export const wikiRouter = express.Router();

interface WikiPageRow extends WikiPagePermissionRow {
  id: number;
  folder_id: number | null;
  slug: string;
  title: string;
  markdown: string;
  map_media_id: number | null;
  sort_order: number;
  revision: number;
  created_at: string;
  updated_at: string;
}

interface WikiFolderRow extends WikiFolderPermissionRow {
  id: number;
  parent_id: number | null;
  name: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

const markdownLimit = 256 * 1024;
const pageCreateSchema = z.object({
  title: z.string().trim().min(1).max(160),
  markdown: z.string().max(markdownLimit).optional(),
  folderId: z.number().int().positive().nullable().optional(),
  sortOrder: z.number().int().min(-1_000_000).max(1_000_000).optional(),
  mapMediaId: z.number().int().positive().nullable().optional()
});
const pageUpdateSchema = z
  .object({
    revision: z.number().int().min(0),
    title: z.string().trim().min(1).max(160).optional(),
    markdown: z.string().max(markdownLimit).optional(),
    folderId: z.number().int().positive().nullable().optional(),
    sortOrder: z.number().int().min(-1_000_000).max(1_000_000).optional(),
    mapMediaId: z.number().int().positive().nullable().optional()
  })
  .refine((value) => Object.keys(value).some((key) => key !== "revision"));
const folderCreateSchema = z.object({
  name: z.string().trim().min(1).max(120).refine(isSafeWikiFolderName),
  parentId: z.number().int().positive().nullable().optional(),
  sortOrder: z.number().int().min(-1_000_000).max(1_000_000).optional()
});
const folderUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(120).refine(isSafeWikiFolderName).optional(),
    parentId: z.number().int().positive().nullable().optional(),
    sortOrder: z.number().int().min(-1_000_000).max(1_000_000).optional()
  })
  .refine((value) => Object.keys(value).length > 0);
const mapLegendSchema = z.object({ slug: z.string().trim().min(1).max(160).nullable() });

function publicPage(row: WikiPageRow, includeMarkdown = false, markdown = row.markdown) {
  return {
    id: row.id,
    roomId: row.room_id,
    folderId: row.folder_id,
    slug: row.slug,
    title: row.title,
    ...(includeMarkdown ? { markdown } : {}),
    visible: Boolean(row.visible),
    mapMediaId: row.map_media_id,
    sortOrder: row.sort_order,
    revision: row.revision,
    ownerAccountId: row.owner_account_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/** Never return directive metadata for a target this particular reader cannot resolve. */
function pageForReader(account: AuthedRequest["account"], row: WikiPageRow) {
  return publicPage(row, true, markdownForWikiReader(account!, row.room_id, row.markdown));
}

function publicFolder(row: WikiFolderRow) {
  return {
    id: row.id,
    roomId: row.room_id,
    parentId: row.parent_id,
    name: row.name,
    sortOrder: row.sort_order,
    ownerAccountId: row.owner_account_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function pageForRoom(roomId: number, slug: string) {
  return one<WikiPageRow>(
    `SELECT id, room_id, folder_id, slug, title, markdown, visible, map_media_id, sort_order, revision,
            owner_account_id, created_at, updated_at
     FROM wiki_pages WHERE room_id = ? AND slug = ?`,
    roomId,
    slug
  );
}

function folderForRoom(roomId: number, folderId: number) {
  return one<WikiFolderRow>(
    `SELECT id, room_id, parent_id, name, sort_order, owner_account_id, created_at, updated_at
     FROM wiki_folders WHERE room_id = ? AND id = ?`,
    roomId,
    folderId
  );
}

function requestedRoom(req: AuthedRequest, res: express.Response) {
  const roomId = Number(req.params.roomId);
  const role = wikiRole(req.account!, roomId);
  if (!role) {
    res.status(404).json({ error: "Wiki not found." });
    return;
  }
  return { roomId, role };
}

function routeString(value: string | string[] | undefined) {
  return typeof value === "string" ? value : "";
}

function slugRoot(title: string) {
  const root = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return root || "page";
}

function uniqueSlug(roomId: number, title: string) {
  const root = slugRoot(title);
  let slug = root;
  let suffix = 2;
  while (one<{ id: number }>("SELECT id FROM wiki_pages WHERE room_id = ? AND slug = ?", roomId, slug))
    slug = `${root.slice(0, Math.max(1, 80 - String(suffix).length - 1))}-${suffix++}`;
  return slug;
}

/** Validates both that the folder is in this room and that a player owns it. */
function writableFolder(roomId: number, folderId: number | null | undefined, accountId: number, role: "gm" | "player") {
  if (folderId == null) return true;
  const folder = folderForRoom(roomId, folderId);
  return Boolean(folder && (role === "gm" || folder.owner_account_id === accountId));
}

function validMap(roomId: number, mediaId: number | null | undefined) {
  if (mediaId == null) return true;
  return Boolean(
    one("SELECT 1 FROM media WHERE id = ? AND room_id = ? AND COALESCE(category, kind) = 'map'", mediaId, roomId)
  );
}

function mapAlreadyHasLegend(mediaId: number | null | undefined, exceptPageId?: number) {
  if (mediaId == null) return false;
  return Boolean(
    one<{ id: number }>(
      `SELECT id FROM wiki_pages WHERE map_media_id = ? ${exceptPageId === undefined ? "" : "AND id <> ?"} LIMIT 1`,
      ...(exceptPageId === undefined ? [mediaId] : [mediaId, exceptPageId])
    )
  );
}

/** Refuses parent links that would make a folder contain itself through a descendant. */
function moveWouldCycle(roomId: number, folderId: number, parentId: number | null | undefined) {
  let current = parentId;
  const seen = new Set<number>();
  while (current != null) {
    if (current === folderId || seen.has(current)) return true;
    seen.add(current);
    const folder = folderForRoom(roomId, current);
    if (!folder) return true;
    current = folder.parent_id;
  }
  return false;
}

wikiRouter.get("/rooms/:roomId/wiki", requireAuth, (req: AuthedRequest, res) => {
  const context = requestedRoom(req, res);
  if (!context) return;
  const { roomId, role } = context;
  const pages = all<WikiPageRow>(
    `SELECT id, room_id, folder_id, slug, title, markdown, visible, map_media_id, sort_order, revision,
            owner_account_id, created_at, updated_at
     FROM wiki_pages
     WHERE room_id = ? ${role === "gm" ? "" : "AND (owner_account_id = ? OR visible = 1)"}
     ORDER BY sort_order, title COLLATE NOCASE, id`,
    ...(role === "gm" ? [roomId] : [roomId, req.account!.id])
  );
  const folders =
    role === "gm"
      ? all<WikiFolderRow>(
          `SELECT id, room_id, parent_id, name, sort_order, owner_account_id, created_at, updated_at
           FROM wiki_folders WHERE room_id = ? ORDER BY sort_order, name COLLATE NOCASE, id`,
          roomId
        )
      : all<WikiFolderRow>(
          `WITH RECURSIVE ancestors(id) AS (
             SELECT folder_id FROM wiki_pages
              WHERE room_id = ? AND folder_id IS NOT NULL AND (owner_account_id = ? OR visible = 1)
             UNION
             SELECT f.parent_id FROM wiki_folders f JOIN ancestors a ON f.id = a.id
              WHERE f.parent_id IS NOT NULL
           )
           SELECT id, room_id, parent_id, name, sort_order, owner_account_id, created_at, updated_at
             FROM wiki_folders
            WHERE room_id = ? AND (owner_account_id = ? OR id IN ancestors)
            ORDER BY sort_order, name COLLATE NOCASE, id`,
          roomId,
          req.account!.id,
          roomId,
          req.account!.id
        );
  res.json({ folders: folders.map(publicFolder), pages: pages.map((page) => publicPage(page)) });
});

wikiRouter.get("/rooms/:roomId/wiki/pages/:slug", requireAuth, (req: AuthedRequest, res) => {
  const context = requestedRoom(req, res);
  if (!context) return;
  const page = pageForRoom(context.roomId, routeString(req.params.slug));
  if (!page || !mayReadWikiFile(req.account!, page)) return res.status(404).json({ error: "Wiki page not found." });
  res.json({ page: pageForReader(req.account, page) });
});

wikiRouter.post("/rooms/:roomId/wiki/pages", requireAuth, (req: AuthedRequest, res) => {
  const context = requestedRoom(req, res);
  if (!context) return;
  const parsed = pageCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Give the page a title and valid content." });
  const body = parsed.data;
  if (!writableFolder(context.roomId, body.folderId, req.account!.id, context.role))
    return res.status(404).json({ error: "Folder not found." });
  if (body.mapMediaId !== undefined && context.role !== "gm")
    return res.status(403).json({ error: "Only the room GM can bind a map legend." });
  if (!validMap(context.roomId, body.mapMediaId)) return res.status(404).json({ error: "Map not found." });
  if (mapAlreadyHasLegend(body.mapMediaId))
    return res.status(409).json({ error: "That map already has a legend page." });
  let page: WikiPageRow | undefined;
  let hasUnresolvableMention = false;
  db.exec("BEGIN IMMEDIATE");
  try {
    // Resolve after acquiring the writer lock, so another server process
    // cannot remove or hide a target after validation but before its derived
    // foreign-keyed index row is written.
    const mentions = resolveWikiMentions(req.account!, context.roomId, body.markdown ?? "");
    if (!mentions) {
      hasUnresolvableMention = true;
      db.exec("ROLLBACK");
    } else {
      const slug = uniqueSlug(context.roomId, body.title);
      const result = db
        .prepare(
          `INSERT INTO wiki_pages (room_id, folder_id, slug, title, markdown, map_media_id, sort_order, owner_account_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          context.roomId,
          body.folderId ?? null,
          slug,
          body.title,
          body.markdown ?? "",
          body.mapMediaId ?? null,
          body.sortOrder ?? 0,
          req.account!.id
        );
      replaceWikiMentions(Number(result.lastInsertRowid), mentions);
      page = one<WikiPageRow>(
        `SELECT id, room_id, folder_id, slug, title, markdown, visible, map_media_id, sort_order, revision,
              owner_account_id, created_at, updated_at FROM wiki_pages WHERE id = ?`,
        Number(result.lastInsertRowid)
      )!;
      db.exec("COMMIT");
    }
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  if (hasUnresolvableMention) return res.status(400).json({ error: "A page cannot mention a target you cannot read." });
  broadcastRoom(context.roomId, { type: "wiki-updated" });
  res.status(201).json({ page: pageForReader(req.account, page!) });
});

wikiRouter.put("/rooms/:roomId/wiki/pages/:slug", requireAuth, (req: AuthedRequest, res) => {
  const context = requestedRoom(req, res);
  if (!context) return;
  const parsed = pageUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Provide a revision and at least one valid page change." });
  const page = pageForRoom(context.roomId, routeString(req.params.slug));
  if (!page || !mayEditWikiFile(req.account!, page)) return res.status(404).json({ error: "Wiki page not found." });
  const body = parsed.data;
  if (body.folderId !== undefined && !writableFolder(context.roomId, body.folderId, req.account!.id, context.role))
    return res.status(404).json({ error: "Folder not found." });
  if (body.mapMediaId !== undefined && context.role !== "gm")
    return res.status(403).json({ error: "Only the room GM can bind a map legend." });
  if (!validMap(context.roomId, body.mapMediaId)) return res.status(404).json({ error: "Map not found." });
  if (mapAlreadyHasLegend(body.mapMediaId, page.id))
    return res.status(409).json({ error: "That map already has a legend page." });
  if (body.revision !== page.revision)
    return res.status(409).json({
      error: "This page changed while you were editing. Review the latest page and try again.",
      page: pageForReader(req.account, page)
    });
  const next = {
    title: body.title ?? page.title,
    folderId: body.folderId === undefined ? page.folder_id : body.folderId,
    sortOrder: body.sortOrder ?? page.sort_order,
    mapMediaId: body.mapMediaId === undefined ? page.map_media_id : body.mapMediaId
  };
  let updated: WikiPageRow | undefined;
  let hasUnresolvableMention = false;
  db.exec("BEGIN IMMEDIATE");
  try {
    // Mention resolution and the index write share one writer transaction.
    // That keeps a target mutation in another process from turning a valid
    // resolution into a foreign-key failure or a stale derived reference.
    const resolvedMarkdown = resolveWikiMarkdownUpdate(
      req.account!,
      context.roomId,
      body.markdown ?? page.markdown,
      page.markdown
    );
    if (!resolvedMarkdown) {
      hasUnresolvableMention = true;
      db.exec("ROLLBACK");
    } else {
      const result = db
        .prepare(
          `UPDATE wiki_pages
            SET title = ?, markdown = ?, folder_id = ?, sort_order = ?, map_media_id = ?, revision = revision + 1,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND revision = ?`
        )
        .run(
          next.title,
          resolvedMarkdown.markdown,
          next.folderId,
          next.sortOrder,
          next.mapMediaId,
          page.id,
          body.revision
        );
      if (result.changes) {
        replaceWikiMentions(page.id, resolvedMarkdown.mentions);
        updated = pageForRoom(context.roomId, page.slug)!;
        db.exec("COMMIT");
      } else db.exec("ROLLBACK");
    }
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  if (hasUnresolvableMention) return res.status(400).json({ error: "A page cannot mention a target you cannot read." });
  if (!updated) return res.status(409).json({ error: "This page changed while you were editing." });
  broadcastRoom(context.roomId, { type: "wiki-updated" });
  res.json({ page: pageForReader(req.account, updated) });
});

wikiRouter.post("/rooms/:roomId/wiki/pages/:slug/reveal", requireAuth, (req: AuthedRequest, res) => {
  const roomId = requireWikiGm(req, res);
  if (!roomId) return;
  const parsed = z.object({ visible: z.boolean() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Choose whether the page is shared." });
  const page = pageForRoom(roomId, routeString(req.params.slug));
  if (!page) return res.status(404).json({ error: "Wiki page not found." });
  db.prepare("UPDATE wiki_pages SET visible = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(
    parsed.data.visible ? 1 : 0,
    page.id
  );
  const updated = pageForRoom(roomId, page.slug)!;
  broadcastRoom(roomId, { type: "wiki-updated" });
  res.json({ page: publicPage(updated, true) });
});

/** Binds an existing room page to a map, or removes that map's legend. The
 * map's media response applies the normal page-read gate before exposing it. */
wikiRouter.post("/rooms/:roomId/maps/:mediaId/legend", requireAuth, (req: AuthedRequest, res) => {
  const roomId = requireWikiGm(req, res);
  if (!roomId) return;
  const mediaId = Number(req.params.mediaId);
  if (
    !Number.isSafeInteger(mediaId) ||
    !one("SELECT 1 FROM media WHERE id = ? AND room_id = ? AND COALESCE(category, kind) = 'map'", mediaId, roomId)
  )
    return res.status(404).json({ error: "Map not found." });
  const parsed = mapLegendSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Choose a wiki page or no legend." });

  if (parsed.data.slug === null) {
    db.prepare(
      "UPDATE wiki_pages SET map_media_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE room_id = ? AND map_media_id = ?"
    ).run(roomId, mediaId);
    broadcastRoom(roomId, { type: "wiki-updated" });
    broadcastRoom(roomId, { type: "media-updated" });
    return res.status(204).end();
  }

  const page = pageForRoom(roomId, parsed.data.slug);
  if (!page) return res.status(404).json({ error: "Wiki page not found." });
  // The selector is a direct replacement, not a two-step unbind/rebind. A page
  // moved from another map leaves that old map without a legend in the same
  // transaction, and this map loses its former page before the new one lands.
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(
      "UPDATE wiki_pages SET map_media_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE map_media_id = ? OR id = ?"
    ).run(mediaId, page.id);
    db.prepare("UPDATE wiki_pages SET map_media_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(
      mediaId,
      page.id
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  const updated = pageForRoom(roomId, page.slug)!;
  broadcastRoom(roomId, { type: "wiki-updated" });
  broadcastRoom(roomId, { type: "media-updated" });
  res.json({ page: pageForReader(req.account, updated) });
});

wikiRouter.delete("/rooms/:roomId/wiki/pages/:slug", requireAuth, (req: AuthedRequest, res) => {
  const context = requestedRoom(req, res);
  if (!context) return;
  const page = pageForRoom(context.roomId, routeString(req.params.slug));
  if (!page || !mayEditWikiFile(req.account!, page)) return res.status(404).json({ error: "Wiki page not found." });
  db.prepare("DELETE FROM wiki_pages WHERE id = ?").run(page.id);
  broadcastRoom(context.roomId, { type: "wiki-updated" });
  res.status(204).end();
});

wikiRouter.post("/rooms/:roomId/wiki/folders", requireAuth, (req: AuthedRequest, res) => {
  const context = requestedRoom(req, res);
  if (!context) return;
  const parsed = folderCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Give the folder a valid name." });
  const body = parsed.data;
  if (!writableFolder(context.roomId, body.parentId, req.account!.id, context.role))
    return res.status(404).json({ error: "Parent folder not found." });
  try {
    const result = db
      .prepare(
        "INSERT INTO wiki_folders (room_id, parent_id, name, sort_order, owner_account_id) VALUES (?, ?, ?, ?, ?)"
      )
      .run(context.roomId, body.parentId ?? null, body.name, body.sortOrder ?? 0, req.account!.id);
    const folder = folderForRoom(context.roomId, Number(result.lastInsertRowid))!;
    broadcastRoom(context.roomId, { type: "wiki-updated" });
    res.status(201).json({ folder: publicFolder(folder) });
  } catch (error) {
    if (error instanceof Error && /UNIQUE constraint failed/i.test(error.message))
      return res.status(409).json({ error: "A folder with that name already exists here." });
    throw error;
  }
});

wikiRouter.patch("/rooms/:roomId/wiki/folders/:folderId", requireAuth, (req: AuthedRequest, res) => {
  const context = requestedRoom(req, res);
  if (!context) return;
  const folder = folderForRoom(context.roomId, Number(req.params.folderId));
  if (!folder || !mayManageWikiFolder(req.account!, folder))
    return res.status(404).json({ error: "Folder not found." });
  const parsed = folderUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Provide a valid folder change." });
  const body = parsed.data;
  if (body.parentId !== undefined) {
    if (!writableFolder(context.roomId, body.parentId, req.account!.id, context.role))
      return res.status(404).json({ error: "Parent folder not found." });
    if (moveWouldCycle(context.roomId, folder.id, body.parentId))
      return res.status(400).json({ error: "A folder cannot contain itself." });
  }
  try {
    db.prepare(
      `UPDATE wiki_folders SET name = ?, parent_id = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).run(
      body.name ?? folder.name,
      body.parentId === undefined ? folder.parent_id : body.parentId,
      body.sortOrder ?? folder.sort_order,
      folder.id
    );
  } catch (error) {
    if (error instanceof Error && /UNIQUE constraint failed/i.test(error.message))
      return res.status(409).json({ error: "A folder with that name already exists here." });
    throw error;
  }
  const updated = folderForRoom(context.roomId, folder.id)!;
  broadcastRoom(context.roomId, { type: "wiki-updated" });
  res.json({ folder: publicFolder(updated) });
});

wikiRouter.delete("/rooms/:roomId/wiki/folders/:folderId", requireAuth, (req: AuthedRequest, res) => {
  const context = requestedRoom(req, res);
  if (!context) return;
  const folder = folderForRoom(context.roomId, Number(req.params.folderId));
  if (!folder || !mayManageWikiFolder(req.account!, folder))
    return res.status(404).json({ error: "Folder not found." });
  const hasChildren = one<{ id: number }>("SELECT id FROM wiki_folders WHERE parent_id = ? LIMIT 1", folder.id);
  const hasPages = one<{ id: number }>("SELECT id FROM wiki_pages WHERE folder_id = ? LIMIT 1", folder.id);
  if (hasChildren || hasPages) return res.status(409).json({ error: "Empty this folder before deleting it." });
  db.prepare("DELETE FROM wiki_folders WHERE id = ?").run(folder.id);
  broadcastRoom(context.roomId, { type: "wiki-updated" });
  res.status(204).end();
});

wikiRouter.get("/rooms/:roomId/wiki/search", requireAuth, (req: AuthedRequest, res) => {
  const context = requestedRoom(req, res);
  if (!context) return;
  const parsed = z.object({ q: z.string().trim().min(1).max(120) }).safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Enter a search query." });
  const query = parsed.data.q.toLocaleLowerCase();
  const pages = all<WikiPageRow>(
    `SELECT id, room_id, folder_id, slug, title, markdown, visible, map_media_id, sort_order, revision,
            owner_account_id, created_at, updated_at
       FROM wiki_pages
       WHERE room_id = ? ${context.role === "gm" ? "" : "AND (owner_account_id = ? OR visible = 1)"}
       ORDER BY updated_at DESC, id DESC`,
    ...(context.role === "gm" ? [context.roomId] : [context.roomId, req.account!.id])
  ).filter(
    (page) =>
      page.title.toLocaleLowerCase().includes(query) ||
      markdownForWikiSearch(page.markdown).toLocaleLowerCase().includes(query)
  );
  res.json({ pages: pages.slice(0, 50).map((page) => publicPage(page)) });
});

wikiRouter.get("/rooms/:roomId/wiki/mentionables", requireAuth, (req: AuthedRequest, res) => {
  const context = requestedRoom(req, res);
  if (!context) return;
  const parsed = z.object({ q: z.string().trim().max(120).default("") }).safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Enter a valid mention search." });
  res.json({ mentionables: wikiMentionables(req.account!, context.roomId, parsed.data.q) });
});

wikiRouter.post("/rooms/:roomId/wiki/pages/from-reference/:mediaId", requireAuth, (req: AuthedRequest, res) => {
  const roomId = requireWikiGm(req, res);
  if (!roomId) return;
  const media = one<{ filename: string; stored_name: string; size: number }>(
    `SELECT filename, stored_name, size FROM media
      WHERE id = ? AND room_id = ? AND COALESCE(category, kind) = 'reference' AND mime_type = 'text/markdown'`,
    Number(req.params.mediaId),
    roomId
  );
  if (!media || media.size > markdownLimit || path.basename(media.stored_name) !== media.stored_name)
    return res.status(404).json({ error: "Markdown reference not found." });
  let markdown: string;
  try {
    markdown = fs.readFileSync(path.join(config.dataDir, "uploads", media.stored_name), "utf8");
  } catch {
    return res.status(404).json({ error: "Markdown reference not found." });
  }
  if (Buffer.byteLength(markdown, "utf8") > markdownLimit)
    return res.status(413).json({ error: "Reference is too large for a wiki page." });
  const title = path.basename(media.filename, path.extname(media.filename)).trim() || "Reference";
  let page: WikiPageRow | undefined;
  let hasUnresolvableMention = false;
  db.exec("BEGIN IMMEDIATE");
  try {
    const mentions = resolveWikiMentions(req.account!, roomId, markdown);
    if (!mentions) {
      hasUnresolvableMention = true;
      db.exec("ROLLBACK");
    } else {
      const slug = uniqueSlug(roomId, title);
      const result = db
        .prepare("INSERT INTO wiki_pages (room_id, slug, title, markdown, owner_account_id) VALUES (?, ?, ?, ?, ?)")
        .run(roomId, slug, title.slice(0, 160), markdown, req.account!.id);
      replaceWikiMentions(Number(result.lastInsertRowid), mentions);
      page = one<WikiPageRow>(
        `SELECT id, room_id, folder_id, slug, title, markdown, visible, map_media_id, sort_order, revision,
              owner_account_id, created_at, updated_at FROM wiki_pages WHERE id = ?`,
        Number(result.lastInsertRowid)
      )!;
      db.exec("COMMIT");
    }
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  if (hasUnresolvableMention)
    return res.status(400).json({ error: "That reference mentions a target the room cannot resolve." });
  broadcastRoom(roomId, { type: "wiki-updated" });
  res.status(201).json({ page: pageForReader(req.account, page!) });
});
