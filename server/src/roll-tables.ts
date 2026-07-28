import type { RollTable, RollTableRow, RollTableSummary } from "@devils-toys/shared";

/** Sides the dice engine can roll, largest first so inference prefers the widest match. */
const supportedSides = [100, 66, 44, 20, 12, 10, 8, 6, 4] as const;
const dicePattern = /^d\s*(100|66|44|20|12|10|8|6|4)$/i;
const dieColumnNames = new Set(["roll", "die", "dice", "result of roll", "d"]);

function slug(value: string) {
  return (
    value
      .toLocaleLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "table"
  );
}

function cells(line: string) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return null;
  return trimmed
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isSeparator(line: string) {
  const parts = cells(line);
  return Boolean(parts?.length && parts.every((part) => /^:?-{2,}:?$/.test(part)));
}

/**
 * Reads "12", "4-14", "01–05", or a compound "11" into the values it covers.
 * Once the die is known from a heading the source may annotate the value, as
 * Monolith's signature weapon tables do with "1 HP", so trailing text is only
 * tolerated when a table has already proved itself rollable.
 */
function rowRange(label: string, annotated = false) {
  const cleaned = label.replace(/\s+/g, " ").trim();
  const match = (annotated ? /^(\d{1,3})\s*(?:[-–—]\s*(\d{1,3}))?\b/ : /^(\d{1,3})\s*(?:[-–—]\s*(\d{1,3}))?$/).exec(
    cleaned
  );
  if (!match) return null;
  const min = Number(match[1]);
  const max = match[2] === undefined ? min : Number(match[2]);
  return max < min ? { min: max, max: min } : { min, max };
}

/** Compound dice read as digit pairs, so d44 covers 11–44 using digits 1–4 only. */
function compoundSides(rows: { min: number; max: number }[]) {
  for (const sides of [4, 6] as const) {
    const digits = rows.every(({ min, max }) =>
      [min, max].every((value) => {
        const tens = Math.floor(value / 10);
        const ones = value % 10;
        return value >= 11 && tens >= 1 && tens <= sides && ones >= 1 && ones <= sides;
      })
    );
    if (digits) return sides === 4 ? "d44" : "d66";
  }
  return undefined;
}

/**
 * What the source says to roll: the die column heading is authoritative, then a
 * "(d20)" marker on any heading above the table.
 */
function statedDice(dieColumn: string, headings: string[]) {
  const named = dicePattern.exec(dieColumn.replace(/\s+/g, ""));
  if (named) return `d${named[1]}`;
  if (!dieColumnNames.has(dieColumn.toLocaleLowerCase())) return undefined;
  for (const heading of [...headings].reverse()) {
    const marker = /\(\s*d\s*(100|66|44|20|12|10|8|6|4)\s*\)/i.exec(heading);
    if (marker) return `d${marker[1]}`;
  }
  return undefined;
}

/** What the rows imply when the source names no die at all. */
function inferredDice(dieColumn: string, rows: { min: number; max: number }[]) {
  if (!dieColumnNames.has(dieColumn.toLocaleLowerCase()) || !rows.length) return undefined;
  const compound = compoundSides(rows);
  if (compound) return compound;
  const lowest = Math.min(...rows.map((row) => row.min));
  const highest = Math.max(...rows.map((row) => row.max));
  if (lowest !== 1) return undefined;
  return supportedSides.includes(highest as (typeof supportedSides)[number]) ? `d${highest}` : undefined;
}

/**
 * Extracts every rollable table from a Markdown document. A table qualifies when
 * its first column is a die and its rows are keyed by die values, which leaves
 * reference tables such as equipment lists out of the catalogue.
 */
