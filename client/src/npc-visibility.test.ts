import { describe, expect, it } from "vitest";
import { npcRevealCopy } from "./npc-visibility";

describe("npcRevealCopy", () => {
  it("makes the limited player-facing scope explicit when revealed", () => {
    expect(npcRevealCopy(true)).toEqual({
      action: "Hide from players",
      state: "Revealed to players",
      detail: "Players can mention this NPC by name. Notes and stats remain GM-only."
    });
  });

  it("does not imply that hidden NPC details are player-readable", () => {
    expect(npcRevealCopy(false)).toEqual({
      action: "Reveal to players",
      state: "Hidden from players",
      detail: "Players cannot mention this NPC until you reveal their name."
    });
  });
});
