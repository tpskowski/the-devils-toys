import {
  diceMaximum,
  diceMinimum,
  parseRowLabel,
  parseRollTables,
  spliceTable,
  type RollTable,
  type TableTag,
  type TableTagDefinition
} from "@devils-toys/shared";

function retargetTableLinkMap(markdown: string, mapping: ReadonlyMap<string, string>) {
  return markdown.replace(
    /(<!--\s*next-table:\s*)([a-z0-9][a-z0-9-]*)(\s*-->)/gi,
    (whole, start: string, id: string, end: string) => {
      const replacement = mapping.get(id.toLocaleLowerCase());
      return replacement ? `${start}${replacement}${end}` : whole;
    }
  );
}

/** Applies one grid edit and retargets every identifier changed by reparsing the set. */
export function applyTableEdit(markdown: string, editingId: string, editing: RollTable) {
  const before = parseRollTables(markdown);
  const editedIndex = before.findIndex(
    (table) => table.id === editingId && table.source?.tableStart === editing.source?.tableStart
  );
  if (editedIndex < 0) throw new Error("The edited table could not be matched to the saved set.");

  const revised = spliceTable(markdown, editing);
  const after = parseRollTables(revised);
  if (after.length !== before.length || !after[editedIndex])
    throw new Error("That edit no longer parses as the same set of tables. Fix the invalid table rows and try again.");

  const mapping = new Map<string, string>();
  for (let index = 0; index < before.length; index += 1) {
    if (before[index].id !== after[index].id) mapping.set(before[index].id.toLocaleLowerCase(), after[index].id);
  }
  return retargetTableLinkMap(revised, mapping);
}

/**
 * Editing operations on a table, kept apart from the components so they can be
 * reasoned about — and tested — on their own. Every one returns a new table
 * rather than changing the one it was given.
 */

export function blankTable(name: string, dice = "d6"): RollTable {
  return {
    id: "",
    name,
    section: "",
    category: name,
    dice,
    columns: ["Result"],
    tags: [],
    rows: [{ label: "1", min: 1, max: 1, cells: [""] }]
  };
}

export function setRowLabel(table: RollTable, index: number, label: string): RollTable {
  const range = parseRowLabel(label);
  const rows = table.rows.map((row, position) =>
    position === index ? { ...row, label, min: range?.min ?? row.min, max: range?.max ?? row.max } : row
  );
  return { ...table, rows };
}

export function setCell(table: RollTable, index: number, column: number, value: string): RollTable {
  const rows = table.rows.map((row, position) => {
    if (position !== index) return row;
    const cells = [...row.cells];
    while (cells.length <= column) cells.push("");
    cells[column] = value;
    return { ...row, cells };
  });
  return { ...table, rows };
}

export function setNextTable(table: RollTable, index: number, nextTableId: string): RollTable {
  return {
    ...table,
    rows: table.rows.map((row, position) =>
      position === index ? { ...row, nextTableId: nextTableId || undefined } : row
    )
  };
}

/** A new row continuing from the highest value the table already covers. */
export function addRow(table: RollTable): RollTable {
  const highest = table.rows.reduce((top, row) => Math.max(top, row.max), 0);
  const next = String(highest + 1);
  return {
    ...table,
    rows: [...table.rows, { label: next, min: highest + 1, max: highest + 1, cells: table.columns.map(() => "") }]
  };
}

export function removeRow(table: RollTable, index: number): RollTable {
  return { ...table, rows: table.rows.filter((_, position) => position !== index) };
}

export function moveRow(table: RollTable, index: number, delta: number): RollTable {
  const target = index + delta;
  if (target < 0 || target >= table.rows.length) return table;
  const rows = [...table.rows];
  [rows[index], rows[target]] = [rows[target], rows[index]];
  return { ...table, rows };
}

/**
 * Gives the table one row per value the die can roll, keeping whatever has
 * already been written. A table half filled in is the common case.
 */
export function fillRows(table: RollTable): RollTable {
  const minimum = diceMinimum(table.dice);
  const maximum = diceMaximum(table.dice);
  // Compound dice count in digit pairs, so 11–44 rather than 1–44.
  const values =
    table.dice === "d44" || table.dice === "d66"
      ? compoundValues(table.dice === "d44" ? 4 : 6)
      : Array.from({ length: maximum - minimum + 1 }, (_, index) => index + minimum);

  const rows = values.map((value) => {
    const existing = table.rows.find((row) => value >= row.min && value <= row.max);
    return existing ?? { label: String(value), min: value, max: value, cells: table.columns.map(() => "") };
  });
  // A range row matches several values; keep it once, in place.
  const seen = new Set<string>();
  return { ...table, rows: rows.filter((row) => !seen.has(row.label) && seen.add(row.label)) };
}

function compoundValues(sides: number) {
  const values: number[] = [];
  for (let tens = 1; tens <= sides; tens += 1)
    for (let ones = 1; ones <= sides; ones += 1) values.push(tens * 10 + ones);
  return values;
}

