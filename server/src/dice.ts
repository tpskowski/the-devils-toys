import type { DiceRules, SavePosition } from "@devils-toys/shared";

export interface DiceResult {
  expression: string;
  total: number;
  rolls: number[];
  keptRolls: number[];
  droppedRolls: number[];
  modifier: number;
  detail: string;
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

export function rollDice(input: string, random = Math.random): DiceResult {
  const expression = input.trim().toLowerCase().replace(/\s+/g, "");
  const match = /^(\d{0,2})d(100|66|44|30|20|12|10|8|6|4)(?:(kh|kl|dh|dl)(\d{0,2}))?([+-]\d{1,3})?$/.exec(expression);
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
  const rolls = Array.from({ length: count }, () => {
    if (!compoundSides) return Math.floor(random() * sides) + 1;
    const digits = [Math.floor(random() * compoundSides) + 1, Math.floor(random() * compoundSides) + 1];
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
    detail
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
