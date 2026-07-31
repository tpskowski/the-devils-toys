import express from "express";
import multer from "multer";
import { z } from "zod";
import { appendTable, parseRollTables, SAMPLE_CSV, serializeSet, tablesFromCsv, tableToCsv } from "@devils-toys/shared";
import type { AuthedRequest } from "./auth.js";
import { requireAuth } from "./auth.js";
import { all, db, one } from "./db.js";
import { requireTableAdmin, requireTableEdit, requireTableRead } from "./table-permissions.js";
import {
  buildBundle,
  buildRepoBundle,
  bundleSetMarkdown,
  compareToExisting,
  readBundle,
  type BundleSet
} from "./table-bundles.js";
import { customSets, findSet, storedTags, type TableSetRow } from "./table-sets.js";
import { knownTags, tagVocabulary } from "./table-tags.js";

/**
 * Getting tables in and out: a CSV of rows, and the zip bundles that move sets
 * between instances or towards the repository.
 */
export const tableEditorRouter = express.Router();

// Bundles are held in memory rather than written to the uploads folder; an
// import is read once and either committed or thrown away.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

function attachment(res: express.Response, type: string, filename: string) {
  res.type(type).setHeader("Content-Disposition", `attachment; filename="${filename}"`);
}

tableEditorRouter.get("/table-templates/sample.csv", requireAuth, (req: AuthedRequest, res) => {
  if (!requireTableRead(req, res)) return;
  attachment(res, "text/csv", "devils-tables-sample.csv");
  res.send(SAMPLE_CSV);
});

tableEditorRouter.get("/table-sets/:setId/tables/:tableId/csv", requireAuth, (req: AuthedRequest, res) => {
  if (!requireTableRead(req, res)) return;
  const found = findSet(String(req.params.setId));
  const table = found?.tables.find((entry) => entry.id === req.params.tableId);
  if (!table) return res.status(404).json({ error: "Table not found." });
  attachment(res, "text/csv", `${table.id}.csv`);
  res.send(tableToCsv(table));
});

/**
 * Two passes over the same file: the first reports what was read and what could
 * not be, the second commits it. Nothing is written until the GM has seen what
 * they are about to get.
 */