export function setDice(table: RollTable, dice: string): RollTable {
  return { ...table, dice };
}

export function setColumn(table: RollTable, index: number, name: string): RollTable {
  return { ...table, columns: table.columns.map((column, position) => (position === index ? name : column)) };
}

export function addColumn(table: RollTable): RollTable {
  return {
    ...table,
    columns: [...table.columns, `Column ${table.columns.length + 1}`],
    rows: table.rows.map((row) => ({ ...row, cells: [...row.cells, ""] }))
  };
}

export function removeColumn(table: RollTable, index: number): RollTable {
  if (table.columns.length <= 1) return table;
  return {
    ...table,
    columns: table.columns.filter((_, position) => position !== index),
    rows: table.rows.map((row) => ({ ...row, cells: row.cells.filter((_, position) => position !== index) }))
  };
}

export function toggleTag(tags: readonly TableTag[], tag: TableTag): TableTag[] {
  return tags.includes(tag) ? tags.filter((entry) => entry !== tag) : [...tags, tag];
}

/** What is wrong with a table, in the order a GM would want to hear it. */
export function tableWarnings(table: RollTable): string[] {
  const warnings: string[] = [];
  const minimum = diceMinimum(table.dice);
  const maximum = diceMaximum(table.dice);
  // The roller counts a row unreachable only when it starts past the die. An
  // editor should also say something about "4-6" on a d4, which is reachable but
  // only partly, so the wider test is the useful one here.
  const overshooting = table.rows.filter((row) => row.max > maximum).length;
  if (overshooting)
    warnings.push(`${overshooting} row${overshooting === 1 ? "" : "s"} reaching past what ${table.dice} can roll`);

  const bad = table.rows.filter((row) => !parseRowLabel(row.label));
  if (bad.length) warnings.push(`${bad.length} row${bad.length === 1 ? "" : "s"} without a die value`);

  const covered = new Set<number>();
  for (const row of table.rows) for (let value = row.min; value <= row.max; value += 1) covered.add(value);
  const missing =
    table.dice === "d44" || table.dice === "d66"
      ? compoundValues(table.dice === "d44" ? 4 : 6).filter((value) => !covered.has(value)).length
      : Array.from({ length: maximum - minimum + 1 }, (_, index) => index + minimum).filter(
          (value) => !covered.has(value)
        ).length;
  if (missing) warnings.push(`${missing} value${missing === 1 ? "" : "s"} the die can roll with no row`);

  return warnings;
}

/** Word-at-a-time search over a set's name and tags, matching the roller's. */
export function filterSets<T extends { name: string; tags?: readonly TableTag[] }>(sets: readonly T[], query: string) {
  const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [...sets];
  return sets.filter((set) => {
    const haystack = `${set.name} ${(set.tags ?? []).join(" ")}`.toLocaleLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

export function sortedVocabulary(vocabulary: readonly TableTagDefinition[]) {
  return [...vocabulary].sort((left, right) => left.sortOrder - right.sortOrder || left.slug.localeCompare(right.slug));
}

/** A tag that appears somewhere in a set, and how much of the set carries it. */
export interface TagTally {
  slug: TableTag;
  /** How many of the set's tables carry it. */
  count: number;
  /** Whether it comes from the set rather than from a table's own comment. */
  fromSet: boolean;
}

/**
 * Every tag present in a set, counted. A table's effective tags are its own plus
 * the set's, exactly as the roller sees them, so a set-level tag is on every
 * table by definition and counts as such.
 *
 * Tags written into the Markdown that this instance does not know are still
 * listed, after the ones it does: they are really there, and hiding them would
 * make a set look untagged when it is not.
 */
export function tagTallies(
  tables: readonly RollTable[],
  setTags: readonly TableTag[],
  vocabulary: readonly TableTagDefinition[]
): TagTally[] {
  const counts = new Map<TableTag, number>();
  for (const table of tables) {
    for (const tag of new Set(table.tags)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  for (const tag of new Set(setTags)) counts.set(tag, tables.length);

  const known = vocabulary
    .filter((entry) => counts.has(entry.slug))
    .map((entry) => ({ slug: entry.slug, count: counts.get(entry.slug)!, fromSet: setTags.includes(entry.slug) }));
  const unknown = [...counts.keys()]
    .filter((slug) => !vocabulary.some((entry) => entry.slug === slug))
    .sort()
    .map((slug) => ({ slug, count: counts.get(slug)!, fromSet: setTags.includes(slug) }));

  return [...known, ...unknown];
}

/** The tables a tag covers, with an empty tag meaning the whole set. */
export function tablesWithTag(
  tables: readonly RollTable[],
  setTags: readonly TableTag[],
  tag: TableTag | ""
): RollTable[] {
  if (!tag) return [...tables];
  if (setTags.includes(tag)) return [...tables];
  return tables.filter((table) => table.tags.includes(tag));
}
