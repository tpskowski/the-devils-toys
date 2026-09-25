import { randomInt } from "node:crypto";
import { DIE_SIDES_PATTERN } from "@devils-toys/shared";
import type { CustomDie, DiceRules, DiceShape, PresentedDie, SavePosition } from "@devils-toys/shared";
import type { DicePhysicsReplay } from "@devils-toys/shared";
import { physicalRandom, physicalResult } from "./dice-physics.js";

/** 32 unbiased random bits, also usable by creation's non-dice choices. */
export const diceRandom = () => physicalRandom(() => randomInt(0, 2 ** 32) / 2 ** 32);

export interface DiceResult {
  expression: string;
  total: number;
  rolls: number[];
  keptRolls: number[];
  droppedRolls: number[];
  modifier: number;
  detail: string;
  dice: PresentedDie[];
  /** Live-only replay, deliberately non-enumerable when present. */
  physics?: DicePhysicsReplay;
}

export interface SaveOutcome {
  passed: boolean;
  label: string;
  target: number;
  position: SavePosition;
}

function selectedIndexes(rolls: number[], selector?: string, selectorCount = 1) {
  const indexed = rolls.map((value, index) => ({ value, index }));
  if (!selector) return new Set(indexed.map(({ index }) => index));

  const ascending = selector.endsWith("l");
  const ranked = [...indexed].sort((left, right) => {
    const difference = ascending ? left.value - right.value : right.value - left.value;
    return difference || left.index - right.index;
  });
  const affected = new Set(ranked.slice(0, selectorCount).map(({ index }) => index));
  if (selector.startsWith("k")) return affected;
  return new Set(indexed.filter(({ index }) => !affected.has(index)).map(({ index }) => index));
}

export function rollDice(input: string, random?: () => number): DiceResult {
  if (!random || random === diceRandom) {
    const result = physicalResult(
      `standard:${input}`,
      () => rollDice(input, () => 0),
      (faces) => {
        const template = rollDice(input, () => 0);
        const percentile = /^\d+d100(?:\D|$)/.test(template.expression);
        const draws = percentile
          ? Array.from(
              { length: faces.length / 2 },
              (_, i) => ((faces[i * 2] * 10 + faces[i * 2 + 1] || 100) - 0.5) / 100
            )
          : faces.map((face, i) => (face + 0.5) / template.dice[i].shape);
        let index = 0;
        return rollDice(input, () => draws[index++]);
      }
    );
    if (result) return result;
  }
  const expression = input
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/d%(?!10)/, "d100");
  const tens = /^(\d{0,2})d%10$/.exec(expression);
  if (tens) {
    const rolled = rollDice(`${tens[1]}d10`, random);
    const rolls = rolled.rolls.map((value) => (value - 1) * 10);
    return {
      ...rolled,
      expression: `${rolls.length}d%10`,
      rolls,
      keptRolls: rolls,
      total: rolls.reduce((a, b) => a + b, 0),
      detail: `[${rolls.map((v) => String(v).padStart(2, "0")).join(", ")}]`,
      dice: rolled.dice.map((die, i) => ({
        ...die,
        definition: "d%10",
        value: rolls[i],
        face: rolls[i] / 10,
        role: "tens",
        labels: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90]
      }))
    };
  }
  const match = new RegExp(`^(\\d{0,2})d(${DIE_SIDES_PATTERN})(?:(kh|kl|dh|dl)(\\d{0,2}))?([+-]\\d{1,3})?$`).exec(
    expression
  );
  if (!match) throw new Error("Use a dice expression like 2d6+1 or 2d20kl1.");

  const count = Number(match[1] || 1);
  const sides = Number(match[2]);
  const selector = match[3];
  const selectorCount = Number(match[4] || 1);
  const modifier = Number(match[5] || 0);
  if (count < 1 || count > 20) throw new Error("Roll between 1 and 20 dice.");
  if (selector && (selectorCount < 1 || selectorCount > count))
    throw new Error("Keep or drop between 1 and the number of dice rolled.");
  if (selector?.startsWith("d") && selectorCount === count) throw new Error("A drop must leave at least one die.");

  const compoundSides = sides === 44 ? 4 : sides === 66 ? 6 : undefined;
  const componentRolls: number[][] = [];
  const draw = (sides: number) => (random ? Math.floor(random() * sides) + 1 : randomInt(1, sides + 1));
  const rolls = Array.from({ length: count }, () => {
    if (!compoundSides) return draw(sides);
    const digits = [draw(compoundSides), draw(compoundSides)];
    componentRolls.push(digits);
    return digits[0] * 10 + digits[1];
  });
  const keptIndexes = selectedIndexes(rolls, selector, selectorCount);
  const keptRolls = rolls.filter((_roll, index) => keptIndexes.has(index));
  const droppedRolls = rolls.filter((_roll, index) => !keptIndexes.has(index));
  const total = keptRolls.reduce((sum, roll) => sum + roll, 0) + modifier;
  const modifierText = modifier ? ` ${modifier > 0 ? "+" : "−"} ${Math.abs(modifier)}` : "";
  const rollDetail = compoundSides
    ? componentRolls.map(([tens, ones], index) => `[${tens}, ${ones}] → ${rolls[index]}`).join(", ")
    : `[${rolls.join(", ")}]`;
  const detail = droppedRolls.length
    ? `${compoundSides ? `${rollDetail} · ` : ""}kept [${keptRolls.join(", ")}] · dropped [${droppedRolls.join(", ")}]${modifierText}`
    : `${rollDetail}${modifierText}`;

  return {
    expression: `${count}d${sides}${selector ? `${selector}${selectorCount}` : ""}${match[5] ?? ""}`,
    total,
    rolls,
    keptRolls,
    droppedRolls,
    modifier,
    detail,
    dice: rolls.flatMap((value, group): PresentedDie[] => {
      const common = { kept: keptIndexes.has(group), group };
      if (compoundSides)
        return componentRolls[group].map((v, i) => ({
          ...common,
          definition: `d${compoundSides}`,
          shape: compoundSides,
          face: v - 1,
          value: v,
          role: i ? "units" : "tens"
        }));
      if (sides === 100)
        return [
          {
            ...common,
            definition: "d%10",
            shape: 10,
            face: Math.floor((value % 100) / 10),
            value: Math.floor((value % 100) / 10) * 10,
            role: "tens",
            labels: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90]
          },
          {
            ...common,
            definition: "d%1",
            shape: 10,
            face: value % 10,
            value: value % 10,
            role: "units",
            labels: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
          }
        ];
      return [{ ...common, definition: `d${sides}`, shape: sides as DiceShape, face: value - 1, value }];
    })
  };
}

