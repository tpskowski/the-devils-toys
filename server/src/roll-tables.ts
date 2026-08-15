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
  dice: string;
  entries: ReadonlyMap<number, string>;
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
      const entries = new Map<number, string>();
      for (const row of table.rows) {
        const value = row.cells[0]?.trim() ?? "";
        if (!value) continue;
        for (let roll = row.min; roll <= row.max; roll += 1) {
          if (roll > 0) entries.set(roll, value);
        }
      }
      return { name: table.name, dice: table.dice, entries };
    });
}
