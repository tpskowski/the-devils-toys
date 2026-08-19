import type { RollTable, RollTableRow, TableTag } from "./index.js";
import { DIE_SIDES_PATTERN, parseRowLabel, SUPPORTED_DIE_SIDES } from "./roll-tables.js";

/**
 * CSV in and out. A spreadsheet is how most people already have their tables, so
 * the shape asked for is the shape a spreadsheet naturally produces: one row per
 * table row, with the table's own details repeated or left blank.
 *
 *   table,dice,tags,roll,<result columns…>
 *
 * `table`, `dice`, and `tags` are read from the first row of each table's group
 * and may be left empty afterwards. Every column after `roll` becomes a result
 * column, named by its heading.
 */

export const CSV_FIXED_COLUMNS = ["table", "dice", "tags", "roll"] as const;

export const SAMPLE_CSV = `table,dice,tags,roll,Rumour,Who says so
Rumours in the market,d6,"fantasy, random-encounter",1,The well has gone bitter,A carter
Rumours in the market,,,2,Bread has doubled in price,The baker
Rumours in the market,,,3-4,A stranger has been asking after you,A child
Rumours in the market,,,5,The lord's men rode out and did not come back,A widow
Rumours in the market,,,6,Something is living in the old mill,Nobody sober
Wilderness omens,d4,fantasy,1,Crows circling with nothing beneath them,
Wilderness omens,,,2,A cairn that was not there yesterday,
Wilderness omens,,,3,Water running the wrong way,
Wilderness omens,,,4,No birdsong at all,
`;

/** One RFC 4180 record at a time: quoted fields may hold commas and newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  // A byte-order mark from a spreadsheet would otherwise become part of the
  // first heading, and "﻿table" matches nothing.
  const source = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char !== '"') {
        field += char;
        continue;
      }
      if (source[index + 1] === '"') {
        field += '"';
        index += 1;
        continue;
      }
      quoted = false;
      continue;
    }
    if (char === '"' && field === "") {
      quoted = true;
      continue;
    }
    if (char === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    field += char;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((entry) => entry.some((cell) => cell.trim() !== ""));
}

function csvField(value: string) {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export interface CsvProblem {
  /** The line in the file, counting the heading as line 1. */
  line: number;
  message: string;
}

export interface CsvImport {
  tables: RollTable[];
  problems: CsvProblem[];
}

function inferDice(rows: RollTableRow[]) {
  const highest = Math.max(...rows.map((row) => row.max));
  const lowest = Math.min(...rows.map((row) => row.min));
  if (lowest >= 11 && rows.every((row) => [row.min, row.max].every(isCompoundValue))) {
    const digits = Math.max(...rows.flatMap((row) => [row.min, row.max]).map((value) => Math.floor(value / 10)));
    return digits <= 4 ? "d44" : "d66";
  }
  const match = SUPPORTED_DIE_SIDES.find((sides) => sides === highest);
  return match ? `d${match}` : undefined;
}

function isCompoundValue(value: number) {
  const tens = Math.floor(value / 10);
  const ones = value % 10;
  return value >= 11 && tens >= 1 && tens <= 6 && ones >= 1 && ones <= 6;
}

/** Reads a CSV into tables, reporting what it could not use rather than guessing. */
export function tablesFromCsv(text: string): CsvImport {
  const rows = parseCsv(text);
  const problems: CsvProblem[] = [];
  if (!rows.length) return { tables: [], problems: [{ line: 1, message: "The file is empty." }] };

  const headings = rows[0].map((cell) => cell.trim());
  const lower = headings.map((cell) => cell.toLocaleLowerCase());
  for (const [position, expected] of CSV_FIXED_COLUMNS.entries()) {
    if (lower[position] !== expected) {
      return {
        tables: [],
        problems: [
          {
            line: 1,
            message: `The first four columns must be ${CSV_FIXED_COLUMNS.join(", ")}. Column ${position + 1} is "${headings[position] ?? ""}".`
          }
        ]
      };
    }
  }
  const columns = headings.slice(CSV_FIXED_COLUMNS.length).map((heading, index) => heading || `Column ${index + 1}`);
  if (!columns.length)
    return { tables: [], problems: [{ line: 1, message: 'Add at least one result column after "roll".' }] };

  const order: string[] = [];
  const groups = new Map<string, { dice: string; tags: TableTag[]; rows: RollTableRow[] }>();

  for (const [position, record] of rows.slice(1).entries()) {
    const line = position + 2;
    const [name, dice, tags, roll] = CSV_FIXED_COLUMNS.map((_, index) => (record[index] ?? "").trim());
    const key = name || order.at(-1) || "";
    if (!key) {
      problems.push({ line, message: "This row has no table name and no table above it." });
      continue;
    }
    if (!groups.has(key)) {
      order.push(key);
      groups.set(key, { dice: "", tags: [], rows: [] });
    }
    const group = groups.get(key)!;
    if (dice && !group.dice) group.dice = dice.toLocaleLowerCase().replace(/\s+/g, "");
    if (tags && !group.tags.length)
      group.tags = [
        ...new Set(
          tags
            .split(/[,;]/)
            .map((tag) => tag.trim().toLocaleLowerCase())
            .filter(Boolean)
        )
      ];

    const range = parseRowLabel(roll);
    if (!range) {
      problems.push({ line, message: `"${roll}" is not a die value or range.` });
      continue;
    }
    group.rows.push({
      label: roll,
      min: range.min,
      max: range.max,
      cells: columns.map((_, index) => (record[CSV_FIXED_COLUMNS.length + index] ?? "").trim())
    });
  }

  const tables: RollTable[] = [];
  for (const name of order) {
    const group = groups.get(name)!;
    if (!group.rows.length) {
      problems.push({ line: 1, message: `"${name}" has no usable rows.` });
      continue;
    }
    const dice = group.dice || inferDice(group.rows);
    if (!dice) {
      problems.push({ line: 1, message: `"${name}" needs a die; its rows do not say which one.` });
      continue;
    }
    if (!new RegExp(`^d(${DIE_SIDES_PATTERN})$`).test(dice)) {
      problems.push({ line: 1, message: `"${name}" asks for ${dice}, which is not a die this can roll.` });
      continue;
    }
    tables.push({
      id: "",
      name,
      section: "",
      category: name,
      dice,
      columns,
      tags: group.tags,
      rows: group.rows
    });
  }

  return { tables, problems };
}

/** One table as CSV, in the same shape the importer reads. */
export function tableToCsv(table: RollTable): string {
  const lines = [[...CSV_FIXED_COLUMNS, ...table.columns].map(csvField).join(",")];
  for (const [index, row] of table.rows.entries()) {
    const lead = index === 0 ? [table.name, table.dice, table.tags.join(", ")] : ["", "", ""];
    const cells = table.columns.map((_, column) => row.cells[column] ?? "");
    lines.push([...lead, row.label, ...cells].map(csvField).join(","));
  }
  return `${lines.join("\n")}\n`;
}
