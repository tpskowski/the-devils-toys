import fs from "node:fs";
import path from "node:path";
import { parseSet } from "./table-json-lib.ts";

const input = process.argv[process.argv.indexOf("--in") + 1];
const jsonPath = process.argv[process.argv.indexOf("--json") + 1];
if (!input || !jsonPath) throw new Error("Use --in <markdown> --json <document>.");

const markdown = fs.readFileSync(path.resolve(input), "utf8");
const lines = markdown.split("\n");
const document = JSON.parse(fs.readFileSync(path.resolve(jsonPath), "utf8"));
const parsed = parseSet(markdown, { setName: document.setName ?? "Imported" });
if (parsed.tables.length !== document.tables?.length) throw new Error("JSON table count differs from Markdown.");

function sourceCells(line: string) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return null;
  const result: string[] = [];
  let cell = "";
  let closed = false;
  for (let index = 0; index < trimmed.length; index += 1) {
    const character = trimmed[index];
    if (character === "\\" && trimmed[index + 1] === "|") {
      cell += "|";
      index += 1;
      closed = false;
    } else if (character === "|") {
      result.push(cell.trim());
      cell = "";
      closed = true;
    } else {
      cell += character;
      closed = false;
    }
  }
  result.push(cell.trim());
  result.shift();
  if (closed) result.pop();
  return result;
}

function sourceRange(label: string) {
  const cleaned = label.replace(/\s+/g, " ").trim();
  const match = /^(\d{1,3})\s*(?:[-–—]\s*(\d{1,3}))?([+-])?(?:\s+.*)?$/.exec(cleaned);
  if (!match) return null;
  const first = Number(match[1]);
  if (match[3] === "-" || (/^\d+-$/.test(cleaned) && match[2] === undefined)) return { min: -1000, max: first };
  if (match[3] === "+") return { min: first, max: 1000 };
  const second = match[2] === undefined ? first : Number(match[2]);
  return second < first ? { min: second, max: first } : { min: first, max: second };
}

function physicalRows(table: any, header: string[]) {
  const rows = lines
    .slice(table.origin.tableStart + 2, table.origin.tableEnd + 1)
    .map(sourceCells)
    .filter((row): row is string[] => Boolean(row));
  const rollColumns = header.flatMap((label, position) =>
    ["roll", "die", "dice", "result of roll", "d"].includes(label.toLocaleLowerCase()) ? [position] : []
  );
  const compact =
    rollColumns.length > 1 &&
    rollColumns.every((position, pair) => position === pair * 2) &&
    rollColumns.every((position) => Boolean(header[position + 1]?.trim()));
  if (!compact) return rows.filter((row) => sourceRange(row[0] ?? ""));
  return rows
    .flatMap((row) => rollColumns.map((position) => [row[position] ?? "", row[position + 1] ?? ""]))
    .filter((row) => sourceRange(row[0]))
    .sort((left, right) => sourceRange(left[0])!.min - sourceRange(right[0])!.min);
}

function verifyPhysicalSource(table: any) {
  const origin = table.origin;
  if (!origin || !Number.isInteger(origin.tableStart) || !Number.isInteger(origin.tableEnd))
    throw new Error(`Table ${table.id} has no valid source boundaries.`);
  if (origin.tableStart < 0 || origin.tableEnd < origin.tableStart + 2 || origin.tableEnd >= lines.length)
    throw new Error(`Table ${table.id} has source boundaries outside the Markdown document.`);
  if (origin.heading && (!Number.isInteger(origin.heading.line) || origin.heading.line < 0 || origin.heading.line >= origin.tableStart))
    throw new Error(`Table ${table.id} has an invalid heading origin.`);
  if (origin.tagsLine !== null && origin.tagsLine !== undefined &&
      (!Number.isInteger(origin.tagsLine) || origin.tagsLine < 0 || origin.tagsLine >= origin.tableStart))
    throw new Error(`Table ${table.id} has an invalid tags origin.`);
  if (!/^\d*d(?:100|66|44|30|20|12|10|8|6|4)$/.test(String(table.dice)))
    throw new Error(`Table ${table.id} has an invalid die expression.`);

  const header = sourceCells(lines[origin.tableStart]);
  const separator = sourceCells(lines[origin.tableStart + 1]);
  if (!header || !separator?.length || !separator.every((cell) => /^:?-{2,}:?$/.test(cell)))
    throw new Error(`Table ${table.id} does not point to a physical Markdown table.`);
  const sourceRows = physicalRows(table, header);
  if (sourceRows.length !== table.rows.length) throw new Error(`Table ${table.id} has a physical row-count mismatch.`);

  for (let index = 0; index < table.rows.length; index += 1) {
    const row = table.rows[index];
    const source = sourceRows[index];
    if (JSON.stringify([row.label, ...row.cells]) !== JSON.stringify(source))
      throw new Error(`Table ${table.id} row ${index + 1} differs from its physical Markdown cells.`);
    const range = sourceRange(source[0]);
    if (!range || range.min !== row.min || range.max !== row.max)
      throw new Error(`Table ${table.id} row ${index + 1} has invalid derived bounds.`);
    if (row.min > row.max) throw new Error(`Table ${table.id} has an inverted row range.`);
    if (index && row.min <= table.rows[index - 1].max)
      throw new Error(`Table ${table.id} has overlapping or unordered row ranges.`);
  }
}

let previousSourceEnd = -1;
for (let index = 0; index < parsed.tables.length; index += 1) {
  const expected = parsed.tables[index];
  const actual = document.tables[index];
  const comparable = (table: typeof expected) => {
    const { origin: _origin, classification: _classification, ...rest } = table;
    return rest;
  };
  if (JSON.stringify(comparable(expected)) !== JSON.stringify(comparable(actual))) {
    throw new Error(`Table ${index} differs from the Markdown parse.`);
  }
  verifyPhysicalSource(actual);
  if (actual.origin.tableStart <= previousSourceEnd)
    throw new Error(`Table ${actual.id} has an overlapping or unordered source range.`);
  previousSourceEnd = actual.origin.tableEnd;
}
