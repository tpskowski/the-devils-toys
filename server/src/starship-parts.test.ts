import { describe, expect, it } from "vitest";
import { parseStarshipParts } from "./starship-parts.js";

/**
 * Reading a ship's parts out of a priced table.
 *
 * The corpus used to be Monolith's STARSHIP PARTS section, read from
 * `raw/Monolith.md`. That book has a repository of its own now, so the tables
 * below carry one row for each thing this parser has to get right: a plain part,
 * one whose name and effect are split across a bolded run, the bolded-name-with-
 * colon shape the quarters tables use, a free part, and nested parentheses.
 */
const book = `# A Book

# STARSHIP PARTS

| WEAPON MODULES | COST |
| --- | --- |
| Flak Cannon (D4) Standard weapon, front-facing pilot use only. | Free |
| Auto-Gun (D6) Most common starship weaponry. | 500 |
| **Hellfire Turret (D8) Critical Effect:** Overheat (Engineer loses next turn.) | 1,500 |
| Ultra-Hot Chaingun (D10, Bulky) | 2,000 |

| HULL MODULES | COST |
| --- | --- |
| Neutron Titanium Husk (+2 HUL, bulky) | 1,800 |
| Unstable Shield-Gen (1D6 SHI, re-roll every time shields recharge.) | 900 |

| QUARTERS | COST |
| --- | --- |
| **Crew Quarters:** Rest comfortably on the ship (6 persons per crew quarter) | 300 |
| **Smuggling Compartments:** Carry 4 trade goods in a single hold (hidden). | 2,000 |
`;

const parts = parseStarshipParts(book);

describe("reading a system's starship parts", () => {
  it("collects every parts table under the heading", () => {
    expect([...new Set(parts.map((part) => part.category))]).toEqual(["WEAPON MODULES", "HULL MODULES", "QUARTERS"]);
    expect(parts).toHaveLength(8);
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
    expect(parts.filter((part) => part.bulky).map((part) => part.name)).toEqual([
      "Ultra-Hot Chaingun",
      "Neutron Titanium Husk"
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
    expect(parseStarshipParts("# Toybox\n\nNo starships here.")).toEqual([]);
  });
});
