import fs from "node:fs";
import {
  parseRowLabel,
  type RollTable,
  type RollTableRow,
  type RollTableSource,
  type TableTagDefinition
} from "@devils-toys/shared";
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

const cache = new Map<string, StoredSet>();

export function readSetJson(file: string): StoredSet {
  const cached = cache.get(file);
  if (cached) return cached;
  const absolute = projectFile("raw", "tables", file);
  const parsed = JSON.parse(fs.readFileSync(absolute, "utf8")) as StoredSet;
  if (parsed.formatVersion !== 1 || !Array.isArray(parsed.tables)) throw new Error(`Invalid table JSON: ${file}`);
  if (parsed.tables.some((table) => !table.id || !table.name || !Array.isArray(table.rows)))
    throw new Error(`Invalid table entry in ${file}`);
  cache.set(file, parsed);
  return parsed;
}

export function tablesForSetJson(file: string): CatalogRollTable[] {
  return readSetJson(file).tables.map(({ origin, classification, ...table }) => ({
    ...table,
    ...(origin ? { source: origin } : {}),
    ...(classification ? { classification } : {})
  }));
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
    return { label, min: range.min, max: range.max, cells: cells.slice(0, columns.length) };
  });
}

export function normalizeCustomTables(
  input: readonly unknown[],
  vocabulary: readonly TableTagDefinition[] = []
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
      !/^\d*d(?:100|66|44|30|20|12|10|8|6|4)$/.test(dice) ||
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
    const unknown = tags.filter((tag) => vocabulary.length && !vocabulary.some((entry) => entry.slug === tag));
    if (unknown.length) throw new Error(`Unknown table tag "${unknown[0]}".`);
    return {
      id,
      name,
      section: String(value.section ?? ""),
      category: String(value.category ?? name),
      dice,
      columns,
      tags: [...new Set(tags)],
      rows: normalizedRows(value, columns),
      ...(typeof value.notesBefore === "string" ? { notesBefore: value.notesBefore } : {})
    };
  });
}

export function parseCustomSet(
  value: string,
  name: string,
  vocabulary: readonly TableTagDefinition[] = []
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

export function customSetDocument(
  name: string,
  tables: readonly unknown[],
  vocabulary: readonly TableTagDefinition[] = [],
  preamble = "",
  postamble = ""
): CustomSetDocument {
  return { formatVersion: 1, setName: name, preamble, postamble, tables: normalizeCustomTables(tables, vocabulary) };
}
