/**
 * Telling a weapon from the rest of a character's gear, and reading what it does.
 *
 * Every system writes an item's mechanics in the parenthetical beside its name —
 * "D8, bulky, mid/long-range", "Armor 2", "2 Leg Sockets" — so that is where all
 * of this is read from, rather than in a list of names that would have to be
 * maintained alongside the books.
 *
 * Weapon-ness has two signals, in order:
 *
 * 1. The table's own category. "STANDARD WEAPONS" is the book saying so, and it
 *    is the only thing that catches a weapon with no damage die, such as
 *    Monolith's Stun Gun or its Flash Grenade.
 * 2. A damage die in the parenthetical. This catches the weapons the books file
 *    elsewhere — Monolith's Sledgehammer and Flare Gun sit under TOOLS, and its
 *    Frog Tongue Mutation under GENETIC MODIFICATION.
 *
 * Damage and traits then come out of the same parenthetical: it is a comma-
 * separated list, and what is not the damage die is what the weapon does. A
 * player may overrule or add to any of it; see `SlotWeaponDetail`.
 */

/** A die, or dice added together as Monolith's smart weapons are: "D6", "2D4", "D6+D6". */
const DICE = String.raw`\d*[dD]\d+(?:\s*\+\s*\d*[dD]\d+)*`;

const DAMAGE_DICE = new RegExp(String.raw`\b${DICE}\b`, "g");

/**
 * A term's damage, with the alternatives some weapons offer and the word "damage"
 * where a book spells it out. Monolith's repeater rolls "D10 or D8 blast" and
 * Cairn writes "d10 damage, bulky"; in both, what is left is the trait.
 */
const LEADING_DAMAGE = new RegExp(String.raw`^\s*${DICE}(?:\s+or\s+${DICE})*(?:\s+(?:damage|dmg))?\s*`, "i");

/**
 * What a die counts when it is not counting damage. Monolith's tools wear out
 * over "1D6 uses" and its gasmask filters for "d8 usage"; neither is a weapon,
 * and both would otherwise read as one.
 */
const COUNTED_THING =
  /^(?:uses?|usage|charges?|rounds?|hours?|days?|minutes?|turns?|feet|foot|ft|metres?|meters?|slots?|inventory|temporary|light|people|person)\b/i;

/** A die the text itself labels as damage, which no other reading can explain away. */
const STATED_DAMAGE = new RegExp(String.raw`\b(${DICE})\s+(?:damage|dmg)\b`);

/**
 * An item's stable id. Built from the system and the item's name, so a rulebook
 * reformat leaves it alone and a rename shows up as one id replacing another —
 * which is a content change, and should be noticed rather than absorbed.
 *
 * Two items sharing a name are told apart by their spec, because the books do
 * reuse a name across tables and an id that depended on table order would move
 * whenever a table did.
 */
export function itemId(system: string, name: string, spec = "") {
  const slug = (value: string) =>
    value
      .toLocaleLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  const base = `${system}/${slug(name)}`;
  const qualifier = slug(spec);
  return { base, qualified: qualifier ? `${base}--${qualifier}` : base };
}

/** The index closing the parenthetical that opens at `open`, or -1. */
export function closingParen(text: string, open: number) {
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === "(") depth += 1;
    else if (text[index] === ")") {
      depth -= 1;
      if (!depth) return index;
    }
  }
  return -1;
}

/**
 * Splits a stored slot value into the name and the parenthetical beside it. Slots
 * hold the label a catalogue entry was stowed under — "Rifle (D8, bulky)" — or
 * whatever a player typed, so the same split serves both.
 */
export function splitItemLabel(label: string) {
  const text = label.trim();
  const open = text.indexOf("(");
  const close = open < 0 ? -1 : closingParen(text, open);
  if (close < 0) return { name: text, spec: "", trailing: "" };
  return {
    name: text.slice(0, open).trim(),
    spec: text.slice(open + 1, close).trim(),
    trailing: text.slice(close + 1).trim()
  };
}

/** The damage a parenthetical states, or nothing when it states something else. */
export function itemDamage(spec: string) {
  DAMAGE_DICE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = DAMAGE_DICE.exec(spec))) {
    const after = spec.slice(match.index + match[0].length).replace(/^[\s,]*/, "");
    if (COUNTED_THING.test(after)) continue;
    return match[0];
  }
  return undefined;
}

/**
 * Everything the parenthetical says other than the damage. The books write it as
 * a comma-separated list — "D8, bulky, mid/long-range" — so each term is a trait
 * once its dice are taken out, and the notation is preserved as written rather
 * than mapped onto a vocabulary this application would have to invent.
 */
