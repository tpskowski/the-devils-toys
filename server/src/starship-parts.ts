import fs from "node:fs";
import type { StarshipPart, SystemId } from "@devils-toys/shared";
import { projectFile } from "./paths.js";
import { readPricedRows, splitPricedCell } from "./rules-tables.js";

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

/** Parsed once per system, because the raw Markdown cannot change at runtime. */
const cache = new Map<SystemId, StarshipPart[]>();

export function starshipPartsFor(system: SystemId) {
  const cached = cache.get(system);
  if (cached) return cached;
  const filename = system === "cairn" ? "Cairn.md" : "Monolith.md";
  const parsed = parseStarshipParts(fs.readFileSync(projectFile("raw", filename), "utf8"));
  cache.set(system, parsed);
  return parsed;
}
