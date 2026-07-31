import type { RollTable, RollTableRow, RollTableSource, RollTableSummary, TableTag } from "./index.js";

/** Sides the dice engine can roll, largest first so inference prefers the widest match. */
export const SUPPORTED_DIE_SIDES = [100, 66, 44, 30, 20, 12, 10, 8, 6, 4] as const;
const dicePattern = /^(?:(\d{1,2})\s*)?d\s*(100|66|44|30|20|12|10|8|6|4)$/i;
const dieColumnNames = new Set(["roll", "die", "dice", "result of roll", "d"]);
/** How a table carries its own tags, kept in a comment so rendered Markdown is unchanged. */
const tagsComment = /^\s*<!--\s*tags:\s*([^>]*?)\s*-->\s*$/i;

function slug(value: string) {
  return (
    value
      .toLocaleLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "table"
  );
}

/**
 * Splits a pipe row into its cells. Monolith writes literal pipes inside cells as
 * "\|", as its injury tables do, so a delimiter only counts when it is unescaped.
 */
export function cells(line: string) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return null;
  const parts: string[] = [];
  let current = "";
  let closed = false;
  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (char === "\\" && trimmed[index + 1] === "|") {
      current += "|";
      index += 1;
      closed = false;
      continue;
    }
    if (char === "|") {
      parts.push(current);
      current = "";
      closed = true;
      continue;
    }
    current += char;
    closed = false;
  }
  parts.push(current);
  // A row always opens with a delimiter, and usually closes with one too.
  parts.shift();
  if (closed) parts.pop();
  return parts.map((cell) => cell.trim());
}

/** The inverse of the unescaping in `cells`, so a written cell survives a re-read. */
export function escapeCell(value: string) {
  return value.replace(/\|/g, "\\|");
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
  const exact = /^(\d{1,3})\s*(?:[-–—]\s*(\d{1,3}))?([+-])?$/.exec(cleaned);
  const leading = annotated ? /^(\d{1,3})\s*(?:[-–—]\s*(\d{1,3}))?([+-])?\b/.exec(cleaned) : null;
  const match = exact ?? leading;
  if (!match) return null;
  const value = Number(match[1]);
  // The books use "2-" and "20+" for totals opened by a modifier. Roll modifiers
  // are bounded to three digits, so these finite sentinels remain JSON-safe.
  if (match[3] === "-" || (/^\d+-$/.test(cleaned) && match[2] === undefined)) return { min: -1000, max: value };
  if (match[3] === "+") return { min: value, max: 1000 };
  const max = match[2] === undefined ? value : Number(match[2]);
  return max < value ? { min: max, max: value } : { min: value, max };
}

/**
 * The values a die-column label covers, for an editor that has to work out what
 * a row now means after someone has typed in it. Annotated labels are accepted,
 * because a table being edited already knows its die.
 */