export function itemTraits(spec: string) {
  return spec
    .split(",")
    .map((term) => term.replace(LEADING_DAMAGE, "").trim())
    .filter(Boolean);
}

/** The dice the roller knows, so a weapon reading "d5" is not offered as a roll. */
const ROLLABLE_SIDES = new Set([4, 6, 8, 10, 12, 20, 44, 66, 100]);

/** One term of a damage expression: "D6", "2D4". */
const DAMAGE_TERM = /^(\d*)[dD](\d+)$/;

/**
 * A weapon's damage as one rollable dice expression, or nothing where it cannot
 * be said as one.
 *
 * The books' own notation carries the difference. `2D4` is a pool rolled and
 * added, as Monolith's high-energy weapons do. `D6+D6` is a second attack die,
 * and both Cairn and Monolith count only the highest single die of an attack, so
 * it becomes a keep-highest roll where the system says so. `D6+D4` is that same
 * rule across two sizes of die, which no single expression can state — that one
 * is rolled by hand.
 */
export function damageExpression(damage: string, multipleRolls?: "keep-highest"): string | undefined {
  const terms = damage.trim().split("+");
  const parsed = terms.map((term) => DAMAGE_TERM.exec(term.trim()));
  if (parsed.some((match) => !match)) return undefined;
  const sides = Number(parsed[0]![2]);
  if (!ROLLABLE_SIDES.has(sides) || parsed.some((match) => Number(match![2]) !== sides)) return undefined;
  const count = parsed.reduce((total, match) => total + Number(match![1] || 1), 0);
  if (count < 1 || count > 20) return undefined;
  return terms.length > 1 && multipleRolls === "keep-highest" ? `${count}d${sides}kh1` : `${count}d${sides}`;
}

/**
 * How a system writes a weapon's reach, as patterns over the traits beside its
 * name. Every book states it its own way — Monolith's range bands (`S-R`,
 * `mid/long-range`), a distance in metres, or nothing at all — so the vocabulary
 * belongs to the system and only the reading is shared.
 *
 * Patterns are regular expression sources, matched case-insensitively against
 * one trait at a time.
 */
export interface WeaponRangeRules {
  /** Traits meaning the weapon is swung rather than aimed. */
  melee: readonly string[];
  /** Traits stating a range, which is then reported in the book's own words. */
  ranged: readonly string[];
}

/**
 * Which weapon a system's ranged arms are drawn as. Melee is crossed swords
 * everywhere; what stands for the rest is the difference between a wood and a
 * sprawl, so each system says which it means.
 */
export type RangedWeaponIcon = "gun" | "bow";

/** What every system calls a weapon used in arm's reach. */
export const MELEE_RANGE = "Melee";

/** What a weapon reports where its own book never says, so the value is never absent. */
export const UNKNOWN_RANGE = "unknown";

/** What is needed to read a weapon out of free text: both come off a list definition. */
export interface WeaponReading {
  weaponCategories?: readonly string[];
  weaponRange?: WeaponRangeRules;
}

/**
 * A weapon's range: `Melee`, whatever the system's own notation says, or
 * `unknown` where nothing does.
 *
 * Traits are read in the order the book writes them, so the first that says
 * anything about reach is the one reported, and it is reported in the book's own
 * words rather than translated. The name is read for melee alone — Monolith
 * prices a "Medium Melee" without ever giving it a trait — since no book states
 * a range in an item's name.
 */
export function itemRange(item: { name?: string; traits?: readonly string[] }, rules: WeaponRangeRules | undefined) {
  if (!rules) return UNKNOWN_RANGE;
  const matches = (patterns: readonly string[], text: string) =>
    patterns.some((pattern) => new RegExp(pattern, "i").test(text));
  if (item.name && matches(rules.melee, item.name)) return MELEE_RANGE;
  for (const trait of item.traits ?? []) {
    if (matches(rules.melee, trait)) return MELEE_RANGE;
    if (matches(rules.ranged, trait)) return trait;
  }
  return UNKNOWN_RANGE;
}

export interface ItemClassification {
  weapon: boolean;
  /** The damage expression the item states, when it states one. */
  damage?: string;
  /** What else its parenthetical says, in the book's own words. */
  traits?: readonly string[];
  /** How far it reaches: `Melee`, the system's own notation, or `unknown`. */
  range?: string;
  /** Anything recorded about this particular weapon by hand. */
  notes?: string;
}

