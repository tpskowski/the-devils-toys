import fs from "node:fs";
import { describe, expect, it } from "vitest";
import type { RollTable } from "@devils-toys/shared";
import { appendTable, parseRollTables, serializeSet, serializeTable, spliceTable } from "@devils-toys/shared";
import { projectFile } from "./paths.js";

/** Everything but where it sat in the document, which changes as lines move. */
function withoutSource(table: RollTable) {
  const { source, ...rest } = table;
  return rest;
}

const books = ["Cairn.md", "Monolith.md"] as const;

describe.each(books)("round-tripping every table in %s", (filename) => {
  const markdown = fs.readFileSync(projectFile("raw", filename), "utf8");
  const original = parseRollTables(markdown);

  it("finds tables to check", () => {
    expect(original.length).toBeGreaterThanOrEqual(10);
  });

  it("reads back an identical table after rewriting it", () => {
    const failures: string[] = [];
    for (const table of original) {
      const rewritten = parseRollTables(spliceTable(markdown, table));
      const match = rewritten.find((entry) => entry.id === table.id);
      if (!match) {
        failures.push(`${table.id}: disappeared after rewriting`);
        continue;
      }
      if (JSON.stringify(withoutSource(match)) !== JSON.stringify(withoutSource(table))) {
        failures.push(`${table.id}: changed after rewriting`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("leaves every other table in the document untouched", () => {
    const others = (tables: RollTable[], skip: string) =>
      tables.filter((entry) => entry.id !== skip).map(withoutSource);
    const failures: string[] = [];
    // A handful of tables is enough to prove the splice is local; running all of
    // Monolith's would reparse a 177 KB book several hundred times.
    for (const table of original.slice(0, 12)) {
      const rewritten = parseRollTables(spliceTable(markdown, table));
      if (JSON.stringify(others(rewritten, table.id)) !== JSON.stringify(others(original, table.id))) {
        failures.push(`${table.id}: rewriting it disturbed another table`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("keeps the document's own lines outside the table it rewrote", () => {
    const table = original[0];
    const before = markdown.split("\n").slice(0, table.source!.heading?.line ?? table.source!.tableStart);
    const after = spliceTable(markdown, table).split("\n").slice(0, before.length);
    expect(after).toEqual(before);
  });
});

describe("writing a table back out", () => {
  const source = `## Generators

### Rumours (d6)

| Roll | Rumour |
| --- | --- |
| 1 | A caravan is overdue |
| 2-3 | Bread has doubled in price |
| 4-6 | A stranger asks after you |
`;

  it("keeps the die column the source wrote when the die has not changed", () => {
    const [table] = parseRollTables(source);
    expect(spliceTable(source, table)).toContain("| Roll | Rumour |");
  });

  it("writes the die explicitly once the die changes", () => {
    const [table] = parseRollTables(source);
    const rewritten = spliceTable(source, { ...table, dice: "d8" });
    expect(rewritten).toContain("| d8 | Rumour |");
    expect(parseRollTables(rewritten)[0].dice).toBe("d8");
  });

  it("renames the heading when the table is the only one under it", () => {
    const [table] = parseRollTables(source);
    const rewritten = spliceTable(source, { ...table, name: "Market Rumours (d6)" });
    expect(rewritten).toContain("### Market Rumours (d6)");
    expect(parseRollTables(rewritten)[0].name).toBe("Market Rumours (d6)");
  });

  it("leaves a shared heading alone, because the name is partly the column", () => {
    const shared = `### STARTING GEAR

| D6 | Signature Weapon |
| --- | --- |
| 1 | Hell Spitter |

| D6 | What Happened? |
| --- | --- |
| 1 | Last man standing |
`;
    const [weapons] = parseRollTables(shared);
    expect(spliceTable(shared, { ...weapons, name: "Anything Else" })).toContain("### STARTING GEAR");
  });

  it("writes tags into a comment and reads them back", () => {
    const [table] = parseRollTables(source);
    const rewritten = spliceTable(source, { ...table, tags: ["fantasy", "random-encounter"] });
    expect(rewritten).toContain("<!-- tags: fantasy, random-encounter -->");
    expect(parseRollTables(rewritten)[0].tags).toEqual(["fantasy", "random-encounter"]);
  });

  it("updates a comment that is already there, and removes it when the tags go", () => {
    const [table] = parseRollTables(source);
    const tagged = spliceTable(source, { ...table, tags: ["fantasy"] });
    const [taggedTable] = parseRollTables(tagged);
    expect(taggedTable.source!.tagsLine).not.toBeNull();

    const retagged = spliceTable(tagged, { ...taggedTable, tags: ["gear"] });
    expect(parseRollTables(retagged)[0].tags).toEqual(["gear"]);
    expect(retagged.match(/<!-- tags:/g)).toHaveLength(1);

    const cleared = spliceTable(tagged, { ...taggedTable, tags: [] });
    expect(cleared).not.toContain("<!-- tags:");
    expect(parseRollTables(cleared)[0].tags).toEqual([]);
  });

  it("keeps a literal pipe inside a cell", () => {
    const [table] = parseRollTables(source);
    const edited: RollTable = {
      ...table,
      rows: [{ label: "1", min: 1, max: 1, cells: ["Roll 1D6 | 1-2: Leg, 3-4: Arm"] }]
    };
    const rewritten = spliceTable(source, edited);
    expect(rewritten).toContain("\\|");
    expect(parseRollTables(rewritten)[0].rows[0].cells).toEqual(["Roll 1D6 | 1-2: Leg, 3-4: Arm"]);
  });

  it("pads a row that is short of cells rather than shifting the columns along", () => {
    const [table] = parseRollTables(`### Omens (d6)

| d6 | Sign | Note |
| --- | --- | --- |
| 1 | Crows | Circling |
`);
    const rewritten = spliceTable(
      `### Omens (d6)

| d6 | Sign | Note |
| --- | --- | --- |
| 1 | Crows | Circling |
`,
      { ...table, rows: [{ label: "1", min: 1, max: 1, cells: ["Crows"] }] }
    );
    expect(parseRollTables(rewritten)[0].rows[0].cells).toEqual(["Crows", ""]);
  });
});

describe("writing a whole set", () => {
  const tables = parseRollTables(`## Generators

### Rumours (d6)

| d6 | Rumour |
| --- | --- |
| 1 | A caravan is overdue |

### Reactions

| d6 | Reaction |
| --- | --- |
| 1 | Hostile |
| 2-6 | Wary |
`);

  it("re-reads as the same tables", () => {
    const written = parseRollTables(serializeSet(tables));
    expect(written.map(withoutSource)).toEqual(tables.map(withoutSource));
  });

  it("is stable when written a second time", () => {
    const once = serializeSet(tables);
    expect(serializeSet(parseRollTables(once))).toBe(once);
  });

  it("carries per-table tags through", () => {
    const tagged = tables.map((table, index) => ({ ...table, tags: index ? ["gear"] : ["fantasy"] }));
    expect(parseRollTables(serializeSet(tagged)).map((table) => table.tags)).toEqual([["fantasy"], ["gear"]]);
  });

  it("adds a table to a document without touching what is already there", () => {
    const existing = `### Rumours (d6)

| d6 | Rumour |
| --- | --- |
| 1 | A caravan is overdue |
`;
    const added = appendTable(existing, {
      ...tables[1],
      source: undefined
    });
    expect(added.startsWith(existing.trimEnd())).toBe(true);
    expect(parseRollTables(added).map((table) => table.name)).toEqual(["Rumours (d6)", "Reactions"]);
  });

  it("writes a standalone table that reads back whole", () => {
    const [table] = parseRollTables(serializeTable({ ...tables[0], tags: ["fantasy"] }).join("\n"));
    expect(table.name).toBe("Rumours (d6)");
    expect(table.dice).toBe("d6");
    expect(table.tags).toEqual(["fantasy"]);
    expect(table.rows).toEqual(tables[0].rows);
  });
});