tableEditorRouter.post(
  "/table-sets/:setId/import-csv",
  requireAuth,
  upload.single("file"),
  (req: AuthedRequest, res) => {
    if (!requireTableEdit(req, res)) return;
    const row = one<TableSetRow>(
      "SELECT id, name, markdown, tags_json, updated_at FROM table_sets WHERE id = ?",
      Number(req.params.setId)
    );
    if (!row) return res.status(404).json({ error: "Table set not found." });
    if (!req.file) return res.status(400).json({ error: "Choose a CSV file to import." });

    const { tables, problems } = tablesFromCsv(req.file.buffer.toString("utf8"));
    const commit = String(req.body?.commit ?? "") === "true";
    const replace = String(req.body?.replace ?? "") === "true";

    if (!commit) {
      return res.json({
        preview: tables.map((table) => ({
          name: table.name,
          dice: table.dice,
          columns: table.columns,
          tags: table.tags,
          rows: table.rows.slice(0, 8),
          rowCount: table.rows.length
        })),
        problems,
        unknownTags: [...new Set(tables.flatMap((table) => table.tags))].filter(
          (tag) => !tagVocabulary().some((entry) => entry.slug === tag)
        )
      });
    }

    if (!tables.length) return res.status(400).json({ error: "Nothing in that file could be read as a table." });

    const vocabulary = tagVocabulary();
    const unknownTags = [...new Set(tables.flatMap((table) => table.tags))].filter(
      (tag) => !vocabulary.some((entry) => entry.slug === tag)
    );
    if (unknownTags.length) return res.status(400).json({ error: `Unknown table tag "${unknownTags[0]}".` });
    const cleaned = tables.map((table) => ({ ...table, tags: knownTags(table.tags, vocabulary) }));

    let markdown = replace ? serializeSet(cleaned, row.name) : row.markdown;
    if (!replace) for (const table of cleaned) markdown = appendTable(markdown, table);
    db.prepare("UPDATE table_sets SET markdown = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(markdown, row.id);
    res.status(201).json({ imported: cleaned.length, problems });
  }
);

/** Every set asked for, as one archive another instance can read back. */
tableEditorRouter.get("/table-export", requireAuth, (req: AuthedRequest, res) => {
  if (!requireTableRead(req, res)) return;
  const wanted = String(req.query.ids ?? "")
    .split(",")
    .map((id) => Number(id.trim()))
    .filter((id) => Number.isInteger(id) && id > 0);

  const rows = customSets().filter((row) => !wanted.length || wanted.includes(row.id));
  if (!rows.length) return res.status(404).json({ error: "There are no custom sets to export." });

  const sets: BundleSet[] = rows.map((row) => ({
    name: row.name,
    markdown: row.markdown,
    tags: storedTags(row.tags_json)
  }));
  const used = new Set(
    sets
      .flatMap((set) => set.tags)
      .concat(sets.flatMap((set) => parseRollTables(set.markdown).flatMap((table) => table.tags)))
  );
  const tags = tagVocabulary().filter((tag) => used.has(tag.slug));

  attachment(res, "application/zip", `devils-tables-${new Date().toISOString().slice(0, 10)}.zip`);
  res.send(Buffer.from(buildBundle(sets, tags)));
});

tableEditorRouter.post("/table-import", requireAuth, upload.single("file"), (req: AuthedRequest, res) => {
  if (!requireTableEdit(req, res)) return;
  if (!req.file) return res.status(400).json({ error: "Choose a bundle to import." });

  let bundle;
  try {
    bundle = readBundle(new Uint8Array(req.file.buffer), tagVocabulary());
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "That bundle could not be read." });
  }

  const existing = all<{ name: string; markdown: string }>("SELECT name, markdown FROM table_sets");
  const vocabulary = tagVocabulary();
  const newTags = bundle.tags.filter((tag) => !vocabulary.some((entry) => entry.slug === tag.slug));

  if (String(req.body?.commit ?? "") !== "true") {
    return res.json({ sets: compareToExisting(bundle.sets, existing), newTags });
  }

  const actions = parseActions(req.body?.actions);
  const insertTag = db.prepare(
    "INSERT OR IGNORE INTO table_tags (slug, label, builtin, sort_order) VALUES (?, ?, 0, ?)"
  );
  const insertSet = db.prepare("INSERT INTO table_sets (name, markdown, tags_json, created_by) VALUES (?, ?, ?, ?)");
  const updateSet = db.prepare(
    "UPDATE table_sets SET markdown = ?, tags_json = ?, updated_at = CURRENT_TIMESTAMP WHERE name = ?"
  );

  let created = 0;
  let overwritten = 0;
  let skipped = 0;
  db.exec("BEGIN IMMEDIATE");
  try {
    let order = one<{ next: number }>("SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM table_tags")!.next;
    for (const tag of newTags) {
      insertTag.run(tag.slug, tag.label, order);
      order += 1;
    }

    const known = tagVocabulary();
    for (const set of bundle.sets) {
      const action = actions[set.name] ?? "create";
      if (action === "skip") {
        skipped += 1;
        continue;
      }
      const tags = JSON.stringify(knownTags(set.tags, known));
      const clash = existing.find((entry) => entry.name.toLocaleLowerCase() === set.name.toLocaleLowerCase());
      const markdown = bundleSetMarkdown(set);
      const unknown = parseRollTables(markdown)
        .flatMap((table) => table.tags)
        .find((tag) => !known.some((entry) => entry.slug === tag));
      if (unknown) throw new Error(`Unknown table tag "${unknown}".`);
      if (clash && action === "overwrite") {
        updateSet.run(markdown, tags, clash.name);
        overwritten += 1;
      } else {
        const name = clash ? `${set.name} (imported)` : set.name;
        insertSet.run(name, markdown, tags, req.account!.id);
        created += 1;
      }
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  res.status(201).json({ created, overwritten, skipped, tagsCreated: newTags.length });
});

/** Per-set decisions, sent as JSON because the body arrives as multipart. */
function parseActions(raw: unknown): Record<string, "create" | "overwrite" | "skip"> {
  if (typeof raw !== "string" || !raw) return {};
  const parsed = z.record(z.string(), z.enum(["create", "overwrite", "skip"])).safeParse(JSON.parse(raw) as unknown);
  return parsed.success ? parsed.data : {};
}

tableEditorRouter.get("/table-sets/:setId/repo-bundle", requireAuth, (req: AuthedRequest, res) => {
  if (!requireTableAdmin(req, res)) return;
  const found = findSet(String(req.params.setId));
  if (!found) return res.status(404).json({ error: "Table set not found." });
  if (!found.tables.length) return res.status(400).json({ error: "That set has no tables to merge." });

  const tags = knownTags(found.tables.flatMap((table) => table.tags));
  attachment(res, "application/zip", `${found.set.id.replace(":", "-")}-repo.zip`);
  res.send(Buffer.from(buildRepoBundle(found.set.name, found.tables, tags)));
});
