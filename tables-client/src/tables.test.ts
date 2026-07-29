import { describe, expect, it } from "vitest";
import { parseRollTables, spliceTable } from "@devils-toys/shared";
import {
  addColumn,
  addRow,
  blankTable,
  fillRows,
  filterSets,
  moveRow,
  removeColumn,
  removeRow,
  setCell,
  setDice,
  setRowLabel,
  tableWarnings,
  tagTallies,
  tablesWithTag,
  toggleTag
} from "./tables";

const source = `### Rumours (d6)

| d6 | Rumour |
| --- | --- |
| 1-3 | The well has gone bitter |
| 4-6 | A stranger asks after you |
`;

const [table] = parseRollTables(source);

describe("editing rows", () => {
  it("re-reads the values a row covers when its die column is typed in", () => {
    const edited = setRowLabel(table, 0, "1-2");
    expect(edited.rows[0]).toMatchObject({ label: "1-2", min: 1, max: 2 });
  });

  it("leaves the range alone when the label stops making sense", () => {
    const edited = setRowLabel(table, 0, "one to three");
    expect(edited.rows[0]).toMatchObject({ min: 1, max: 3 });
  });

  it("carries on from the highest value already covered", () => {
    expect(addRow(table).rows.at(-1)).toEqual({ label: "7", min: 7, max: 7, cells: [""] });
  });

  it("moves and removes rows", () => {
    expect(moveRow(table, 0, 1).rows.map((row) => row.label)).toEqual(["4-6", "1-3"]);
    expect(moveRow(table, 0, -1).rows.map((row) => row.label)).toEqual(["1-3", "4-6"]);
    expect(removeRow(table, 0).rows.map((row) => row.label)).toEqual(["4-6"]);
  });

  it("writes a cell without disturbing the others", () => {
    const wide = addColumn(table);
    const edited = setCell(wide, 1, 1, "Note");
    expect(edited.rows[1].cells).toEqual(["A stranger asks after you", "Note"]);
    expect(edited.rows[0].cells).toEqual(["The well has gone bitter", ""]);
  });
});

describe("editing columns", () => {
  it("adds a column to the heading and to every row", () => {
    const wide = addColumn(table);
    expect(wide.columns).toEqual(["Rumour", "Column 2"]);
    expect(wide.rows.every((row) => row.cells.length === 2)).toBe(true);
  });

  it("removes a column from the heading and from every row", () => {
    const back = removeColumn(addColumn(table), 1);
    expect(back.columns).toEqual(["Rumour"]);
    expect(back.rows.every((row) => row.cells.length === 1)).toBe(true);
  });

  it("keeps the last column, because a table with no result is not a table", () => {
    expect(removeColumn(table, 0)).toBe(table);
  });
});

describe("filling a table out to its die", () => {
  it("gives every value a row and keeps what is already written", () => {
    const filled = fillRows(table);
    expect(filled.rows.map((row) => row.label)).toEqual(["1-3", "4-6"]);
  });

  it("adds the values a table is missing", () => {
    const filled = fillRows(setDice(table, "d8"));
    expect(filled.rows.map((row) => row.label)).toEqual(["1-3", "4-6", "7", "8"]);
  });

  it("counts compound dice in digit pairs", () => {
    const filled = fillRows({ ...blankTable("Quality", "d44"), rows: [] });
    expect(filled.rows).toHaveLength(16);
    expect(filled.rows[0].label).toBe("11");
    expect(filled.rows.at(-1)!.label).toBe("44");
  });
});

describe("warning about a table", () => {
  it("says nothing about a table that covers its die exactly", () => {
    expect(tableWarnings(table)).toEqual([]);
  });

  it("reports values the die can roll with no row", () => {
    expect(tableWarnings(setDice(table, "d8"))).toEqual(["2 values the die can roll with no row"]);
  });

  it("reports a row that only partly fits the die", () => {
    // "4-6" on a d4 is reachable at 4 but not at 5 or 6, which the roller's own
    // count of unreachable rows would not mention.
    expect(tableWarnings(setDice(table, "d4"))).toContain("1 row reaching past what d4 can roll");
  });

  it("reports a row written entirely past the die", () => {
    const past = { ...table, dice: "d4", rows: [{ label: "9", min: 9, max: 9, cells: ["x"] }] };
    expect(tableWarnings(past)).toContain("1 row reaching past what d4 can roll");
  });

  it("reports a row whose die value cannot be read", () => {
    const broken = { ...table, rows: [{ label: "many", min: 0, max: 0, cells: ["x"] }] };
    expect(tableWarnings(broken)).toContain("1 row without a die value");
  });
});