export function parseRowLabel(label: string) {
  return rowRange(label, true);
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
  if (named) return `${named[1] ?? ""}d${named[2]}`;
  if (!dieColumnNames.has(dieColumn.toLocaleLowerCase())) return undefined;
  for (const heading of [...headings].reverse()) {
    const marker = /\(\s*d\s*(100|66|44|30|20|12|10|8|6|4)\s*\)/i.exec(heading);
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
  return SUPPORTED_DIE_SIDES.includes(highest as (typeof SUPPORTED_DIE_SIDES)[number]) ? `d${highest}` : undefined;
}

/** Tags a table names for itself, read from its `<!-- tags: ... -->` comment. */
function commentTags(line: string): TableTag[] {
  const match = tagsComment.exec(line);
  if (!match) return [];
  const seen = new Set<TableTag>();
  for (const entry of match[1].split(",")) {
    const tag = entry.trim().toLocaleLowerCase();
    if (tag) seen.add(tag);
  }
  return [...seen];
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
  const headings: { level: number; text: string; line: number }[] = [];
  const found: {
    path: string[];
    subject: string;
    dice: string;
    columns: string[];
    rows: RollTableRow[];
    tags: TableTag[];
    source: RollTableSource;
  }[] = [];
  // A tags comment speaks for the next table below it and is spent once read.
  let pendingTags: { tags: TableTag[]; line: number } | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(lines[index]);
    if (heading) {
      const level = heading[1].length;
      while (headings.length && headings[headings.length - 1].level >= level) headings.pop();
      headings.push({ level, text: heading[2].trim(), line: index });
      pendingTags = null;
      continue;
    }
    if (tagsComment.test(lines[index])) {
      pendingTags = { tags: commentTags(lines[index]), line: index };
      continue;
    }
    const header = cells(lines[index]);
    if (!header || header.length < 2 || !isSeparator(lines[index + 1] ?? "")) continue;

    const path = headings.map((item) => item.text);
    const stated = statedDice(header[0], path);
    // Some books save horizontal space by repeating Roll/Result pairs. Flatten
    // those pairs into the same one-roll-column shape used by the catalogue.
    const compactRollColumns = header.flatMap((label, position) =>
      dieColumnNames.has(label.trim().toLocaleLowerCase()) && position + 1 < header.length ? [position] : []
    );
    const compact =
      compactRollColumns.length > 1 &&
      compactRollColumns.every((position, pair) => position === pair * 2) &&
      compactRollColumns.every((position) => Boolean(header[position + 1]?.trim()));
    const parsed: RollTableRow[] = [];
    let cursor = index + 2;
    for (; cursor < lines.length; cursor += 1) {
      const row = cells(lines[cursor]);
      if (!row) break;
      if (compact) {
        for (const position of compactRollColumns) {
          const label = row[position] ?? "";
          const range = rowRange(label, Boolean(stated));
          if (!range) continue;
          parsed.push({ label, min: range.min, max: range.max, cells: [row[position + 1] ?? ""] });
        }
      } else {
        const range = rowRange(row[0], Boolean(stated));
        if (!range) continue;
        parsed.push({ label: row[0], min: range.min, max: range.max, cells: row.slice(1) });
      }
    }
    if (compact) parsed.sort((left, right) => left.min - right.min || left.max - right.max);
    const tableStart = index;
    const tableEnd = cursor - 1;
    const owning = headings[headings.length - 1];
    const tags = pendingTags?.tags ?? [];
    const tagsLine = pendingTags?.line ?? null;
    pendingTags = null;
    index = cursor - 1;

    const dice = stated ?? inferredDice(header[0], parsed);
    const owningHeading = path[path.length - 1] ?? "Table";
    if (!dice || !parsed.length || blocked.has(owningHeading.toLocaleLowerCase())) continue;
    found.push({
      path,
      subject: header[1]?.trim() ?? "",
      dice,
      columns: compact ? [header[1]] : header.slice(1),
      rows: parsed,
      tags,
      source: {
        heading: owning ? { line: owning.line, level: owning.level, text: owning.text } : null,
        headingPath: path,
        tagsLine,
        tableStart,
        tableEnd,
        dieColumn: header[0],
        dice,
        soleTable: true
      }
    });
  }

  // Several tables often share one heading, as every Monolith background does.
  // Where that happens the first result column names the subject, so it is what
  // tells them apart in the switcher.
  const perHeading = new Map<string, number>();
  for (const table of found) perHeading.set(table.path.join("/"), (perHeading.get(table.path.join("/")) ?? 0) + 1);

  const usedIds = new Set<string>();
  return found.map(({ path, subject, dice, columns, rows, tags, source }) => {
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
      tags,
      rows,
      source: { ...source, soleTable: !shared }
    };
  });
}

export function diceMaximum(dice: string) {
  const compound = /^d(44|66)$/.exec(dice);
  if (compound) return Number(compound[1]);
  const match = /^(\d*)d(\d+)$/.exec(dice);
  if (!match) return 0;
  return Number(match[1] || 1) * Number(match[2]);
}

export function diceMinimum(dice: string) {
  if (dice === "d44" || dice === "d66") return 11;
  const match = /^(\d*)d\d+$/.exec(dice);
  return match ? Number(match[1] || 1) : 1;
}

/**
 * Rows the stated die cannot reach. Source mismatches are reported rather than
 * silently changing either the stated die or the authored rows.
 */
export function unreachableRows(table: RollTable) {
  const maximum = diceMaximum(table.dice);
  return table.rows.filter((row) => row.min > maximum).length;
}

export function tableSummary(table: RollTable): RollTableSummary {
  const { rows, source, ...rest } = table;
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
