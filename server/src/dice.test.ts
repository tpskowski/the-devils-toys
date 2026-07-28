import { describe, expect, it } from "vitest";
import { cairn } from "@devils-toys/system-cairn";
import { monolith } from "@devils-toys/system-monolith";
import { evaluateSave, parseRollCommand, rollDice } from "./dice.js";

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
    expect(evaluateSave(12, 12, "normal", cairn.dice).passed).toBe(true);
    expect(evaluateSave(1, 1, "normal", cairn.dice).passed).toBe(true);
    expect(evaluateSave(20, 20, "normal", cairn.dice).passed).toBe(false);
  });

  it("uses Monolith ADV and DIS to change outcome quality without changing the roll", () => {
    expect(evaluateSave(8, 10, "advantage", monolith.dice)).toMatchObject({
      passed: true,
      label: "Enhanced success"
    });
    expect(evaluateSave(18, 10, "advantage", monolith.dice)).toMatchObject({
      passed: false,
      label: "Reduced failure"
    });
    expect(evaluateSave(8, 10, "disadvantage", monolith.dice)).toMatchObject({
      passed: true,
      label: "Mixed success"
    });
    expect(evaluateSave(18, 10, "disadvantage", monolith.dice)).toMatchObject({
      passed: false,
      label: "Disastrous failure"
    });
  });
});