describe("a new table", () => {
  it("is written out and read back the same", () => {
    const fresh = blankTable("Omens");
    const document = spliceTable(`### Omens\n\n| d6 | Result |\n| --- | --- |\n| 1 | x |\n`, {
      ...fresh,
      source: parseRollTables(`### Omens\n\n| d6 | Result |\n| --- | --- |\n| 1 | x |\n`)[0].source
    });
    const [read] = parseRollTables(document);
    expect(read.name).toBe("Omens");
    expect(read.dice).toBe("d6");
  });
});

describe("odds and ends", () => {
  it("toggles a tag on and off", () => {
    expect(toggleTag(["fantasy"], "gear")).toEqual(["fantasy", "gear"]);
    expect(toggleTag(["fantasy", "gear"], "fantasy")).toEqual(["gear"]);
  });

  it("matches sets on every word given, over name and tags", () => {
    const sets = [
      { name: "Market rumours", tags: ["fantasy"] },
      { name: "Derelict hazards", tags: ["scifi", "random-encounter"] }
    ];
    expect(filterSets(sets, "market").map((set) => set.name)).toEqual(["Market rumours"]);
    expect(filterSets(sets, "scifi hazards").map((set) => set.name)).toEqual(["Derelict hazards"]);
    expect(filterSets(sets, "")).toHaveLength(2);
  });
});

describe("the tags present in a set", () => {
  const vocabulary = [
    { slug: "fantasy", label: "Fantasy", builtin: true, sortOrder: 0 },
    { slug: "scifi", label: "Sci-fi", builtin: true, sortOrder: 1 },
    { slug: "character-building", label: "Character Building", builtin: true, sortOrder: 2 },
    { slug: "gear", label: "Gear", builtin: true, sortOrder: 4 }
  ];
  const set = parseRollTables(`### One
<!-- tags: scifi, gear -->

| d6 | Result |
| --- | --- |
| 1-6 | a |

### Two
<!-- tags: scifi -->

| d6 | Result |
| --- | --- |
| 1-6 | b |

### Three

| d6 | Result |
| --- | --- |
| 1-6 | c |
`);

  it("counts how many tables carry each tag, in vocabulary order", () => {
    expect(tagTallies(set, [], vocabulary)).toEqual([
      { slug: "scifi", count: 2, fromSet: false },
      { slug: "gear", count: 1, fromSet: false }
    ]);
  });

  it("counts a set-level tag against every table, because that is what it means", () => {
    expect(tagTallies(set, ["character-building"], vocabulary)).toEqual([
      { slug: "scifi", count: 2, fromSet: false },
      { slug: "character-building", count: 3, fromSet: true },
      { slug: "gear", count: 1, fromSet: false }
    ]);
  });

  it("leaves out tags no table carries", () => {
    expect(tagTallies(set, [], vocabulary).map((tally) => tally.slug)).not.toContain("fantasy");
  });

  it("still lists a tag written into the Markdown that this instance does not know", () => {
    const stray = parseRollTables("### Odd\n<!-- tags: horror -->\n\n| d6 | R |\n| --- | --- |\n| 1-6 | x |\n");
    expect(tagTallies(stray, [], vocabulary)).toEqual([{ slug: "horror", count: 1, fromSet: false }]);
  });

  it("counts a table once even if it repeats a tag", () => {
    const repeated = parseRollTables("### Odd\n<!-- tags: gear, gear -->\n\n| d6 | R |\n| --- | --- |\n| 1-6 | x |\n");
    expect(tagTallies(repeated, [], vocabulary)).toEqual([{ slug: "gear", count: 1, fromSet: false }]);
  });
});

describe("filtering a set by tag", () => {
  const set = parseRollTables(`### One
<!-- tags: scifi -->

| d6 | Result |
| --- | --- |
| 1-6 | a |

### Two

| d6 | Result |
| --- | --- |
| 1-6 | b |
`);

  it("shows the whole set when nothing is chosen", () => {
    expect(tablesWithTag(set, [], "")).toHaveLength(2);
  });

  it("shows only the tables carrying the tag", () => {
    expect(tablesWithTag(set, [], "scifi").map((table) => table.name)).toEqual(["One"]);
  });

  it("shows the whole set for a set-level tag, since every table has it", () => {
    expect(tablesWithTag(set, ["fantasy"], "fantasy")).toHaveLength(2);
  });
});
