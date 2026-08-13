import express from "express";
import { z } from "zod";
import {
  parseRollTables,
  spliceTable,
  TABLE_TAG_SLUG,
  type TableTag,
  type TableTagDefinition
} from "@devils-toys/shared";
import type { AuthedRequest } from "./auth.js";
import { requireAuth } from "./auth.js";
import { all, db, one } from "./db.js";
import { requireTableAdmin, requireTableEdit, requireTableRead } from "./table-permissions.js";
import { systems } from "./systems.js";
import { repositorySetEntries, repositoryTablesForSetJson, tablesForSetJson } from "./table-json.js";

export const tagRouter = express.Router();

interface TableTagRow {
  slug: string;
  label: string;
  builtin: number;
  sort_order: number;
}

function toDefinition(row: TableTagRow): TableTagDefinition {
  return { slug: row.slug, label: row.label, builtin: Boolean(row.builtin), sortOrder: row.sort_order };
}

/** The instance's tag vocabulary, in the order it should be shown. */
export function tagVocabulary(): TableTagDefinition[] {
  return all<TableTagRow>("SELECT slug, label, builtin, sort_order FROM table_tags ORDER BY sort_order, slug").map(
    toDefinition
  );
}

/** Only tags this instance knows, so a stale or hand-edited slug is dropped. */
export function knownTags(
  tags: readonly TableTag[],
  vocabulary: readonly TableTagDefinition[] = tagVocabulary()
): TableTag[] {
  const wanted = new Set(tags);
  return vocabulary.filter((entry) => wanted.has(entry.slug)).map((entry) => entry.slug);
}

/**
 * How many sets store a tag and how many tables effectively carry it, including
 * inherited catalogue tags. Built-in system catalogues are source-backed rather
 * than database rows, so they must be counted explicitly.
 */
type TagUsage = { sets: number; tables: number };

function allTagUsage() {
  const usage = new Map<string, TagUsage>();
  const counts = (slug: string) => {
    let found = usage.get(slug);
    if (!found) {
      found = { sets: 0, tables: 0 };
      usage.set(slug, found);
    }
    return found;
  };
  const includeSet = (tags: readonly string[]) => {
    for (const slug of new Set(tags)) counts(slug).sets += 1;
  };
  const includeTables = (tables: readonly { tags: readonly string[] }[], inherited: readonly string[]) => {
    for (const table of tables) {
      for (const slug of new Set([...inherited, ...table.tags])) counts(slug).tables += 1;
    }
  };

  for (const row of all<{ tags_json: string; markdown: string }>("SELECT tags_json, markdown FROM table_sets")) {
    let inherited: string[] = [];
    try {
      const tags = JSON.parse(row.tags_json);
      if (Array.isArray(tags)) inherited = tags.filter((tag): tag is string => typeof tag === "string");
    } catch {
      // Unreadable set tags do not hide valid tags carried by its tables.
    }
    includeSet(inherited);
    includeTables(parseRollTables(row.markdown), inherited);
  }

  for (const system of Object.values(systems)) {
    includeSet(system.tableCatalog.tags);
    const source = system.sourceDocuments[0];
    if (!source?.tablesFile) continue;
    for (const table of tablesForSetJson(source.tablesFile)) {
      for (const slug of new Set([...system.tableCatalog.tags, ...table.tags])) counts(slug).tables += 1;
    }
  }

  for (const entry of repositorySetEntries()) {
    const tables = repositoryTablesForSetJson(entry.file, tagVocabulary());
    includeSet(tables.flatMap((table) => table.tags));
    includeTables(tables, []);
  }

  return usage;
}

export function tagUsage(slug: string) {
  return allTagUsage().get(slug) ?? { sets: 0, tables: 0 };
}

/**
 * Rewrites a slug everywhere it is stored: the set-level tag lists, and the
 * `<!-- tags: ... -->` comment of every table that names it. Passing no
 * replacement removes the tag instead. One transaction, because a half-applied
 * rename would leave sets pointing at a tag that no longer exists.
 */
