import { describe, expect, it } from "vitest";
import type { CharacterItem, CharacterListDefinition } from "@devils-toys/shared";
import { characterItemsForSlot, slotClassification, weaponTraitSuggestions } from "./character-items";

const list: CharacterListDefinition = {
  key: "augmentations",
  label: "Augmentations",
  slots: ["Eyes", "Skin", "Left Leg"],
  slotTypes: ["eyes", "skin", "leg"]
};

function item(name: string, allowedSlotTypes?: string[]): CharacterItem {
  return {
    id: `monolith/${name.toLowerCase()}`,
    category: "Augments",
    name,
    spec: "",
    detail: "",
    cost: "Play",
    bulky: false,
    weapon: false,
    label: name,
    allowedSlotTypes
  };
}

describe("augmentation menu slot restrictions", () => {
  const catalogue = [
    item("Oculus", ["eyes"]),
    item("Tendons", ["leg"]),
    item("Mutation", ["internal", "skin"]),
    item("Unrestricted")
  ];

  it("shows only matching and unrestricted items for a typed slot", () => {
    expect(characterItemsForSlot(catalogue, list, 0).map((entry) => entry.name)).toEqual(["Oculus", "Unrestricted"]);
    expect(characterItemsForSlot(catalogue, list, 1).map((entry) => entry.name)).toEqual(["Mutation", "Unrestricted"]);
  });

  it("keeps the full catalogue for lists without typed slots", () => {
    expect(characterItemsForSlot(catalogue, { ...list, slotTypes: undefined }, 0)).toBe(catalogue);
  });
});

describe("what a filled slot holds", () => {
  const inventory: CharacterListDefinition = {
    key: "inventory",
    label: "Inventory",
    slots: ["Slot 1", "Slot 2"],
    weaponCategories: ["STANDARD WEAPONS"]
  };

  const rifle: CharacterItem = {
    id: "monolith/rifle",
    category: "STANDARD WEAPONS",
    name: "Rifle",
    spec: "D8, bulky, mid/long-range",
    detail: "Particle beam energy bolts.",
    cost: "500",
    bulky: true,
    weapon: true,
    damage: "D8",
    traits: ["bulky", "mid/long-range"],
    label: "Rifle (D8, bulky, mid/long-range)"
  };

  const held = { weapon: true, damage: "D8", traits: ["bulky", "mid/long-range"] };

  it("trusts the catalogue for an item chosen from it", () => {
    expect(slotClassification(rifle.label, {}, inventory, 0, [rifle])).toEqual(held);
  });

  it("reads a typed item from its own notation", () => {
    expect(slotClassification("Rusty Machete (d8, rusted)", {}, inventory, 0, [])).toEqual({
      weapon: true,
      damage: "d8",
      traits: ["rusted"],
      // The list states no range vocabulary, so nothing is read into one.
      range: "unknown"
    });
    expect(slotClassification("Rope (25ft)", {}, inventory, 0, [])).toEqual({ weapon: false });
  });

  it("takes what the slot records over what the item reads as", () => {
    const marked = { inventoryWeapons: [{ weapon: true, damage: "d4", notes: "Sharpened on a rock." }] };
    expect(slotClassification("Sharpened Spoon", marked, inventory, 0, [])).toEqual({
      weapon: true,
      damage: "d4",
      notes: "Sharpened on a rock."
    });

    const cleared = { inventoryWeapons: [{ weapon: false }] };
    expect(slotClassification(rifle.label, cleared, inventory, 0, [rifle])).toEqual({ ...held, weapon: false });
  });

  it("leaves an unrecorded slot following its item", () => {
    expect(
      slotClassification(rifle.label, { inventoryWeapons: [null, { weapon: true }] }, inventory, 0, [rifle])
    ).toEqual(held);
  });

  it("offers the traits this system's own weapons use", () => {
    expect(weaponTraitSuggestions([rifle, item("Bedroll")])).toEqual(["bulky", "mid/long-range"]);
  });
});