/**
 * Whether an item is something you attack with, and what it does. `category` is
 * the heading of the table it came from; free text has none.
 */
export function classifyItem(
  item: { name?: string; category?: string; spec: string; detail?: string } & WeaponReading
): ItemClassification {
  const categories = new Set((item.weaponCategories ?? []).map((name) => name.toLocaleLowerCase()));
  const byCategory = Boolean(item.category && categories.has(item.category.toLocaleLowerCase()));
  // Only the spec is read loosely. A description mentions dice for every reason
  // there is, so it counts only where it says outright that they are damage.
  const specDamage = itemDamage(item.spec);
  const damage = specDamage ?? (item.detail ? STATED_DAMAGE.exec(item.detail)?.[1] : undefined);
  const weapon = byCategory || Boolean(damage);
  if (!weapon) return { weapon: false };
  // The parenthetical is only a list of traits where it is what made this a
  // weapon. Monolith's Frog Tongue Mutation states its damage in its prose and
  // spends its parenthetical on a socket, which is not a trait of anything.
  const traits = byCategory || specDamage ? itemTraits(item.spec) : [];
  return {
    weapon: true,
    ...(damage ? { damage } : {}),
    ...(traits.length ? { traits } : {}),
    range: itemRange({ name: item.name, traits }, item.weaponRange)
  };
}

/** The same reading for a slot's stored text, which carries no category. */
export function classifyItemLabel(label: string, reading: WeaponReading = {}): ItemClassification {
  const { name, spec, trailing } = splitItemLabel(label);
  return classifyItem({ name, spec, detail: trailing, ...reading });
}

/**
 * What a player has recorded about the weapon in one slot, over and above what
 * its own notation says. Every field is optional: an absent one defers to the
 * reading, so a slot only stores what someone actually changed.
 */
export interface SlotWeaponDetail {
  /** Whether this is a weapon at all, when the reading gets it wrong. */
  weapon?: boolean;
  /** Damage, for a weapon whose text does not state it. */
  damage?: string;
  /** Traits, replacing those read from the notation. */
  traits?: readonly string[];
  /** Records that an empty traits list was intentionally chosen. */
  traitsCleared?: boolean;
  /** Range, for a weapon whose book never states one. */
  range?: string;
  /** Free notes about this weapon, which no system parses. */
  notes?: string;
}

/**
 * How many of a list's slots are within reach. A system that groups its slots
 * says where the first group ends — Monolith carries four on the body and the
 * rest in a backpack — and one that does not is read the same way.
 */
export function readiedSlotCount(list: { groupStarts?: readonly number[] }) {
  return list.groupStarts?.[0] ?? 4;
}

/** A weapon that takes two hands, and so cannot be paired with another. */
const BULKY = /\bbulky\b/i;

/** The readied slot used for the main hand. */
export const WEAPON_SLOT_KEY = "weaponSlot";
/** The readied slot used for the off hand while dual-wielding. */
export const OFFHAND_SLOT_KEY = "weaponOffhandSlot";
/** Whether the selected main and off-hand weapons are both drawn. */
export const DUAL_WIELD_KEY = "dualWield";

export interface ReadiedWeapon {
  /** The slot it is stowed in, which is what the sheet records. */
  index: number;
  /** The slot's own text. */
  label: string;
  name: string;
  /** Two-handed, so it can be swung but never paired with a second weapon. */
  bulky: boolean;
  held: ItemClassification;
}

/**
 * The weapons a character could have in hand: the ones stowed within reach. A
 * bulky weapon is among them — it is swung with both hands, not unusable — but
 * it is marked, because two hands are exactly what a second weapon needs.
 */
export function readiedWeapons(
  sheet: Record<string, unknown>,
  list: { key: string; groupStarts?: readonly number[] } & WeaponReading
): ReadiedWeapon[] {
  const stored = Array.isArray(sheet[list.key]) ? (sheet[list.key] as unknown[]) : [];
  const within = readiedSlotCount(list);
  const weapons: ReadiedWeapon[] = [];
  for (let index = 0; index < within; index += 1) {
    const label = String(stored[index] ?? "").trim();
    if (!label) continue;
    const held = slotIsWeapon(label, slotWeapon(sheet, list.key, index), list);
    if (!held.weapon) continue;
    const bulky = Boolean(held.traits?.some((trait) => BULKY.test(trait)));
    weapons.push({ index, label, name: splitItemLabel(label).name || label, bulky, held });
  }
  return weapons;
}

