import { describe, expect, it } from "vitest";
import { evaluateCharacterWarnings, type CharacterWarningRule } from "@devils-toys/shared";

const check = (rules: CharacterWarningRule[], sheet: Record<string, unknown>) =>
  evaluateCharacterWarnings(rules, sheet);

describe("a blank field", () => {
  const rules: CharacterWarningRule[] = [
    { kind: "range", key: "score", min: 3, max: 18, message: "out of range" },
    { kind: "compare", key: "current", against: "maximum", operator: ">", message: "over maximum" }
  ];

  // The empty string is the one that matters: `Number("")` is 0, so a blank box
  // would otherwise read as a recorded zero and trip every minimum.
  it("earns nothing, however the sheet spells it", () => {
    for (const blank of ["", null, undefined]) {
      expect(check(rules, { score: blank })).toEqual([]);
      expect(check(rules, { current: blank, maximum: 3 })).toEqual([]);
      expect(check(rules, { current: 9, maximum: blank })).toEqual([]);
    }
    expect(check(rules, {})).toEqual([]);
  });

  it("is not a number even when it is a boolean", () => {
    expect(check(rules, { score: true })).toEqual([]);
    expect(check(rules, { score: false })).toEqual([]);
  });

  it("still judges a real zero", () => {
    expect(check(rules, { score: 0 })).toEqual(["out of range"]);
  });
});

describe("a range rule", () => {
  it("takes either bound alone", () => {
    expect(check([{ kind: "range", key: "armor", max: 3, message: "too much" }], { armor: 4 })).toEqual(["too much"]);
    expect(check([{ kind: "range", key: "armor", max: 3, message: "too much" }], { armor: -9 })).toEqual([]);
    expect(check([{ kind: "range", key: "n", min: 1, message: "too little" }], { n: 0 })).toEqual(["too little"]);
  });

  it("treats both bounds as inclusive", () => {
    const rules: CharacterWarningRule[] = [{ kind: "range", key: "n", min: 3, max: 18, message: "out" }];
    expect(check(rules, { n: 3 })).toEqual([]);
    expect(check(rules, { n: 18 })).toEqual([]);
    expect(check(rules, { n: 2 })).toEqual(["out"]);
    expect(check(rules, { n: 19 })).toEqual(["out"]);
  });
});

describe("a flag rule", () => {
  const rules: CharacterWarningRule[] = [{ kind: "flag", key: "deprived", equals: true, message: "deprived" }];

  it("matches the boolean and nothing that merely looks like it", () => {
    expect(check(rules, { deprived: true })).toEqual(["deprived"]);
    expect(check(rules, { deprived: false })).toEqual([]);
    expect(check(rules, { deprived: "true" })).toEqual([]);
    expect(check(rules, { deprived: 1 })).toEqual([]);
    expect(check(rules, {})).toEqual([]);
  });
});

describe("a list-occupancy rule", () => {
  const rules: CharacterWarningRule[] = [
    {
      kind: "list-occupancy",
      listKey: "augmentations",
      tiers: [
        { atLeast: 12, message: "full" },
        { atLeast: 6, message: "half" }
      ]
    }
  ];
  const slots = (filled: number) => Array.from({ length: 12 }, (_, index) => (index < filled ? "aug" : ""));

  it("speaks only for the highest tier reached", () => {
    expect(check(rules, { augmentations: slots(5) })).toEqual([]);
    expect(check(rules, { augmentations: slots(6) })).toEqual(["half"]);
    expect(check(rules, { augmentations: slots(11) })).toEqual(["half"]);
    expect(check(rules, { augmentations: slots(12) })).toEqual(["full"]);
  });

  it("counts what a slot holds, not how many slots there are", () => {
    expect(check(rules, { augmentations: ["a", "", "  ", null, undefined, "b"] })).toEqual([]);
    expect(check(rules, { augmentations: "not a list" })).toEqual([]);
    expect(check(rules, {})).toEqual([]);
  });

  it("reads tiers in whatever order they were declared", () => {
    const ascending: CharacterWarningRule[] = [
      {
        kind: "list-occupancy",
        listKey: "slots",
        tiers: [
          { atLeast: 6, message: "half" },
          { atLeast: 12, message: "full" }
        ]
      }
    ];
    expect(check(ascending, { slots: slots(12) })).toEqual(["full"]);
  });
});

describe("a compare rule", () => {
  it("compares one field against another", () => {
    const rules: CharacterWarningRule[] = [
      { kind: "compare", key: "current", against: "maximum", operator: ">", message: "over" }
    ];
    expect(check(rules, { current: 4, maximum: 3 })).toEqual(["over"]);
    expect(check(rules, { current: 3, maximum: 3 })).toEqual([]);
  });

  it("scales and offsets the field it compares against", () => {
    // CWN's readied capacity: half of Strength, rounded down.
    const rules: CharacterWarningRule[] = [
      { kind: "compare", key: "readied", against: "str", scale: 0.5, operator: ">", message: "heavy" }
    ];
    expect(check(rules, { str: 11, readied: 5 })).toEqual([]);
    expect(check(rules, { str: 11, readied: 6 })).toEqual(["heavy"]);
    expect(check(rules, { str: 10, readied: 5 })).toEqual([]);
    expect(check(rules, { str: 10, readied: 6 })).toEqual(["heavy"]);
  });

  it("says the further thing only once the value is past the second threshold", () => {
    const rules: CharacterWarningRule[] = [
      {
        kind: "compare",
        key: "stowed",
        against: "str",
        operator: ">",
        message: "heavy",
        beyond: { offset: 4, message: "beyond hauling" }
      }
    ];
    expect(check(rules, { str: 11, stowed: 11 })).toEqual([]);
    expect(check(rules, { str: 11, stowed: 12 })).toEqual(["heavy"]);
    expect(check(rules, { str: 11, stowed: 15 })).toEqual(["heavy"]);
    expect(check(rules, { str: 11, stowed: 16 })).toEqual(["beyond hauling"]);
  });

  it("runs the same way downwards, with the second threshold just as exclusive", () => {
    const rules: CharacterWarningRule[] = [
      {
        kind: "compare",
        key: "morale",
        against: "floor",
        operator: "<",
        message: "low",
        beyond: { offset: 3, message: "broken" }
      }
    ];
    expect(check(rules, { floor: 10, morale: 10 })).toEqual([]);
    expect(check(rules, { floor: 10, morale: 9 })).toEqual(["low"]);
    // Sitting exactly on `threshold - offset` is still only the first sentence,
    // the same way `stowed > strength + 4` reads at the top end.
    expect(check(rules, { floor: 10, morale: 7 })).toEqual(["low"]);
    expect(check(rules, { floor: 10, morale: 6 })).toEqual(["broken"]);
  });
});

describe("the rule list as a whole", () => {
  it("keeps the order the system declared, so a sheet reads the way it is laid out", () => {
    const rules: CharacterWarningRule[] = [
      { kind: "range", key: "b", max: 1, message: "second" },
      { kind: "range", key: "a", max: 1, message: "first" }
    ];
    expect(check(rules, { a: 9, b: 9 })).toEqual(["second", "first"]);
  });

  it("is empty for a system that declares no rules", () => {
    expect(check([], { anything: 99 })).toEqual([]);
  });
});
