import type { RollTable, RollTableRow, TableTag } from "./index.js";
import { escapeCell } from "./roll-tables.js";

/**
 * Writing tables back out. The parser is deliberately forgiving about how a
 * source document is laid out, so this is not a byte-exact inverse of it: an
 * edited table is re-emitted in one canonical style. What it does guarantee is
 * that re-reading the result gives back the same table, and that every line
 * outside the table being written is left exactly as it was.
 */

const DEFAULT_HEADING_LEVEL = 3;

function tagsCommentLine(tags: readonly TableTag[]) {
  return tags.length ? `<!-- tags: ${[...tags].join(", ")} -->` : null;
}

function pipeRow(values: readonly string[]) {
  return `| ${values.map((value) => escapeCell(value.trim())).join(" | ")} |`;
}

/**
 * The die column as it should be written. A table whose die has not been touched
 * keeps the heading the source gave it, so an edit to one row does not silently
 * rewrite a "Roll" column into "d20".
 */
function dieColumn(table: RollTable) {
  const source = table.source;
  return source && source.dice === table.dice ? source.dieColumn : table.dice;
}

function rowCells(row: RollTableRow, columns: number) {
  const filled = [...row.cells];
  while (filled.length < columns) filled.push("");
  return filled.slice(0, columns);
}

/** The pipe table on its own: header, separator, and one line per row. */
export function tableLines(table: RollTable): string[] {
  const header = [dieColumn(table), ...table.columns];
  return [
    pipeRow(header),
    `| ${header.map(() => "---").join(" | ")} |`,
    ...table.rows.map((row) => pipeRow([row.label, ...rowCells(row, table.columns.length)]))
  ];
}

/** A whole table as Markdown: its heading, its tags, then the table itself. */
export function serializeTable(table: RollTable, level = DEFAULT_HEADING_LEVEL): string[] {
  const comment = tagsCommentLine(table.tags);
  return [`${"#".repeat(level)} ${table.name}`, "", ...(comment ? [comment] : []), ...tableLines(table), ""];
}

/**
 * Rewrites one table in place. Edits are applied from the bottom of the document
 * upwards so that earlier line numbers stay valid, and nothing between the
 * heading and the table — prose, notes, anything — is disturbed.
 */
export function spliceTable(markdown: string, table: RollTable): string {
  const source = table.source;
  if (!source) throw new Error(`Table "${table.name}" was not parsed from this document.`);
  const lines = markdown.split("\n");

  lines.splice(source.tableStart, source.tableEnd - source.tableStart + 1, ...tableLines(table));

  const comment = tagsCommentLine(table.tags);
  if (source.tagsLine !== null) {
    if (comment) lines[source.tagsLine] = comment;
    else lines.splice(source.tagsLine, 1);
  } else if (comment) {
    lines.splice(source.tableStart, 0, comment);
  }

  // Only a heading that owns this table alone can be renamed from the table's
  // name; where several tables share a heading the name is partly the column.
  if (source.heading && source.soleTable && table.name !== source.heading.text) {
    lines[source.heading.line] = `${"#".repeat(source.heading.level)} ${table.name}`;
  }

  return lines.join("\n");
}

/** Adds a table to the end of a document, leaving what is already there alone. */
export function appendTable(markdown: string, table: RollTable, level = DEFAULT_HEADING_LEVEL): string {
  const body = markdown.replace(/\s*$/, "");
  return `${body ? `${body}\n\n` : ""}${serializeTable(table, level).join("\n").replace(/\n+$/, "")}\n`;
}

/**
 * A whole set as one document, used where there is no source to preserve: tables
 * seeded from CSV, and the Markdown written into an export or repo bundle.
 */
export function serializeSet(tables: readonly RollTable[], title?: string): string {
  const lines: string[] = [];
  if (title) lines.push(`# ${title}`, "");

  let category = "";
  for (const table of tables) {
    // A category heading is only worth writing when the tables actually differ by
    // one; a flat set would otherwise gain a level of headings it never had.
    if (table.category && table.category !== table.name && table.category !== category) {
      category = table.category;
      lines.push(`## ${category}`, "");
    }
    lines.push(...serializeTable(table, category ? 3 : 2));
  }

  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}
