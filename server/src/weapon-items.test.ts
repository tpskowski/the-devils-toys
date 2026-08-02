import { describe, expect, it } from "vitest";
import {
  classifyItem,
  classifyItemLabel,
  damageExpression,
  itemRange,
  readiedWeapons,
  weaponsInHand,
  itemDamage,
  itemTraits,
  setSlotWeapon,
  slotIsWeapon,
  slotWeapon,
  splitItemLabel
} from "@devils-toys/shared";

describe("splitting a slot's stored text", () => {
  it("takes the name and the parenthetical beside it", () => {
    expect(splitItemLabel("Rifle (D8, bulky, mid/long-range)")).toEqual({
      name: "Rifle",
      spec: "D8, bulky, mid/long-range",
      trailing: ""
    });
  });

  it("matches the closing parenthesis rather than the first one", () => {
    expect(splitItemLabel("Repeater (D10 or D8 blast (heavy), bulky) Particle beams.")).toEqual({
      name: "Repeater",
      spec: "D10 or D8 blast (heavy), bulky",
      trailing: "Particle beams."
    });
  });

  it("leaves an item with no parenthetical alone", () => {
    expect(splitItemLabel("Grappling Hook")).toEqual({ name: "Grappling Hook", spec: "", trailing: "" });
  });
});

describe("reading damage out of a parenthetical", () => {
  it("takes the die the books write", () => {
    expect(itemDamage("D8, bulky, mid/long-range")).toBe("D8");
    expect(itemDamage("d10 damage, bulky")).toBe("d10");
    expect(itemDamage("2D4 blast")).toBe("2D4");
    expect(itemDamage("D6 blast, mid-range")).toBe("D6");
  });

  it("keeps dice the book adds together", () => {
    expect(itemDamage("D10+D10, enhanced when hidden, bulky")).toBe("D10+D10");
  });

  it("ignores a die that counts something other than damage", () => {
    // Monolith's tools wear out over uses; its gasmask filters for a while.
    expect(itemDamage("1D6 uses")).toBeUndefined();
    expect(itemDamage("1D4 uses")).toBeUndefined();
    expect(itemDamage("Filtration d8 usage")).toBeUndefined();
    expect(itemDamage("DEX save or stunned for 1D4 rounds")).toBeUndefined();
    expect(itemDamage("4 inventory slots")).toBeUndefined();
  });

  it("still finds the damage when a count comes first", () => {
    // Monolith's flare gun: "(3 uses, D6 thermal)".
    expect(itemDamage("3 uses, D6 thermal")).toBe("D6");
  });

  it("finds nothing in armour and sockets", () => {
    expect(itemDamage("Armor 2, bulky")).toBeUndefined();
    expect(itemDamage("+1 Armor")).toBeUndefined();
    expect(itemDamage("2 Leg Sockets")).toBeUndefined();
  });
});

describe("reading traits out of a parenthetical", () => {
  it("takes every term that is not the damage", () => {
    expect(itemTraits("D8, bulky, mid/long-range")).toEqual(["bulky", "mid/long-range"]);
    expect(itemTraits("D6 blast, mid-range")).toEqual(["blast", "mid-range"]);
    expect(itemTraits("D6, Cheap, S-R")).toEqual(["Cheap", "S-R"]);
  });

  it("strips the alternatives a weapon offers", () => {
    // Monolith's repeater: "(D10 or D8 blast, bulky, mid-range)".
    expect(itemTraits("D10 or D8 blast, bulky, mid-range")).toEqual(["blast", "bulky", "mid-range"]);
  });

  it("does not leave the word Cairn spells out behind", () => {
    expect(itemTraits("d10 damage, bulky")).toEqual(["bulky"]);
    expect(itemTraits("d6 damage")).toEqual([]);
  });

  it("keeps a weapon that is nothing but its die traitless", () => {
    expect(itemTraits("2D4")).toEqual([]);
    expect(itemTraits("D10+D10, enhanced when hidden, bulky")).toEqual(["enhanced when hidden", "bulky"]);
  });
});

