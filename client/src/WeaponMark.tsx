import { Swords } from "lucide-react";
import type { ItemClassification, ItemTrait, RangedWeaponIcon } from "@devils-toys/shared";
import { describeTraits, MELEE_RANGE } from "@devils-toys/shared";
import { useHoverTip } from "./HoverTip";
import { BowIcon, GunIcon } from "./WeaponIcons";

/**
 * What a slot's weapon carries, shown beside it. The damage is the part read at a
 * glance mid-combat, so it is the only thing spelled out; traits and notes ride
 * in the tooltip rather than crowding a ten-slot inventory.
 *
 * Given `onRoll`, the mark is the button that rolls the weapon's damage — who is
 * allowed to is the caller's to decide, since it depends on whose weapon it is.
 */
export function WeaponMark({
  held,
  name,
  size = 14,
  rangedIcon,
  traits,
  onRoll
}: {
  held: ItemClassification;
  /** What the weapon is called, for the attack the mark offers to roll. */
  name?: string;
  size?: number;
  /**
   * Draws the mark by reach where the surface knows the system: crossed swords
   * for melee, and this for everything else — including a weapon whose range the
   * book never stated, since an unknown reach is far likelier to be a shot than
   * a swing on a sheet that bothered to record it.
   */
  rangedIcon?: RangedWeaponIcon;
  /** The system's own definitions, so the tooltip can say what its words mean. */
  traits?: readonly ItemTrait[];
  onRoll?: () => void;
}) {
  // The range is stated in its own right, so the trait it was read from is not
  // repeated underneath as though it were something else the weapon does.
  const words = (held.traits ?? []).filter((word) => word.toLocaleLowerCase() !== held.range?.toLocaleLowerCase());
  // Each word the book defines is then spelled out on its own line; one it never
  // defined — a player's own — is shown as written.
  const spelled = describeTraits(words, traits).map((trait) => trait.summary);
  const summary = [held.damage, held.range, held.notes].filter(Boolean).join(" — ");
  const description = [summary ? `Weapon — ${summary}` : "Weapon", ...spelled].join("\n");
  // What the button does, what with, how far, and what the book says about it.
  const attack = [
    ["Roll attack", name, held.damage, held.range, words.join(", ")].filter(Boolean).join(" — "),
    ...spelled
  ].join("\n");
  const tip = useHoverTip(onRoll ? attack : description);
  if (!held.weapon) return null;
  const Icon = !rangedIcon || held.range === MELEE_RANGE ? Swords : rangedIcon === "bow" ? BowIcon : GunIcon;
  const content = (
    <>
      <Icon size={size} aria-hidden="true" />
      {held.damage && <small>{held.damage}</small>}
      {!held.damage && held.traits?.length ? <small>{held.traits[0]}</small> : null}
    </>
  );
  if (!onRoll)
    return (
      <span className="character-slot-weapon" aria-label={description} {...tip.props}>
        {content}
        {tip.node}
      </span>
    );
  return (
    <button
      type="button"
      className="character-slot-weapon character-slot-weapon-roll"
      aria-label={attack}
      onClick={onRoll}
      {...tip.props}
    >
      {content}
      {tip.node}
    </button>
  );
}
