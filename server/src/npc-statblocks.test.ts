import { describe, expect, it } from "vitest";
import { npcCatalog } from "./npcs.js";
import {
  parseCairnNpcStatblock,
  parseCwnNpcStatblock,
  parseNpcStatblock,
  parseStatblockWith
} from "./npc-statblocks.js";
import { installToybox } from "./test-fixture.js";

installToybox();

/**
 * There are two parsers and a system picks one by name. The cases below used to
 * be one per compiled system; they are one per *parser* now, which is what was
 * always being tested — a system contributes nothing here but its choice.
 */
describe("NPC statblock parsers", () => {
  it.each([
    ["inline", "*12 HP, 2 Armor, 14 STR, 1 DEX, 8 WIL, bite (d10)*"],
    ["inline", "12 HP, 2 Armor, 14 STR, 8 DEX, 4 WIL, plasma-saw (D10)"],
    ["labelled", "HD:         1 (5 HP+2)          Atk:         +1r/+1m\nAC:         13r/10m         Dmg:        Wpn"]
  ] as const)("parses %s stat lines", (parser, markdown) => {
    const parsed = parseStatblockWith(parser, markdown);
    expect(typeof parsed.fields.hp).toBe("number");
    expect(parsed.unparsed).toBe(markdown);
  });

  it("takes the parser a system declares", () => {
    // The fixture declares "inline", so this is the same reading by another road.
    expect(parseNpcStatblock("toybox", "10 HP, 2 Armor, 14 Muscle, 6 Nerve, 4 Knack, fist (d8)").fields.hp).toBe(10);
  });

  it("keeps inline armor defaults and attacks", () => {
    expect(parseCairnNpcStatblock("4 HP, 8 STR, 14 DEX, 8 WIL, spear (d6)").fields).toEqual({
      hp: 4,
      armor: 0,
      str: 8,
      dex: 14,
      wil: 8,
      attacks: "spear (d6)"
    });
  });

  it("keeps labelled damage soak and tail text", () => {
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

  it("parses every catalogue entry a system's bestiary offers", () => {
    const entries = npcCatalog("toybox");
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) expect(typeof parseNpcStatblock("toybox", entry.markdown).fields.hp).toBe("number");
  });
});