/**
 * Which of them is in hand. A sheet that has chosen nothing falls back to the
 * first within reach, so a weapon is still known without anyone saying so, and a
 * choice that no longer holds a weapon is treated as no choice at all.
 *
 * Two weapons need two hands, so a bulky one in either hand leaves the other
 * empty however the sheet was left.
 */
export function weaponsInHand(
  sheet: Record<string, unknown>,
  list: { key: string; groupStarts?: readonly number[] } & WeaponReading
) {
  const readied = readiedWeapons(sheet, list);
  const at = (key: string) => {
    const index = Number(sheet[key]);
    return Number.isInteger(index) ? readied.find((weapon) => weapon.index === index) : undefined;
  };
  const main = at(WEAPON_SLOT_KEY) ?? readied[0];
  const canPair = Boolean(
    main && !main.bulky && readied.some((weapon) => !weapon.bulky && weapon.index !== main.index)
  );
  const dual = sheet[DUAL_WIELD_KEY] === true && canPair;
  const chosen = dual ? at(OFFHAND_SLOT_KEY) : undefined;
  const offhand = chosen && !chosen.bulky && chosen.index !== main?.index ? chosen : undefined;
  return { readied, main, offhand, dual, canPair };
}

/**
 * Where a list's weapon records live on the sheet: one entry per slot, aligned
 * with the list itself. The slot's text and its record can only disagree if one
 * is written without the other, so write both together — see `setSlotWeapon`.
 */
export function weaponOverrideKey(listKey: string) {
  return `${listKey}Weapons`;
}

function readDetail(value: unknown): SlotWeaponDetail | undefined {
  // A bare boolean is the shorthand for "this is or is not a weapon" and nothing else.
  if (typeof value === "boolean") return { weapon: value };
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const detail: SlotWeaponDetail = {};
  if (typeof record.weapon === "boolean") detail.weapon = record.weapon;
  if (typeof record.damage === "string" && record.damage.trim()) detail.damage = record.damage.trim();
  if (Array.isArray(record.traits)) {
    const traits = record.traits.map((trait) => String(trait).trim()).filter(Boolean);
    if (traits.length) detail.traits = traits;
    // An empty array needs an explicit marker: otherwise a completely blank
    // editor record would turn into a needless persistent override.
    if (!traits.length && record.traitsCleared === true) {
      detail.traits = [];
      detail.traitsCleared = true;
    }
  }
  if (typeof record.range === "string" && record.range.trim()) detail.range = record.range.trim();
  if (typeof record.notes === "string" && record.notes.trim()) detail.notes = record.notes.trim();
  return Object.keys(detail).length ? detail : undefined;
}

export function slotWeapon(sheet: Record<string, unknown>, listKey: string, index: number) {
  const stored = sheet[weaponOverrideKey(listKey)];
  return Array.isArray(stored) ? readDetail(stored[index]) : undefined;
}

/**
 * The list's records with one slot changed. An empty or absent detail drops the
 * record, returning the slot to whatever its text reads as. Trailing gaps are
 * trimmed so an untouched list stores nothing at all.
 */
export function setSlotWeapon(
  sheet: Record<string, unknown>,
  listKey: string,
  index: number,
  detail: SlotWeaponDetail | undefined
) {
  const stored = sheet[weaponOverrideKey(listKey)];
  const records = Array.isArray(stored) ? [...stored] : [];
  while (records.length <= index) records.push(null);
  records[index] = readDetail(detail) ?? null;
  while (records.length && (records[records.length - 1] === null || records[records.length - 1] === undefined))
    records.pop();
  return records as (SlotWeaponDetail | null)[];
}

/**
 * Everything known about what a filled slot holds: the reading of its own text,
 * with anything recorded by hand laid over the top.
 */
export function slotIsWeapon(
  label: string,
  detail: SlotWeaponDetail | undefined,
  reading: WeaponReading = {}
): ItemClassification {
  return mergeWeaponDetail(classifyItemLabel(label, reading), detail);
}

/** A reading with a hand-written record laid over it. */
export function mergeWeaponDetail(read: ItemClassification, detail: SlotWeaponDetail | undefined): ItemClassification {
  if (!detail) return read;
  const damage = detail.damage ?? read.damage;
  const traits = detail.traits ?? read.traits;
  const range = detail.range ?? read.range;
  return {
    weapon: detail.weapon ?? read.weapon,
    ...(damage ? { damage } : {}),
    ...(traits?.length ? { traits } : {}),
    ...(range ? { range } : {}),
    ...(detail.notes ? { notes: detail.notes } : {})
  };
}
