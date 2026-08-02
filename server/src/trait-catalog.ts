import fs from "node:fs";
import type { ItemTrait, SystemId, SystemTraitCatalog } from "@devils-toys/shared";
import { traitId } from "@devils-toys/shared";
import { sectionLines } from "./rules-tables.js";
import { projectFile } from "./paths.js";
import { systems } from "./systems.js";

/**
 * A definition list entry, which is how a book states what one of its words
 * means: `- **Thermal:** DEX Save or take 1D4 heat damage for 1D4 rounds.` The
 * condition some carry — `- **Sweep:** (Bulky) …` — is kept apart from the rest
 * rather than being read as part of what the trait does.
 */
const DEFINITION = /^-\s+\*\*(.+?):?\*\*:?\s*(.*)$/;
const CONDITION = /^\((.+?)\)\s*/;

/** Where a system's trait definitions live, beside the package that owns them. */
export function traitCatalogFile(system: SystemId) {
  return projectFile("systems", system, "traits.json");
}

export function readTraitCatalog(system: SystemId): SystemTraitCatalog {
  return JSON.parse(fs.readFileSync(traitCatalogFile(system), "utf8"));
}

/** Writes the catalogue, and says whether it had to. See `writeItemCatalog`. */
export function writeTraitCatalog(system: SystemId, catalog: SystemTraitCatalog) {
  const file = traitCatalogFile(system);
  const next = `${JSON.stringify(catalog, null, 2)}\n`;
  if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === next) return false;
  fs.writeFileSync(file, next);
  return true;
}

/**
 * What a system's rulebook states its weapon words mean. Only the headings a
 * system names are read, and only their definition lists: a book explains plenty
 * in prose, and prose is not a definition anyone can look up by name.
 */
export function traitsFromRulebook(system: SystemId): SystemTraitCatalog {
  const definition = systems[system];
  const source = definition.sourceDocuments[0];
  if (!source) throw new Error(`${definition.name} has no rules source.`);
  const markdown = fs.readFileSync(projectFile("raw", source.markdownFile), "utf8");
  const lines = markdown.split("\n");

  const traits: ItemTrait[] = [];
  const seen = new Set<string>();
  for (const heading of definition.traitCatalog?.headings ?? []) {
    for (const line of sectionLines(lines, heading)) {
      const match = DEFINITION.exec(line.trim());
      if (!match) continue;
      const label = match[1].trim();
      const id = traitId(label);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const condition = CONDITION.exec(match[2]);
      traits.push({
        id,
        label,
        description: (condition ? match[2].slice(condition[0].length) : match[2]).trim(),
        ...(condition ? { appliesTo: condition[1].trim() } : {}),
        category: heading
      });
    }
  }
  return { system, source: source.markdownFile, traits };
}

export interface TraitSeed {
  catalog: SystemTraitCatalog;
  added: string[];
  /** In the catalogue but no longer stated by the book; left exactly as it is. */
  unmatched: string[];
}

/**
 * Folds the book's definitions into the catalogue. As with items, an entry the
 * catalogue already holds is never rewritten — a trait the book states in prose,
 * and so was written in by hand, has no book entry to be overruled by.
 */
export function mergeTraits(existing: SystemTraitCatalog, fromBook: SystemTraitCatalog): TraitSeed {
  const traits = [...existing.traits];
  const known = new Set(traits.map((trait) => trait.id));
  const added: string[] = [];
  for (const trait of fromBook.traits) {
    if (known.has(trait.id)) continue;
    traits.push(trait);
    known.add(trait.id);
    added.push(trait.id);
  }
  const offered = new Set(fromBook.traits.map((trait) => trait.id));
  const unmatched = existing.traits.map((trait) => trait.id).filter((id) => !offered.has(id));
  return { catalog: { system: existing.system, source: fromBook.source, traits }, added, unmatched };
}

export function seedTraitCatalog(system: SystemId): TraitSeed {
  const fromBook = traitsFromRulebook(system);
  if (!fs.existsSync(traitCatalogFile(system)))
    return { catalog: fromBook, added: fromBook.traits.map((t) => t.id), unmatched: [] };
  return mergeTraits(readTraitCatalog(system), fromBook);
}
