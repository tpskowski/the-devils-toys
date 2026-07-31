import { describe, expect, it } from "vitest";
import type { CharacterItem, CharacterListDefinition } from "@devils-toys/shared";
import { characterItemsForSlot } from "./character-items";

const list: CharacterListDefinition = {
  key: "augmentations",
  label: "Augmentations",
  slots: ["Eyes", "Skin", "Left Leg"],
  slotTypes: ["eyes", "skin", "leg"]
};

function item(name: string, allowedSlotTypes?: string[]): CharacterItem {
  return {
    category: "Augments",
    name,
    spec: "",
    detail: "",
    cost: "Play",
    bulky: false,
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
