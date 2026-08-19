import { describe, expect, it } from "vitest";
import { parseRollTables, rowForRoll, rowText, tableSummary, unreachableRows } from "./roll-tables.js";

const source = `# **Rules**

## Character Creation

### Character Traits (d10)

| d10 | Physique | Vice |
| --- | --- | --- |
| 1 | Athletic | Aggressive |
| 2 | Brawny | Bitter |

### Starting Gear (d20)

#### Armor

| Roll | Armor |
| --- | --- |
| 1-3 | None |
| 4-14 | Brigandine |
| 15-19 | Chainmail |
| 20 | Plate |

#### Equipment List

| Item | Cost |
| --- | --- |
| Rope | 5gp |

## Generators

### D44 Quality

| D44 | Result |
| --- | --- |
| 11 | Indigo |
| 12 | Crimson |
| 44 | Inventors |

### Reaction

| Roll | Reaction |
| --- | --- |
| 1 | Hostile |
| 2 | Wary |
| 3 | Curious |
| 4 | Kind |
`;

describe("finding rollable tables in system Markdown", () => {
  const tables = parseRollTables(source);

  it("keeps only tables keyed by a die and ignores reference tables", () => {
    expect(tables.map((table) => table.name)).toEqual(["Character Traits (d10)", "Armor", "D44 Quality", "Reaction"]);
  });

  it("reads the die from the column heading", () => {
    expect(tables[0].dice).toBe("d10");
    expect(tables[0].columns).toEqual(["Physique", "Vice"]);
  });

  it("falls back to a die marked on a heading above the table", () => {
    const armor = tables[1];
    expect(armor.dice).toBe("d20");
    expect(armor.section).toBe("Character Creation · Starting Gear (d20)");
  });

  it("groups tables by the part of the book they sit in, ignoring the document title", () => {
    expect(tables.map((table) => table.category)).toEqual([
      "Character Creation",
      "Character Creation",
      "Generators",
      "Generators"
    ]);
  });

  it("treats chapter headings as categories when the document has no single title", () => {
    const chapters = parseRollTables(`# GROUP DEBT

| d12 | Debt |
| --- | --- |
| 1 | A moneylender |

# CAROUSING

### Mishaps

| d12 | Mishap |
| --- | --- |
| 1 | A brawl |
`);
    expect(chapters.map((table) => [table.name, table.category, table.section])).toEqual([
      ["GROUP DEBT", "GROUP DEBT", ""],
      ["Mishaps", "CAROUSING", "CAROUSING"]
    ]);
  });

  it("recognises compound dice from the values the rows cover", () => {
    expect(tables[2].dice).toBe("d44");
  });

  it("infers a plain die from a full 1-to-sides range", () => {
    expect(tables[3].dice).toBe("d4");
  });

  it("recognises and resolves d30 tables", () => {
    const [table] = parseRollTables(`### Omens

| D30 | Result |
| --- | --- |
| 1 | The first omen |
| 30 | The final omen |
`);
    expect(table.dice).toBe("d30");
    expect(rowForRoll(table, 30)?.cells).toEqual(["The final omen"]);
    expect(unreachableRows(table)).toBe(0);
  });

  it("reads, infers, and rolls a d5 table", () => {
    const [named] = parseRollTables(`### Watches

| D5 | Who is awake |
| --- | --- |
| 1 | Nobody, and something is at the fire |
| 2-4 | The one who drew the short straw |
| 5 | Everybody, and nobody will say why |
`);
    expect(named.dice).toBe("d5");
    expect(rowForRoll(named, 5)?.cells).toEqual(["Everybody, and nobody will say why"]);
    expect(unreachableRows(named)).toBe(0);

    // The rows imply the die when the column does not name it — 1 to 5 was not a
    // die this application had before, so such a table was not rollable at all.
    const [inferred] = parseRollTables(`### Watches

| Roll | Who is awake |
| --- | --- |
| 1 | Nobody |
| 5 | Everybody |
`);
    expect(inferred.dice).toBe("d5");
  });

  it("infers d30 from a heading marker when the die column only says Roll", () => {
    const [table] = parseRollTables(`### Omens (d30)

| Roll | Result |
| --- | --- |
| 1 | The first omen |
| 30 | The final omen |
`);
    expect(table.dice).toBe("d30");
  });

  it("drops surrounding emphasis from a table's derived display name", () => {
    const [table] = parseRollTables(`#### *3.6.1.1 Implant Complications*

| d6 | Result |
| --- | --- |
| 1 | A complication |
`);
    expect(table.name).toBe("3.6.1.1 Implant Complications");
  });

  it("flattens compact repeated Roll and Result pairs", () => {
    const [compact] = parseRollTables(`## Generators

### Names

| Roll | Result | Roll | Result |
| --- | --- | --- | --- |
| 1 | Ash | 4 | Moss |
| 2 | Bell | 5 | Pike |
| 3 | Crow | 6 | Vale |
`);
    expect(compact).toMatchObject({
      name: "Names",
      category: "Generators",
      dice: "d6",
      columns: ["Result"]
    });
    expect(compact.rows).toEqual([
      { label: "1", min: 1, max: 1, cells: ["Ash"] },
      { label: "2", min: 2, max: 2, cells: ["Bell"] },
      { label: "3", min: 3, max: 3, cells: ["Crow"] },
      { label: "4", min: 4, max: 4, cells: ["Moss"] },
      { label: "5", min: 5, max: 5, cells: ["Pike"] },
      { label: "6", min: 6, max: 6, cells: ["Vale"] }
    ]);
  });

  it("records the ranges each row covers", () => {
    expect(tables[1].rows).toEqual([
      { label: "1-3", min: 1, max: 3, cells: ["None"] },
      { label: "4-14", min: 4, max: 14, cells: ["Brigandine"] },
      { label: "15-19", min: 15, max: 19, cells: ["Chainmail"] },
      { label: "20", min: 20, max: 20, cells: ["Plate"] }
    ]);
  });

  it("gives every table an id that survives repeated headings", () => {
    const repeated = parseRollTables(`## Loot

### Trinkets

| d6 | Result |
| --- | --- |
| 1 | Bell |

### Trinkets

| d6 | Result |
| --- | --- |
| 1 | Coin |
`);
    expect(repeated.map((table) => table.id)).toEqual(["loot-trinkets", "loot-trinkets-2"]);
  });

  it("names tables that share a heading after their first result column", () => {
    const shared = parseRollTables(`### STARTING GEAR

| D6 | Signature Weapon |
| --- | --- |
| 1 HP | Hell Spitter |
| 2 HP | Vibro-Shank |

| D6 | What Happened? |
| --- | --- |
| 1 | Last man standing |
| 2 | Betrayal |
`);
    expect(shared.map((table) => table.name)).toEqual([
      "STARTING GEAR — Signature Weapon",
      "STARTING GEAR — What Happened?"
    ]);
    expect(shared.map((table) => table.id)).toEqual(["starting-gear-signature-weapon", "starting-gear-what-happened"]);
  });

  it("reads annotated die values once the source has named the die", () => {
    const [weapons] = parseRollTables(`### STARTING GEAR

| D6 | Signature Weapon |
| --- | --- |
| 1 HP | Hell Spitter |
| 2 HP | Vibro-Shank |
`);
    expect(weapons.rows.map((row) => [row.label, row.min])).toEqual([
      ["1 HP", 1],
      ["2 HP", 2]
    ]);
  });

  it("reads multi-die headings and modifier-open row labels", () => {
    const [reaction] = parseRollTables(`### Reaction

| 2d6 | Result |
| --- | --- |
| 2- | Hostile |
| 3-11 | Uncertain |
| 12+ | Helpful |
`);
    expect(reaction.dice).toBe("2d6");
    expect(rowForRoll(reaction, -5)?.cells).toEqual(["Hostile"]);
    expect(rowForRoll(reaction, 15)?.cells).toEqual(["Helpful"]);
  });

  it("reports rows the stated die cannot reach instead of changing the die", () => {
    const [hollowing] = parseRollTables(`### ASPECT DISTORTION

| D20 | HOLLOWING |
| --- | --- |
| 1 | Fingertips blacken |
| 20 | An entropy aspect |
| 21 | You cannot carry weapons |
| 22 | A non-euclidean aspect |
`);
    expect(hollowing.dice).toBe("d20");
    expect(unreachableRows(hollowing)).toBe(2);
    expect(tableSummary(hollowing).unreachableRows).toBe(2);
  });

  it("leaves out tables named in the system's exclusions", () => {
    expect(parseRollTables(source, ["Armor"]).map((table) => table.name)).not.toContain("Armor");
  });

  it("summarises a table without shipping its rows", () => {
    const summary = tableSummary(tables[1]);
    expect(summary.rowCount).toBe(4);
    expect(summary).not.toHaveProperty("rows");
  });
});

describe("resolving a roll against a table", () => {
  const tables = parseRollTables(source);

  it("matches the row whose range contains the roll", () => {
    expect(rowForRoll(tables[1], 1)?.cells).toEqual(["None"]);
    expect(rowForRoll(tables[1], 14)?.cells).toEqual(["Brigandine"]);
    expect(rowForRoll(tables[1], 20)?.cells).toEqual(["Plate"]);
  });

  it("reports no row when a table leaves a value uncovered", () => {
    expect(rowForRoll(tables[2], 13)).toBeNull();
    expect(rowText(tables[2], null)).toBe("");
  });

  it("labels the cells of a multi-column result", () => {
    expect(rowText(tables[0], rowForRoll(tables[0], 1))).toBe("Physique: Athletic · Vice: Aggressive");
  });

  it("returns a single-column result on its own", () => {
    expect(rowText(tables[1], rowForRoll(tables[1], 2))).toBe("None");
  });

  it("ignores empty cells", () => {
    const [table] = parseRollTables(`### Omens (d6)

| d6 | Sign | Note |
| --- | --- | --- |
| 1 | Crows | — |
`);
    expect(rowText(table, rowForRoll(table, 1))).toBe("Crows");
  });
});
