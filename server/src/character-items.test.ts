import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { allowedSlotTypes, parseCharacterItems } from "./character-items.js";
import { projectFile } from "./paths.js";

const monolith = fs.readFileSync(projectFile("raw", "Monolith.md"), "utf8");
const gear = parseCharacterItems(monolith, ["ARMORY", "EQUIPMENT"], {
  skipCategories: [
    "LAND VEHICLES (DAILY RENTING PRICE IS 1/1OTH COST)",
    "FOOD, DRINKS, & SERVICES",
    "SPECIALISTS (COST IS DAILY)"
  ],
  weaponCategories: ["STANDARD WEAPONS", "HIGH ENERGY WEAPONS", "SMART WEAPONS", "EXPLOSIVES"],
  weaponRange: {
    melee: [String.raw`\bmelee\b`],
    ranged: [String.raw`range`, String.raw`\b[csmf]-r\b`]
  }
});
const augments = parseCharacterItems(monolith, ["AUGMENTATIONS"]);
const named = (name: string) => gear.find((item) => item.name === name);
const augment = (name: string) => augments.find((item) => item.name === name);

describe("reading a system's carryable gear", () => {
  it("gathers every armoury and equipment category a character can carry", () => {
    expect([...new Set(gear.map((item) => item.category))]).toEqual([
      "STANDARD WEAPONS",
      "HIGH ENERGY WEAPONS",
      "SMART WEAPONS",
      "AMMO",
      "ARMOR",
      "EXPLOSIVES",
      "CONSUMABLES",
      "GEAR",
      "TOOLS"
    ]);
  });

  it("splits an item into its name, the book's parenthetical, and the rest", () => {
    expect(named("Rifle")).toEqual({
      category: "STANDARD WEAPONS",
      name: "Rifle",
      spec: "D8, bulky, mid/long-range",
      detail: "Particle beam energy bolts.",
      cost: "500",
      bulky: true,
      weapon: true,
      damage: "D8",
      traits: ["bulky", "mid/long-range"],
      range: "mid/long-range",
      label: "Rifle (D8, bulky, mid/long-range)"
    });
  });

  it("reads both halves of a table that sets two item columns side by side", () => {
    const tools = gear.filter((item) => item.category === "TOOLS").map((item) => item.name);

    // The left column of the TOOLS table, and the right column that shares its rows.
    expect(tools).toContain("Flashlight");
    expect(tools).toContain("Auto-saw");
    expect(tools).toContain("Starship Fuel");
    expect(tools.length).toBe(28);
  });

  it("leaves out services and vehicles, which are priced but not carried", () => {
    expect(gear.some((item) => item.name === "Starship Pilot")).toBe(false);
    expect(gear.some((item) => item.name.startsWith("Cantina Meal"))).toBe(false);
    expect(gear.some((item) => item.name === "Hover-Truck")).toBe(false);
  });

  it("skips note rows that carry no price", () => {
    expect(gear.some((item) => item.name.startsWith("Add on price"))).toBe(false);
  });

  it("stocks sockets from the augmentation tables alone", () => {
    expect([...new Set(augments.map((item) => item.category))]).toEqual([
      "CYBERWARE & IMPLANTS",
      "GENETIC MODIFICATION",
      "UNKNOWABLE CHANGES"
    ]);
    expect(augments.find((item) => item.name === "Bionic Oculus")?.spec).toBe("Eyes Socket");
    expect(augments.some((item) => item.name === "Rifle")).toBe(false);
  });

  it("retains every socket restriction written in the augmentation tables", () => {
    expect(augments.find((item) => item.name === "Standard Brain-Jack")?.allowedSlotTypes).toEqual(["neural"]);
    expect(augments.find((item) => item.name === "Bionic Tendons")?.allowedSlotTypes).toEqual(["leg"]);
    expect(augments.find((item) => item.name === "Devil-Leopard Mutation")?.allowedSlotTypes).toEqual([
      "internal",
      "skin"
    ]);
    expect(augments.find((item) => item.name === "Mask of Pale Starlight")?.allowedSlotTypes).toEqual([
      "eyes",
      "lower-face"
    ]);
    expect(augments.every((item) => item.allowedSlotTypes?.length)).toBe(true);
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
    expect(gear.filter((item) => item.category === "STANDARD WEAPONS").every((item) => item.weapon)).toBe(true);

    // A stun gun states a save rather than damage, and is still a weapon.
    expect(named("Stun Gun")?.weapon).toBe(true);
    expect(named("Stun Gun")?.damage).toBeUndefined();
    expect(named("Flash Grenade")?.weapon).toBe(true);
  });

  it("catches the weapons the book files under something else", () => {
    expect(named("Sledgehammer")).toMatchObject({ category: "TOOLS", weapon: true, damage: "D8" });
    expect(named("Flare Gun")).toMatchObject({ category: "TOOLS", weapon: true, damage: "D6" });
  });

  it("does not mistake a die that counts something else", () => {
    // These wear out over so many uses; none of them is a weapon.
    for (const name of ["Auto-saw", "Auto Lock-Slicer", "Blowtorch", "Gasmask", "Duffle Bag", "Medkit"])
      expect(named(name)).toMatchObject({ weapon: false });

    expect(gear.filter((item) => item.category === "ARMOR").some((item) => item.weapon)).toBe(false);
    expect(gear.filter((item) => item.category === "CONSUMABLES").some((item) => item.weapon)).toBe(false);
  });

  it("records the damage and the traits the parenthetical states", () => {
    expect(named("Large Melee")).toMatchObject({ damage: "D10", traits: ["bulky"] });
    expect(named("Shotgun")).toMatchObject({ damage: "D6", traits: ["Blast", "bulky", "close/ short range"] });
    expect(named("Smart Sniper Rifle")).toMatchObject({
      damage: "D10+D10",
      traits: ["enhanced when hidden", "bulky"]
    });
    // The repeater rolls one die or the other; the alternatives are not a trait.
    expect(named("Repeater")).toMatchObject({ damage: "D10", traits: ["blast", "bulky", "mid-range"] });
  });

  it("leaves damage and traits off anything that is not a weapon", () => {
    expect(named("Combat Suit")).toMatchObject({ weapon: false });
    expect(named("Combat Suit")?.damage).toBeUndefined();
    expect(named("Combat Suit")?.traits).toBeUndefined();
  });

  it("finds a socketed weapon whose damage is only in its description", () => {
    // The parenthetical is the socket, so the damage is stated in the prose.
    expect(augment("Frog Tongue Mutation")).toMatchObject({ weapon: true, damage: "1D6" });
    expect(augment("Self-Sterilizing Liver")?.weapon).toBe(false);
  });

  it("reads the Basilisk Gland as ordinary gear, which the catalogue corrects", () => {
    // Its damage is in a second parenthetical, past the socket the first one
    // carries. Nothing here fixes that — `item-catalog.test.ts` covers the
    // catalogue holding the corrected entry and the seeder leaving it alone.
    expect(augment("Basilisk Gland")?.weapon).toBe(false);
  });
});
