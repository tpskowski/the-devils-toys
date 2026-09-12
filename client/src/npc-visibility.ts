/**
 * Revealing an NPC makes only its identity available to players. The status
 * wording stays shared between the GM's quick panel and Room Config so neither
 * surface implies that statblocks or notes are being published.
 */
export function npcRevealCopy(revealed: boolean) {
  return revealed
    ? {
        action: "Hide from players",
        state: "Revealed to players",
        detail: "Players can mention this NPC by name. Notes and stats remain GM-only."
      }
    : {
        action: "Reveal to players",
        state: "Hidden from players",
        detail: "Players cannot mention this NPC until you reveal their name."
      };
}
