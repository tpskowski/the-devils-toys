import { describe, expect, it } from "vitest";
import type { SystemTraitCatalog } from "@devils-toys/shared";
import { describeTraits, findTrait, traitKeys, traitSummary } from "@devils-toys/shared";
import { mergeTraits, readTraitCatalog, traitsFromRulebook } from "./trait-catalog.js";
import { characterItemsFor, itemTraitsFor } from "./character-items.js";
import { installToybox } from "./test-fixture.js";

installToybox();

describe("reading what a book says its words mean", () => {
  const book = traitsFromRulebook("toybox");
  const trait = (id: string) => book.traits.find((entry) => entry.id === id);

  it("takes every definition under the headings the system names", () => {
    expect(trait("thrown")).toEqual({
      id: "thrown",
      label: "Thrown",
      description: "May be used at range once, and is then wherever it landed.",
      category: "Gear Properties"
    });
  });

  it("keeps a condition apart from what the trait does", () => {
    // "- **Sweep:** (Bulky) Long weapons that reach a second adjacent enemy…"
    expect(trait("sweep")).toMatchObject({
      appliesTo: "Bulky",
      description: "Long weapons that reach a second adjacent enemy on a hit."
    });
  });

  it("reads an abbreviation as part of the label, not as a separate trait", () => {
    expect(trait("armour-piercing-ap")?.label).toBe("Armour Piercing (AP)");
    expect(book.traits.filter((entry) => entry.label.includes("Armour Piercing"))).toHaveLength(1);
  });

  it("records which book it read, so a catalogue can be traced to a source", () => {
    expect(book).toMatchObject({ system: "toybox", source: "Toybox.md" });
  });

  it("takes nothing the book does not state in a definition list", () => {
    // Prose is not a definition. A word stated only in a sentence has to be
    // written into the catalogue by hand, and stays there.
    expect(book.traits.map((entry) => entry.id)).not.toContain("deprived");
    expect(findTrait(itemTraitsFor("toybox"), "bulky")).toMatchObject({ label: "Bulky" });
  });
});

describe("keeping a trait catalogue", () => {
  const catalog = (traits: SystemTraitCatalog["traits"]): SystemTraitCatalog => ({
    system: "toybox",
    source: "Toybox.md",
    traits
  });

  it("never rewrites an entry the catalogue already holds", () => {
    const existing = catalog([{ id: "thermal", label: "Thermal", description: "Ours, corrected." }]);
    const book = catalog([{ id: "thermal", label: "Thermal", description: "The book's." }]);
    const { catalog: merged, added } = mergeTraits(existing, book);
    expect(added).toEqual([]);
    expect(merged.traits[0].description).toBe("Ours, corrected.");
  });

  it("adds what the book states and the catalogue has never seen", () => {
    const { catalog: merged, added } = mergeTraits(
      catalog([{ id: "thermal", label: "Thermal", description: "Ours." }]),
      catalog([
        { id: "thermal", label: "Thermal", description: "The book's." },
        { id: "cryo", label: "Cryo", description: "STR Save or do half damage on next attack." }
      ])
    );
    expect(added).toEqual(["cryo"]);
    expect(merged.traits.map((entry) => entry.id)).toEqual(["thermal", "cryo"]);
  });

  it("leaves a hand-written trait alone when the book no longer states it", () => {
    const { catalog: merged, unmatched } = mergeTraits(
      catalog([{ id: "bulky", label: "Bulky", description: "Takes two slots." }]),
      catalog([])
    );
    expect(unmatched).toEqual(["bulky"]);
    expect(merged.traits).toHaveLength(1);
  });
});

describe("matching a word on an item to its definition", () => {
  const traits = itemTraitsFor("toybox");

  it("finds a trait however the armoury happens to write it", () => {
    expect(findTrait(traits, "Thrown")?.id).toBe("thrown");
    expect(findTrait(traits, "thrown")?.id).toBe("thrown");
    // "Armour Piercing (AP)" is the sort of label a book writes both ways.
    expect(findTrait(traits, "AP")?.id).toBe("armour-piercing-ap");
    expect(findTrait(traits, "Armour Piercing")?.id).toBe("armour-piercing-ap");
    expect(traitKeys({ id: "armour-piercing-ap", label: "Armour Piercing (AP)" })).toContain("ap");
  });

  it("keeps a word nobody defined, since players write their own", () => {
    expect(findTrait(traits, "sticky")).toBeUndefined();
    expect(describeTraits(["thrown", "sticky"], traits)).toEqual([
      { written: "thrown", summary: traitSummary(findTrait(traits, "thrown")!) },
      { written: "sticky", summary: "sticky" }
    ]);
  });

  it("says what a trait is in one line, condition and all", () => {
    expect(traitSummary(findTrait(traits, "sweep")!)).toBe(
      "Sweep — Bulky — Long weapons that reach a second adjacent enemy on a hit."
    );
  });
});

describe("what the catalogues actually carry", () => {
  it("defines the words its own weapons are written with, or leaves them plainly undefined", () => {
    // Not every word in a parenthetical is a trait — "must spend a round
    // reloading" is a sentence — so this reports rather than demands. It exists
    // to notice a word the book defines that the catalogue somehow missed.
    const traits = itemTraitsFor("toybox");
    const written = new Set<string>();
    for (const items of Object.values(characterItemsFor("toybox")))
      for (const item of items) for (const word of item.traits ?? []) written.add(word);
    const defined = [...written].filter((word) => findTrait(traits, word));

    expect(written.size).toBeGreaterThan(0);
    expect(defined.length).toBeGreaterThanOrEqual(2);
    expect(readTraitCatalog("toybox").traits).toEqual(traits);
  });
});
