import { describe, expect, it } from "vitest";
import type { CharacterItem, SystemItemCatalog } from "@devils-toys/shared";
import { SYSTEM_IDS } from "@devils-toys/shared";
import { catalogFromRulebook, mergeCatalog, readItemCatalog, seedItemCatalog } from "./item-catalog.js";
import { characterItem, characterItemsFor } from "./character-items.js";

function catalog(items: Partial<CharacterItem>[]): SystemItemCatalog {
  return {
    system: "monolith",
    source: "Monolith.md",
    lists: {
      equipment: items.map((item) => ({
        id: "monolith/thing",
        category: "GEAR",
        name: "Thing",
        spec: "",
        detail: "",
        cost: "1",
        bulky: false,
        weapon: false,
        label: "Thing",
        ...item
      }))
    }
  };
}

describe("seeding a catalogue from a rulebook", () => {
  // The rule the whole arrangement rests on: the book seeds the catalogue once
  // and never again decides what is in it.
  it("keeps an entry the catalogue already holds, however the book reads it", () => {
    const edited = catalog([{ id: "monolith/knife", name: "Knife", weapon: true, damage: "d8", traits: ["silenced"] }]);
    const book = catalog([{ id: "monolith/knife", name: "Knife", weapon: false }]);

    const { catalog: merged, added } = mergeCatalog(edited, book);
    expect(added).toEqual([]);
    expect(merged.lists.equipment[0]).toMatchObject({ weapon: true, damage: "d8", traits: ["silenced"] });
  });

  it("never brings back an entry the catalogue retired", () => {
    // The book still prices "Heavy Weapons"; the catalogue replaced that one row
    // with the two weapons its own description names, and means it.
    const existing = {
      ...catalog([{ id: "monolith/mini-gun", name: "Mini Gun" }]),
      retired: ["monolith/heavy-weapons"]
    };
    const book = catalog([
      { id: "monolith/heavy-weapons", name: "Heavy Weapons" },
      { id: "monolith/rifle", name: "Rifle" }
    ]);

    const { catalog: merged, added } = mergeCatalog(existing, book);
    expect(added).toEqual(["monolith/rifle"]);
    expect(merged.lists.equipment.map((item) => item.id)).toEqual(["monolith/mini-gun", "monolith/rifle"]);
    expect(merged.retired).toEqual(["monolith/heavy-weapons"]);
  });

  it("takes only the entries the catalogue has never seen", () => {
    const existing = catalog([{ id: "monolith/knife", name: "Knife" }]);
    const book = catalog([
      { id: "monolith/knife", name: "Knife", cost: "999" },
      { id: "monolith/rifle", name: "Rifle", weapon: true, damage: "D8" }
    ]);

    const { catalog: merged, added } = mergeCatalog(existing, book);
    expect(added).toEqual(["monolith/rifle"]);
    expect(merged.lists.equipment.map((item) => item.id)).toEqual(["monolith/knife", "monolith/rifle"]);
    // The one it already had keeps its own cost, not the book's.
    expect(merged.lists.equipment[0].cost).toBe("1");
  });

  it("never drops an entry the book stopped offering, and says so", () => {
    const existing = catalog([
      { id: "monolith/knife", name: "Knife" },
      { id: "monolith/homebrew-axe", name: "Homebrew Axe", weapon: true }
    ]);
    const book = catalog([{ id: "monolith/knife", name: "Knife" }]);

    const { catalog: merged, unmatched } = mergeCatalog(existing, book);
    expect(unmatched).toEqual(["monolith/homebrew-axe"]);
    expect(merged.lists.equipment.map((item) => item.id)).toContain("monolith/homebrew-axe");
  });

  it("adds nothing on a second run", () => {
    const book = catalog([{ id: "monolith/knife", name: "Knife" }]);
    const once = mergeCatalog(catalog([]), book);
    const twice = mergeCatalog(once.catalog, book);
    expect(twice.added).toEqual([]);
    expect(twice.catalog).toEqual(once.catalog);
  });

  it.each(SYSTEM_IDS)("has nothing new to fold into %s today", (system) => {
    const { added, catalog: merged } = seedItemCatalog(system);
    expect(added).toEqual([]);
    expect(merged).toEqual(readItemCatalog(system));
  });
});

describe("the committed item catalogues", () => {
  it.each(SYSTEM_IDS)("is what %s serves at runtime", (system) => {
    expect(characterItemsFor(system)).toEqual(readItemCatalog(system).lists);
  });

  it("gives every item an id that is unique within its system", () => {
    for (const system of SYSTEM_IDS) {
      const items = Object.values(readItemCatalog(system).lists).flat();
      const ids = items.map((item) => item.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.every((id) => id.startsWith(`${system}/`))).toBe(true);
    }
  });

  it("looks an item up by the id it was seeded with", () => {
    expect(characterItem("monolith", "monolith/rifle")).toMatchObject({ name: "Rifle", weapon: true, damage: "D8" });
    expect(characterItem("monolith", "monolith/medkit")).toMatchObject({ name: "Medkit", weapon: false });
    expect(characterItem("monolith", "monolith/no-such-thing")).toBeUndefined();
  });

  it("holds a weapon the book itself does not describe as one", () => {
    // The gland's damage sits in a second parenthetical, so the parser reads it
    // as ordinary gear. The catalogue says otherwise, and the catalogue wins —
    // which is the arrangement working, not a discrepancy to reconcile.
    const seeded = catalogFromRulebook("monolith").lists.augmentations.find((item) => item.name === "Basilisk Gland");
    expect(seeded?.weapon).toBe(false);
    expect(characterItem("monolith", "monolith/basilisk-gland")).toMatchObject({
      name: "Basilisk Gland",
      weapon: true,
      damage: "1D8"
    });
  });

  it("records what Monolith's gear is, so a change to it has to be deliberate", () => {
    const lists = readItemCatalog("monolith").lists;
    // The book's two generic rows — "Heavy Weapons", "Stationary Weapons" — were
    // retired in favour of the four weapons their own descriptions name.
    expect(lists.equipment).toHaveLength(81);
    expect(lists.augmentations).toHaveLength(16);
    expect(
      Object.values(lists)
        .flat()
        .filter((item) => item.weapon)
    ).toHaveLength(41);
    expect(readItemCatalog("monolith").retired).toEqual(["monolith/heavy-weapons", "monolith/stationary-weapons"]);
  });

  it("has nothing to say for the systems whose gear tables are not read yet", () => {
    // Cairn's tables are priced under a "Price" column and CWN's weapons are not
    // Markdown tables at all. Both are empty on purpose, not by accident.
    expect(readItemCatalog("cairn").lists).toEqual({});
    expect(readItemCatalog("cwn").lists).toEqual({});
  });
});