function rewriteSlug(from: string, to: string | null) {
  const rows = all<{ id: number; tags_json: string; markdown: string }>(
    "SELECT id, tags_json, markdown FROM table_sets"
  );
  const updateSet = db.prepare("UPDATE table_sets SET tags_json = ?, markdown = ? WHERE id = ?");

  db.exec("BEGIN IMMEDIATE");
  try {
    for (const row of rows) {
      let tags: string[] = [];
      try {
        const parsed = JSON.parse(row.tags_json);
        if (Array.isArray(parsed)) tags = parsed.filter((tag): tag is string => typeof tag === "string");
      } catch {
        tags = [];
      }
      const nextTags = [...new Set(tags.flatMap((tag) => (tag === from ? (to ? [to] : []) : [tag])))];

      const changedTables = parseRollTables(row.markdown)
        .filter((table) => table.tags.includes(from))
        .map((table) => ({
          ...table,
          tags: [...new Set(table.tags.flatMap((tag) => (tag === from ? (to ? [to] : []) : [tag])))]
        }))
        .sort((left, right) => right.source!.tableStart - left.source!.tableStart);
      let markdown = row.markdown;
      for (const table of changedTables) markdown = spliceTable(markdown, table);

      if (changedTables.length || JSON.stringify(nextTags) !== JSON.stringify(tags)) {
        updateSet.run(JSON.stringify(nextTags), markdown, row.id);
      }
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

tagRouter.get("/table-tags", requireAuth, (req: AuthedRequest, res) => {
  if (!requireTableRead(req, res)) return;
  const usage = allTagUsage();
  res.json({
    tags: tagVocabulary().map((tag) => ({ ...tag, usage: usage.get(tag.slug) ?? { sets: 0, tables: 0 } }))
  });
});

const tagBody = z.object({
  slug: z.string().trim().toLowerCase().regex(TABLE_TAG_SLUG).max(40),
  label: z.string().trim().min(1).max(60)
});

tagRouter.post("/table-tags", requireAuth, (req: AuthedRequest, res) => {
  if (!requireTableEdit(req, res)) return;
  const parsed = tagBody.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: "A tag needs a name and a slug of lower-case words joined by hyphens." });
  if (one("SELECT slug FROM table_tags WHERE slug = ?", parsed.data.slug))
    return res.status(409).json({ error: "That tag already exists." });

  const next = one<{ next: number }>("SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM table_tags")!.next;
  db.prepare("INSERT INTO table_tags (slug, label, builtin, sort_order) VALUES (?, ?, 0, ?)").run(
    parsed.data.slug,
    parsed.data.label,
    next
  );
  res.status(201).json({ tag: { slug: parsed.data.slug, label: parsed.data.label, builtin: false, sortOrder: next } });
});

const patchBody = z.object({
  label: z.string().trim().min(1).max(60).optional(),
  slug: z.string().trim().toLowerCase().regex(TABLE_TAG_SLUG).max(40).optional()
});

tagRouter.patch("/table-tags/:slug", requireAuth, (req: AuthedRequest, res) => {
  const parsed = patchBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Give the tag a name, a slug, or both." });
  const changingSlug = Boolean(parsed.data.slug && parsed.data.slug !== req.params.slug);
  // Relabelling is ordinary authoring; re-slugging rewrites every set that uses
  // it, so it asks for more.
  if (!(changingSlug ? requireTableAdmin(req, res) : requireTableEdit(req, res))) return;

  const existing = one<TableTagRow>(
    "SELECT slug, label, builtin, sort_order FROM table_tags WHERE slug = ?",
    String(req.params.slug)
  );
  if (!existing) return res.status(404).json({ error: "Tag not found." });
  // A built-in is seeded by its slug on every start, so moving one aside would
  // simply bring the old slug back alongside the new one at the next restart.
  // Its name can still be changed, which is what renaming a built-in means.
  if (changingSlug && existing.builtin)
    return res.status(400).json({ error: "A built-in tag keeps its slug; its name can still be changed." });
  if (changingSlug && one("SELECT slug FROM table_tags WHERE slug = ?", parsed.data.slug!))
    return res.status(409).json({ error: "That tag already exists." });

  if (changingSlug) {
    rewriteSlug(existing.slug, parsed.data.slug!);
    db.prepare("UPDATE table_tags SET slug = ?, label = ? WHERE slug = ?").run(
      parsed.data.slug!,
      parsed.data.label ?? existing.label,
      existing.slug
    );
  } else if (parsed.data.label) {
    db.prepare("UPDATE table_tags SET label = ? WHERE slug = ?").run(parsed.data.label, existing.slug);
  }
  res.status(204).end();
});

tagRouter.post("/table-tags/:slug/merge", requireAuth, (req: AuthedRequest, res) => {
  if (!requireTableAdmin(req, res)) return;
  const parsed = z.object({ into: z.string().trim().toLowerCase().regex(TABLE_TAG_SLUG).max(40) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Name the tag to merge into." });

  const from = String(req.params.slug);
  if (from === parsed.data.into) return res.status(400).json({ error: "A tag cannot merge into itself." });
  if (!one("SELECT slug FROM table_tags WHERE slug = ?", from))
    return res.status(404).json({ error: "Tag not found." });
  if (!one("SELECT slug FROM table_tags WHERE slug = ?", parsed.data.into))
    return res.status(404).json({ error: "The tag to merge into does not exist." });

  rewriteSlug(from, parsed.data.into);
  db.prepare("DELETE FROM table_tags WHERE slug = ? AND builtin = 0").run(from);
  res.status(204).end();
});

tagRouter.delete("/table-tags/:slug", requireAuth, (req: AuthedRequest, res) => {
  if (!requireTableAdmin(req, res)) return;
  const existing = one<TableTagRow>("SELECT slug, builtin FROM table_tags WHERE slug = ?", String(req.params.slug));
  if (!existing) return res.status(404).json({ error: "Tag not found." });
  // A built-in is seeded again on the next start, so retiring one would only
  // look like it worked.
  if (existing.builtin) return res.status(400).json({ error: "A built-in tag cannot be retired." });

  rewriteSlug(existing.slug, null);
  db.prepare("DELETE FROM table_tags WHERE slug = ?").run(existing.slug);
  res.status(204).end();
});
