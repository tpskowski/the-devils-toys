import { describe, expect, it } from "vitest";
import { monolith } from "@devils-toys/system-monolith";
import {
  applyStarshipSize,
  continuationOf,
  holdSlots,
  isContinuation,
  setHoldValue,
  starshipHolds,
  starshipSizeFor
} from "./starship";

const sheet = monolith.groupPage!.starshipSheet!;

describe("Monolith's ship sizes", () => {
  it("ships the five sizes from the rules with their holds", () => {
    expect(sheet.sizes?.map((size) => [size.label, size.holds])).toEqual([
      ["Fighter", 4],
      ["Small", 8],
      ["Medium", 12],
      ["Large", 16],
      ["Giant", 20]
    ]);
  });

  it("fixes crew, movement, and mobility per the size table", () => {
    expect(sheet.sizes?.map((size) => size.fixed)).toEqual([
      { crew: "1-2", movement: 5, mobility: 3 },
      { crew: "2-6", movement: 5, mobility: 2 },
      { crew: "6-10", movement: 4, mobility: 2 },
      { crew: "10-20", movement: 3, mobility: 1 },
      { crew: "20-50", movement: 2, mobility: 1 }
    ]);
  });

  it("prices a hull at 500C a hold and names its command room", () => {
    const [fighter, , medium, large] = sheet.sizes!;
    expect(fighter.note).toContain("base cost 2,000C");
    expect(medium.note).toContain("base cost 6,000C");
    expect(medium.note).toContain("cockpit");
    expect(large.note).toContain("bridge");
  });

  it("finds a size by id or by the label written on a sheet", () => {
    expect(starshipSizeFor(sheet, "medium")?.holds).toBe(12);
    expect(starshipSizeFor(sheet, "Medium")?.holds).toBe(12);
    expect(starshipSizeFor(sheet, " giant ")?.holds).toBe(20);
    expect(starshipSizeFor(sheet, "Corvette")).toBeUndefined();
    expect(starshipHolds(sheet, "Fighter")).toBe(4);
    expect(starshipHolds(sheet, "")).toBeUndefined();
  });
});

describe("choosing a ship size", () => {
  it("sets the base stats of a new ship", () => {
    const ship = applyStarshipSize({ name: "The Kestrel" }, sheet, "medium");
    expect(ship).toMatchObject({
      name: "The Kestrel",
      size: "Medium",
      crew: "6-10",
      movement: 4,
      mobility: 2,
      shieldsCurrent: 10,
      shieldsMax: 10,
      hullCurrent: 10,
      hullMax: 10,
      enginesCurrent: 10,
      enginesMax: 10,
      systemsCurrent: 10,
      systemsMax: 10,
      armoring: 0
    });
  });

  it("leaves the holds empty for the crew to fill", () => {
    expect(applyStarshipSize({}, sheet, "fighter").holds).toBeUndefined();
    expect(applyStarshipSize({ holds: ["Cargo"] }, sheet, "fighter").holds).toEqual(["Cargo"]);
  });

  it("keeps scores raised by modules when the hull is changed", () => {
    const worked = applyStarshipSize({ hullMax: 14, systemsMax: 18, armoring: 2 }, sheet, "large");
    expect(worked).toMatchObject({ hullMax: 14, systemsMax: 18, armoring: 2, movement: 3, mobility: 1 });
    expect(worked.shieldsMax).toBe(10);
  });

  it("always rewrites the stats the hull class decides", () => {
    const resized = applyStarshipSize({ size: "Fighter", crew: "1-2", movement: 5, mobility: 3 }, sheet, "giant");
    expect(resized).toMatchObject({ size: "Giant", crew: "20-50", movement: 2, mobility: 1 });
  });

  it("clears the size when the choice is emptied", () => {
    expect(applyStarshipSize({ size: "Medium", crew: "6-10" }, sheet, "")).toMatchObject({
      size: "",
      crew: "6-10"
    });
  });
});

