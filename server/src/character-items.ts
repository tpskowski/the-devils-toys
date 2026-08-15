import type {
  CharacterItem,
  CharacterListDefinition,
  SystemId,
  SystemItemCatalog,
  SystemTraitCatalog
} from "@devils-toys/shared";
import { classifyItem } from "@devils-toys/shared";
import cairnItems from "@devils-toys/system-cairn/items";
import cwnItems from "@devils-toys/system-cwn/items";
import monolithItems from "@devils-toys/system-monolith/items";
import cairnTraits from "@devils-toys/system-cairn/traits";
import cwnTraits from "@devils-toys/system-cwn/traits";
import monolithTraits from "@devils-toys/system-monolith/traits";
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
 * Every system's gear, read from the committed catalogues rather than from the
 * rulebooks. Bundled at build time, so this is a lookup and not a file read.
 */
const catalogs: Record<SystemId, SystemItemCatalog> = {
  cairn: cairnItems as SystemItemCatalog,
  monolith: monolithItems as SystemItemCatalog,
  cwn: cwnItems as SystemItemCatalog
};

/** What each system's own words mean, read from the committed catalogues. */
const traitCatalogs: Record<SystemId, SystemTraitCatalog> = {
  cairn: cairnTraits as SystemTraitCatalog,
  monolith: monolithTraits as SystemTraitCatalog,
  cwn: cwnTraits as SystemTraitCatalog
};

/**
 * An installed system's catalogues are read off disk instead, and cached.
 *
 * A compiled system's are inlined into the bundle by esbuild, which is why the
 * runtime image carries no `items.json` — see `AGENTS.md`. An installed system
 * arrived after the build, so there is nothing to inline and no choice but to
 * read it. The two paths are kept apart so the built-in one stays exactly as it
 * was, and so the Docker image needs nothing new.
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
  return catalogs[system] ?? readJsonCatalog(itemCatalogFile(system), installedCatalogs, system);
}

function traitCatalogOf(system: SystemId): SystemTraitCatalog {
  return traitCatalogs[system] ?? readJsonCatalog(traitCatalogFile(system), installedTraits, system);
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
