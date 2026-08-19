import fs from "node:fs";
import {
  DIE_SIDES_PATTERN,
  parseRowLabel,
  type RollTable,
  type RollTableRow,
  type RollTableSource,
  type SystemId,
  type TableTagDefinition
} from "@devils-toys/shared";
import { systemTablesJsonFile } from "./system-content.js";
import { projectFile } from "./paths.js";

export type TableClassification = "player" | "gm";
export type CatalogRollTable = RollTable & { classification?: TableClassification };
export type StoredCustomTable = RollTable & { notesBefore?: string };

export interface CustomSetDocument {
  formatVersion: 1;
  setName: string;
  preamble: string;
  postamble: string;
  tables: StoredCustomTable[];
}

export interface RepositorySetEntry {
  id: string;
  name: string;
  file: string;
}

interface RepositorySetRegistry {
  formatVersion: 1;
  sets: RepositorySetEntry[];
}

interface StoredTable extends Omit<RollTable, "source"> {
  classification?: TableClassification;
  origin?: RollTableSource & { markdownFile?: string };
}

interface StoredSet {
  formatVersion: number;
  setName: string;
  sourceDocument?: string;
  tables: StoredTable[];
}

export function parseSetJson(value: string, file: string): StoredSet {
  const parsed = JSON.parse(value) as StoredSet;
  if (parsed.formatVersion !== 1 || !Array.isArray(parsed.tables)) throw new Error(`Invalid table JSON: ${file}`);
  if (parsed.tables.some((table) => !table.id || !table.name || !Array.isArray(table.rows)))
    throw new Error(`Invalid table entry in ${file}`);
  return parsed;
}

/**
 * Parsed sets, keyed by the system that owns them as well as the filename. The
 * filename alone was enough while every set lived in `raw/tables`; an installed
 * system brings its own directory, and two systems may well both call their set
 * `tables.json`.
 */
const cache = new Map<string, StoredSet>();

/** Drops a system's parsed sets, for when its content has been replaced. */
export function forgetSetJson(system?: SystemId) {
  if (system === undefined) return cache.clear();
  for (const key of cache.keys()) if (key.startsWith(`${system}\u0000`)) cache.delete(key);
}

/** Standalone, checked-in table sets installed by a repository bundle. */
export function parseRepositorySetRegistry(value: string): RepositorySetEntry[] {
  const parsed = JSON.parse(value) as Partial<RepositorySetRegistry>;
  if (parsed.formatVersion !== 1 || !Array.isArray(parsed.sets))
    throw new Error("Invalid repository table-set registry.");
  const ids = new Set<string>();
  return parsed.sets.map((entry) => {
    const id = String(entry?.id);
    if (
      !entry ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) ||
      ids.has(id) ||
      !String(entry.name).trim() ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*\.json$/.test(String(entry.file))
    )
      throw new Error("Invalid repository table-set entry.");
    ids.add(id);
    return { id, name: String(entry.name), file: String(entry.file) };
  });
}

export function repositorySetEntries(): RepositorySetEntry[] {
  const file = projectFile("raw", "tables", "repository-sets.json");
  return parseRepositorySetRegistry(fs.readFileSync(file, "utf8"));
}

