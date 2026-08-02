import { describe, expect, it } from "vitest";
import { canControlCombatant, clampMapPosition } from "./encounter-control";
import type { EncounterCombatant } from "./EncounterPage";

const combatant = (patch: Partial<EncounterCombatant>): EncounterCombatant => ({
  id: 1,
  kind: "npc",
  name: "Goblin",
  side: "enemies",
  initiative: null,
  actsFirstTurn: null,
  sortOrder: 0,
  included: true,
  ...patch
});

describe("encounter map control", () => {
  it("gives the GM every token and players only their characters and hirelings", () => {
    const npc = combatant({});
    const own = combatant({ kind: "character", character: { ownerAccountId: 7 } as never });
    const other = combatant({ kind: "character", character: { ownerAccountId: 8 } as never });
    const hireling = combatant({ kind: "hireling" });

    expect(canControlCombatant(npc, true, 7)).toBe(true);
    expect(canControlCombatant(npc, false, 7)).toBe(false);
    expect(canControlCombatant(own, false, 7)).toBe(true);
    expect(canControlCombatant(other, false, 7)).toBe(false);
    expect(canControlCombatant(hireling, false, 7)).toBe(true);
  });

  it("keeps token centers away from the map's clipped edge", () => {
    expect(clampMapPosition(-1)).toBe(0.03);
    expect(clampMapPosition(0.5)).toBe(0.5);
    expect(clampMapPosition(2)).toBe(0.97);
  });
});
