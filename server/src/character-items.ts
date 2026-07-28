import fs from "node:fs";
import type { CharacterItem, CharacterSheetDefinition, SystemId } from "@devils-toys/shared";
import { projectFile } from "./paths.js";
import { readPricedRows, splitPricedCell } from "./rules-tables.js";

/**
 * The gear a character can be carrying, read out of the system's own tables. A
 * list names the headings that stock it, so weapons fill inventory slots while
 * augments fill sockets, and each system decides which of its priced categories
 * are things you carry at all.
 */
export function parseCharacterItems(
  markdown: string,
  headings: readonly string[],
  skipCategories: readonly string[] = []
): CharacterItem[] {
  const skipped = new Set(skipCategories.map((category) => category.toLocaleLowerCase()));
  const seen = new Set<string>();
  const items: CharacterItem[] = [];

  for (const heading of headings) {
    for (const row of readPricedRows(markdown, heading)) {
      if (skipped.has(row.category.toLocaleLowerCase())) continue;
      const { name, spec, detail } = splitPricedCell(row.cell);
      // Tables carry note rows and blank filler cells; only priced things are gear.
      if (!name || !row.cost) continue;
      const label = spec ? `${name} (${spec})` : name;
      if (seen.has(label)) continue;
      seen.add(label);
      items.push({
        category: row.category,
        name,
        spec,
        detail,
        cost: row.cost,
        bulky: /\bbulky\b/i.test(spec),
        label
      });
    }
  }

  return items;
}

function markdownFor(system: SystemId) {
  return fs.readFileSync(projectFile("raw", system === "cairn" ? "Cairn.md" : "Monolith.md"), "utf8");
}

/** Parsed once per system, because the raw Markdown cannot change at runtime. */
const cache = new Map<SystemId, Record<string, CharacterItem[]>>();

/** The picker contents for every list on a sheet, keyed by list. */
export function characterItemsFor(system: SystemId, sheet: CharacterSheetDefinition) {
  const cached = cache.get(system);
  if (cached) return cached;

  const markdown = markdownFor(system);
  const catalogue: Record<string, CharacterItem[]> = {};
  for (const list of sheet.lists) {
    if (!list.itemHeadings?.length) continue;
    catalogue[list.key] = parseCharacterItems(markdown, list.itemHeadings, list.skipCategories);
  }

  cache.set(system, catalogue);
  return catalogue;
}
