/**
 * The advisory notes a filled-in character sheet earns.
 *
 * These are declarations rather than a function because a system may be
 * installed at runtime, and an installed system is data — nothing in it is ever
 * evaluated as code. The vocabulary is deliberately small: it is exactly what
 * the three source books between them ask for, and a book that asks for
 * something genuinely new should get a new rule kind rather than an escape
 * hatch that runs arbitrary expressions.
 *
 * `PLAN.md` calls for warnings rather than hard limits, so nothing here refuses
 * a value. Every rule produces a sentence and lets the player decide.
 */

/** A value that should sit within the range the book states. */
export interface RangeWarningRule {
  kind: "range";
  key: string;
  /** Omit either bound for a one-sided range, as a maximum-only cap is. */
  min?: number;
  max?: number;
  message: string;
}

/** A checkbox whose being set is worth remarking on, as Cairn's deprived is. */
export interface FlagWarningRule {
  kind: "flag";
  key: string;
  equals: boolean;
  message: string;
}

/**
 * How full one of the sheet's slot lists is. Tiers are exclusive: the highest
 * one the list reaches is the only one that speaks, so Monolith's twelfth
 * occupied socket does not also report the sixth.
 */
export interface ListOccupancyWarningRule {
  kind: "list-occupancy";
  listKey: string;
  tiers: readonly { atLeast: number; message: string }[];
}

/**
 * One field measured against another. Covers three shapes with one rule:
 * a current value above its own maximum (`against` is the maximum's key), a
 * score above another score (CWN's Alienation above Wisdom), and a load above a
 * capacity derived from a score (`scale` and `offset` — CWN's readied
 * encumbrance against half of Strength).
 *
 * `beyond` is the second, worse thing to say when the value is further past the
 * threshold still, which is how the encumbrance rules distinguish being slowed
 * from being past what a character can haul at all.
 */
export interface CompareWarningRule {
  kind: "compare";
  key: string;
  against: string;
  operator: ">" | "<";
  /** Multiplies `against` before comparing, floored. Defaults to 1. */
  scale?: number;
  /** Added to the scaled value. Defaults to 0. */
  offset?: number;
  message: string;
  beyond?: { offset: number; message: string };
}

export type CharacterWarningRule = RangeWarningRule | FlagWarningRule | ListOccupancyWarningRule | CompareWarningRule;

/**
 * A sheet value read as a number, or undefined where there is nothing to judge.
 * A blank field is not a wrong field: a half-filled sheet earns no warnings for
 * what has not been written down yet.
 *
 * The empty string, null, and booleans are turned away before `Number` sees
 * them, because `Number("")` is 0 and a blank box would otherwise read as a
 * recorded zero and trip every rule with a minimum. CWN's own reader already
 * guarded against this; Cairn's and Monolith's did not, and this is the one
 * behaviour the conversion deliberately changes — in the direction of not
 * warning about a field nobody has filled in yet.
 */
function numeric(sheet: Record<string, unknown>, key: string) {
  const raw = sheet[key];
  if (raw === "" || raw === null || raw === undefined || typeof raw === "boolean") return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

/** How many of a slot list's slots hold something. */
function occupied(sheet: Record<string, unknown>, listKey: string) {
  const list = Array.isArray(sheet[listKey]) ? (sheet[listKey] as unknown[]) : [];
  return list.filter((item) => String(item ?? "").trim()).length;
}

function evaluateRule(rule: CharacterWarningRule, sheet: Record<string, unknown>): string | undefined {
  switch (rule.kind) {
    case "range": {
      const value = numeric(sheet, rule.key);
      if (value === undefined) return;
      if (rule.min !== undefined && value < rule.min) return rule.message;
      if (rule.max !== undefined && value > rule.max) return rule.message;
      return;
    }
    case "flag":
      return sheet[rule.key] === rule.equals ? rule.message : undefined;
    case "list-occupancy": {
      const count = occupied(sheet, rule.listKey);
      // Highest tier first, so the most serious thing true is the one said.
      const tier = [...rule.tiers].sort((a, b) => b.atLeast - a.atLeast).find((entry) => count >= entry.atLeast);
      return tier?.message;
    }
    case "compare": {
      const value = numeric(sheet, rule.key);
      const base = numeric(sheet, rule.against);
      if (value === undefined || base === undefined) return;
      const threshold = Math.floor(base * (rule.scale ?? 1)) + (rule.offset ?? 0);
      const past = (limit: number) => (rule.operator === ">" ? value > limit : value < limit);
      if (!past(threshold)) return;
      if (!rule.beyond) return rule.message;
      const further = rule.operator === ">" ? threshold + rule.beyond.offset : threshold - rule.beyond.offset;
      return past(further) ? rule.beyond.message : rule.message;
    }
  }
}

/** Every warning a sheet earns, in the order its system declared them. */
export function evaluateCharacterWarnings(
  rules: readonly CharacterWarningRule[],
  sheet: Record<string, unknown>
): string[] {
  const warnings: string[] = [];
  for (const rule of rules) {
    const warning = evaluateRule(rule, sheet);
    if (warning) warnings.push(warning);
  }
  return warnings;
}
