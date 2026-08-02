import type { CharacterItem, CharacterListDefinition, ItemClassification } from "@devils-toys/shared";
import { classifyItemLabel, mergeWeaponDetail, slotWeapon } from "@devils-toys/shared";

/**
 * What a filled slot holds. A catalogue entry is trusted as the book classified
 * it; anything else is read from the text the player typed. A record kept on the
 * slot overlays both, and is the only way to give a weapon damage, traits, or
 * notes that its own notation never stated.
 */
export function slotClassification(
  label: string,
  sheet: Record<string, unknown>,
  list: CharacterListDefinition,
  index: number,
  items: readonly CharacterItem[]
): ItemClassification {
  return mergeWeaponDetail(catalogueClassification(label, list, items), slotWeapon(sheet, list.key, index));
}

/** The reading alone, before anything recorded by hand. */
export function catalogueClassification(
  label: string,
  list: CharacterListDefinition,
  items: readonly CharacterItem[]
): ItemClassification {
  const known = items.find((item) => item.label === label);
  if (!known) return classifyItemLabel(label, list);
  return {
    weapon: known.weapon,
    ...(known.damage ? { damage: known.damage } : {}),
    ...(known.traits?.length ? { traits: known.traits } : {}),
    ...(known.range ? { range: known.range } : {})
  };
}

/**
 * The traits this system's own weapons use, offered as suggestions when someone
 * describes a weapon the book never priced. Taken from the catalogue rather than
 * declared per system, so a system's vocabulary is whatever its tables say.
 */
export function weaponTraitSuggestions(items: readonly CharacterItem[]) {
  const traits = new Set<string>();
  for (const item of items) for (const trait of item.traits ?? []) traits.add(trait);
  return [...traits].sort((left, right) => left.localeCompare(right));
}

/** Keeps unrestricted entries and entries whose source names the socket being edited. */
export function characterItemsForSlot(
  items: readonly CharacterItem[],
  list: CharacterListDefinition,
  slotIndex: number
) {
  const slotType = list.slotTypes?.[slotIndex];
  if (!slotType) return items;
  return items.filter((item) => !item.allowedSlotTypes?.length || item.allowedSlotTypes.includes(slotType));
}

/** What the catalogue's own all-weapons table is called in a picker. */
export const ALL_WEAPONS = "ALL WEAPONS";

/**
 * Every weapon a list can hold, gathered into one table.
 *
 * The book files its weapons under eight headings — the armoury's four, plus the
 * tools, explosives, and starting kits that turn out to hold weapons too — and
 * finding one meant knowing which. This is derived rather than stored: a second
 * copy in `items.json` would be 87 entries to keep in step, and would be wrong
 * the first time one of them was corrected.
 */
export function allWeapons(items: readonly CharacterItem[]) {
  return items.filter((item) => item.weapon).sort((left, right) => left.name.localeCompare(right.name));
}
