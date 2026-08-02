/**
 * Reading the priced tables the rulebooks use for gear, parts, and augments.
 *
 * Every such table pairs a name column with a cost column, and the name column's
 * heading says what the rows are. Some tables set two of those pairs side by side
 * to save page space, so a row can describe more than one item.
 */

import { closingParen } from "@devils-toys/shared";

export interface PricedRow {
  category: string;
  cell: string;
  cost: string;
}

export interface SplitCell {
  name: string;
  spec: string;
  detail: string;
}

export function plain(value: string) {
  return value.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Splits a row into the name, the parenthetical the book gives it, and the
 * description that follows.
 *
 * The book writes rows two ways. A module leads with its name and spec —
 * "Hellfire Turret (D8) Critical Effect: Overheat" — while quarters bold the
 * name and end it with a colon, as "**Crew Quarters:** Rest comfortably…". The
 * emphasised span is therefore where the name ends when one is present.
 */
export function splitPricedCell(cell: string): SplitCell {
  const bold = /^\s*\*\*(.+?)\*\*(.*)$/s.exec(cell);
  const head = plain(bold ? bold[1] : cell);
  const tail = plain(bold ? bold[2] : "");

  const open = head.indexOf("(");
  const close = open < 0 ? -1 : closingParen(head, open);
  const name = (close < 0 ? head : head.slice(0, open)).trim().replace(/:$/, "");
  const spec = close < 0 ? "" : head.slice(open + 1, close).trim();
  const trailing = close < 0 ? "" : head.slice(close + 1).trim();
  const detail = [trailing, tail].filter(Boolean).join(" ").replace(/^:\s*/, "").trim();
  return { name, spec, detail };
}

export function rowCells(line: string) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return null;
  return trimmed
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isSeparator(line: string) {
  const cells = rowCells(line);
  return Boolean(cells?.length && cells.every((cell) => /^:?-{2,}:?$/.test(cell)));
}

function isCost(cell: string | undefined) {
  return plain(cell ?? "").toLocaleLowerCase() === "cost";
}

function headingLevel(line: string) {
  return /^(#+)\s+/.exec(line)?.[1].length;
}

function headingText(line: string) {
  return /^#+\s+(.+?)\s*$/.exec(line)?.[1].trim().toLocaleLowerCase();
}

/** The lines belonging to a heading, up to the next heading of the same rank or higher. */
export function sectionLines(lines: readonly string[], heading: string) {
  const start = lines.findIndex((line) => headingText(line) === heading.toLocaleLowerCase());
  if (start < 0) return [];
  const rootLevel = headingLevel(lines[start])!;
  const end = lines.findIndex((line, index) => index > start && (headingLevel(line) ?? 99) <= rootLevel);
  return lines.slice(start + 1, end < 0 ? lines.length : end);
}

/**
 * Every priced row under a heading, in book order. Name/cost column pairs beyond
 * the first are read as further items in the same category.
 */
export function readPricedRows(markdown: string, heading: string): PricedRow[] {
  const lines = sectionLines(markdown.split("\n"), heading);
  const rows: PricedRow[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const header = rowCells(lines[index]);
    if (!header || header.length < 2 || !isSeparator(lines[index + 1] ?? "")) continue;
    if (!isCost(header[1])) continue;

    // Column pairs are (name, cost); a wide table repeats that pair across the row.
    const pairs = Math.floor(header.length / 2);
    const category = plain(header[0]);

    for (index += 2; index < lines.length; index += 1) {
      const row = rowCells(lines[index]);
      if (!row) break;
      for (let pair = 0; pair < pairs; pair += 1) {
        const cell = row[pair * 2];
        if (cell === undefined) continue;
        rows.push({ category, cell, cost: plain(row[pair * 2 + 1] ?? "") });
      }
    }
    index -= 1;
  }

  return rows;
}
