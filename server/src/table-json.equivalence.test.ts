import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { parseRollTables } from "@devils-toys/shared";
import { readSetJson } from "./table-json.js";
import { projectFile } from "./paths.js";
import { builtinSystems } from "./systems.js";

const comparable = (table: {
  id: string;
  name: string;
  section: string;
  category: string;
  dice: string;
  columns: readonly string[];
  tags: readonly string[];
  rows: readonly unknown[];
}) => ({
  id: table.id,
  name: table.name,
  section: table.section,
  category: table.category,
  dice: table.dice,
  columns: table.columns,
  tags: table.tags,
  rows: table.rows
});

describe("generated table JSON", () => {
  for (const system of Object.values(builtinSystems)) {
    it(`${system.id} matches the parser output`, () => {
      const source = system.sourceDocuments[0]!;
      const markdown = fs.readFileSync(projectFile("raw", source.markdownFile), "utf8");
      const parsed = parseRollTables(markdown, system.tableCatalog.exclude);
      const stored = readSetJson(system.id, source.tablesFile!);
      expect(stored.tables.map(comparable)).toEqual(parsed.map(comparable));
      expect(stored.tables.map((table) => [table.id, table.origin?.tableStart, table.origin?.tableEnd])).toEqual(
        parsed.map((table) => [table.id, table.source?.tableStart, table.source?.tableEnd])
      );
    });
  }
});