describe("classifying an item", () => {
  it("takes the book's own category as saying so", () => {
    // A stun gun states a save, not a die, and is a weapon regardless.
    expect(
      classifyItem({
        category: "STANDARD WEAPONS",
        spec: "DEX Save vs Impaired 1 round, S-R, recharges in 1 round",
        weaponCategories: ["STANDARD WEAPONS"]
      })
    ).toEqual({
      weapon: true,
      traits: ["DEX Save vs Impaired 1 round", "S-R", "recharges in 1 round"],
      range: "unknown"
    });
  });

  it("catches a weapon the book files elsewhere", () => {
    // Monolith's sledgehammer sits under TOOLS.
    expect(classifyItem({ category: "TOOLS", spec: "D8, bulky", weaponCategories: ["STANDARD WEAPONS"] })).toEqual({
      weapon: true,
      damage: "D8",
      traits: ["bulky"],
      range: "unknown"
    });
  });

  it("leaves traits off anything that is not a weapon", () => {
    expect(classifyItem({ category: "ARMOR", spec: "Armor 2, bulky" })).toEqual({ weapon: false });
  });

  it("leaves ordinary gear alone", () => {
    expect(classifyItem({ category: "TOOLS", spec: "1D6 uses", weaponCategories: ["STANDARD WEAPONS"] })).toEqual({
      weapon: false
    });
    expect(classifyItem({ category: "ARMOR", spec: "Armor 2, bulky", weaponCategories: ["STANDARD WEAPONS"] })).toEqual(
      { weapon: false }
    );
  });

  it("reads a description only where it says outright that dice are damage", () => {
    // Monolith's Frog Tongue Mutation, whose parenthetical is its socket — and
    // so is not the trait list it would be on a weapon out of the armoury.
    expect(
      classifyItem({
        category: "GENETIC MODIFICATION",
        spec: "Lower Face Socket",
        detail: "You have a long sticky tongue that extends 20 feet. 1D6 damage and can grab small objects."
      })
    ).toEqual({ weapon: true, damage: "1D6", range: "unknown" });

    expect(
      classifyItem({
        category: "CONSUMABLES",
        spec: "1 use",
        detail: "Gain 1D6 temporary HP for 10 minutes."
      })
    ).toEqual({ weapon: false });
  });

  it("classifies free text with no category the same way", () => {
    expect(classifyItemLabel("Rusty Machete (d8 damage, rusted)")).toEqual({
      weapon: true,
      damage: "d8",
      traits: ["rusted"],
      range: "unknown"
    });
    expect(classifyItemLabel("Bedroll")).toEqual({ weapon: false });
  });
});

describe("what a slot records about its weapon", () => {
  it("stores a record against its slot", () => {
    const records = setSlotWeapon({}, "inventory", 2, { weapon: true, damage: "d8" });
    expect(records).toEqual([null, null, { weapon: true, damage: "d8" }]);
    expect(slotWeapon({ inventoryWeapons: records }, "inventory", 2)).toEqual({ weapon: true, damage: "d8" });
    expect(slotWeapon({ inventoryWeapons: records }, "inventory", 0)).toBeUndefined();
  });

  it("keeps damage, traits, and notes", () => {
    const detail = { damage: "2d6", traits: ["bulky", "loud"], notes: "Jams on a 1." };
    const records = setSlotWeapon({}, "inventory", 0, detail);
    expect(slotWeapon({ inventoryWeapons: records }, "inventory", 0)).toEqual(detail);
  });

  it("drops fields that say nothing", () => {
    const records = setSlotWeapon({}, "inventory", 0, { damage: "  ", traits: [], notes: "" });
    expect(records).toEqual([]);
  });

  it("trims itself away when the last record is dropped", () => {
    expect(setSlotWeapon({ inventoryWeapons: [null, { weapon: true }] }, "inventory", 1, undefined)).toEqual([]);
  });

  it("keeps earlier records when a later one is dropped", () => {
    const sheet = { inventoryWeapons: [{ weapon: true }, { weapon: false }] };
    expect(setSlotWeapon(sheet, "inventory", 1, undefined)).toEqual([{ weapon: true }]);
  });

  it("reads a bare boolean as the shorthand it is", () => {
    expect(slotWeapon({ inventoryWeapons: [true] }, "inventory", 0)).toEqual({ weapon: true });
  });

  it("overrules the reading in both directions", () => {
    expect(slotIsWeapon("Sharpened Spoon", { weapon: true })).toEqual({ weapon: true });
    expect(slotIsWeapon("Rifle (D8, bulky)", { weapon: false })).toEqual({
      weapon: false,
      damage: "D8",
      traits: ["bulky"],
      range: "unknown"
    });
    expect(slotIsWeapon("Rifle (D8, bulky)", undefined)).toEqual({
      weapon: true,
      damage: "D8",
      traits: ["bulky"],
      range: "unknown"
    });
  });

  it("lays a record over the reading field by field", () => {
    expect(slotIsWeapon("Rifle (D8, bulky)", { damage: "D10", notes: "Scoped." })).toEqual({
      weapon: true,
      damage: "D10",
      traits: ["bulky"],
      range: "unknown",
      notes: "Scoped."
    });
  });

  it("lets a recorded weapon carry what its text never said", () => {
    expect(slotIsWeapon("Sharpened Spoon", { weapon: true, damage: "d4", traits: ["concealed"] })).toEqual({
      weapon: true,
      damage: "d4",
      traits: ["concealed"]
    });
  });
});

