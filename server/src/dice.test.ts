import { describe, expect, it } from "vitest";
import type { GameSystem } from "@devils-toys/shared";

/**
 * Save configurations, written out rather than borrowed from a system.
 *
 * These used to be `cairn.dice`, `monolith.dice`, and `cwn.dice`, read from the
 * systems compiled into this repository. No system is, so each case now states
 * the configuration it is testing — which is what a test of `evaluateSave`
 * should have done anyway: the interesting thing is the shape, not whose it is.
 */
const rollUnder: GameSystem["dice"] = {
  save: {
    sides: 20,
    success: "equal-or-under",
    automaticSuccess: 1,
    automaticFailure: 20,
    types: [],
    outcomes: { normal: { success: "Success", failure: "Failure" } }
  }
};

const rollOver: GameSystem["dice"] = {
  save: {
    sides: 20,
    success: "equal-or-over",
    automaticSuccess: 20,
    automaticFailure: 1,
    types: [],
    outcomes: { normal: { success: "Success", failure: "Failure" } }
  }
};

/** Roll-under, and with advantage and disadvantage naming their own outcomes. */
const withQualifiedOutcomes: GameSystem["dice"] = {
  save: {
    ...rollUnder.save,
    outcomes: {
      normal: { success: "Success", failure: "Failure" },
      advantage: { success: "Enhanced success", failure: "Reduced failure" },
      disadvantage: { success: "Mixed success", failure: "Disastrous failure" }
    }
  }
};
import { evaluateCheck, evaluateSave, parseRollCommand, rollDice } from "./dice.js";

function sequence(...values: number[]) {
  let index = 0;
  return () => values[index++] ?? 0;
}

describe("dice expressions", () => {
  it("parses both roll commands", () => {
    expect(parseRollCommand("/r d20")).toBe("d20");
    expect(parseRollCommand("/roll 2d6kh1+1")).toBe("2d6kh1+1");
  });

  it("rolls deterministic dice with modifiers", () => {
    expect(rollDice("2d6+1", () => 0).total).toBe(3);
  });

  it("rolls a d30 across its full range", () => {
    expect(rollDice("d30", () => 0).total).toBe(1);
    expect(rollDice("d30", () => 0.999)).toMatchObject({ expression: "1d30", total: 30, rolls: [30] });
  });

  /**
   * A plain die, unlike d44 and d66, which are two dice read as tens and ones.
   * The regexes that accept it are built from SUPPORTED_DIE_SIDES rather than
   * spelling the list out, so this covers the roller and the alternation both.
   */
  it("rolls a d5 across its full range", () => {
    expect(rollDice("d5", () => 0)).toMatchObject({ expression: "1d5", total: 1, rolls: [1] });
    expect(rollDice("d5", () => 0.999)).toMatchObject({ expression: "1d5", total: 5, rolls: [5] });
    expect(rollDice("3d5kh1+1", sequence(0, 0.5, 0.999)).total).toBe(6);
  });

  it("still refuses a die it does not have", () => {
    expect(() => rollDice("d7")).toThrow(/dice expression/);
    expect(() => rollDice("d50")).toThrow(/dice expression/);
  });

  it("rolls d44 and d66 as separate tens and ones dice", () => {
    const d44 = rollDice("d44", sequence(0, 0.99));
    expect(d44).toMatchObject({
      expression: "1d44",
      total: 14,
      rolls: [14],
      keptRolls: [14],
      detail: "[1, 4] → 14"
    });

    const d66 = rollDice("d66+2", sequence(0.99, 0));
    expect(d66).toMatchObject({
      expression: "1d66+2",
      total: 63,
      rolls: [61],
      keptRolls: [61],
      modifier: 2
    });
    expect(d66.detail).toContain("[6, 1] → 61");
  });

  it("treats each d44 or d66 pair as one die for counts and selectors", () => {
    const result = rollDice("2d44kh1", sequence(0, 0, 0.99, 0.99));
    expect(result.rolls).toEqual([11, 44]);
    expect(result.keptRolls).toEqual([44]);
    expect(result.droppedRolls).toEqual([11]);
    expect(result.total).toBe(44);
  });

  it("keeps or drops dice before applying the modifier", () => {
    const highest = rollDice("3d6kh1+2", sequence(0, 0.5, 0.99));
    expect(highest.total).toBe(8);
    expect(highest.keptRolls).toEqual([6]);
    expect(highest.droppedRolls).toEqual([1, 4]);

    expect(rollDice("3d6dl1", sequence(0, 0.5, 0.99)).total).toBe(10);
    expect(rollDice("2d6dh1", sequence(0, 0.99)).total).toBe(1);
  });

  it("rejects unsupported dice and invalid selectors", () => {
    expect(() => rollDice("1d3")).toThrow();
    expect(() => rollDice("2d6kh3")).toThrow();
    expect(() => rollDice("2d6dl2")).toThrow();
  });
});

describe("system saves", () => {
  it("applies roll-under saves and automatic 1/20 outcomes", () => {
    expect(evaluateSave(12, 12, "normal", rollUnder).passed).toBe(true);
    expect(evaluateSave(1, 1, "normal", rollUnder).passed).toBe(true);
    expect(evaluateSave(20, 20, "normal", rollUnder).passed).toBe(false);
  });

  it("uses ADV and DIS to change outcome quality without changing the roll", () => {
    expect(evaluateSave(8, 10, "advantage", withQualifiedOutcomes)).toMatchObject({
      passed: true,
      label: "Enhanced success"
    });
    expect(evaluateSave(18, 10, "advantage", withQualifiedOutcomes)).toMatchObject({
      passed: false,
      label: "Reduced failure"
    });
    expect(evaluateSave(8, 10, "disadvantage", withQualifiedOutcomes)).toMatchObject({
      passed: true,
      label: "Mixed success"
    });
    expect(evaluateSave(18, 10, "disadvantage", withQualifiedOutcomes)).toMatchObject({
      passed: false,
      label: "Disastrous failure"
    });
  });

  it("applies roll-over saves, where the natural outcomes invert", () => {
    expect(evaluateSave(12, 12, "normal", rollOver).passed).toBe(true);
    expect(evaluateSave(11, 12, "normal", rollOver).passed).toBe(false);
    expect(evaluateSave(20, 20, "normal", rollOver).passed).toBe(true);
    expect(evaluateSave(1, 1, "normal", rollOver).passed).toBe(false);
  });

  it("evaluates skill checks against their difficulty", () => {
    expect(evaluateCheck(8, 8)).toMatchObject({ passed: true, label: "Success" });
    expect(evaluateCheck(7, 8)).toMatchObject({ passed: false, label: "Failure" });
  });
});
