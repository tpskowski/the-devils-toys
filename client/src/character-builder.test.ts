import { describe, expect, it } from "vitest";
import type {
  CreationDraft,
  CreationSaveStep,
  ResolvedCreationDefinition,
  ResolvedCreationStep
} from "@devils-toys/shared";
import {
  builderSteps,
  currentStepIndex,
  describedCandidates,
  describeDerivation,
  plannedRolls,
  rearrangeWarning,
  seedArrangement,
  stepDecision,
  stepState,
  swapValues,
  swapsUsed,
  takenCandidates,
  unfinishedSteps
} from "./character-builder";

const abilities: ResolvedCreationStep = {
  step: {
    id: "abilities",
    kind: "roll-scores",
    label: "Abilities",
    scores: [
      { label: "Muscle", dice: "3d6", currentKey: "muscleCurrent", maximumKey: "muscleMax" },
      { label: "Nerve", dice: "3d6", currentKey: "nerveCurrent", maximumKey: "nerveMax" },
      { label: "Knack", dice: "3d6", currentKey: "knackCurrent", maximumKey: "knackMax" }
    ],
    rearrange: { kind: "swap", count: 2 },
    array: { values: [14, 11, 8] }
  }
};

const viceStep: CreationSaveStep = {
  id: "vice",
  kind: "save",
  label: "A vice, if you have one",
  key: "nerveCurrent",
  type: "nerve",
  on: "failure",
  then: [
    {
      id: "vice-roll",
      kind: "roll-table",
      label: "Your vice",
      section: "Character Creation",
      tables: [{ table: "Vices (d6)", column: "Vice", field: "vices" }]
    }
  ]
};

// A save and its branch, resolved the way the characters payload carries them.
const vice: ResolvedCreationStep = { step: viceStep, then: [{ step: viceStep.then[0] }] };

const kit: ResolvedCreationStep = {
  step: {
    id: "kit",
    kind: "grant",
    label: "What you start with",
    listKey: "inventory",
    items: ["Cudgel", "Lantern"],
    roll: [{ dice: "3d6", field: "coin", label: "Coin" }]
  }
};

const definition: ResolvedCreationDefinition = { label: "Make one", steps: [abilities, vice, kit] };

const labelFor = (key: string) => ({ coin: "Coin", muscleCurrent: "Muscle", armor: "Armour" })[key] ?? key;

const draftWith = (steps: CreationDraft["steps"], stepId = "abilities"): CreationDraft => ({
  system: "toybox",
  stepId,
  steps
});

/* -------------------------------------------------------------------------- */

describe("the steps a player can be on", () => {
  it("shows a rolled save branch inside its save screen", () => {
    expect(builderSteps(definition, null).map((entry) => entry.step.id)).toEqual(["abilities", "vice", "kit"]);

    const opened = draftWith({
      vice: { save: { type: "nerve", roll: 20, target: 10, passed: false, label: "Failure", matched: true } }
    });
    expect(builderSteps(definition, opened).map((entry) => entry.step.id)).toEqual(["abilities", "vice", "kit"]);
  });

  it("opens on the step the draft is on, and on the first one for a build that has not started", () => {
    const steps = builderSteps(definition, null);
    expect(currentStepIndex(steps, null)).toBe(0);
    expect(currentStepIndex(steps, draftWith({}, "kit"))).toBe(2);
    // A step the system no longer declares, or one inside a branch that has
    // closed again, is not a screen this wizard can show.
    expect(currentStepIndex(steps, draftWith({}, "vice-roll"))).toBe(0);
  });

  it("keeps a rolled save follow-up on its parent save screen", () => {
    const opened = draftWith(
      {
        vice: { save: { type: "nerve", roll: 20, target: 10, passed: false, label: "Failure", matched: true } },
        "vice-roll": { runs: 1 }
      },
      "vice-roll"
    );
    expect(currentStepIndex(builderSteps(definition, opened), opened)).toBe(1);
  });
});

