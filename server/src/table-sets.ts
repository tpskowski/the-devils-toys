import express from "express";
import { z } from "zod";
import {
  tableSummary,
  TABLE_TAG_SLUG,
  type RollTable,
  type RollTableSet,
  type SystemId,
  type TableTag,
  type TableTagDefinition
} from "@devils-toys/shared";
import type { AuthedRequest } from "./auth.js";
import { requireAuth } from "./auth.js";
import { all, db, one } from "./db.js";
import { knownTags, tagVocabulary } from "./table-tags.js";
import { requireTableEdit, requireTableRead } from "./table-permissions.js";
import { systems } from "./systems.js";
import { customSetDocument, parseCustomSet, tablesForSetJson, type CatalogRollTable } from "./table-json.js";

/**
 * The table catalogue itself: what sets exist, and how a set is created, edited,
 * and removed. It is deliberately separate from rolling on a table, because The
 * Devil's Tables serves exactly this and none of the room machinery.
 */
export const tableSetRouter = express.Router();

export interface TableSetRow {
  id: number;
  name: string;
  tables_json: string;
  migration_markdown?: string | null;
  tags_json: string;
  updated_at: string;
}

/** Parsed system tables, kept because the raw Markdown cannot change at runtime. */
const systemTables = new Map<SystemId, CatalogRollTable[]>();

function tablesForSystem(system: SystemId) {
  const cached = systemTables.get(system);
  if (cached) return cached;
  const source = systems[system].sourceDocuments[0];
  if (!source?.tablesFile) throw new Error(`${systems[system].name} has no sourceDocument.tablesFile.`);
  const parsed = tablesForSetJson(source.tablesFile).map((table) => ({
    ...table,
    tags: mergeTags(systems[system].tableCatalog.tags, table.tags, tagVocabulary())
  }));
  systemTables.set(system, parsed);
  return parsed;
}

export function customSets() {
  return all<TableSetRow>("SELECT id, name, tables_json, tags_json, updated_at FROM table_sets ORDER BY name");
}

/** A set's stored tags, less any the instance no longer knows about. */
export function storedTags(value: string, vocabulary = tagVocabulary()): TableTag[] {
  try {
    const tags = JSON.parse(value);
    if (!Array.isArray(tags)) return [];
    return knownTags(tags, vocabulary);
  } catch {
    return [];
  }
}

/**
 * A table shows both the tags its set carries and any it names for itself in a
 * `<!-- tags: ... -->` comment, in vocabulary order and without repeats.
 */
function mergeTags(
  setTags: readonly TableTag[],
  tableTags: readonly TableTag[],
  vocabulary: readonly TableTagDefinition[]
): TableTag[] {
  return knownTags([...setTags, ...tableTags], vocabulary);
}

/** Every set a GM can switch between: one per installed system, then custom sets. */
export function availableSets(): { set: RollTableSet; tables: RollTable[] }[] {
  const vocabulary = tagVocabulary();
  const system = Object.values(systems).map((entry) => {
    const tables = tablesForSystem(entry.id);
    return {
      set: {
        id: `system:${entry.id}`,
        name: entry.tableCatalog.label,
        origin: "system" as const,
        tables: tables.map(tableSummary)
      },
      tables
    };
  });
  const custom = customSets().map((row) => {
    const tags = storedTags(row.tags_json, vocabulary);
    const document = parseCustomSet(row.tables_json, row.name, vocabulary);
    const customTables = document.tables.map((table) => ({
      ...table,
      tags: mergeTags(tags, table.tags, vocabulary)
    }));
    return {
      set: {
        id: `custom:${row.id}`,
        name: row.name,
        origin: "custom" as const,
        tables: customTables.map(tableSummary)
      },
      tables: customTables
    };
  });
  return [...system, ...custom];
}

export function findSet(setId: string) {
  return availableSets().find((entry) => entry.set.id === setId);
}

/**
 * Tags a set may be saved with. An unknown slug is refused rather than dropped:
 * silently saving a set without the tag the GM asked for is worse than saying no.
 */
export function resolveTags(input: readonly string[], res: express.Response): TableTag[] | undefined {
  const vocabulary = tagVocabulary();
  const unknown = input.filter((tag) => !vocabulary.some((entry) => entry.slug === tag));
  if (unknown.length) {
    res.status(400).json({ error: `This instance has no tag called "${unknown[0]}".` });
    return;
  }
  return knownTags(input, vocabulary);
}

const setBody = z.object({
  name: z.string().trim().min(2).max(80),
  tables: z.array(z.unknown()).max(500),
  preamble: z.string().max(200_000).default(""),
  postamble: z.string().max(200_000).default(""),
  tags: z.array(z.string().trim().toLowerCase().regex(TABLE_TAG_SLUG).max(40)).max(64).default([])
});

/** The whole catalogue with its summaries, for an editor rather than a room. */
tableSetRouter.get("/table-sets", requireAuth, (req: AuthedRequest, res) => {
  if (!requireTableRead(req, res)) return;
  const updated = new Map(customSets().map((row) => [`custom:${row.id}`, row.updated_at]));
  res.json({
    sets: availableSets().map((entry) => ({ ...entry.set, updatedAt: updated.get(entry.set.id) })),
    canEdit: req.account!.role !== "player",
    canAdminister: req.account!.role === "admin"
  });
});

