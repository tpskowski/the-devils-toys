/**
 * The table parser lives in `shared` so the Devil's Tables editor can preview a
 * set in the browser with exactly the parser the roller uses. This re-export
 * keeps the server's existing imports pointing somewhere sensible.
 */
import { parseRollTables, type SystemId } from "@devils-toys/shared";
import { systemTablesFile } from "./systems.js";
import { tablesForSetJson, type CatalogRollTable } from "./table-json.js";

export {
  diceMaximum,
  parseRollTables,
  rowForRoll,
  rowText,
  tableSummary,
  unreachableRows,
  SUPPORTED_DIE_SIDES
} from "@devils-toys/shared";

export interface CompactRollTable {
  name: string;
  /**
   * The heading path above the table, joined by " · " as the catalogue writes
   * it. A creation packet needs it: the twelve sections under `BACKGROUNDS` are
   * told apart by the heading that owns each table, and reading a line number
   * would tie the engine to a Markdown file the tables were generated from
   * rather than to the tables themselves.
   */
  section: string;
  dice: string;
  columns: readonly string[];
  /**
   * One roll-to-result map per column, positional against `columns`. A blank
   * cell is left out of its own column's map alone: Cairn rolls each column of
   * `Name & Background` separately, so a row that gives no surname still has to
   * be reachable as a background.
   */
  entries: readonly ReadonlyMap<number, string>[];
}

/**
 * The result a roll lands on, in the named column or in the first where no
 * column is named. A column the table does not have is reported rather than
 * quietly answered with nothing, because a declaration naming the wrong column
 * would otherwise be discovered by a player with an empty field.
 */
export function compactEntry(table: CompactRollTable, roll: number, column?: string): string | undefined {
  return table.entries[column === undefined ? 0 : columnIndex(table, column)]?.get(roll);
}

function columnIndex(table: CompactRollTable, column: string): number {
  const wanted = column.trim().toLocaleLowerCase();
  const index = table.columns.findIndex((name) => name.trim().toLocaleLowerCase() === wanted);
  if (index < 0) throw new Error(`The "${table.name}" table has no "${column}" column.`);
  return index;
}

/**
 * Compatibility adapter for callers that want the compact table map shape.
 * The shared catalogue parser now flattens repeated Roll/Result pairs, keeping
 * character generation and the table UI on the same authoritative parse.
 */
export function parseCompactRollTables(markdown: string, section: string): CompactRollTable[] {
  return compactTablesFromTables(parseRollTables(markdown), section);
}

export function compactTables(system: SystemId, section: string): CompactRollTable[] {
  return compactTablesFromTables(tablesForSetJson(system, systemTablesFile(system)), section);
}

function compactTablesFromTables(tables: readonly CatalogRollTable[], section: string): CompactRollTable[] {
  const wanted = section.trim().toLocaleLowerCase();
  return tables
    .filter(
      (table) =>
        table.category.trim().toLocaleLowerCase() === wanted ||
        table.section.split(/\s*\u00b7\s*/).some((heading) => heading.trim().toLocaleLowerCase() === wanted)
    )
    .map((table) => {
      const entries = table.columns.map((_, column) => {
        const rolls = new Map<number, string>();
        for (const row of table.rows) {
          const value = row.cells[column]?.trim() ?? "";
          if (!value) continue;
          for (let roll = row.min; roll <= row.max; roll += 1) {
            if (roll > 0) rolls.set(roll, value);
          }
        }
        return rolls;
      });
      return { name: table.name, section: table.section, dice: table.dice, columns: [...table.columns], entries };
    });
}
