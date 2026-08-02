import type { CharacterListDefinition } from "@devils-toys/shared";
import {
  DUAL_WIELD_KEY,
  OFFHAND_SLOT_KEY,
  WEAPON_SLOT_KEY,
  readiedSlotCount,
  weaponsInHand
} from "@devils-toys/shared";
import { WeaponMark } from "./WeaponMark";

/**
 * What this character or hireling has in hand, chosen from what they are
 * carrying within reach. A bulky weapon is drawn like any other, but it takes
 * both hands: it cannot be paired, and nothing can be paired with it.
 *
 * The sheet records slots rather than names: the same weapon can be carried
 * twice, and a name would not say which one was drawn.
 */
export function WeaponSelector({
  sheet,
  list,
  canEdit,
  onChange
}: {
  sheet: Record<string, unknown>;
  list: CharacterListDefinition;
  canEdit: boolean;
  onChange: (key: string, value: unknown) => void;
}) {
  const { readied, main, offhand, dual } = weaponsInHand(sheet, list);
  const within = readiedSlotCount(list);

  if (!readied.length)
    return (
      <p className="weapon-selector-empty">
        Nothing to hand. Stow a weapon in {list.slots.slice(0, within).length > 1 ? "one of the first" : "the first"}{" "}
        {within} {list.label.toLocaleLowerCase()} to draw it.
      </p>
    );

  const choose = (key: string) => (event: { target: { value: string } }) =>
    onChange(key, event.target.value === "" ? undefined : Number(event.target.value));

  return (
    <div className="weapon-selector">
      <label>
        <span>In hand</span>
        <select value={main ? String(main.index) : ""} disabled={!canEdit} onChange={choose(WEAPON_SLOT_KEY)}>
          <option value="">Empty-handed</option>
          {readied.map((weapon) => (
            <option value={weapon.index} key={weapon.index}>
              {list.slots[weapon.index] ?? `Slot ${weapon.index + 1}`} — {weapon.label}
            </option>
          ))}
        </select>
        {main && <WeaponMark held={main.held} name={main.name} />}
      </label>

      <label className="weapon-selector-dual">
        <input
          type="checkbox"
          checked={dual}
          disabled={!canEdit || readied.length < 2}
          onChange={(event) => onChange(DUAL_WIELD_KEY, event.target.checked ? true : undefined)}
        />
        <span>Dual wield</span>
      </label>

      {dual && (
        <label>
          <span>Off hand</span>
          <select value={offhand ? String(offhand.index) : ""} disabled={!canEdit} onChange={choose(OFFHAND_SLOT_KEY)}>
            <option value="">Nothing</option>
            {readied
              .filter((weapon) => weapon.index !== main?.index)
              .map((weapon) => (
                <option value={weapon.index} key={weapon.index}>
                  {list.slots[weapon.index] ?? `Slot ${weapon.index + 1}`} — {weapon.label}
                </option>
              ))}
          </select>
          {offhand && <WeaponMark held={offhand.held} name={offhand.name} />}
        </label>
      )}
    </div>
  );
}
