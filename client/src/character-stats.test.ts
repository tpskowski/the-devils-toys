import { describe, expect, it } from "vitest";
import { currentsToBackfill, hasNumericValue } from "./character-stats";

const rows = [
  { currentKey: "hpCurrent", maximumKey: "hpMax" },
  { currentKey: "strCurrent", maximumKey: "strMax" },
  { currentKey: "dexCurrent", maximumKey: "dexMax" }
];

describe("paired stat maximums", () => {
  it("recognizes which sheet values hold a number", () => {
    expect(hasNumericValue(3)).toBe(true);
    expect(hasNumericValue(0)).toBe(true);
    expect(hasNumericValue("7")).toBe(true);
    expect(hasNumericValue("")).toBe(false);
    expect(hasNumericValue("   ")).toBe(false);
    expect(hasNumericValue(undefined)).toBe(false);
    expect(hasNumericValue(null)).toBe(false);
    expect(hasNumericValue("dagger")).toBe(false);
    expect(hasNumericValue(true)).toBe(false);
  });

  it("starts a blank current at its maximum", () => {
    expect(currentsToBackfill({ hpMax: 6, strMax: 12, dexMax: 9 }, rows)).toEqual({
      hpCurrent: 6,
      strCurrent: 12,
      dexCurrent: 9
    });
  });

  it("leaves a current alone once it holds a number, including zero", () => {
    const sheet = { hpCurrent: 0, hpMax: 6, strCurrent: 4, strMax: 12, dexCurrent: "", dexMax: 9 };

    expect(currentsToBackfill(sheet, rows)).toEqual({ dexCurrent: 9 });
  });

  it("has nothing to copy when the maximum itself is unset", () => {
    expect(currentsToBackfill({ hpMax: "", strMax: undefined }, rows)).toEqual({});
  });
});
