import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import {
  parseRollTables,
  serializeSet,
  type RollTable,
  type TableTag,
  type TableTagDefinition
} from "@devils-toys/shared";
import { parseCustomSet, type CustomSetDocument } from "./table-json.js";
import { REPOSITORY_TABLE_IMPORT_SCRIPT } from "./repository-table-import-script.js";

/**
 * The two archives The Devil's Tables produces.
 *
 * A **bundle** carries sets between copies of the application: the Markdown as
 * it was written, plus a manifest naming each set and the tag vocabulary it
 * relies on. A **repo bundle** is the other direction — one set shaped the way
 * `raw/tables/` expects, with a confirmation-based importer for folding it into
 * the repository.
 */

export const BUNDLE_VERSION = 2;

export interface BundleManifest {
  bundleVersion: number;
  exportedAt: string;
  app: "devils-tables";
  sets: { file: string; name: string; tags: TableTag[] }[];
  tags: TableTagDefinition[];
}

export interface BundleSet {
  name: string;
  markdown: string;
  document?: CustomSetDocument;
  tags: TableTag[];
}

function slugFor(name: string, taken: Set<string>) {
  const base =
    name
      .toLocaleLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "set";
  let slug = base;
  for (let suffix = 2; taken.has(slug); suffix += 1) slug = `${base}-${suffix}`;
  taken.add(slug);
  return slug;
}

export function buildBundle(sets: readonly BundleSet[], tags: readonly TableTagDefinition[]): Uint8Array {
  const taken = new Set<string>();
  const files: Record<string, Uint8Array> = {};
  const manifest: BundleManifest = {
    bundleVersion: sets.some((set) => set.document) ? BUNDLE_VERSION : 1,
    exportedAt: new Date().toISOString(),
    app: "devils-tables",
    sets: [],
    tags: [...tags]
  };

  for (const set of sets) {
    const json = Boolean(set.document);
    const file = `sets/${slugFor(set.name, taken)}.${json ? "json" : "md"}`;
    files[file] = strToU8(json ? `${JSON.stringify(set.document, null, 2)}\n` : set.markdown);
    manifest.sets.push({ file, name: set.name, tags: [...set.tags] });
  }
  files["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);
  return zipSync(files, { level: 6 });
}

export interface ReadBundle {
  sets: BundleSet[];
  tags: TableTagDefinition[];
}

/** Reads a bundle, refusing anything that is not one rather than half-importing it. */
export function readBundle(archive: Uint8Array, vocabulary: readonly TableTagDefinition[]): ReadBundle {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(archive);
  } catch {
    throw new Error("That file is not a readable zip archive.");
  }

  const manifestFile = files["manifest.json"];
  if (!manifestFile) throw new Error("The archive has no manifest.json, so it is not a table bundle.");

  let manifest: BundleManifest;
  try {
    manifest = JSON.parse(strFromU8(manifestFile));
  } catch {
    throw new Error("The bundle's manifest.json could not be read.");
  }
  if (manifest.app !== "devils-tables") throw new Error("That bundle was not written by The Devil's Tables.");
  if (manifest.bundleVersion > BUNDLE_VERSION)
    throw new Error(`That bundle was written by a newer version (${manifest.bundleVersion}). Update this one first.`);
  if (!Array.isArray(manifest.sets)) throw new Error("The bundle's manifest lists no sets.");

  const tags = Array.isArray(manifest.tags)
    ? manifest.tags.filter((tag) => tag && typeof tag.slug === "string" && typeof tag.label === "string")
    : [];
  const effectiveVocabulary = [...vocabulary];
  for (const tag of tags) {
    if (!effectiveVocabulary.some((entry) => entry.slug === tag.slug)) effectiveVocabulary.push(tag);
  }

  const sets: BundleSet[] = [];
  for (const entry of manifest.sets) {
    const file = files[entry.file];
    if (!file) throw new Error(`The bundle names "${entry.file}" but does not contain it.`);
    const name = String(entry.name ?? "Untitled set").slice(0, 80);
    const tags = Array.isArray(entry.tags) ? entry.tags.filter((tag): tag is string => typeof tag === "string") : [];
    if (manifest.bundleVersion <= 1 || entry.file.toLocaleLowerCase().endsWith(".md")) {
      sets.push({ name, markdown: strFromU8(file), tags });
    } else {
      try {
        sets.push({ name, markdown: "", document: parseCustomSet(strFromU8(file), name, effectiveVocabulary), tags });
      } catch {
        throw new Error(`The bundle's table JSON for "${name}" could not be read.`);
      }
    }
  }

  return { sets, tags };
}

/** Canonical Markdown for legacy JSON bundle inputs, which have no source ranges to preserve. */
export function bundleSetMarkdown(set: BundleSet) {
  if (!set.document) return set.markdown;
  const body = serializeSet(set.document.tables, set.name).trim();
  return [set.document.preamble.trim(), body, set.document.postamble.trim()].filter(Boolean).join("\n\n") + "\n";
}

export interface RepositoryBundleSet {
  name: string;
  tables: readonly RollTable[];
}

function storedRepositoryTable(table: RollTable) {
  return {
    id: table.id,
    name: table.name,
    section: table.section,
    category: table.category,
    dice: table.dice,
    columns: [...table.columns],
    tags: [...table.tags],
    rows: table.rows.map((row) => ({
      label: row.label,
      min: row.min,
      max: row.max,
      cells: [...row.cells],
      ...(row.nextTableId ? { nextTableId: row.nextTableId } : {})
    }))
  };
}

/** JSON table sets plus a review-first Node importer for a checked-out repository. */
export function buildRepoBundle(sets: readonly RepositoryBundleSet[]): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  const taken = new Set<string>();
  const manifest = {
    formatVersion: 1,
    app: "devils-tables-repository" as const,
    exportedAt: new Date().toISOString(),
    sets: [] as { id: string; name: string; file: string }[]
  };

  for (const set of sets) {
    const id = slugFor(set.name, taken);
    const file = `sets/${id}.json`;
    files[file] = strToU8(
      `${JSON.stringify(
        { formatVersion: 1, setName: set.name, tables: set.tables.map(storedRepositoryTable) },
        null,
        2
      )}\n`
    );
    manifest.sets.push({ id, name: set.name, file });
  }

  files["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);
  files["import-tables.mjs"] = strToU8(REPOSITORY_TABLE_IMPORT_SCRIPT);
  files["README.md"] = strToU8(`# Importing these tables

From a checkout of The Devil's Toys, run:

\`\`\`powershell
node path/to/this-bundle/import-tables.mjs
\`\`\`

The script finds the repository, reports which sets and tables would be added,
updated, or removed, and asks for Y/N confirmation before writing. You can also
pass the repository path explicitly. After importing, review \`git diff\`, run
the tests, and commit the JSON files with the rest of your change.
`);
  return zipSync(files, { level: 6 });
}

/** How a set in a bundle relates to what this instance already holds. */
export type ImportStatus = "new" | "identical" | "conflict";

export function compareToExisting(
  incoming: readonly BundleSet[],
  existing: readonly { name: string; markdown: string }[]
) {
  return incoming.map((set) => {
    const match = existing.find((entry) => entry.name.toLocaleLowerCase() === set.name.toLocaleLowerCase());
    const markdown = bundleSetMarkdown(set);
    const status: ImportStatus = !match ? "new" : match.markdown === markdown ? "identical" : "conflict";
    return {
      name: set.name,
      tags: set.tags,
      status,
      tables: parseRollTables(markdown).length
    };
  });
}
