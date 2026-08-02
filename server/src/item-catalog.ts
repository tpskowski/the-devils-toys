import fs from "node:fs";
import type { CharacterItem, SystemId, SystemItemCatalog } from "@devils-toys/shared";
import { itemId } from "@devils-toys/shared";
import { parseCharacterItems } from "./character-items.js";
import { projectFile } from "./paths.js";
import { systems } from "./systems.js";

/** Where a system's gear lives, beside the package that owns it. */
export function itemCatalogFile(system: SystemId) {
  return projectFile("systems", system, "items.json");
}

export function readItemCatalog(system: SystemId): SystemItemCatalog {
  return JSON.parse(fs.readFileSync(itemCatalogFile(system), "utf8"));
}

/**
 * Writes the catalogue, and says whether it had to. The file is hand-edited, so
 * a run with nothing to add leaves it exactly as its author left it rather than
 * reformatting it to this serializer's taste.
 */
export function writeItemCatalog(system: SystemId, catalog: SystemItemCatalog) {
  const file = itemCatalogFile(system);
  const next = `${JSON.stringify(catalog, null, 2)}\n`;
  if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === next) return false;
  fs.writeFileSync(file, next);
  return true;
}

/**
 * What a system's rulebook says its gear is. Used to seed a catalogue and to find
 * entries a catalogue has not got yet — never to decide what an entry already in
 * the catalogue looks like.
 */
export function catalogFromRulebook(system: SystemId): SystemItemCatalog {
  const definition = systems[system];
  const source = definition.sourceDocuments[0];
  if (!source) throw new Error(`${definition.name} has no rules source.`);
  const markdown = fs.readFileSync(projectFile("raw", source.markdownFile), "utf8");

  // Names repeat across a book's tables, so an id is only qualified by its spec
  // where it has to be. Counting first keeps an unambiguous item's id short and,
  // more to the point, keeps it from changing when an unrelated table gains a row.
  const lists = definition.characterSheet.lists.filter((list) => list.itemHeadings?.length);
  const parsed = lists.map((list) => ({ list, items: parseCharacterItems(markdown, list.itemHeadings!, list) }));
  const nameCounts = new Map<string, number>();
  for (const { items } of parsed)
    for (const item of items) nameCounts.set(item.name, (nameCounts.get(item.name) ?? 0) + 1);

  const catalog: Record<string, CharacterItem[]> = {};
  const claimed = new Map<string, string>();
  for (const { list, items } of parsed) {
    catalog[list.key] = items.map((item) => {
      const { base, qualified } = itemId(system, item.name, item.spec);
      const id = (nameCounts.get(item.name) ?? 0) > 1 ? qualified : base;
      const previous = claimed.get(id);
      if (previous)
        throw new Error(
          `${definition.name} gives "${item.name}" and "${previous}" the same id "${id}". Rename one in raw/${source.markdownFile}, or give it a distinguishing parenthetical.`
        );
      claimed.set(id, item.name);
      return { id, ...item };
    });
  }
  return { system, source: source.markdownFile, lists: catalog };
}

export interface CatalogSeed {
  catalog: SystemItemCatalog;
  /** Ids taken from the book because the catalogue did not have them. */
  added: string[];
  /** Ids the catalogue has that the book no longer offers. Reported, never removed. */
  unmatched: string[];
}

/**
 * Folds anything new in the rulebook into a system's catalogue, and touches
 * nothing else.
 *
 * The catalogue is the authority once it exists. An entry already in it keeps
 * exactly the values it has — a weapon whose damage was fixed by hand stays
 * fixed, and re-running this never undoes that. Only ids the catalogue has never
 * seen are appended, which also makes the operation idempotent.
 *
 * An id the catalogue holds that the book no longer offers is reported and left
 * alone: it is either a deliberate addition or an entry a book edit renamed, and
 * neither is something to delete without being asked.
 */
export function seedItemCatalog(system: SystemId): CatalogSeed {
  const fromBook = catalogFromRulebook(system);
  const existing = fs.existsSync(itemCatalogFile(system))
    ? readItemCatalog(system)
    : { system, source: fromBook.source, lists: {} };
  return mergeCatalog(existing, fromBook);
}

/**
 * The merge itself, which is the whole rule: the existing catalogue wins on
 * every id it already holds, and the book may only contribute ids it does not.
 * New entries are appended, so an existing catalogue's order — and therefore its
 * diff — is left alone.
 */
export function mergeCatalog(existing: SystemItemCatalog, fromBook: SystemItemCatalog): CatalogSeed {
  const fromBookById = new Map(
    Object.values(fromBook.lists)
      .flat()
      .map((item) => [item.id, item] as const)
  );
  const lists: Record<string, CharacterItem[]> = {};
  // An entry keeps every value it carries. A field it has never carried — one
  // this application only started reading later, such as a weapon's range — is
  // taken from the book, since there is no hand-written answer to protect.
  for (const [key, items] of Object.entries(existing.lists))
    lists[key] = items.map((item) => {
      const book = fromBookById.get(item.id);
      if (!book) return item;
      const missing = Object.fromEntries(
        Object.entries(book).filter(([field, value]) => !(field in item) && value !== undefined)
      );
      return Object.keys(missing).length ? ({ ...item, ...missing } as CharacterItem) : item;
    });
  const known = new Set(
    Object.values(lists)
      .flat()
      .map((item) => item.id)
  );

  // A retired id is one the catalogue turned down on purpose; the book offering
  // it again is not news.
  const retired = new Set(existing.retired ?? []);
  const added: string[] = [];
  for (const [key, items] of Object.entries(fromBook.lists)) {
    for (const item of items) {
      if (known.has(item.id) || retired.has(item.id)) continue;
      (lists[key] ??= []).push(item);
      known.add(item.id);
      added.push(item.id);
    }
  }

  const offered = new Set(
    Object.values(fromBook.lists)
      .flat()
      .map((item) => item.id)
  );
  const unmatched = Object.values(existing.lists)
    .flat()
    .map((item) => item.id)
    .filter((id) => !offered.has(id));

  return {
    catalog: {
      system: existing.system,
      source: fromBook.source,
      lists,
      ...(existing.retired?.length ? { retired: existing.retired } : {})
    },
    added,
    unmatched
  };
}