export function readSetJson(system: SystemId, file: string): StoredSet {
  const key = `${system}\u0000${file}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const absolute = systemTablesJsonFile(system, file);
  const parsed = parseSetJson(fs.readFileSync(absolute, "utf8"), file);
  cache.set(key, parsed);
  return parsed;
}

export function tablesForSetJson(system: SystemId, file: string): CatalogRollTable[] {
  return readSetJson(system, file).tables.map(({ origin, classification, ...table }) => ({
    ...table,
    ...(origin ? { source: origin } : {}),
    classification
  }));
}

/** Repository tables must not silently lose a tag the checked-in JSON names. */
export function validateRepositoryTableTags<T extends { tags: readonly string[] }>(
  tables: readonly T[],
  vocabulary: readonly TableTagDefinition[],
  file: string
): T[] {
  const unknown = tables.flatMap((table) => table.tags).find((tag) => !vocabulary.some((entry) => entry.slug === tag));
  if (unknown) throw new Error(`Unknown repository table tag "${unknown}" in ${file}.`);
  return [...tables];
}

export function repositoryTablesForSetJson(
  file: string,
  vocabulary: readonly TableTagDefinition[]
): CatalogRollTable[] {
  const key = `repository\u0000${file}`;
  const cached = cache.get(key);
  const parsed =
    cached ??
    (() => {
      const source = JSON.parse(fs.readFileSync(projectFile("raw", "tables", file), "utf8")) as StoredSet;
      if (source.formatVersion !== 1 || !Array.isArray(source.tables)) throw new Error(`Invalid table JSON: ${file}`);
      if (source.tables.some((table) => !table.id || !table.name || !Array.isArray(table.rows)))
        throw new Error(`Invalid table entry in ${file}`);
      cache.set(key, source);
      return source;
    })();
  const tables = parsed.tables.map(({ origin, classification, ...table }) => ({
    ...table,
    ...(origin ? { source: origin } : {}),
    classification
  }));
  return validateRepositoryTableTags(tables, vocabulary, file);
}

function tableSlug(value: string) {
  return (
    value
      .toLocaleLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "table"
  );
}

function normalizedRows(table: Record<string, unknown>, columns: readonly string[]): RollTableRow[] {
  if (!Array.isArray(table.rows)) throw new Error(`Table "${String(table.name ?? "")}" has no rows.`);
  return table.rows.map((raw, index) => {
    if (!raw || typeof raw !== "object") throw new Error(`Table row ${index + 1} is invalid.`);
    const row = raw as Record<string, unknown>;
    const label = String(row.label ?? "").trim();
    const range = parseRowLabel(label);
    if (!range || Number(row.min) !== range.min || Number(row.max) !== range.max)
      throw new Error(`Table "${String(table.name ?? "")}" has an invalid range for "${label}".`);
    if (!Array.isArray(row.cells)) throw new Error(`Table "${String(table.name ?? "")}" has invalid cells.`);
    const cells = row.cells.map((cell) => String(cell));
    while (cells.length < columns.length) cells.push("");
    const nextTableId = typeof row.nextTableId === "string" ? row.nextTableId.trim() : "";
    if (nextTableId && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(nextTableId))
      throw new Error(`Table "${String(table.name ?? "")}" has an invalid next table id.`);
    return {
      label,
      min: range.min,
      max: range.max,
      cells: cells.slice(0, columns.length),
      ...(nextTableId ? { nextTableId } : {})
    };
  });
}

export function normalizeCustomTables(
  input: readonly unknown[],
  vocabulary: readonly TableTagDefinition[]
): StoredCustomTable[] {
  const used = new Set<string>();
  return input.map((raw, index) => {
    if (!raw || typeof raw !== "object") throw new Error(`Table ${index + 1} is invalid.`);
    const value = raw as Record<string, unknown>;
    if (value.origin || value.classification) throw new Error("Custom tables cannot contain repository provenance.");
    const name = String(value.name ?? "").trim();
    const dice = String(value.dice ?? "")
      .replace(/\s+/g, "")
      .toLocaleLowerCase();
    const columns = Array.isArray(value.columns) ? value.columns.map(String) : [];
    if (
      !name ||
      !new RegExp(`^\\d*d(?:${DIE_SIDES_PATTERN})$`).test(dice) ||
      !columns.length ||
      columns.some((column) => !column.trim())
    )
      throw new Error(`Table ${index + 1} has an invalid name, die, or columns.`);
    const requested = String(value.id ?? "").trim();
    let id: string;
    if (requested) {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(requested)) throw new Error(`Table "${name}" has an invalid id.`);
      if (used.has(requested)) throw new Error(`Duplicate table id "${requested}".`);
      id = requested;
    } else {
      const base = tableSlug(name);
      id = base;
      for (let suffix = 2; used.has(id); suffix += 1) id = `${base}-${suffix}`;
    }
    used.add(id);
    const tags = Array.isArray(value.tags) ? value.tags.map((tag) => String(tag)) : [];
    const unknown = tags.filter((tag) => !vocabulary.some((entry) => entry.slug === tag));
    if (unknown.length) throw new Error(`Unknown table tag "${unknown[0]}".`);
    const rows = normalizedRows(value, columns);
    for (let position = 1; position < rows.length; position += 1) {
      if (rows[position].min <= rows[position - 1].max)
        throw new Error(`Table "${name}" has overlapping or unordered ranges at "${rows[position].label}".`);
    }
    return {
      id,
      name,
      section: String(value.section ?? ""),
      category: String(value.category ?? name),
      dice,
      columns,
      tags: [...new Set(tags)],
      rows,
      ...(typeof value.notesBefore === "string" ? { notesBefore: value.notesBefore } : {})
    };
  });
}

export function parseCustomSet(
  value: string,
  name: string,
  vocabulary: readonly TableTagDefinition[]
): CustomSetDocument {
  const parsed = JSON.parse(value) as Partial<CustomSetDocument>;
  if (parsed.formatVersion !== 1 || !Array.isArray(parsed.tables)) throw new Error("Invalid custom table JSON.");
  return {
    formatVersion: 1,
    setName: name,
    preamble: typeof parsed.preamble === "string" ? parsed.preamble : "",
    postamble: typeof parsed.postamble === "string" ? parsed.postamble : "",
    tables: normalizeCustomTables(parsed.tables, vocabulary)
  };
}