describe("what a step has settled", () => {
  it("tells a step that has run from one passed over and one still waiting", () => {
    expect(stepState(undefined)).toBe("waiting");
    expect(stepState({})).toBe("waiting");
    expect(stepState({ runs: 1 })).toBe("done");
    expect(stepState({ runs: 2, skipped: true })).toBe("skipped");
    expect(stepState({ chosen: "" })).toBe("done");
  });

  it("counts what is left without ever standing in the way of finishing", () => {
    const steps = builderSteps(definition, null);
    expect(unfinishedSteps(steps, null)).toHaveLength(3);
    // Skipping counts as settled: a step that was passed over is not one the
    // wizard is still waiting on.
    expect(unfinishedSteps(steps, draftWith({ abilities: { skipped: true }, kit: { runs: 1 } }))).toHaveLength(1);
  });

  it("summarises each kind from the ledger rather than from the sheet", () => {
    expect(
      stepDecision(abilities, { applied: { set: { muscleCurrent: 12, nerveCurrent: 9, knackCurrent: 7 } } }, labelFor)
    ).toBe("Muscle 12 · Nerve 9 · Knack 7");
    expect(stepDecision(abilities, { skipped: true }, labelFor)).toBe("Skipped");
    expect(
      stepDecision(
        kit,
        { applied: { set: { coin: 11 }, stow: [{ key: "inventory", items: ["Cudgel", "Lantern"] }] } },
        labelFor
      )
    ).toBe("2 items · Coin 11");
    expect(
      stepDecision(
        vice,
        { save: { type: "nerve", roll: 18, target: 10, passed: false, label: "Failure", matched: true } },
        labelFor
      )
    ).toBe("18 vs 10 — Failure");
    expect(stepDecision(abilities, undefined, labelFor)).toBe("");
  });
});

describe("what a step is about to roll", () => {
  const traits = [
    { table: "Character Traits (d10)", column: "Virtue" },
    { table: "Character Traits (d10)", column: "Vice" },
    { table: "Character Traits (d10)", column: "Reputation" }
  ];

  it("announces one line per table rather than one per roll", () => {
    expect(plannedRolls(traits, [{ name: "Character Traits (d10)", dice: "d10", columns: ["Virtue"] }])).toEqual([
      // The die stays off where the book has already put it in the name.
      { table: "Character Traits (d10)", columns: ["Virtue", "Vice", "Reputation"] }
    ]);
    expect(
      plannedRolls(
        [{ firstOf: ["Male Names", "Female Names"], column: "Result" }],
        [{ name: "Male Names", dice: "d20", columns: ["Result"] }]
      )
    ).toEqual([{ table: "Male Names or Female Names (d20)", columns: ["Result"] }]);
  });

  it("names a choice of columns as the choice it is, since the server picks it", () => {
    expect(
      plannedRolls(
        [{ table: "Name & Background", columnFirstOf: ["Female Name", "Male Name"] }],
        [{ name: "Name & Background", dice: "d20", columns: ["Female Name", "Male Name"] }]
      )
    ).toEqual([{ table: "Name & Background (d20)", columns: ["Female Name or Male Name"] }]);
  });

  it("has nothing to say about a table whose column the declaration leaves out", () => {
    expect(plannedRolls([{ table: "Complications (d10)" }])).toEqual([{ table: "Complications (d10)", columns: [] }]);
  });

  it("names the table owned by the packet section the player chose", () => {
    const packet: ResolvedCreationStep = {
      step: { id: "trade", kind: "packet", label: "Trade", under: "Trades" },
      options: [
        {
          name: "Cooper",
          gear: [],
          tables: [{ name: "Cooper's Keepsake", dice: "d6", columns: ["Result"] }]
        }
      ]
    };
    const packetDefinition: ResolvedCreationDefinition = { label: "Make one", steps: [packet] };
    const draft = draftWith({ trade: { chosen: "Cooper" } }, "trade-table");
    expect(
      plannedRolls([{ fromPacket: "trade", position: 1, fromStep: "hit-protection" }], [], packetDefinition, draft)
    ).toEqual([{ table: "Cooper's Keepsake (d6)", columns: [] }]);
  });
});