export function parseRollTables(markdown: string, exclude: readonly string[] = []): RollTable[] {
  const blocked = new Set(exclude.map((name) => name.trim().toLocaleLowerCase()));
  const lines = markdown.split("\n");
  // A document with a single top-level heading is titled by it, as Cairn is, and
  // that title says nothing about where a table sits. Monolith instead uses top
  // level headings for its chapters, which are exactly the grouping wanted.
  const topLevel = lines.filter((line) => /^#\s+\S/.test(line));
  const documentTitle = topLevel.length === 1 ? /^#\s+(.+?)\s*$/.exec(topLevel[0])![1].trim() : undefined;
  const headings: { level: number; text: string }[] = [];
  const found: { path: string[]; subject: string; dice: string; columns: string[]; rows: RollTableRow[] }[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(lines[index]);
    if (heading) {
      const level = heading[1].length;
      while (headings.length && headings[headings.length - 1].level >= level) headings.pop();
      headings.push({ level, text: heading[2].trim() });
      continue;
    }
    const header = cells(lines[index]);
    if (!header || header.length < 2 || !isSeparator(lines[index + 1] ?? "")) continue;

    const path = headings.map((item) => item.text);
    const stated = statedDice(header[0], path);
    const parsed: RollTableRow[] = [];
    let cursor = index + 2;
    for (; cursor < lines.length; cursor += 1) {
      const row = cells(lines[cursor]);
      if (!row) break;
      const range = rowRange(row[0], Boolean(stated));
      if (!range) continue;
      parsed.push({ label: row[0], min: range.min, max: range.max, cells: row.slice(1) });
    }
    index = cursor - 1;

    const dice = stated ?? inferredDice(header[0], parsed);
    const owningHeading = path[path.length - 1] ?? "Table";
    if (!dice || !parsed.length || blocked.has(owningHeading.toLocaleLowerCase())) continue;
    found.push({ path, subject: header[1]?.trim() ?? "", dice, columns: header.slice(1), rows: parsed });
  }

  // Several tables often share one heading, as every Monolith background does.
  // Where that happens the first result column names the subject, so it is what
  // tells them apart in the switcher.
  const perHeading = new Map<string, number>();
  for (const table of found) perHeading.set(table.path.join("/"), (perHeading.get(table.path.join("/")) ?? 0) + 1);

  const usedIds = new Set<string>();
  return found.map(({ path, subject, dice, columns, rows }) => {
    const owningHeading = path[path.length - 1] ?? "Table";
    const shared = (perHeading.get(path.join("/")) ?? 0) > 1;
    const name =
      shared && subject && subject.toLocaleLowerCase() !== "result" ? `${owningHeading} — ${subject}` : owningHeading;
    const base = slug([...path.slice(0, -1), name].join("-"));
    let id = base;
    for (let suffix = 2; usedIds.has(id); suffix += 1) id = `${base}-${suffix}`;
    usedIds.add(id);

    // A table with no heading above it is its own part of the book, the way
    // Monolith's one-table GROUP DEBT chapter is.
    const ancestors = path.slice(0, -1).filter((entry, position) => !(position === 0 && entry === documentTitle));
    return {
      id,
      name,
      section: ancestors.join(" · "),
      category: ancestors[0] ?? owningHeading,
      dice,
      columns,
      tags: [],
      rows
    };
  });
}

export function diceMaximum(dice: string) {
  return Number(dice.slice(1));
}

/**
 * Rows the stated die cannot reach. Monolith's hollowing table is written with a
 * D20 heading over thirty rows, and the GM is better served by being told than
 * by having the die quietly changed for them.
 */
export function unreachableRows(table: RollTable) {
  const maximum = diceMaximum(table.dice);
  return table.rows.filter((row) => row.min > maximum).length;
}

export function tableSummary(table: RollTable): RollTableSummary {
  const { rows, ...rest } = table;
  return { ...rest, rowCount: rows.length, unreachableRows: unreachableRows(table) };
}

export function rowForRoll(table: RollTable, total: number) {
  return table.rows.find((row) => total >= row.min && total <= row.max) ?? null;
}

/** One line describing a result, labelling cells when a table has several columns. */
export function rowText(table: RollTable, row: RollTableRow | null) {
  if (!row) return "";
  const filled = row.cells.map((cell, position) => ({ cell: cell.trim(), column: table.columns[position] ?? "" }));
  const values = filled.filter((entry) => entry.cell && entry.cell !== "-" && entry.cell !== "—");
  if (!values.length) return "";
  if (values.length === 1) return values[0].cell;
  return values.map((entry) => (entry.column ? `${entry.column}: ${entry.cell}` : entry.cell)).join(" · ");
}
