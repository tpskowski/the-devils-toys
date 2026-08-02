import type { EncounterCombatant } from "./EncounterPage";

/**
 * A combatant's portrait where one exists. Characters carry theirs on the sheet
 * and hirelings in `hireling_images`; NPCs have no image store, so they fall back
 * to an initial rather than leaving a ragged gap down the column.
 *
 * This lives apart from both rows that draw it so neither has to import the
 * other for it — the type import above erases, so nothing circular survives.
 */
export function CombatantAvatar({ combatant }: { combatant: EncounterCombatant }) {
  if (combatant.imageUrl)
    return <img className="combatant-avatar" src={combatant.imageUrl} alt="" loading="lazy" aria-hidden="true" />;
  return (
    <span className="combatant-avatar combatant-avatar-blank" aria-hidden="true">
      {combatant.name.trim().charAt(0).toLocaleUpperCase() || "?"}
    </span>
  );
}