describe("rearranging what the dice said", () => {
  it("trades two scores and leaves the rest where they fell", () => {
    expect(swapValues([12, 9, 7], 0, 2)).toEqual([7, 9, 12]);
    expect(swapValues([12, 9, 7], 1, 1)).toEqual([12, 9, 7]);
  });

  it("counts the trades an arrangement took, however the numbers repeat", () => {
    expect(swapsUsed([12, 9, 7], [12, 9, 7])).toBe(0);
    expect(swapsUsed([12, 9, 7], [9, 12, 7])).toBe(1);
    expect(swapsUsed([1, 2, 3, 4], [2, 1, 4, 3])).toBe(2);
    // Two 9s: putting the other one first is no trade at all.
    expect(swapsUsed([9, 9, 7], [7, 9, 9])).toBe(1);
    expect(swapsUsed([9, 9, 7], [9, 9, 7])).toBe(0);
    expect(swapsUsed([12, 9, 7], [18, 9, 7])).toBe(-1);
  });

  it("warns past the book's own limit rather than refusing the interaction", () => {
    const swap = { kind: "swap", count: 1 } as const;
    expect(rearrangeWarning(swap, [1, 2, 3, 4], [2, 1, 3, 4])).toBe("");
    expect(rearrangeWarning(swap, [1, 2, 3, 4], [2, 1, 4, 3])).toBe(
      "The book allows 1 swaps, and this arrangement takes 2."
    );
    const substitute = { kind: "substitute", value: 14, count: 1 } as const;
    expect(rearrangeWarning(substitute, [12, 9, 7], [14, 9, 7])).toBe("");
    expect(rearrangeWarning(substitute, [12, 9, 7], [14, 14, 7])).toMatch(/at most 1 of these with 14/);
    expect(rearrangeWarning(undefined, [12, 9, 7], [9, 12, 7])).toBe("");
  });

  it("opens the rolled path on the dice and the array path on the book's own numbers", () => {
    const record = {
      scores: [
        { label: "Muscle", currentKey: "muscleCurrent", total: 12 },
        { label: "Nerve", currentKey: "nerveCurrent", total: 9 },
        { label: "Knack", currentKey: "knackCurrent", total: 7 }
      ]
    };
    const step = abilities.step as Extract<typeof abilities.step, { kind: "roll-scores" }>;
    expect(seedArrangement(step, record, {}, "rolled")).toEqual([12, 9, 7]);
    expect(seedArrangement(step, undefined, {}, "rolled")).toEqual([]);
    // Taking the array puts the dice away, so a resumed array screen recovers
    // its arrangement from the scores on the sheet.
    expect(seedArrangement(step, record, {}, "array")).toEqual([14, 11, 8]);
    expect(seedArrangement(step, record, { muscleCurrent: 8, nerveCurrent: 14, knackCurrent: 11 }, "array")).toEqual([
      8, 14, 11
    ]);
    // Scores that are not the printed set belong to some other path.
    expect(seedArrangement(step, record, { muscleCurrent: 12, nerveCurrent: 9, knackCurrent: 7 }, "array")).toEqual([
      14, 11, 8
    ]);
  });
});

describe("the gear a packet offered", () => {
  it("reads back which bullets are already in a slot, under whichever spelling went in", () => {
    const record = {
      candidates: [
        { text: "Crowbar", listKey: "inventory", label: "Crowbar" },
        { text: "Cudgel", listKey: "inventory", label: "Cudgel (d6)" },
        { text: "A hoop that fits nothing" }
      ],
      applied: { stow: [{ key: "inventory", items: ["Cudgel (d6)"] }] }
    };
    expect(takenCandidates(record)).toEqual(["Cudgel"]);
    expect(takenCandidates(undefined)).toEqual([]);
  });

  it("reads back which reviewed results were filed as description", () => {
    const record = {
      candidates: [
        {
          text: "**Ace:** Never gets lost.",
          description: "Pilot Talent: **Ace:** Never gets lost.",
          listKey: "inventory"
        }
      ],
      applied: { join: [{ field: "notes", separator: "\n", lines: ["Pilot Talent: **Ace:** Never gets lost."] }] }
    };
    expect(describedCandidates(record, "notes")).toEqual(["**Ace:** Never gets lost."]);
    expect(describedCandidates(record, "other")).toEqual([]);
  });
});

describe("derivations in words", () => {
  it("says what each of the five operations will do", () => {
    expect(describeDerivation({ key: "armor", op: "copy", from: ["armorMax"] }, labelFor)).toBe("copied from armorMax");
    expect(describeDerivation({ key: "xp", op: "constant", value: 0 }, labelFor)).toBe("always 0");
    expect(describeDerivation({ key: "x", op: "sum", from: ["a", "b"], pick: "total" }, labelFor)).toBe(
      "the total of a, b"
    );
    expect(
      describeDerivation({ key: "x", op: "difference", value: 15, from: ["a", "b"], pick: "highest" }, labelFor)
    ).toBe("15 minus the better of a and b");
    expect(describeDerivation({ key: "x", op: "lookup", from: ["muscleCurrent"] }, labelFor)).toBe(
      "read off the book's ladder against Muscle"
    );
  });
});
