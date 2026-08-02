import type { EncounterCombatant } from "./EncounterPage";

/**
 * Mirrors the server's encounter-placement rule. The GM controls the whole
 * board; a player controls their own characters and the party's hirelings.
 */
export function canControlCombatant(combatant: EncounterCombatant, isGm: boolean, viewerId: number) {
  return (
    isGm ||
    combatant.kind === "hireling" ||
    (combatant.kind === "character" && combatant.character?.ownerAccountId === viewerId)
  );
}

export function clampMapPosition(value: number) {
  return Math.min(0.97, Math.max(0.03, value));
}