describe("turning a weapon's damage into a roll", () => {
  it("rolls a single die as written", () => {
    expect(damageExpression("D8")).toBe("1d8");
    expect(damageExpression("d10", "keep-highest")).toBe("1d10");
  });

  it("adds a pool the book states as one, such as a high-energy weapon's 2D4", () => {
    expect(damageExpression("2D4", "keep-highest")).toBe("2d4");
  });

  it("keeps the highest of several attack dice, which is what D6+D6 means", () => {
    expect(damageExpression("D6+D6", "keep-highest")).toBe("2d6kh1");
    expect(damageExpression("D10+D10", "keep-highest")).toBe("2d10kh1");
    // Without that rule the extra die is simply another die in the pool.
    expect(damageExpression("D6+D6")).toBe("2d6");
  });

  it("refuses what one roll cannot say", () => {
    // Two attack dice of different sizes: Monolith's one such weapon.
    expect(damageExpression("D6+D4", "keep-highest")).toBeUndefined();
    expect(damageExpression("D5")).toBeUndefined();
    expect(damageExpression("a stern look")).toBeUndefined();
    expect(damageExpression("")).toBeUndefined();
  });

  it("reads the damage a slot states, so a typed weapon rolls too", () => {
    expect(damageExpression(classifyItemLabel("Sword (d6, bulky)").damage!)).toBe("1d6");
  });
});

describe("how far a weapon reaches", () => {
  // Monolith's own vocabulary: bands written as codes or spelled out, and a
  // melee weapon the armoury names without ever giving it a trait.
  const monolith = {
    melee: [String.raw`\bmelee\b`, String.raw`^c-?r$`, String.raw`^close(?:\s+range)?$`],
    ranged: [String.raw`range`, String.raw`\b[csmf]-r\b`, String.raw`\b(?:feet|foot|ft)\b`]
  };

  it("calls a weapon melee from its trait or its name", () => {
    expect(itemRange({ traits: ["melee", "-1 if opponent has armor"] }, monolith)).toBe("Melee");
    expect(itemRange({ name: "Medium Melee", traits: [] }, monolith)).toBe("Melee");
  });

  it("reports a range in the book's own words", () => {
    expect(itemRange({ traits: ["Cheap", "S-R"] }, monolith)).toBe("S-R");
    expect(itemRange({ traits: ["bulky", "mid/long-range"] }, monolith)).toBe("mid/long-range");
    expect(itemRange({ traits: ["blast", "30 feet"] }, monolith)).toBe("30 feet");
  });

  it("says unknown where the book says nothing, and never guesses", () => {
    expect(itemRange({ name: "High-Energy Blaster", traits: ["blast"] }, monolith)).toBe("unknown");
    // A system that states no ranges at all leaves every weapon unknown.
    expect(itemRange({ name: "Sword", traits: ["bulky"] }, undefined)).toBe("unknown");
  });

  it("is carried on the classification, so every weapon has one", () => {
    expect(classifyItemLabel("Rifle (D8, bulky, mid-range)", { weaponRange: monolith })).toEqual({
      weapon: true,
      damage: "D8",
      traits: ["bulky", "mid-range"],
      range: "mid-range"
    });
  });
});