export function rollCustomDie(systemId: string, die: CustomDie, count = 1, random?: () => number): DiceResult {
  if (!random) {
    const result = physicalResult(
      `custom:${systemId}:${die.id}:${count}`,
      () => rollCustomDie(systemId, die, count, () => 0),
      (faces) => {
        let index = 0;
        return rollCustomDie(systemId, die, count, () => (faces[index++] + 0.5) / die.values.length);
      }
    );
    if (result) return result;
  }
  if (!Number.isInteger(count) || count < 1 || count > 20) throw new Error("Roll between 1 and 20 dice.");
  const dice: PresentedDie[] = Array.from({ length: count }, (_, group) => {
    const face = random ? Math.floor(random() * die.values.length) : randomInt(die.values.length);
    return {
      definition: `${systemId}:${die.id}`,
      shape: die.shape ?? 6,
      face,
      value: die.values[face],
      kept: true,
      group,
      labels: die.values,
      custom: die
    };
  });
  const rolls = dice.map((die) => die.value);
  return {
    expression: `${count} × ${die.name}`,
    rolls,
    keptRolls: rolls,
    droppedRolls: [],
    modifier: 0,
    total: rolls.reduce((a, b) => a + b, 0),
    detail: `[${rolls.join(", ")}]`,
    dice
  };
}

export function evaluateSave(roll: number, target: number, position: SavePosition, rules: DiceRules): SaveOutcome {
  if (!Number.isInteger(target) || target < 1 || target > rules.save.sides)
    throw new Error(`Save targets must be between 1 and ${rules.save.sides}.`);
  if (!Number.isInteger(roll) || roll < 1 || roll > rules.save.sides) throw new Error("Invalid save roll.");

  const passed =
    roll === rules.save.automaticSuccess ||
    (roll !== rules.save.automaticFailure &&
      (rules.save.success === "equal-or-under" ? roll <= target : roll >= target));
  const labels = rules.save.outcomes[position] ?? rules.save.outcomes.normal;
  return { passed, label: passed ? labels.success : labels.failure, target, position };
}

export function evaluateCheck(total: number, difficulty: number) {
  if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 30)
    throw new Error("Check difficulties must be between 1 and 30.");
  return { passed: total >= difficulty, label: total >= difficulty ? "Success" : "Failure", difficulty };
}

export function parseRollCommand(body: string): string | undefined {
  const match = /^\/(?:r|roll)\s+(.+)$/i.exec(body.trim());
  return match?.[1];
}
