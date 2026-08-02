import { useEffect, useId, useRef, useState } from "react";
import { Check, Swords, X } from "lucide-react";
import type { CharacterItem, ItemClassification, SlotWeaponDetail, WeaponRangeRules } from "@devils-toys/shared";
import { classifyItemLabel, UNKNOWN_RANGE } from "@devils-toys/shared";
import { ALL_WEAPONS, allWeapons } from "./character-items";

/** Traits are held as text while being edited, so a half-typed comma is not a trait. */
function parseTraits(value: string) {
  return value
    .split(",")
    .map((trait) => trait.trim())
    .filter(Boolean);
}

function sameTraits(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((trait, index) => trait === right[index]);
}

/**
 * Fills one slot. An item can be chosen from the system's own tables or typed in
 * freely, so anything the book never priced still has a home — and a weapon can
 * carry its damage, its traits, and whatever else is worth remembering, whether
 * or not the book ever stated them.
 */
export function CharacterItemEditor({
  slotName,
  items,
  current,
  currentWeapon,
  weaponCategories,
  weaponRange,
  traitSuggestions = [],
  onCancel,
  onSubmit
}: {
  slotName: string;
  items: readonly CharacterItem[];
  current: string;
  /** What the slot already records about its weapon, when it records anything. */
  currentWeapon: SlotWeaponDetail | undefined;
  weaponCategories?: readonly string[];
  weaponRange?: WeaponRangeRules;
  traitSuggestions?: readonly string[];
  onCancel: () => void;
  onSubmit: (value: string, weapon: SlotWeaponDetail | undefined) => void;
}) {
  const [value, setValue] = useState(current);
  // Undefined until the box is touched, so an untouched slot keeps reading its
  // own text rather than freezing whatever it happened to say when opened.
  const [weapon, setWeapon] = useState<boolean | undefined>(currentWeapon?.weapon);
  const [damage, setDamage] = useState(currentWeapon?.damage ?? "");
  const [traits, setTraits] = useState((currentWeapon?.traits ?? []).join(", "));
  const [traitsTouched, setTraitsTouched] = useState(false);
  const [range, setRange] = useState(currentWeapon?.range ?? "");
  const [notes, setNotes] = useState(currentWeapon?.notes ?? "");
  const [notesTouched, setNotesTouched] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const traitListId = useId();
  const categories = [...new Set(items.map((item) => item.category))];
  // The catalogue's own all-weapons table, above the headings the book files
  // them under, since a weapon is what someone is usually reaching for.
  const weapons = allWeapons(items);
  const chosen = items.find((item) => item.label === value);

  const read: ItemClassification = chosen
    ? {
        weapon: chosen.weapon,
        ...(chosen.damage ? { damage: chosen.damage } : {}),
        ...(chosen.traits?.length ? { traits: chosen.traits } : {}),
        ...(chosen.range ? { range: chosen.range } : {})
      }
    : classifyItemLabel(value, { weaponCategories, weaponRange });
  const isWeapon = weapon ?? read.weapon;

  // The editor opens below a list that can be long enough to scroll, so bring it
  // into view rather than leaving the pencil looking like it did nothing.
  useEffect(() => {
    panel.current?.scrollIntoView({ block: "nearest" });
  }, []);

  /** Picking a different item makes the old record meaningless, so drop it. */
  function replace(next: string) {
    setValue(next);
    setWeapon(undefined);
    setDamage("");
    setTraits("");
    setTraitsTouched(false);
    setRange("");
    setNotes("");
    setNotesTouched(false);
  }

  /**
   * Only what disagrees with the reading is kept, so an ordinary weapon keeps
   * following its own notation instead of pinning a copy of it to the sheet.
   */
  function record(): SlotWeaponDetail | undefined {
    if (!value.trim()) return undefined;
    const detail: SlotWeaponDetail = {};
    if (isWeapon !== read.weapon) detail.weapon = isWeapon;
    if (isWeapon) {
      const typed = parseTraits(traits);
      if (damage.trim() && damage.trim() !== read.damage) detail.damage = damage.trim();
      const hasTraitOverride = currentWeapon && Object.hasOwn(currentWeapon, "traits");
      if ((traitsTouched || hasTraitOverride) && !sameTraits(typed, read.traits ?? [])) detail.traits = typed;
      if (!typed.length && (read.traits?.length || currentWeapon?.traitsCleared)) {
        detail.traits = [];
        detail.traitsCleared = true;
      }
      if (range.trim() && range.trim() !== read.range) detail.range = range.trim();
      if (notes.trim()) detail.notes = notes.trim();
      // Omitting a note from a newly written record clears one that was stored.
      if (notesTouched && !notes.trim()) delete detail.notes;
    }
    return Object.keys(detail).length ? detail : undefined;
  }

  // A div, not a form: the character sheet is itself a form, and nesting one
  // inside another makes the submit escape to the outer form and navigate away.
  return (
    <div className="character-item-editor" ref={panel} role="group" aria-label={`Fill ${slotName}`}>
      <p className="character-item-slot">{slotName}</p>
      {/* A system whose gear tables are not yet read has nothing to offer here,
          but the slot still needs the free-text field and the weapon record. */}
      {items.length > 0 && (
        <label>
          From the rules
          <select
            value={chosen?.label ?? ""}
            onChange={(event) => replace(event.target.value)}
            aria-label={`Choose an item for ${slotName}`}
          >
            <option value="">Choose an item…</option>
            {weapons.length > 0 && (
              <optgroup label={ALL_WEAPONS}>
                {weapons.map((item) => (
                  <option value={item.label} key={`all-${item.id}`}>
                    {item.label}
                    {item.cost ? ` — ${item.cost}` : ""}
                  </option>
                ))}
              </optgroup>
            )}
            {categories.map((category) => (
              <optgroup label={category} key={category}>
                {items
                  .filter((item) => item.category === category)
                  .map((item) => (
                    <option value={item.label} key={`${item.category}-${item.label}`}>
                      {item.label}
                      {item.cost ? ` — ${item.cost}` : ""}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
      )}
      <label>
        {items.length > 0 ? "Or type your own" : "What is in this slot"}
        <input
          value={value}
          placeholder="Salvage, a keepsake, anything else"
          onChange={(event) => replace(event.target.value)}
        />
      </label>
      {value.trim() && (
        <label className="character-item-weapon">
          <input type="checkbox" checked={isWeapon} onChange={(event) => setWeapon(event.target.checked)} />
          <span>This is a weapon</span>
        </label>
      )}
      {value.trim() && isWeapon && (
        <div className="character-item-weapon-detail">
          <label>
            Damage
            <input
              value={damage}
              placeholder={read.damage ?? "d6, 2d4, none"}
              onChange={(event) => setDamage(event.target.value)}
            />
          </label>
          <label>
            Range
            <input
              value={range}
              placeholder={read.range ?? UNKNOWN_RANGE}
              onChange={(event) => setRange(event.target.value)}
            />
          </label>
          <label>
            Traits
            <input
              value={traits}
              list={traitSuggestions.length ? traitListId : undefined}
              placeholder={(read.traits ?? []).join(", ") || "bulky, blast, mid-range"}
              onChange={(event) => {
                setTraitsTouched(true);
                setTraits(event.target.value);
              }}
            />
          </label>
          {traitSuggestions.length > 0 && (
            <datalist id={traitListId}>
              {traitSuggestions.map((trait) => (
                <option value={trait} key={trait} />
              ))}
            </datalist>
          )}
          <label className="character-item-weapon-notes">
            Notes
            <textarea
              value={notes}
              rows={2}
              placeholder="Anything worth remembering about this weapon"
              onChange={(event) => {
                setNotesTouched(true);
                setNotes(event.target.value);
              }}
            />
          </label>
          {(read.damage || read.traits?.length || (read.range && read.range !== UNKNOWN_RANGE)) && (
            <p className="character-item-detail">
              The rules give this{" "}
              {[read.damage, read.range === UNKNOWN_RANGE ? "" : read.range, (read.traits ?? []).join(", ")]
                .filter(Boolean)
                .join(", ")}
              . Leave a field blank to keep it.
            </p>
          )}
        </div>
      )}
      {chosen?.detail && <p className="character-item-detail">{chosen.detail}</p>}
      {chosen?.bulky && <p className="character-item-detail">The book calls this bulky — it takes two slots.</p>}
      {isWeapon && !read.weapon && value.trim() && (
        <p className="character-item-detail">
          <Swords size={14} aria-hidden="true" /> Marked by hand — the rules do not list this as a weapon.
        </p>
      )}
      <div className="character-item-actions">
        <button className="primary-button" type="button" onClick={() => onSubmit(value, record())}>
          <Check size={16} /> {value.trim() ? "Stow" : "Empty the slot"}
        </button>
        <button type="button" onClick={onCancel}>
          <X size={16} /> Cancel
        </button>
      </div>
    </div>
  );
}
