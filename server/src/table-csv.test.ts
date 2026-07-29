import { describe, expect, it } from "vitest";
import { parseCsv, parseRollTables, SAMPLE_CSV, serializeSet, tablesFromCsv, tableToCsv } from "@devils-toys/shared";

describe("reading CSV", () => {
  it("keeps commas, quotes, and newlines inside a quoted field", () => {
    expect(parseCsv('a,"b,c","d""e","f\ng"\n')).toEqual([["a", "b,c", 'd"e', "f\ng"]]);
  });

  it("reads CRLF files and drops a byte-order mark", () => {
    expect(parseCsv("﻿table,dice\r\nOne,d6\r\n")).toEqual([
      ["table", "dice"],
      ["One", "d6"]
    ]);
  });

  it("ignores blank lines", () => {
    expect(parseCsv("a,b\n\n\nc,d\n")).toEqual([
      ["a", "b"],
      ["c", "d"]
    ]);
  });
});

describe("turning CSV into tables", () => {
  const { tables, problems } = tablesFromCsv(SAMPLE_CSV);

  it("reads the sample template without complaint", () => {
    expect(problems).toEqual([]);
    expect(tables.map((table) => table.name)).toEqual(["Rumours in the market", "Wilderness omens"]);
  });

  it("takes the die, tags, and columns from the first row of each group", () => {
    expect(tables[0].dice).toBe("d6");
    expect(tables[0].tags).toEqual(["fantasy", "random-encounter"]);
    expect(tables[0].columns).toEqual(["Rumour", "Who says so"]);
    expect(tables[1].tags).toEqual(["fantasy"]);
  });

  it("reads ranges as well as single values", () => {
    expect(tables[0].rows.map((row) => [row.label, row.min, row.max])).toContainEqual(["3-4", 3, 4]);
  });

  it("works out the die when the file does not say", () => {
    const rows = Array.from({ length: 6 }, (_, index) => `Omens,,,${index + 1},result ${index + 1}`);
    const { tables: guessed } = tablesFromCsv(`table,dice,tags,roll,Result\n${rows.join("\n")}\n`);
    expect(guessed[0].dice).toBe("d6");
  });

  it("asks for a die when the values do not name one", () => {
    const { tables: none, problems: found } = tablesFromCsv("table,dice,tags,roll,Result\nOmens,,,1,a\nOmens,,,2,b\n");
    expect(none).toEqual([]);
    expect(found[0].message).toContain("needs a die");
  });

  it("reads a digit-pair die from its values", () => {
    const rows = ["table,dice,tags,roll,Result"];
    for (let tens = 1; tens <= 4; tens += 1)
      for (let ones = 1; ones <= 4; ones += 1) rows.push(`Quality,,,${tens}${ones},x`);
    expect(tablesFromCsv(`${rows.join("\n")}\n`).tables[0].dice).toBe("d44");
  });

  it("names the line of a row it cannot read, and keeps the rest", () => {
    const { tables: partial, problems: found } = tablesFromCsv(
      "table,dice,tags,roll,Result\nOmens,d6,,1,a\nOmens,,,later,b\nOmens,,,3,c\n"
    );
    expect(found).toEqual([{ line: 3, message: '"later" is not a die value or range.' }]);
    expect(partial[0].rows.map((row) => row.label)).toEqual(["1", "3"]);
  });

  it("refuses a file whose fixed columns are wrong", () => {
    const { tables: none, problems: found } = tablesFromCsv("name,die,tags,roll,Result\nOmens,d6,,1,a\n");
    expect(none).toEqual([]);
    expect(found[0].message).toContain("must be table, dice, tags, roll");
  });

  it("refuses a die it cannot roll", () => {
    const { problems: found } = tablesFromCsv("table,dice,tags,roll,Result\nOmens,d7,,1,a\n");
    expect(found[0].message).toContain("not a die this can roll");
  });

  it("refuses a row with no table above it", () => {
    const { problems: found } = tablesFromCsv("table,dice,tags,roll,Result\n,,,1,a\n");
    expect(found[0].message).toContain("no table name");
  });
});

describe("CSV and Markdown together", () => {
  it("becomes Markdown that parses back to the same tables", () => {
    const { tables } = tablesFromCsv(SAMPLE_CSV);
    const parsed = parseRollTables(serializeSet(tables, "Imported"));
    expect(parsed.map((table) => [table.name, table.dice, table.rows.length])).toEqual([
      ["Rumours in the market", "d6", 5],
      ["Wilderness omens", "d4", 4]
    ]);
    expect(parsed[0].tags).toEqual(["fantasy", "random-encounter"]);
    expect(parsed[0].columns).toEqual(["Rumour", "Who says so"]);
  });

  it("writes a table out as CSV that reads back unchanged", () => {
    const [table] = tablesFromCsv(SAMPLE_CSV).tables;
    const [again] = tablesFromCsv(tableToCsv(table)).tables;
    expect(again).toEqual(table);
  });

  it("survives a cell holding a comma and a quote", () => {
    const [table] = tablesFromCsv(SAMPLE_CSV).tables;
    const awkward = { ...table, rows: [{ label: "1", min: 1, max: 1, cells: ['A "friend", of sorts', ""] }] };
    expect(tablesFromCsv(tableToCsv(awkward)).tables[0].rows[0].cells[0]).toBe('A "friend", of sorts');
  });
});
