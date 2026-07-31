import fs from "node:fs";
import path from "node:path";
import { cairn } from "../systems/cairn/src/index.ts";
import { cwn } from "../systems/cwn/src/index.ts";
import { monolith } from "../systems/monolith/src/index.ts";
import {
  parseRollTables,
  type GameSystem,
  type RollTable,
  type RollTableSource,
  type SystemId
} from "../shared/src/index.ts";

export interface JsonTable extends Omit<RollTable, "source"> {
  classification?: "player" | "gm";
  origin?: RollTableSource & { markdownFile: string };
}

export interface JsonSet {
  formatVersion: 1;
  setName: string;
  sourceDocument?: string;
  preamble?: string;
  postamble?: string;
  tables: JsonTable[];
}

export const SYSTEMS: Record<SystemId, GameSystem> = { cairn, monolith, cwn };

export function projectFile(...segments: string[]) {
  return path.resolve(process.cwd(), ...segments);
}

export function systemMarkdown(system: GameSystem) {
  const source = system.sourceDocuments[0];
  if (!source) throw new Error(`${system.name} has no source document.`);
  return fs.readFileSync(projectFile("raw", source.markdownFile), "utf8");
}

export function classificationFor(system: GameSystem, table: RollTable): "player" | "gm" {
  const blocked = new Set(system.gmOnlyHeadings.map((heading) => heading.trim().toLocaleLowerCase()));
  return table.source?.headingPath.some((heading) => blocked.has(heading.trim().toLocaleLowerCase())) ? "gm" : "player";
}

function tableOrigin(table: RollTable, markdownFile: string) {
  if (!table.source) throw new Error(`Table "${table.name}" has no source metadata.`);
  return { ...table.source, markdownFile };
}

export function jsonTable(system: GameSystem | undefined, table: RollTable): JsonTable {
  const { source, ...rest } = table;
  return {
    ...rest,
    ...(system ? { classification: classificationFor(system, table) } : {}),
    ...(source && system ? { origin: tableOrigin(table, system.sourceDocuments[0]?.markdownFile ?? "") } : {})
  };
}

export function parseSet(
  markdown: string,
  options: {
    setName: string;
    sourceDocument?: string;
    system?: GameSystem;
    exclude?: readonly string[];
  }
): JsonSet {
  const parsed = parseRollTables(markdown, options.exclude ?? []);
  return {
    formatVersion: 1,
    setName: options.setName,
    ...(options.sourceDocument ? { sourceDocument: options.sourceDocument } : {}),
    tables: parsed.map((table) => jsonTable(options.system, table))
  };
}

export function canonicalTableData(table: JsonTable) {
  const { origin: _origin, classification: _classification, ...data } = table;
  return data;
}

export function canonicalJson(value: unknown) {
  return JSON.stringify(value);
}