describe("filling a hold", () => {
  const four = { capacity: 4 };

  it("writes a chosen or typed value into the hold", () => {
    const result = setHoldValue(["", "", "", ""], 1, "Auto-Gun (D6)", four);
    expect(result).toEqual({ ok: true, slots: ["", "Auto-Gun (D6)", "", ""] });
  });

  it("pads a ship whose holds were never recorded", () => {
    const result = setHoldValue([], 2, "Vault", four);
    expect(result.ok && result.slots).toEqual(["", "", "Vault", ""]);
  });

  it("empties a hold when the value is cleared", () => {
    const result = setHoldValue(["Vault", "", "", ""], 0, "   ", four);
    expect(result.ok && result.slots[0]).toBe("");
  });

  it("gives a bulky part the hold after it", () => {
    const result = setHoldValue(["", "", "", ""], 0, "Ultra-Hot Chaingun (D10, bulky)", { ...four, bulky: true });
    expect(result).toEqual({
      ok: true,
      slots: ["Ultra-Hot Chaingun (D10, bulky)", "↳ Ultra-Hot Chaingun (D10, bulky) (continued)", "", ""]
    });
  });

  it("refuses a bulky part when the next hold is taken", () => {
    const result = setHoldValue(["", "Mess Hall", "", ""], 0, "Neutron Titanium Husk (+6 HUL, bulky)", {
      ...four,
      bulky: true
    });
    expect(result).toEqual({ ok: false, error: "A bulky part needs two holds, and Hold 2 holds Mess Hall." });
  });

  it("refuses a bulky part in the last hold", () => {
    const result = setHoldValue(["", "", "", ""], 3, "Quantum Operating System (+6 SYS, bulky)", {
      ...four,
      bulky: true
    });
    expect(result).toEqual({ ok: false, error: "A bulky part needs two holds, and Hold 4 is the last hold." });
  });

  it("names holds the way the sheet does", () => {
    const result = setHoldValue(["", "Cargo", "", ""], 0, "Bulky thing", {
      ...four,
      bulky: true,
      slotName: (index) => `Bay ${index + 1}`
    });
    expect(result.ok === false && result.error).toContain("Bay 2 holds Cargo");
  });

  it("frees the second hold when a bulky part is replaced", () => {
    const installed = setHoldValue(["", "", "", ""], 0, "Disintegrator Beam (D10, bulky, req SYS 12)", {
      ...four,
      bulky: true
    });
    const replaced = setHoldValue(installed.ok ? installed.slots : [], 0, "Auto-Gun (D6)", four);
    expect(replaced.ok && replaced.slots).toEqual(["Auto-Gun (D6)", "", "", ""]);
  });

  it("frees the second hold when a bulky part is removed", () => {
    const installed = setHoldValue([], 1, "Condensed Power Supply (+10 Energy Reserves, Bulky)", {
      ...four,
      bulky: true
    });
    const cleared = setHoldValue(installed.ok ? installed.slots : [], 1, "", four);
    expect(cleared.ok && cleared.slots).toEqual(["", "", "", ""]);
  });

  it("recognises a continuation, whatever part it belongs to", () => {
    expect(isContinuation(continuationOf("Emerald Star Particle Array (D10, bulky)"))).toBe(true);
    expect(isContinuation("Mess Hall")).toBe(false);
    expect(isContinuation(undefined)).toBe(false);
  });

  it("shows at least the ship's capacity in slots, and keeps hidden overflow", () => {
    expect(holdSlots({ holds: ["Vault"] }, "holds", 4)).toEqual(["Vault", "", "", ""]);
    expect(holdSlots({ holds: ["a", "b", "c", "d", "e"] }, "holds", 4)).toHaveLength(5);
  });

  it("refuses a hold that is not on the ship", () => {
    expect(setHoldValue(["", "", "", ""], 9, "Vault", four)).toEqual({
      ok: false,
      error: "That hold is not on this ship."
    });
  });
});
