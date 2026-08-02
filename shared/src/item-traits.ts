/**
 * What the words beside a weapon mean.
 *
 * An item's parenthetical is read as a list of traits — "D8, bulky, thermal" —
 * and until now each was only ever the word itself. A book that states what its
 * words do says so in one place, so the words are resolved against a catalogue
 * of the system's own definitions rather than being explained wherever they
 * happen to be shown.
 *
 * The catalogue is seeded from the book by `npm run build:traits` and belongs to
 * us thereafter, exactly as `items.json` does: a trait a book states in prose
 * rather than in a definition list is written in by hand and stays.
 */

export interface ItemTrait {
  /** Stable and derived from the name, so a reformatted book leaves it alone. */
  id: string;
  /** As the book writes it, including any abbreviation: "Armor Piercing (AP)". */
  label: string;
  /** What the book says it does. */
  description: string;
  /** A condition the book puts before the description: "Only effective vs organics". */
  appliesTo?: string;
  /** The heading it was read under, such as "DAMAGE TYPES". */
  category?: string;
}

export interface SystemTraitCatalog {
  system: string;
  source: string;
  traits: ItemTrait[];
}

/** Lower case, single hyphens, nothing else — the same shape as an item's id. */
export function traitId(name: string) {
  return name
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Every way a book might write one trait: in full, without its abbreviation, and
 * by the abbreviation alone. "Armor Piercing (AP)" is written both ways in the
 * armoury, and both are the same trait.
 */
export function traitKeys(trait: Pick<ItemTrait, "id" | "label">) {
  const keys = new Set([trait.id, traitId(trait.label)]);
  const abbreviation = /\(([^)]+)\)\s*$/.exec(trait.label);
  if (abbreviation) {
    keys.add(traitId(trait.label.slice(0, abbreviation.index)));
    keys.add(traitId(abbreviation[1]));
  }
  return [...keys].filter(Boolean);
}

/** The trait an item's own word names, where the system defines one. */
export function findTrait(traits: readonly ItemTrait[] | undefined, written: string) {
  if (!traits?.length) return undefined;
  const wanted = traitId(written);
  if (!wanted) return undefined;
  return traits.find((trait) => traitKeys(trait).includes(wanted));
}

/**
 * One trait as a line of text: what it is called, what it needs, and what it
 * does. Used for the tooltips that show a weapon's words in full.
 */
export function traitSummary(trait: ItemTrait) {
  return [trait.label, trait.appliesTo, trait.description].filter(Boolean).join(" — ");
}

/**
 * The words written on an item, resolved against the system's own definitions.
 * A word the book never defined is kept as written rather than dropped, since
 * players write their own on a slot.
 */
export function describeTraits(written: readonly string[] | undefined, traits: readonly ItemTrait[] | undefined) {
  return (written ?? []).map((word) => {
    const known = findTrait(traits, word);
    return { written: word, summary: known ? traitSummary(known) : word };
  });
}
