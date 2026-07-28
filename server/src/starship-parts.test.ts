import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { parseStarshipParts } from "./starship-parts.js";
import { projectFile } from "./paths.js";

const monolith = fs.readFileSync(projectFile("raw", "Monolith.md"), "utf8");
const parts = parseStarshipParts(monolith);

describe("reading a system's starship parts", () => {
  it("collects every parts table under the heading", () => {
    expect([...new Set(parts.map((part) => part.category))]).toEqual([
      "WEAPON MODULES",
      "HULL MODULES",
      "ENGINE MODULES",
      "SYSTEM MODULES",
      "QUARTERS"
    ]);
    expect(parts.length).toBeGreaterThan(40);
  });

  it("splits a part into its name, the book's parenthetical, and the rest", () => {
    expect(parts.find((part) => part.name === "Auto-Gun")).toEqual({
      category: "WEAPON MODULES",
      name: "Auto-Gun",
      spec: "D6",
      detail: "Most common starship weaponry.",
      cost: "500",
      bulky: false,
      label: "Auto-Gun (D6)"
    });
  });

  it("keeps the emphasis and critical effects of a weapon readable", () => {
    const turret = parts.find((part) => part.name === "Hellfire Turret");
    expect(turret?.label).toBe("Hellfire Turret (D8)");
    expect(turret?.detail).toBe("Critical Effect: Overheat (Engineer loses next turn.)");
    expect(turret?.cost).toBe("1,500");
  });

  it("marks the parts the book calls bulky, however it is capitalised", () => {
    const bulky = parts.filter((part) => part.bulky).map((part) => part.name);
    expect(bulky).toEqual([
      "Emerald Star Particle Array",
      "Ultra-Hot Chaingun",
      "Disintegrator Beam",
      "Nanobot Veil Generator",
      "Neutron Titanium Husk",
      "Condensed Power Supply",
      "Quantum Operating System"
    ]);
  });

  it("reads quarters written as a bolded name with a colon", () => {
    expect(parts.find((part) => part.name === "Crew Quarters")).toEqual({
      category: "QUARTERS",
      name: "Crew Quarters",
      spec: "",
      detail: "Rest comfortably on the ship (6 persons per crew quarter)",
      cost: "300",
      bulky: false,
      label: "Crew Quarters"
    });
    const smuggling = parts.find((part) => part.name === "Smuggling Compartments");
    expect(smuggling?.label).toBe("Smuggling Compartments");
    expect(smuggling?.detail).toBe("Carry 4 trade goods in a single hold (hidden).");
  });

  it("keeps free parts and nested parentheses intact", () => {
    expect(parts.find((part) => part.name === "Flak Cannon")?.cost).toBe("Free");
    expect(parts.find((part) => part.name === "Unstable Shield-Gen")?.label).toBe(
      "Unstable Shield-Gen (1D6 SHI, re-roll every time shields recharge.)"
    );
  });

  it("returns nothing when a system has no parts list", () => {
    expect(parseStarshipParts("# Cairn\n\nNo starships here.")).toEqual([]);
  });
});
