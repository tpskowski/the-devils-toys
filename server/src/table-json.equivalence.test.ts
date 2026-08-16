import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { parseRollTables } from "@devils-toys/shared";
import { readSetJson } from "./table-json.js";
import { projectFile } from "./paths.js";
import { installToybox } from "./test-fixture.js";

installToybox();

/**
 * The committed table JSON has to say exactly what the parser reads out of the
 * Markdown beside it, or a system serves tables its own book does not have.
 *
 * This used to run over the three systems compiled into this repository. Each of
 * them now checks itself in its own CI, with `tables-md-to-json.ts --repo
 * --check`, which is the same comparison one level up — on the rendered file
 * rather than the parsed structure. What is left here is the fixture, which
 * keeps the property under test in this suite rather than only in other repos'.
 */
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
  it("matches what the parser reads out of the rules Markdown", () => {
    const markdown = fs.readFileSync(projectFile("fixtures", "toybox", "rules", "Toybox.md"), "utf8");
    const parsed = parseRollTables(markdown, []);
    const stored = readSetJson("toybox", "toybox.json");

    expect(stored.tables).not.toHaveLength(0);
    expect(stored.tables.map(comparable)).toEqual(parsed.map(comparable));
  });
});