tableSetRouter.get("/table-sets/:setId", requireAuth, (req: AuthedRequest, res) => {
  if (!requireTableRead(req, res)) return;
  const setId = String(req.params.setId);

  if (setId.startsWith("system:")) {
    const system = Object.values(systems).find((entry) => `system:${entry.id}` === setId);
    if (!system) return res.status(404).json({ error: "Table set not found." });
    return res.json({
      set: {
        id: setId,
        name: system.tableCatalog.label,
        tables: tablesForSystem(system.id),
        tags: knownTags(system.tableCatalog.tags),
        updatedAt: null,
        readOnly: true
      }
    });
  }

  const numericId = Number(setId.replace("custom:", ""));
  const row = one<TableSetRow>(
    "SELECT id, name, tables_json, tags_json, updated_at FROM table_sets WHERE id = ?",
    numericId
  );
  if (!row) return res.status(404).json({ error: "Table set not found." });
  const tags = storedTags(row.tags_json);
  const document = parseCustomSet(row.tables_json, row.name, tagVocabulary());
  res.json({
    set: {
      id: row.id,
      name: row.name,
      ...document,
      tables: document.tables.map((table) => ({ ...table, tags: mergeTags(tags, table.tags, tagVocabulary()) })),
      tags,
      updatedAt: row.updated_at,
      readOnly: false
    }
  });
});

tableSetRouter.post("/table-sets", requireAuth, (req: AuthedRequest, res) => {
  if (!requireTableEdit(req, res)) return;
  const parsed = setBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Give the set a name, valid tags, and valid table data." });
  const tags = resolveTags(parsed.data.tags, res);
  if (!tags) return;
  let document;
  try {
    document = customSetDocument(
      parsed.data.name,
      parsed.data.tables,
      tagVocabulary(),
      parsed.data.preamble,
      parsed.data.postamble
    );
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Invalid table data." });
  }
  const result = db
    .prepare("INSERT INTO table_sets (name, tables_json, tags_json, created_by) VALUES (?, ?, ?, ?)")
    .run(parsed.data.name, JSON.stringify(document), JSON.stringify(tags), req.account!.id);
  const id = Number(result.lastInsertRowid);
  res.status(201).json({ set: { id: `custom:${id}`, tags, tables: document.tables.length } });
});

tableSetRouter.patch("/table-sets/:setId", requireAuth, (req: AuthedRequest, res) => {
  if (!requireTableEdit(req, res)) return;
  const parsed = setBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Give the set a name, valid tags, and valid table data." });
  const tags = resolveTags(parsed.data.tags, res);
  if (!tags) return;
  let document;
  try {
    document = customSetDocument(
      parsed.data.name,
      parsed.data.tables,
      tagVocabulary(),
      parsed.data.preamble,
      parsed.data.postamble
    );
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Invalid table data." });
  }
  const result = db
    .prepare(
      "UPDATE table_sets SET name = ?, tables_json = ?, migration_markdown = NULL, tags_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    )
    .run(parsed.data.name, JSON.stringify(document), JSON.stringify(tags), Number(req.params.setId));
  if (!result.changes) return res.status(404).json({ error: "Table set not found." });
  res.status(204).end();
});

/** A copy to work on, so a system catalogue can be the starting point for one. */
tableSetRouter.post("/table-sets/:setId/duplicate", requireAuth, (req: AuthedRequest, res) => {
  if (!requireTableEdit(req, res)) return;
  const found = findSet(String(req.params.setId));
  if (!found) return res.status(404).json({ error: "Table set not found." });

  const source =
    found.set.origin === "custom"
      ? one<TableSetRow>(
          "SELECT id, name, tables_json, tags_json, updated_at FROM table_sets WHERE id = ?",
          Number(found.set.id.replace("custom:", ""))
        )
      : undefined;
  const document = source
    ? parseCustomSet(source.tables_json, source.name, tagVocabulary())
    : customSetDocument(found.set.name, found.tables, tagVocabulary());
  const tags = source ? storedTags(source.tags_json) : knownTags(found.tables.flatMap((table) => table.tags));

  const result = db
    .prepare("INSERT INTO table_sets (name, tables_json, tags_json, created_by) VALUES (?, ?, ?, ?)")
    .run(
      `${found.set.name} copy`,
      JSON.stringify({ ...document, setName: `${found.set.name} copy` }),
      JSON.stringify(tags),
      req.account!.id
    );
  res.status(201).json({ set: { id: `custom:${Number(result.lastInsertRowid)}` } });
});

tableSetRouter.delete("/table-sets/:setId", requireAuth, (req: AuthedRequest, res) => {
  if (!requireTableEdit(req, res)) return;
  const result = db.prepare("DELETE FROM table_sets WHERE id = ?").run(Number(req.params.setId));
  if (!result.changes) return res.status(404).json({ error: "Table set not found." });
  res.status(204).end();
});
