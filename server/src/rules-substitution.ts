import { parseRollTables, rollTableLabel, type RollTable } from "@devils-toys/shared";

function href(setId: string, tableId: string) {
  return `devils-table:${encodeURIComponent(setId)}/${encodeURIComponent(tableId)}`;
}

/** Replace catalogue tables with safe roller links, preserving every heading and non-table line. */
export function substituteTableLinks(markdown: string, setId: string, tables: readonly RollTable[]): string {
  const sourced = tables.filter((table) => table.source);
  const links = sourced.map((table) => `[${rollTableLabel(table.name, table.dice)}](${href(setId, table.id)})`);
  if (!sourced.length) return markdown;
  if (links.every((link) => markdown.includes(link))) return markdown;
  if (markdown.includes("devils-table:")) throw new Error("Rules document is partially substituted.");

  const parsed = new Map(parseRollTables(markdown).map((table) => [table.id, table]));
  const lines = markdown.split("\n");
  const edits: { start: number; end: number; replacement: string[] }[] = [];
  for (const table of sourced) {
    const source = table.source!;
    const actual = parsed.get(table.id);
    if (!actual?.source || actual.source.tableStart !== source.tableStart || actual.source.tableEnd !== source.tableEnd)
      throw new Error(`Rules table source drifted for "${table.name}".`);
    edits.push({ start: source.tableStart, end: source.tableEnd, replacement: [links[sourced.indexOf(table)]] });
    if (source.tagsLine !== null) edits.push({ start: source.tagsLine, end: source.tagsLine, replacement: [] });
  }
  edits.sort((left, right) => right.start - left.start);
  for (const edit of edits) lines.splice(edit.start, edit.end - edit.start + 1, ...edit.replacement);
  return lines.join("\n");
}
