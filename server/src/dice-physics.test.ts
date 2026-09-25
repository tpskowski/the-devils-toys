import { describe, expect, it } from "vitest";
import { Quaternion } from "cannon-es";
import { settledDieFace } from "@devils-toys/shared/dice-physics";
import { rollDice, rollCustomDie, diceRandom } from "./dice.js";
import { withPhysicalDice } from "./dice-physics.js";

describe("authoritative physical dice", () => {
  for (const expression of ["4d6kh2+3", "2d100", "2d66", "2d%10"])
    it(`uses the recorded faces for ${expression}, totals, and keep/drop`, async () => {
      const result = await withPhysicalDice(() => rollDice(expression));
      const replay = result.physics!,
        final = replay.frames.at(-1)!;
      result.dice.forEach((die, i) => {
        const q = new Quaternion(...(final.slice(i * 7 + 3, i * 7 + 7) as [number, number, number, number]));
        expect(settledDieFace(die, q)).toBe(die.face);
        expect(die.labels?.[die.face] ?? die.face + 1).toBe(die.value);
      });
      expect(result.total).toBe(result.keptRolls.reduce((sum, n) => sum + n, 0) + result.modifier);
      expect(result.dice.filter((d) => !d.kept).length).toBe(expression.includes("kh") ? 2 : 0);
      expect(JSON.stringify(result)).not.toContain('"physics"');
    });
  it("physically resolves custom repeated-value dice", async () => {
    const result = await withPhysicalDice(() =>
      rollCustomDie("test", { id: "fate", name: "Fate", shape: 6, values: [-1, -1, 0, 0, 1, 1] }, 3)
    );
    expect(result.physics).toBeDefined();
    expect(result.dice.every((d) => d.labels![d.face] === d.value)).toBe(true);
  });
  it("prepares multiple dependent rolls without repeating committed writes or changing choices", async () => {
    let writes = 0;
    const choices: number[] = [];
    const result = await withPhysicalDice(() => {
      const choice = diceRandom();
      choices.push(choice);
      const first = rollDice("d6", diceRandom);
      const second = rollDice(`d${first.total > 3 ? 8 : 4}`, diceRandom);
      writes++;
      return { first, second };
    });
    expect(writes).toBe(1);
    expect(new Set(choices).size).toBe(1);
    expect(result.first.physics).toBeDefined();
    expect(result.second.physics).toBeDefined();
  });
  it("preserves the ordinary RNG path outside physical rooms", () => {
    expect(rollDice("d20").physics).toBeUndefined();
    expect(rollDice("d20", () => 0).total).toBe(1);
  });
});
