import type { StarshipPart, SystemId } from "@devils-toys/shared";
import { readPricedRows, splitPricedCell } from "./rules-tables.js";
import { systemMarkdown } from "./systems.js";

/**
 * Reads the installable parts out of a system's Markdown. Every table under the
 * parts heading whose second column is a cost contributes its rows, and the
 * table's first column heading names the category.
 */
export function parseStarshipParts(markdown: string, heading = "STARSHIP PARTS"): StarshipPart[] {
  return readPricedRows(markdown, heading).flatMap((row) => {
    const { name, spec, detail } = splitPricedCell(row.cell);
    if (!name) return [];
    return [
      {
        category: row.category,
        name,
        spec,
        detail,
        cost: row.cost,
        bulky: /\bbulky\b/i.test(spec),
        label: spec ? `${name} (${spec})` : name
      }
    ];
  });
}

/**
 * Parsed once per system. This used to say the Markdown could not change at
 * runtime, which was true while every system was compiled in; an installed
 * system's book is replaced whenever its bundle is, so the cache is cleared
 * along with everything else remembered about that system.
 */
const cache = new Map<SystemId, StarshipPart[]>();

export function forgetStarshipParts(system?: SystemId) {
  if (system === undefined) cache.clear();
  else cache.delete(system);
}

export function starshipPartsFor(system: SystemId) {
  const cached = cache.get(system);
  if (cached) return cached;
  const parsed = parseStarshipParts(systemMarkdown(system));
  cache.set(system, parsed);
  return parsed;
}
