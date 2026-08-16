import { describe, expect, it } from "vitest";
import { allowedSlotTypes, parseCharacterItems } from "./character-items.js";

/**
 * Reading gear out of a priced table.
 *
 * The corpus used to be Monolith's armoury, read from `raw/Monolith.md`. That
 * book is a repository of its own now, so the tables below were written to hold
 * one row for each thing the parser has to get right — which is a good deal
 * easier to read than finding the row in a 177 KB book that proves the point.
 *
 * Every category name is shouted, as a priced table's header always is.
 */
const book = `# A Book

## ARMORY

| BLADES | COST |
| --- | --- |
| Shortblade (D6) Dagger, knife, shiv. | 100 |
| Greatblade (D10, bulky) | 300 |
| Net (STR Save vs Restrained) | 80 |
| Repeater (D6, Blast, bulky, mid-range) | 400 |

| ARMOR | COST |
| --- | --- |
| Padded Coat (Armor 1) | 100 |
| Plated Suit (Armor 2, bulky) | 400 |

## EQUIPMENT

| TOOLS | COST | TOOLS | COST |
| --- | --- | --- | --- |
| Sledgehammer (D8) | 40 | Lockpicks (D6 uses) | 60 |
| Blowtorch (10 uses) | 90 | Flare Gun (D6) | 70 |
| Add on price for each extra charge | | Rope, 50 feet (bulky) | 20 |

| SERVICES | COST |
| --- | --- |
| Stevedore | 25 |

## MODIFICATIONS

| GRAFTS | COST |
| --- | --- |
| Brass Eye (Eyes Socket) | 500 |
| Spring Tendons (2 Leg Sockets) | 700 |
| Ash Lung (Internal & Skin Sockets) | 900 |
| Hooked Tongue (Lower-Face Socket) Deals 1D6 damage at reach. | 650 |
| Second Liver (Internal Socket) | 400 |
`;

const gear = parseCharacterItems(book, ["ARMORY", "EQUIPMENT"], {
  skipCategories: ["SERVICES"],
  weaponCategories: ["BLADES"],
  weaponRange: { melee: [String.raw`\bmelee\b`], ranged: [String.raw`range`] }
});
const grafts = parseCharacterItems(book, ["MODIFICATIONS"]);
const named = (name: string) => gear.find((item) => item.name === name);
const graft = (name: string) => grafts.find((item) => item.name === name);

describe("reading a system's carryable gear", () => {
  it("gathers every category under the headings it was given", () => {
    expect([...new Set(gear.map((item) => item.category))]).toEqual(["BLADES", "ARMOR", "TOOLS"]);
  });

  it("splits an item into its name, the book's parenthetical, and the rest", () => {
    expect(named("Shortblade")).toEqual({
      category: "BLADES",
      name: "Shortblade",
      spec: "D6",
      detail: "Dagger, knife, shiv.",
      cost: "100",
      bulky: false,
      weapon: true,
      damage: "D6",
      range: "unknown",
      label: "Shortblade (D6)"
    });
  });

  it("reads both halves of a table that sets two item columns side by side", () => {
    const tools = gear.filter((item) => item.category === "TOOLS").map((item) => item.name);
    // The left column, and the right column that shares its rows.
    expect(tools).toContain("Sledgehammer");
    expect(tools).toContain("Lockpicks");
    expect(tools).toContain("Rope, 50 feet");
  });

  it("leaves out categories that are priced but not carried", () => {
    expect(gear.some((item) => item.name === "Stevedore")).toBe(false);
  });

  it("skips note rows that carry no price", () => {
    expect(gear.some((item) => item.name.startsWith("Add on price"))).toBe(false);
  });

  it("marks what the parenthetical calls bulky", () => {
    expect(named("Greatblade")?.bulky).toBe(true);
    expect(named("Rope, 50 feet")?.bulky).toBe(true);
    expect(named("Shortblade")?.bulky).toBe(false);
  });

  it("stocks sockets from the tables it was pointed at alone", () => {
    expect([...new Set(grafts.map((item) => item.category))]).toEqual(["GRAFTS"]);
    expect(graft("Brass Eye")?.spec).toBe("Eyes Socket");
    expect(grafts.some((item) => item.name === "Shortblade")).toBe(false);
  });

  it("retains every socket restriction written in the tables", () => {
    expect(graft("Brass Eye")?.allowedSlotTypes).toEqual(["eyes"]);
    expect(graft("Spring Tendons")?.allowedSlotTypes).toEqual(["leg"]);
    expect(graft("Ash Lung")?.allowedSlotTypes).toEqual(["internal", "skin"]);
    expect(graft("Hooked Tongue")?.allowedSlotTypes).toEqual(["lower-face"]);
    expect(grafts.every((item) => item.allowedSlotTypes?.length)).toBe(true);
  });

  it("does not treat ordinary item parentheticals as socket restrictions", () => {
    expect(allowedSlotTypes("D8, bulky, mid/long-range")).toBeUndefined();
  });

  it("keeps the first entry when a name repeats across tables", () => {
    const labels = gear.map((item) => item.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe("telling the weapons from the rest of the gear", () => {
  it("takes every entry under a weapon category, die or no die", () => {
    expect(gear.filter((item) => item.category === "BLADES").every((item) => item.weapon)).toBe(true);

    // A net states a save rather than damage, and is still a weapon.
    expect(named("Net")?.weapon).toBe(true);
    expect(named("Net")?.damage).toBeUndefined();
  });

  it("catches the weapons the book files under something else", () => {
    expect(named("Sledgehammer")).toMatchObject({ category: "TOOLS", weapon: true, damage: "D8" });
    expect(named("Flare Gun")).toMatchObject({ category: "TOOLS", weapon: true, damage: "D6" });
  });

  it("does not mistake a die that counts something else", () => {
    // Lockpicks wear out over so many uses; that is not damage.
    expect(named("Lockpicks")).toMatchObject({ weapon: false });
    expect(named("Blowtorch")).toMatchObject({ weapon: false });
    expect(gear.filter((item) => item.category === "ARMOR").some((item) => item.weapon)).toBe(false);
  });

  it("records the damage and the traits the parenthetical states", () => {
    expect(named("Greatblade")).toMatchObject({ damage: "D10", traits: ["bulky"] });
    expect(named("Repeater")).toMatchObject({ damage: "D6", traits: ["Blast", "bulky", "mid-range"] });
  });

  it("reads a range out of the traits, in the book's own words", () => {
    expect(named("Repeater")?.range).toBe("mid-range");
  });

  it("leaves damage and traits off anything that is not a weapon", () => {
    expect(named("Padded Coat")).toMatchObject({ weapon: false });
    expect(named("Padded Coat")?.damage).toBeUndefined();
    expect(named("Padded Coat")?.traits).toBeUndefined();
  });

  it("finds a socketed weapon whose damage is only in its description", () => {
    // The parenthetical is the socket, so the damage is stated in the prose —
    // and the socket is not a trait of anything.
    expect(graft("Hooked Tongue")).toMatchObject({ weapon: true, damage: "1D6" });
    expect(graft("Hooked Tongue")?.traits).toBeUndefined();
    expect(graft("Second Liver")?.weapon).toBe(false);
  });
});
