import { describe, expect, it } from "vitest";
import type { CharacterItem, SystemItemCatalog } from "@devils-toys/shared";
import { catalogFromRulebook, mergeCatalog, readItemCatalog, seedItemCatalog } from "./item-catalog.js";
import { characterItem, characterItemsFor } from "./character-items.js";
import { installToybox } from "./test-fixture.js";

installToybox();

function catalog(items: Partial<CharacterItem>[]): SystemItemCatalog {
  return {
    system: "toybox",
    source: "Toybox.md",
    lists: {
      equipment: items.map((item) => ({
        id: "toybox/thing",
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
    const edited = catalog([{ id: "toybox/knife", name: "Knife", weapon: true, damage: "d8", traits: ["silenced"] }]);
    const book = catalog([{ id: "toybox/knife", name: "Knife", weapon: false }]);

    const { catalog: merged, added } = mergeCatalog(edited, book);
    expect(added).toEqual([]);
    expect(merged.lists.equipment[0]).toMatchObject({ weapon: true, damage: "d8", traits: ["silenced"] });
  });

  it("never brings back an entry the catalogue retired", () => {
    // The book still prices "Heavy Weapons"; the catalogue replaced that one row
    // with the two weapons its own description names, and means it.
    const existing = {
      ...catalog([{ id: "toybox/mini-gun", name: "Mini Gun" }]),
      retired: ["toybox/heavy-weapons"]
    };
    const book = catalog([
      { id: "toybox/heavy-weapons", name: "Heavy Weapons" },
      { id: "monolith/rifle", name: "Rifle" }
    ]);

    const { catalog: merged, added } = mergeCatalog(existing, book);
    expect(added).toEqual(["monolith/rifle"]);
    expect(merged.lists.equipment.map((item) => item.id)).toEqual(["toybox/mini-gun", "monolith/rifle"]);
    expect(merged.retired).toEqual(["toybox/heavy-weapons"]);
  });

  it("takes only the entries the catalogue has never seen", () => {
    const existing = catalog([{ id: "toybox/knife", name: "Knife" }]);
    const book = catalog([
      { id: "toybox/knife", name: "Knife", cost: "999" },
      { id: "monolith/rifle", name: "Rifle", weapon: true, damage: "D8" }
    ]);

    const { catalog: merged, added } = mergeCatalog(existing, book);
    expect(added).toEqual(["monolith/rifle"]);
    expect(merged.lists.equipment.map((item) => item.id)).toEqual(["toybox/knife", "monolith/rifle"]);
    // The one it already had keeps its own cost, not the book's.
    expect(merged.lists.equipment[0].cost).toBe("1");
  });

  it("never drops an entry the book stopped offering, and says so", () => {
    const existing = catalog([
      { id: "toybox/knife", name: "Knife" },
      { id: "monolith/homebrew-axe", name: "Homebrew Axe", weapon: true }
    ]);
    const book = catalog([{ id: "toybox/knife", name: "Knife" }]);

    const { catalog: merged, unmatched } = mergeCatalog(existing, book);
    expect(unmatched).toEqual(["monolith/homebrew-axe"]);
    expect(merged.lists.equipment.map((item) => item.id)).toContain("monolith/homebrew-axe");
  });

  it("adds nothing on a second run", () => {
    const book = catalog([{ id: "toybox/knife", name: "Knife" }]);
    const once = mergeCatalog(catalog([]), book);
    const twice = mergeCatalog(once.catalog, book);
    expect(twice.added).toEqual([]);
    expect(twice.catalog).toEqual(once.catalog);
  });

  it("has nothing new to fold into the committed catalogue today", () => {
    const { added, catalog: merged } = seedItemCatalog("toybox");
    expect(added).toEqual([]);
    expect(merged).toEqual(readItemCatalog("toybox"));
  });
});

describe("the committed item catalogue", () => {
  it("is what the system serves at runtime", () => {
    expect(characterItemsFor("toybox")).toEqual(readItemCatalog("toybox").lists);
  });

  it("gives every item an id that is unique within its system", () => {
    const items = Object.values(readItemCatalog("toybox").lists).flat();
    const ids = items.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id.startsWith("toybox/"))).toBe(true);
  });

  it("looks an item up by the id it was seeded with", () => {
    expect(characterItem("toybox", "toybox/longblade")).toMatchObject({
      name: "Longblade",
      weapon: true,
      damage: "d8"
    });
    expect(characterItem("toybox", "toybox/lantern")).toMatchObject({ name: "Lantern", weapon: false });
    expect(characterItem("toybox", "toybox/no-such-thing")).toBeUndefined();
  });

  it("holds a weapon the book itself does not describe as one", () => {
    // The fixture's book prices a crowbar as a tool with no die, so the parser
    // reads it as ordinary gear. The catalogue says otherwise, and the catalogue
    // wins — the arrangement working, not a discrepancy to reconcile.
    const seeded = catalogFromRulebook("toybox").lists.inventory.find((item) => item.name === "Crowbar");
    expect(seeded?.weapon).toBe(false);
    expect(characterItem("toybox", "toybox/crowbar")).toMatchObject({
      name: "Crowbar",
      weapon: true,
      damage: "d6"
    });
  });

  it("never brings back an id the catalogue has retired", () => {
    const retired = readItemCatalog("toybox").retired ?? [];
    expect(retired).toContain("toybox/bent-nail");
    const ids = Object.values(readItemCatalog("toybox").lists)
      .flat()
      .map((item) => item.id);
    for (const id of retired) expect(ids).not.toContain(id);
    // And a reseed leaves it retired, which is the point of recording it.
    expect(seedItemCatalog("toybox").added).toEqual([]);
  });

  it("is empty rather than absent for a system whose gear tables are not read", () => {
    // A system may price its gear in a shape the parser does not read, or have no
    // priced gear at all. Empty on purpose is a different thing from missing.
    expect(catalogFromRulebook("toybox").lists.inventory.length).toBeGreaterThan(0);
    expect(mergeCatalog(catalog([]), { system: "toybox", source: "Toybox.md", lists: {} }).catalog.lists).toEqual({
      equipment: []
    });
  });
});
