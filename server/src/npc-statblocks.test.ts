import { describe, expect, it } from "vitest";
import { npcCatalog } from "./npcs.js";
import { parseCairnNpcStatblock, parseCwnNpcStatblock, parseNpcStatblock } from "./npc-statblocks.js";

describe("NPC statblock parsers", () => {
  it.each([
    ["cairn", "*12 HP, 2 Armor, 14 STR, 1 DEX, 8 WIL, bite (d10)*"],
    ["monolith", "12 HP, 2 Armor, 14 STR, 8 DEX, 4 WIL, plasma-saw (D10)"],
    [
      "cwn",
      "HD:\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a01 (5 HP+2)\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0Atk:\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0+1r/+1m\nAC:\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a013r/10m\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0Dmg:\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0Wpn"
    ]
  ])("parses %s stat lines", (system, markdown) => {
    const parsed = parseNpcStatblock(system as "cairn" | "monolith" | "cwn", markdown);
    expect(typeof parsed.fields.hp).toBe("number");
    expect(parsed.unparsed).toBe(markdown);
  });

  it("keeps Cairn armor defaults and attacks", () => {
    expect(parseCairnNpcStatblock("4 HP, 8 STR, 14 DEX, 8 WIL, spear (d6)").fields).toEqual({
      hp: 4,
      armor: 0,
      str: 8,
      dex: 14,
      wil: 8,
      attacks: "spear (d6)"
    });
  });

  it("keeps CWN damage soak and tail text", () => {
    const parsed = parseCwnNpcStatblock(
      "HD:        1 (5 HP+2)        Atk:        +1r/+1m\nAC:        13r/10m          Dmg:        Wpn\n\nReinforced Clothing\nHeavy Pistol (1d8)"
    );
    expect(parsed.fields).toMatchObject({
      hd: 1,
      hp: 5,
      damageSoak: 2,
      acRanged: "13r",
      acMelee: "10m",
      gear: "Reinforced Clothing\nHeavy Pistol (1d8)"
    });
  });

  it.each(["cairn", "monolith", "cwn"] as const)("parses every %s catalogue entry with numeric HP", (system) => {
    const entries = npcCatalog(system);
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) expect(typeof parseNpcStatblock(system, entry.markdown).fields.hp).toBe("number");
  });
});
