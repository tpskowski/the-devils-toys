import type {
  CharacterItem,
  CharacterListDefinition,
  SystemId,
  SystemItemCatalog,
  SystemTraitCatalog
} from "@devils-toys/shared";
import { classifyItem } from "@devils-toys/shared";
import fs from "node:fs";
import { readPricedRows, splitPricedCell } from "./rules-tables.js";
import { applyRoomOverlay } from "./room-items.js";
import { itemCatalogFile, traitCatalogFile } from "./system-content.js";

/** Reads socket names from parentheticals such as "2 Leg Sockets" or "Internal & Skin Sockets". */
export function allowedSlotTypes(spec: string) {
  const socketSpec = /^(?:\d+\s+)?(.+?)\s+Sockets?(?:\s*,|$)/i.exec(spec)?.[1];
  if (!socketSpec) return;
  const types = socketSpec
    .split(/\s*(?:&|\band\b)\s*/i)
    .map((type) =>
      type
        .trim()
        .toLocaleLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
    )
    .filter(Boolean);
  return types.length ? types : undefined;
}

/**
 * The gear a character can be carrying, read out of the system's own tables. A
 * list names the headings that stock it, so weapons fill inventory slots while
 * augments fill sockets, and each system decides which of its priced categories
 * are things you carry at all.
 *
 * Generation-time only: the application loads the committed result. Ids are
 * assigned by `catalogFromRulebook`, which can see every list at once and so can
 * tell whether a name needs qualifying.
 */
export function parseCharacterItems(
  markdown: string,
  headings: readonly string[],
  options: Pick<CharacterListDefinition, "skipCategories" | "weaponCategories" | "weaponRange"> = {}
): Omit<CharacterItem, "id">[] {
  const { skipCategories = [], weaponCategories = [], weaponRange } = options;
  const skipped = new Set(skipCategories.map((category) => category.toLocaleLowerCase()));
  const seen = new Set<string>();
  const items: Omit<CharacterItem, "id">[] = [];

  for (const heading of headings) {
    for (const row of readPricedRows(markdown, heading)) {
      if (skipped.has(row.category.toLocaleLowerCase())) continue;
      const { name, spec, detail } = splitPricedCell(row.cell);
      // Tables carry note rows and blank filler cells; only priced things are gear.
      if (!name || !row.cost) continue;
      const label = spec ? `${name} (${spec})` : name;
      const slotTypes = allowedSlotTypes(spec);
      if (seen.has(label)) continue;
      seen.add(label);
      const { weapon, damage, traits, range } = classifyItem({
        name,
        category: row.category,
        spec,
        detail,
        weaponCategories,
        weaponRange
      });
      items.push({
        category: row.category,
        name,
        spec,
        detail,
        cost: row.cost,
        bulky: /\bbulky\b/i.test(spec),
        weapon,
        ...(damage ? { damage } : {}),
        ...(traits?.length ? { traits } : {}),
        ...(range ? { range } : {}),
        ...(slotTypes ? { allowedSlotTypes: slotTypes } : {}),
        label
      });
    }
  }

  return items;
}

/**
 * A system's catalogues are read off disk and cached.
 *
 * There used to be a second path here: the three compiled systems' catalogues
 * were inlined into the bundle by esbuild and looked up rather than read, which
 * is why the runtime image carried no `items.json`. No system is compiled in any
 * more, so every catalogue arrives after the build and every one is read. The
 * cache is what that lookup became, and `forgetInstalledCatalogs` is what makes
 * it safe — a system's content can be replaced while the server is running.
 */
const installedCatalogs = new Map<SystemId, SystemItemCatalog>();
const installedTraits = new Map<SystemId, SystemTraitCatalog>();

export function forgetInstalledCatalogs(system?: SystemId) {
  if (system === undefined) {
    installedCatalogs.clear();
    installedTraits.clear();
    return;
  }
  installedCatalogs.delete(system);
  installedTraits.delete(system);
}

function readJsonCatalog<T>(file: string, cache: Map<SystemId, T>, system: SystemId): T {
  const cached = cache.get(system);
  if (cached) return cached;
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as T;
  cache.set(system, parsed);
  return parsed;
}

function itemCatalogOf(system: SystemId): SystemItemCatalog {
  return readJsonCatalog(itemCatalogFile(system), installedCatalogs, system);
}

function traitCatalogOf(system: SystemId): SystemTraitCatalog {
  return readJsonCatalog(traitCatalogFile(system), installedTraits, system);
}

/** The definitions behind the words written on a system's weapons. */
export function itemTraitsFor(system: SystemId) {
  return traitCatalogOf(system).traits;
}

/**
 * The picker contents for every list on a sheet, keyed by list.
 *
 * Given a room, the room's own additions and retirements are applied over the
 * system's catalogue. Given none — a character in a pool belongs to no room —
 * the system's catalogue is what it has always been.
 */
export function characterItemsFor(system: SystemId, roomId?: number) {
  return applyRoomOverlay(itemCatalogOf(system).lists, roomId);
}

/** One item wherever it sits, for anything holding an id rather than a slot's text. */
export function characterItem(system: SystemId, id: string, roomId?: number) {
  for (const items of Object.values(characterItemsFor(system, roomId))) {
    const found = items.find((item) => item.id === id);
    if (found) return found;
  }
  return undefined;
}