describe("what is in hand", () => {
  const list = { key: "equipment", slots: ["Body 1", "Body 2", "Body 3", "Body 4", "Pack 1"], groupStarts: [4] };
  const carrying = {
    equipment: [
      "Rifle (D8, bulky, mid/long-range)",
      "Small Melee (D6)",
      "Junky Blaster (D6, Cheap, S-R)",
      "",
      "Medium Melee (D8)"
    ]
  };

  it("offers what is within reach, marking what takes both hands", () => {
    // The medium melee is in the pack, so it is not to hand at all; the rifle is
    // to hand and bulky, which is a fact about pairing rather than about drawing.
    expect(readiedWeapons(carrying, list).map((weapon) => `${weapon.name}${weapon.bulky ? " (bulky)" : ""}`)).toEqual([
      "Rifle (bulky)",
      "Small Melee",
      "Junky Blaster"
    ]);
  });

  it("falls back to the first within reach until a choice is made", () => {
    expect(weaponsInHand(carrying, list).main?.name).toBe("Rifle");
    expect(weaponsInHand(carrying, list).offhand).toBeUndefined();
  });

  it("refuses to pair anything with a two-handed weapon", () => {
    const bulky = { ...carrying, weaponSlot: 0, weaponOffhandSlot: 1, dualWield: true };
    expect(weaponsInHand(bulky, list).canPair, "the rifle takes both hands").toBe(false);
    expect(weaponsInHand(bulky, list).offhand).toBeUndefined();
    // Nor as the second weapon, where the first leaves a hand free.
    const paired = { ...carrying, weaponSlot: 1, weaponOffhandSlot: 0, dualWield: true };
    expect(weaponsInHand(paired, list).offhand).toBeUndefined();
  });

  it("takes the slots the sheet chose, and only pairs them when told to", () => {
    const chosen = { ...carrying, weaponSlot: 2, weaponOffhandSlot: 1 };
    expect(weaponsInHand(chosen, list).main?.name).toBe("Junky Blaster");
    expect(weaponsInHand(chosen, list).offhand, "an off hand needs the toggle").toBeUndefined();
    expect(weaponsInHand({ ...chosen, dualWield: true }, list).offhand?.name).toBe("Small Melee");
  });

  it("ignores a choice that no longer holds a weapon it could draw", () => {
    // Slot 3 is empty, and slot 4 is in the pack rather than to hand.
    expect(weaponsInHand({ ...carrying, weaponSlot: 3 }, list).main?.name).toBe("Rifle");
    expect(weaponsInHand({ ...carrying, weaponSlot: 4 }, list).main?.name).toBe("Rifle");
  });

  it("never puts the same weapon in both hands", () => {
    const both = { ...carrying, weaponSlot: 1, weaponOffhandSlot: 1, dualWield: true };
    expect(weaponsInHand(both, list).offhand).toBeUndefined();
  });

  it("pairs two light weapons when the sheet says to", () => {
    const pair = { ...carrying, weaponSlot: 1, weaponOffhandSlot: 2, dualWield: true };
    expect(weaponsInHand(pair, list).main?.name).toBe("Small Melee");
    expect(weaponsInHand(pair, list).offhand?.name).toBe("Junky Blaster");
    expect(weaponsInHand({ ...pair, dualWield: false }, list).offhand, "one hand unless told").toBeUndefined();
  });

  it("reads four slots where a system does not group them", () => {
    const plain = { key: "inventory", slots: Array.from({ length: 10 }, (_, index) => `Slot ${index + 1}`) };
    const sheet = { inventory: ["", "", "", "", "Sword (d6)"] };
    expect(readiedWeapons(sheet, plain)).toEqual([]);
    expect(readiedWeapons({ inventory: ["Sword (d6)"] }, plain).map((weapon) => weapon.name)).toEqual(["Sword"]);
  });
});
