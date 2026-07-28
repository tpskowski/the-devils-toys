import type { RollTableSummary, TableRollVisibility, TableTag } from "@devils-toys/shared";

export function tableTagLabel(tag: TableTag) {
  if (tag === "scifi") return "Sci-fi";
  return tag
    .split("-")
    .map((word) => `${word[0].toLocaleUpperCase()}${word.slice(1)}`)
    .join(" ");
}

export function filterTablesByTag(tables: readonly RollTableSummary[], tag: TableTag | "") {
  return tag ? tables.filter((table) => table.tags.includes(tag)) : [...tables];
}

/**
 * Type-ahead over a set's tables. Every word typed has to appear somewhere in
 * the table's name, its heading path, or its die, so "d66 psionic" and
 * "gear mercenary" both find what the GM means without exact spelling.
 */
export function filterTables(tables: readonly RollTableSummary[], query: string) {
  const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [...tables];
  return tables.filter((table) => {
    const haystack = `${table.name} ${table.section} ${table.dice} ${table.tags.join(" ")}`.toLocaleLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

export interface TableCategory {
  name: string;
  tables: RollTableSummary[];
}

/** Groups a set's tables by the part of the book they came from, in book order. */
export function groupByCategory(tables: readonly RollTableSummary[]): TableCategory[] {
  const groups: TableCategory[] = [];
  for (const table of tables) {
    const existing = groups.find((group) => group.name === table.category);
    if (existing) existing.tables.push(table);
    else groups.push({ name: table.category, tables: [table] });
  }
  return groups;
}

/**
 * A category holding one table of the same name is that table — a chapter such
 * as Monolith's GROUP DEBT — so opening it should skip the list of one.
 */
export function categoryOpensTable(category: TableCategory) {
  return category.tables.length === 1 && category.tables[0].name === category.name ? category.tables[0] : undefined;
}

/**
 * The three checkboxes are one choice: ticking one clears the others, and
 * unticking the current one returns the roll to the room's normal visibility.
 */
export function toggleVisibility(
  current: TableRollVisibility,
  option: Exclude<TableRollVisibility, "public">
): TableRollVisibility {
  return current === option ? "public" : option;
}

export function visibilityNotice(visibility: TableRollVisibility) {
  if (visibility === "private") return "You see the result and the table text. Players are told a roll was made.";
  if (visibility === "invisible") return "Only you see the result. Players are told nothing.";
  if (visibility === "reveal") return "Everyone sees the table text for this result.";
  return "Everyone sees the table and the number rolled, but not the text.";
}

/** Keeps a keyboard-driven list selection inside its bounds. */
export function moveHighlight(current: number, delta: number, length: number) {
  if (!length) return -1;
  if (current < 0) return delta > 0 ? 0 : length - 1;
  return (((current + delta) % length) + length) % length;
}
