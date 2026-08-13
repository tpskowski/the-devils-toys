import { describe, expect, it } from "vitest";
import type { SystemTraitCatalog } from "@devils-toys/shared";
import { BUILTIN_SYSTEM_IDS, describeTraits, findTrait, traitKeys, traitSummary } from "@devils-toys/shared";
import { mergeTraits, readTraitCatalog, traitsFromRulebook } from "./trait-catalog.js";
import { characterItemsFor, itemTraitsFor } from "./character-items.js";

describe("reading what a book says its words mean", () => {
  const monolith = traitsFromRulebook("monolith");
  const trait = (id: string) => monolith.traits.find((entry) => entry.id === id);

  it("takes every definition under the headings the system names", () => {
    expect(trait("thermal")).toEqual({
      id: "thermal",
      label: "Thermal",
      description: "DEX Save or take 1D4 heat damage for 1D4 rounds.",
      category: "DAMAGE TYPES"
    });
  });

  it("keeps a condition apart from what the trait does", () => {
    // "- **Sweep:** (Bulky) Long weapons that allow a second attack…"
    expect(trait("sweep")).toMatchObject({
      appliesTo: "Bulky",
      description: "Long weapons that allow a second attack on an adjacent opponent."
    });
  });

  it("reads nothing from a book that defines its words in prose alone", () => {
    // Cairn states bulk in a sentence, not a definition list, so the catalogue's
    // own entry is the only one there is.
    expect(traitsFromRulebook("cairn").traits).toEqual([]);
    expect(findTrait(itemTraitsFor("cairn"), "bulky")).toMatchObject({ label: "Bulky" });
  });
});

describe("keeping a trait catalogue", () => {
  const catalog = (traits: SystemTraitCatalog["traits"]): SystemTraitCatalog => ({
    system: "monolith",
    source: "Monolith.md",
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
  const traits = itemTraitsFor("monolith");

  it("finds a trait however the armoury happens to write it", () => {
    expect(findTrait(traits, "Thermal")?.id).toBe("thermal");
    expect(findTrait(traits, "thermal")?.id).toBe("thermal");
    // "Armor Piercing (AP)" is written both ways in the book.
    expect(findTrait(traits, "AP")?.id).toBe("armor-piercing-ap");
    expect(findTrait(traits, "Armor Piercing")?.id).toBe("armor-piercing-ap");
    expect(traitKeys({ id: "armor-piercing-ap", label: "Armor Piercing (AP)" })).toContain("ap");
  });

  it("keeps a word nobody defined, since players write their own", () => {
    expect(findTrait(traits, "sticky")).toBeUndefined();
    expect(describeTraits(["thermal", "sticky"], traits)).toEqual([
      { written: "thermal", summary: traitSummary(findTrait(traits, "thermal")!) },
      { written: "sticky", summary: "sticky" }
    ]);
  });

  it("says what a trait is in one line, condition and all", () => {
    expect(traitSummary(findTrait(traits, "sweep")!)).toBe(
      "Sweep — Bulky — Long weapons that allow a second attack on an adjacent opponent."
    );
  });
});

describe("what the catalogues actually carry", () => {
  it("defines the words its own weapons are written with, or leaves them plainly undefined", () => {
    // Not every word in a parenthetical is a trait — "must spend a round
    // reloading" is a sentence — so this reports rather than demands. It exists
    // to notice a word the book defines that the catalogue somehow missed.
    for (const system of BUILTIN_SYSTEM_IDS) {
      const traits = itemTraitsFor(system);
      const written = new Set<string>();
      for (const items of Object.values(characterItemsFor(system)))
        for (const item of items) for (const word of item.traits ?? []) written.add(word);
      const defined = [...written].filter((word) => findTrait(traits, word));
      // Monolith writes damage types and properties beside its weapons; a system
      // with no priced tables yet has nothing to check.
      if (system === "monolith") expect(defined.length).toBeGreaterThan(3);
      expect(readTraitCatalog(system).traits).toEqual(traits);
    }
  });
});
