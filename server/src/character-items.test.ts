import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCharacterItems } from "./character-items.js";
import { projectFile } from "./paths.js";

const monolith = fs.readFileSync(projectFile("raw", "Monolith.md"), "utf8");
const gear = parseCharacterItems(
  monolith,
  ["ARMORY", "EQUIPMENT"],
  ["LAND VEHICLES (DAILY RENTING PRICE IS 1/1OTH COST)", "FOOD, DRINKS, & SERVICES", "SPECIALISTS (COST IS DAILY)"]
);
const augments = parseCharacterItems(monolith, ["AUGMENTATIONS"]);

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
    expect(gear.find((item) => item.name === "Rifle")).toEqual({
      category: "STANDARD WEAPONS",
      name: "Rifle",
      spec: "D8, bulky, mid/long-range",
      detail: "Particle beam energy bolts.",
      cost: "500",
      bulky: true,
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

  it("keeps the first entry when a name repeats across tables", () => {
    const labels = gear.map((item) => item.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});
