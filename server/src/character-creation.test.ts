import { beforeEach, describe, expect, it } from "vitest";
import { CREATION_NAME_KEY } from "@devils-toys/shared";
import type { CreationDeriveStep, CreationDraft, CreationRollTableStep, CreationStep } from "@devils-toys/shared";
import {
  applyCreationWrite,
  availableCreationSteps,
  creationTotals,
  deriveValue,
  equipmentArmor,
  performCreationStep,
  readCreationDraft,
  refuseScoreAssignment,
  resolveCreationDefinition,
  revertCreationWrite,
  type CreationRunContext
} from "./character-creation.js";
import { db, one } from "./db.js";
import {
  finishCreation,
  publicCharacter,
  rollCreationStep,
  updateCreationDraft,
  type CharacterRow
} from "./characters.js";
import { installToybox } from "./test-fixture.js";
import { systemOrThrow } from "./systems.js";

installToybox();

const creation = systemOrThrow("toybox").characterCreation!;

/** Every step by id, the nested one included, so a test names what it is running. */
const steps = new Map<string, CreationStep>(
  creation.steps
    .flatMap((step) => (step.kind === "save" ? [step, ...step.then] : [step]))
    .map((step) => [step.id, step])
);

function step(id: string) {
  const found = steps.get(id);
  if (!found) throw new Error(`The fixture has no "${id}" creation step.`);
  return found;
}

/**
 * A random function landing each die thrown on a named face of a named size, in
 * the order the pairs are given. `rollDice` reads a face as
 * `floor(random × sides) + 1`, so the middle of a face's band lands on it. The
 * last pair is held, so `faces([6, 6])` is "every d6 comes up six" and a step
 * that throws more dice than the test names keeps rolling rather than falling
 * off the end into NaN.
 */
function faces(...values: [face: number, sides: number][]) {
  let index = 0;
  return () => {
    const [face, sides] = values[Math.min(index, values.length - 1)];
    index += 1;
    return (face - 0.5) / sides;
  };
}

function run(id: string, context: Partial<CreationRunContext> = {}) {
  return performCreationStep(step(id), { system: "toybox", sheet: {}, random: () => 0, ...context });
}

/* -------------------------------------------------------------------------- */

describe("performing each kind of creation step", () => {
  it("rolls scores and leaves them unplaced where the step lets a player rearrange", () => {
    const outcome = run("abilities", { random: faces([6, 6]) });
    expect(outcome.scores).toEqual([
      { label: "Muscle", currentKey: "muscleCurrent", maximumKey: "muscleMax", total: 18 },
      { label: "Nerve", currentKey: "nerveCurrent", maximumKey: "nerveMax", total: 18 },
      { label: "Knack", currentKey: "knackCurrent", maximumKey: "knackMax", total: 18 }
    ]);
    expect(outcome.applied).toEqual({});
    // Three scores, so nothing here is a total another step could read.
    expect(outcome.total).toBeUndefined();
  });

  it("places a single score at once, and offers its total to a later step", () => {
    const outcome = run("hit-protection", { random: faces([4, 6]) });
    expect(outcome.applied.set).toEqual({ hpCurrent: 4, hpMax: 4 });
    expect(outcome.total).toBe(4);
  });

  it("rolls a named column of a table into the field a step names", () => {
    const outcome = run("vice-roll", { random: faces([2, 6]) });
    expect(outcome.rolled[0]).toMatchObject({ table: "Vices (d6)", column: "Vice", total: 2, result: "Boasting" });
  });

  it("rolls one table from an earlier packet's chosen section", () => {
    const packetTable: CreationRollTableStep = {
      id: "trade-keepsake",
      kind: "roll-table",
      label: "Trade keepsake",
      section: "Trades",
      tables: [
        {
          fromPacket: "trade",
          position: 1,
          fromStep: "hit-protection",
          stowInto: "inventory"
        }
      ],
      joinInto: { field: "notes", separator: "\n", prefixWith: "table" }
    };
    const outcome = performCreationStep(packetTable, {
      system: "toybox",
      sheet: {},
      records: { trade: { chosen: "Cooper" } },
      totals: new Map([["hit-protection", 3]]),
      random: faces([6, 6])
    });
    expect(outcome.rolled[0]).toMatchObject({
      table: "Cooper's Keepsake (d6)",
      total: 3,
      fromStep: "hit-protection",
      result: "A mallet with somebody else's name on it"
    });
    expect(outcome.applied.join?.[0].lines).toEqual([
      "Cooper's Keepsake (d6): A mallet with somebody else's name on it"
    ]);
    expect(outcome.candidates?.[0]).toMatchObject({ text: "A mallet with somebody else's name on it" });
  });

  /**
   * The choice `firstOf` makes between tables, one level down. Cairn's name
   * table carries a Female Name column and a Male Name column, and rolling both
   * and joining them is a different instruction from rolling one.
   */
  it("chooses between the columns a roll offers, and records which one it read", () => {
    const first = run("name", { random: faces([2, 6]) });
    expect(first.rolled.map((roll) => [roll.column, roll.result])).toEqual([
      ["Given Name", "Byrd"],
      ["Family Name", "Marchbank"]
    ]);

    // The same table, the same die, the other column: which one it landed on is
    // the engine's to say, and the ledger is the only place it is said.
    const second = run("name", { random: faces([5, 6]) });
    expect(second.rolled.map((roll) => [roll.column, roll.result])).toEqual([
      ["Chosen Name", "Nine"],
      ["Family Name", "Rookwood"]
    ]);
  });

  it("captions a joined line with the table or with the column, as the step asks", () => {
    // Ten columns of one table would read as the table's name ten times over;
    // five tables of one column would read as `Result` five times over.
    expect(run("odds-and-ends", { random: faces([1, 6]) }).applied.join).toEqual([
      { field: "notes", separator: "\n", lines: ["Item: Lantern"] }
    ]);
    expect(run("trade", { random: faces([1, 4]), totals: new Map([["hit-protection", 3]]) }).applied.join).toEqual([
      {
        field: "notes",
        separator: "\n",
        lines: ["Cooper's Keepsake (d6): A mallet with somebody else's name on it"]
      }
    ]);
  });

  /**
   * Decision 10, one kind further along: a rolled item is offered on exactly the
   * terms a packet's printed bullets are, and is in no slot until the player
   * says so.
   */
  it("offers a rolled result into a list without putting it there", () => {
    const known = run("odds-and-ends", { random: faces([1, 6]) });
    expect(known.candidates).toEqual([
      {
        text: "Lantern",
        description: "Item: Lantern",
        listKey: "inventory",
        itemId: "toybox/lantern",
        label: "Lantern"
      }
    ]);
    expect(known.applied.stow).toBeUndefined();

    // A result the catalogue has never heard of is still offered: a slot holds a
    // plain string either way, and the step said which list it belongs in.
    const unknown = run("odds-and-ends", { random: faces([6, 6]) });
    expect(unknown.candidates).toEqual([
      { text: "A brick, in a sock", description: "Item: A brick, in a sock", listKey: "inventory" }
    ]);
  });

  it("chooses a packet section, rolls what it owns, and offers its gear", () => {
    const outcome = run("trade", { random: faces([1, 4]), totals: new Map([["hit-protection", 3]]) });
    expect(outcome.chosen).toBe("Cooper");
    expect(outcome.applied.set).toEqual({ trade: "Cooper" });
    expect(outcome.applied.join).toEqual([
      {
        field: "notes",
        separator: "\n",
        lines: ["Cooper's Keepsake (d6): A mallet with somebody else's name on it"]
      }
    ]);
    // The keepsake table is read at the Hit Protection already rolled rather
    // than rolled again: one roll, two tables.
    expect(outcome.rolled.map((roll) => roll.fromStep)).toEqual([undefined, "hit-protection"]);
    expect(outcome.candidates?.slice(0, 2)).toEqual([
      { text: "Crowbar", listKey: "inventory", itemId: "toybox/crowbar", label: "Crowbar" },
      { text: "Chalk and twine", listKey: "inventory", itemId: "toybox/chalk-and-twine", label: "Chalk and twine" }
    ]);
    expect(outcome.candidates).toHaveLength(3);
  });

  it("takes a packet section a player picked instead of rolling for one", () => {
    const outcome = run("trade", { choice: "glazier", totals: new Map([["hit-protection", 1]]) });
    expect(outcome.chosen).toBe("Glazier");
    expect(outcome.total).toBeUndefined();
  });

  it("refuses a packet section the book does not have", () => {
    expect(() => run("trade", { choice: "Wheelwright" })).toThrow(/not one of the sections under "Trades"/);
  });

  it("stows granted gear under the catalogue's own spelling and rolls its money", () => {
    const outcome = run("kit", { random: faces([5, 6]) });
    expect(outcome.applied.stow).toEqual([{ key: "inventory", items: ["Cudgel (d6)", "Lantern", "Chalk and twine"] }]);
    expect(outcome.applied.set).toEqual({ coin: 15 });
  });

  it("copies an earlier step's offered gear into the final review", () => {
    const candidate = { text: "Old armor (Armor 1)", listKey: "inventory" };
    const outcome = run("kit", { records: { trade: { candidates: [candidate] } } });
    expect(outcome.candidates).toEqual([candidate]);
  });

  it("stows a granted name the catalogue has never heard of exactly as it was written", () => {
    const grant: CreationStep = {
      id: "improvised",
      kind: "grant",
      label: "What you found",
      listKey: "inventory",
      items: ["toybox/lantern", "A brick, in a sock"]
    };
    const outcome = performCreationStep(grant, { system: "toybox", sheet: {}, random: () => 0 });
    expect(outcome.applied.stow).toEqual([{ key: "inventory", items: ["Lantern", "A brick, in a sock"] }]);
  });

  it("reports a save's outcome and whether it opens the branch beneath it", () => {
    const failed = run("vice", { sheet: { nerveCurrent: 10 }, random: faces([20, 20]) });
    expect(failed.save).toMatchObject({ roll: 20, target: 10, passed: false, matched: true });
    expect(failed.applied).toEqual({});

    const passed = run("vice", { sheet: { nerveCurrent: 10 }, random: faces([1, 20]) });
    expect(passed.save).toMatchObject({ passed: true, matched: false });
  });

  it("refuses a save the sheet has no score for yet", () => {
    expect(() => run("vice", { sheet: {} })).toThrow(/has no score in yet/);
  });

  it("writes a rolled vice in the shape the sheet's vices field holds", () => {
    const outcome = run("vice-roll", { random: faces([4, 6]) });
    expect(outcome.applied.stow).toEqual([
      { key: "vices", items: [{ name: "Grudges", triggers: "Being corrected", satisfying: "An apology, or worse" }] }
    ]);
  });

  it("writes the constants a set step declares", () => {
    expect(run("starting-state").applied.set).toEqual({ armor: 0, criticalDamage: false, deprived: false });
    expect(run("starting-state", { sheet: { armor: 2 } }).applied.set).toEqual({
      criticalDamage: false,
      deprived: false
    });
  });

  it("derives a field from another, and writes nothing where the source is not there", () => {
    expect(run("currents", { sheet: { hpMax: 5 } }).applied.set).toEqual({ hpCurrent: 5 });
    expect(run("currents", { sheet: {} }).applied).toEqual({});
  });

  it("rolls nothing for a text step or a rules step", () => {
    expect(run("anything-else")).toMatchObject({ applied: {}, rolled: [] });
    expect(run("how-it-works")).toMatchObject({ applied: {}, rolled: [] });
  });
});

describe("the derive operations", () => {
  const sheet = { muscleMax: 14, nerveMax: 9, knackMax: 12 };

  it("copies one key, and takes the first where a pick says nothing", () => {
    expect(deriveValue(sheet, { key: "x", op: "copy", from: ["muscleMax"] })).toBe(14);
    expect(deriveValue(sheet, { key: "x", op: "copy", from: ["nerveMax", "muscleMax"] })).toBe(9);
  });

  it("writes a constant with no source at all", () => {
    expect(deriveValue({}, { key: "x", op: "constant", value: 3 })).toBe(3);
  });

  it("totals its sources, or picks the highest or lowest of them", () => {
    const from = ["muscleMax", "nerveMax", "knackMax"];
    expect(deriveValue(sheet, { key: "x", op: "sum", from })).toBe(35);
    expect(deriveValue(sheet, { key: "x", op: "sum", from, pick: "highest" })).toBe(14);
    expect(deriveValue(sheet, { key: "x", op: "sum", from, pick: "lowest" })).toBe(9);
  });

  it("counts down from a declared number, which is a save target", () => {
    // Cities Without Number's "Physical save is 15 minus the better of STR or CON".
    expect(
      deriveValue(sheet, { key: "x", op: "difference", value: 15, from: ["muscleMax", "nerveMax"], pick: "highest" })
    ).toBe(1);
  });

  it("reads a ladder at the highest rung its sources reach, and nothing below the bottom", () => {
    const ladder = [
      { atLeast: 4, value: -1 },
      { atLeast: 8, value: 0 },
      { atLeast: 14, value: 1 }
    ];
    expect(deriveValue(sheet, { key: "x", op: "lookup", from: ["muscleMax"], ladder })).toBe(1);
    expect(deriveValue(sheet, { key: "x", op: "lookup", from: ["nerveMax"], ladder })).toBe(0);
    expect(deriveValue({ low: 2 }, { key: "x", op: "lookup", from: ["low"], ladder })).toBeUndefined();
  });

  it("writes nothing where a source is blank rather than writing a number that is not one", () => {
    const derivation: CreationDeriveStep["derive"][number] = { key: "x", op: "sum", from: ["muscleMax", "missing"] };
    expect(deriveValue(sheet, derivation)).toBeUndefined();
    expect(deriveValue({ muscleMax: 14, missing: "" }, derivation)).toBeUndefined();
  });

  it("reads the best worn armor plus stackable bonuses, capped at three", () => {
    expect(equipmentArmor(["Light vest (Armor 1)", "Shield generator (+1 Armor)"])).toBe(2);
    expect(equipmentArmor(["Combat suit (2 Armor)", "Helm (+1 Armor)", "Shield (+1 Armor)"])).toBe(3);
    expect(equipmentArmor(["Unarmed (-1 if opponent has armor)"])).toBe(0);
  });
});

describe("a total taken from an earlier step", () => {
  const keepsake: CreationRollTableStep = {
    id: "keepsake",
    kind: "roll-table",
    label: "Keepsake",
    section: "Character Creation",
    tables: [{ table: "Name & Trade (d6)", column: "Trade", field: "trade", fromStep: "hit-protection" }]
  };

  it("reads the table at the total rather than rolling a second one", () => {
    const outcome = performCreationStep(keepsake, {
      system: "toybox",
      sheet: {},
      totals: new Map([["hit-protection", 5]]),
      // Any roll of its own would land on 1; the total says 5.
      random: () => 0
    });
    expect(outcome.applied.set).toEqual({ trade: "Miller" });
    expect(outcome.rolled[0]).toMatchObject({ total: 5, fromStep: "hit-protection" });
  });

  it("skips the step where the total was never rolled, rather than failing", () => {
    // The install checks cannot see across a save's branches, and should not
    // try: a step may legally read a total from a branch that did not run.
    const outcome = performCreationStep(keepsake, { system: "toybox", sheet: {}, totals: new Map(), random: () => 0 });
    expect(outcome).toMatchObject({ skipped: true, applied: {}, rolled: [] });
  });

  it("offers a skipped step's total to nobody", () => {
    const draft: CreationDraft = {
      system: "toybox",
      stepId: "trade",
      steps: { "hit-protection": { total: 4, skipped: true }, name: { total: 2 } }
    };
    expect([...creationTotals(draft)]).toEqual([["name", 2]]);
  });
});

describe("checking a score assignment", () => {
  const rolled = [12, 9, 7];
  const swap = { rearrange: { kind: "swap", count: 2 } } as const;

  it("accepts the numbers left where they fell", () => {
    expect(refuseScoreAssignment(swap, "rolled", rolled, [12, 9, 7])).toBeUndefined();
  });

  it("accepts a rearrangement inside the declared number of swaps", () => {
    expect(refuseScoreAssignment(swap, "rolled", rolled, [9, 12, 7])).toBeUndefined();
    expect(refuseScoreAssignment(swap, "rolled", rolled, [7, 12, 9])).toBeUndefined();
  });

  it("refuses a rearrangement that takes more swaps than the book allows", () => {
    const four = [1, 2, 3, 4];
    const once = { rearrange: { kind: "swap", count: 1 } } as const;
    expect(refuseScoreAssignment(once, "rolled", four, [2, 1, 4, 3])).toBe(
      "That rearrangement takes more than 1 swaps."
    );
    expect(refuseScoreAssignment(swap, "rolled", four, [2, 1, 4, 3])).toBeUndefined();
  });

  it("refuses numbers nothing rolled", () => {
    expect(refuseScoreAssignment(swap, "rolled", rolled, [18, 9, 7])).toBe(
      "An assignment uses each of the rolled numbers exactly once."
    );
    expect(refuseScoreAssignment(swap, "rolled", rolled, [12, 12, 9])).toBe(
      "An assignment uses each of the rolled numbers exactly once."
    );
  });

  it("refuses an assignment of the wrong length", () => {
    expect(refuseScoreAssignment(swap, "rolled", rolled, [12, 9])).toMatch(/rolled 3 scores, and 2 came back/);
  });

  it("counts repeated numbers as the one arrangement they are", () => {
    // Two 9s: putting the other one first is no swap at all.
    const once = { rearrange: { kind: "swap", count: 1 } } as const;
    expect(refuseScoreAssignment(once, "rolled", [9, 9, 7], [9, 9, 7])).toBeUndefined();
    expect(refuseScoreAssignment(once, "rolled", [9, 9, 7], [7, 9, 9])).toBeUndefined();
  });

  it("lets a substitution replace what the book says it may, and no more", () => {
    const step = { rearrange: { kind: "substitute", value: 14, count: 1 } } as const;
    expect(refuseScoreAssignment(step, "rolled", rolled, [14, 9, 7])).toBeUndefined();
    expect(refuseScoreAssignment(step, "rolled", rolled, [12, 9, 7])).toBeUndefined();
    expect(refuseScoreAssignment(step, "rolled", rolled, [14, 14, 7])).toBe(
      "At most 1 of the rolled scores may be replaced with 14."
    );
    expect(refuseScoreAssignment(step, "rolled", rolled, [18, 9, 7])).toBe(
      "A substitution replaces a rolled score with 14 and leaves the rest where they fell."
    );
    // A substitution does not rearrange: the untouched scores stay put.
    expect(refuseScoreAssignment(step, "rolled", rolled, [9, 12, 7])).toMatch(/replaces a rolled score with 14/);
  });

  it("holds an array assignment to the declared values, whatever the dice said", () => {
    const step = { array: { values: [14, 12, 11, 10, 9, 7] } } as const;
    expect(refuseScoreAssignment(step, "array", [], [7, 9, 10, 11, 12, 14])).toBeUndefined();
    expect(refuseScoreAssignment(step, "array", [], [14, 14, 11, 10, 9, 7])).toMatch(/exactly once/);
    expect(refuseScoreAssignment(step, "array", [], [14, 12, 11])).toBe("This step assigns 6 values, and 3 came back.");
    // The rolled numbers are not the array's, and taking the array is choosing
    // not to roll: an assignment of what the dice said is refused on this path.
    expect(refuseScoreAssignment(step, "array", [12, 9, 7], [12, 9, 7])).toMatch(/came back/);
  });

  /**
   * The two paths are checked against different things, which is the whole
   * reason an array is not a rearrangement. A step offering both — the fixture's
   * abilities step, and Cities Without Number's — is checked as whichever path
   * the player took, and neither check can be reached from the other.
   */
  it("keeps the two paths apart on a step that offers both", () => {
    const both = { rearrange: { kind: "swap", count: 2 }, array: { values: [14, 11, 8] } } as const;
    expect(refuseScoreAssignment(both, "rolled", rolled, [9, 12, 7])).toBeUndefined();
    expect(refuseScoreAssignment(both, "rolled", rolled, [14, 11, 8])).toMatch(/each of the rolled numbers/);
    expect(refuseScoreAssignment(both, "array", rolled, [8, 14, 11])).toBeUndefined();
    // A substitution belongs to the rolled path, so Cities Without Number's "a
    // score from the array may not be replaced with a 14" needs no rule of its
    // own: there is no way to ask for one on this path at all.
    expect(refuseScoreAssignment(both, "array", rolled, [14, 14, 8])).toMatch(/exactly once/);
  });

  it("refuses an array on a step that offers none, and a rearrangement on one that offers none", () => {
    expect(refuseScoreAssignment({}, "array", [], [14, 11, 8])).toBe(
      "This step has no array of numbers to take; roll its dice instead."
    );
    expect(refuseScoreAssignment({}, "rolled", rolled, [12, 9, 7])).toBe(
      "This step's scores are placed in the order they were rolled."
    );
  });
});

describe("folding a step's contribution into a sheet", () => {
  it("lets two steps share one box and takes only its own lines back", () => {
    const background = { join: [{ field: "notes", separator: "\n", lines: ["Trade: Cooper"] }] };
    const touches = { join: [{ field: "notes", separator: "\n", lines: ["Hair: Bald", "Face: Boney"] }] };
    const both = applyCreationWrite(applyCreationWrite({}, background), touches);
    expect(both.notes).toBe("Trade: Cooper\nHair: Bald\nFace: Boney");

    const rerolled = applyCreationWrite(
      both,
      { join: [{ field: "notes", separator: "\n", lines: ["Trade: Glazier"] }] },
      background
    );
    expect(rerolled.notes).toBe("Hair: Bald\nFace: Boney\nTrade: Glazier");
  });

  it("replaces a rerolled step's slots rather than piling a second copy beside them", () => {
    const first = { stow: [{ key: "inventory", items: ["Cudgel (d6)", "Lantern"] }] };
    const sheet = applyCreationWrite({ inventory: ["A rope of my own"] }, first);
    expect(sheet.inventory).toEqual(["A rope of my own", "Cudgel (d6)", "Lantern"]);

    const second = { stow: [{ key: "inventory", items: ["Crowbar"] }] };
    expect(applyCreationWrite(sheet, second, first).inventory).toEqual(["A rope of my own", "Crowbar"]);
  });

  it("takes a skipped step's work back out and leaves everything else", () => {
    const write = { set: { trade: "Cooper" }, join: [{ field: "notes", separator: "\n", lines: ["Trade: Cooper"] }] };
    const sheet = applyCreationWrite({ notes: "Mine" }, write);
    expect(revertCreationWrite(sheet, write).notes).toBe("Mine");
  });

  /**
   * The one join target that is not a box. A character has one name, and the
   * builder's door has to create the row with a placeholder — so appending left
   * the placeholder in front of every rolled name and a second reroll in front
   * of the first.
   */
  it("replaces the character's own name rather than joining onto it", () => {
    const rolled = { join: [{ field: CREATION_NAME_KEY, separator: " ", lines: ["Byrd", "Marchbank"] }] };
    const named = applyCreationWrite({ [CREATION_NAME_KEY]: "New character" }, rolled);
    expect(named[CREATION_NAME_KEY]).toBe("Byrd Marchbank");

    const again = { join: [{ field: CREATION_NAME_KEY, separator: " ", lines: ["Ewe", "Ashdown"] }] };
    expect(applyCreationWrite(named, again, rolled)[CREATION_NAME_KEY]).toBe("Ewe Ashdown");
    // And with no record of the first roll to take back out, which is what a
    // second step joining the same target would have.
    expect(applyCreationWrite(named, again)[CREATION_NAME_KEY]).toBe("Ewe Ashdown");
  });
});

describe("reading a stored draft", () => {
  const draft = (steps: Record<string, unknown>, stepId = "abilities") =>
    JSON.stringify({ system: "toybox", stepId, steps });

  it("keeps what the system still declares and drops what it does not", () => {
    // A system is replaced in place, so a half-built character can wake up under
    // a declaration that has lost the step it recorded against. The sheet keeps
    // what that step already wrote; the record for it goes.
    const stored = draft({ abilities: { total: 12 }, "old-step": { total: 4 } });
    expect(readCreationDraft("toybox", stored)).toEqual({
      system: "toybox",
      stepId: "abilities",
      steps: { abilities: { total: 12 } }
    });
  });

  it("falls back to the first step where the one it was on has gone", () => {
    expect(readCreationDraft("toybox", draft({ abilities: {} }, "old-step"))?.stepId).toBe("how-it-works");
  });

  it("drops a draft that has nothing left of it, and one that was never one", () => {
    expect(readCreationDraft("toybox", draft({ "old-step": {} }, "old-step"))).toBeUndefined();
    expect(readCreationDraft("toybox", "not json")).toBeUndefined();
    expect(readCreationDraft("toybox", "[]")).toBeUndefined();
    expect(readCreationDraft("toybox", JSON.stringify({ system: "elsewhere", steps: {} }))).toBeUndefined();
    expect(readCreationDraft("toybox", null)).toBeUndefined();
  });
});

describe("the steps a player can be on", () => {
  it("keeps a save's branch out of the way until the save has opened it", () => {
    const empty = availableCreationSteps(creation, undefined);
    expect(empty.map((entry) => entry.id)).not.toContain("vice-roll");

    const opened: CreationDraft = {
      system: "toybox",
      stepId: "vice",
      steps: { vice: { save: { type: "nerve", roll: 20, target: 10, passed: false, label: "", matched: true } } }
    };
    const withBranch = availableCreationSteps(creation, opened).map((entry) => entry.id);
    expect(withBranch).toContain("vice-roll");
    expect(withBranch.indexOf("vice-roll")).toBe(withBranch.indexOf("vice") + 1);
  });
});

describe("the definition a client is sent", () => {
  it("resolves the tables a step will roll and the sections a packet offers", () => {
    const resolved = resolveCreationDefinition("toybox")!;
    expect(resolved.label).toBe("Make one");
    const name = resolved.steps.find((entry) => entry.step.id === "name");
    expect(name?.tables?.[0]).toEqual({
      name: "Names (d6)",
      dice: "d6",
      columns: ["Given Name", "Chosen Name", "Family Name"]
    });
    const trade = resolved.steps.find((entry) => entry.step.id === "trade");
    expect(trade?.options?.map((option) => option.name)).toEqual(["Cooper", "Drayman", "Fletcher", "Glazier"]);
    expect(trade?.options?.[0].gear).toEqual(["Crowbar", "Chalk and twine"]);
    expect(trade?.options?.[0].prose).toMatch(/^Barrels, casks/);
    const vice = resolved.steps.find((entry) => entry.step.id === "vice");
    expect(vice?.then?.[0].tables?.[0].name).toBe("Vices (d6)");
  });
});

/* -------------------------------------------------------------------------- */
/* The routes                                                                   */
/* -------------------------------------------------------------------------- */

let roomId = 0;
let characterId = 0;
const owner = 1;
const stranger = 2;

beforeEach(() => {
  db.exec("DELETE FROM characters; DELETE FROM memberships; DELETE FROM rooms; DELETE FROM accounts;");
  db.prepare(
    "INSERT INTO accounts (id, username, password_hash, account_role) VALUES (1, 'Player', '', 'player')"
  ).run();
  db.prepare(
    "INSERT INTO accounts (id, username, password_hash, account_role) VALUES (2, 'Other', '', 'player')"
  ).run();
  roomId = Number(
    db.prepare("INSERT INTO rooms (name, system, theme, created_by) VALUES ('Table', 'toybox', 'grim', 1)").run()
      .lastInsertRowid
  );
  for (const accountId of [owner, stranger])
    db.prepare("INSERT INTO memberships (room_id, account_id, role) VALUES (?, ?, 'player')").run(roomId, accountId);
  characterId = Number(
    db
      .prepare(
        "INSERT INTO characters (system, owner_account_id, name, sheet_json) VALUES ('toybox', 1, 'Nobody', '{}')"
      )
      .run().lastInsertRowid
  );
});

function row() {
  return one<CharacterRow>("SELECT c.*, NULL AS owner_username FROM characters c WHERE c.id = ?", characterId)!;
}

function sheetNow() {
  return publicCharacter(row(), roomId).sheet;
}

function draftNow() {
  return publicCharacter(row(), roomId).creation;
}

function expectCharacter(result: ReturnType<typeof rollCreationStep>) {
  if ("error" in result) throw new Error(result.error);
  return result.character;
}

describe("the creation routes", () => {
  it("refuses every one of them to somebody else's character", () => {
    expect(rollCreationStep(stranger, roomId, characterId)).toMatchObject({ status: 404 });
    expect(updateCreationDraft(stranger, roomId, characterId, { stepId: "abilities" })).toMatchObject({ status: 404 });
    expect(finishCreation(stranger, roomId, characterId)).toMatchObject({ status: 404 });
  });

  it("rolls the step the draft is on, writes the sheet, and records the ledger", () => {
    const character = expectCharacter(rollCreationStep(owner, roomId, characterId, { stepId: "hit-protection" }));
    expect(typeof character.sheet.hpMax).toBe("number");
    expect(character.creation?.stepId).toBe("hit-protection");
    expect(character.creation?.steps["hit-protection"]).toMatchObject({ runs: 1 });
    expect(character.creation?.steps["hit-protection"].total).toBe(character.sheet.hpMax);
  });

  it("allows a reroll and counts it, replacing what the first one wrote", () => {
    rollCreationStep(owner, roomId, characterId, { stepId: "kit" });
    const again = expectCharacter(rollCreationStep(owner, roomId, characterId, { stepId: "kit" }));
    expect(again.creation?.steps.kit.runs).toBe(2);
    expect(again.sheet.inventory).toEqual(["Cudgel (d6)", "Lantern", "Chalk and twine"]);
  });

  it("refuses a step this character cannot be on", () => {
    expect(rollCreationStep(owner, roomId, characterId, { stepId: "vice-roll" })).toMatchObject({
      status: 400,
      error: "That is not a step this character can be on."
    });
  });

  it("reports a step that could not be rolled rather than half-writing it", () => {
    expect(rollCreationStep(owner, roomId, characterId, { stepId: "vice" })).toMatchObject({ status: 400 });
    expect(draftNow()).toBeNull();
  });

  it("assigns rolled scores only where the check allows it", () => {
    const rolled = expectCharacter(rollCreationStep(owner, roomId, characterId, { stepId: "abilities" }));
    const totals = rolled.creation!.steps.abilities.scores!.map((score) => score.total);
    expect(rolled.sheet.muscleMax).toBeUndefined();

    const invented = [...totals];
    invented[0] += 1;
    expect(updateCreationDraft(owner, roomId, characterId, { stepId: "abilities", assign: invented })).toMatchObject({
      status: 400
    });

    const swapped = [totals[1], totals[0], totals[2]];
    const assigned = expectCharacter(
      updateCreationDraft(owner, roomId, characterId, { stepId: "abilities", assign: swapped })
    );
    expect(assigned.sheet.muscleCurrent).toBe(swapped[0]);
    expect(assigned.sheet.nerveMax).toBe(swapped[1]);
  });

  it("refuses an assignment before anything has been rolled", () => {
    expect(updateCreationDraft(owner, roomId, characterId, { stepId: "abilities", assign: [3, 3, 3] })).toMatchObject({
      status: 400,
      error: "Roll this step's scores before placing them."
    });
  });

  it("takes the declared array instead of rolling, and needs no roll to do it", () => {
    const taken = expectCharacter(
      updateCreationDraft(owner, roomId, characterId, { stepId: "abilities", array: [8, 14, 11] })
    );
    expect(taken.sheet).toMatchObject({
      muscleCurrent: 8,
      muscleMax: 8,
      nerveCurrent: 14,
      nerveMax: 14,
      knackCurrent: 11,
      knackMax: 11
    });
    expect(taken.creation?.steps.abilities.source).toBe("array");
    // The dice are put away with it, so a resumed wizard shows the array panel
    // rather than a set of rolls the sheet no longer reflects.
    expect(taken.creation?.steps.abilities.scores).toBeUndefined();
  });

  it("refuses an array that is not the one the book printed", () => {
    expect(updateCreationDraft(owner, roomId, characterId, { stepId: "abilities", array: [14, 14, 11] })).toMatchObject(
      { status: 400 }
    );
  });

  it("lets a rolled step be filled from the array afterwards, and the numbers change with it", () => {
    const rolled = expectCharacter(rollCreationStep(owner, roomId, characterId, { stepId: "abilities" }));
    expect(rolled.creation?.steps.abilities.source).toBe("rolled");
    const taken = expectCharacter(
      updateCreationDraft(owner, roomId, characterId, { stepId: "abilities", array: [14, 11, 8] })
    );
    expect(taken.sheet.muscleMax).toBe(14);
    expect(taken.creation?.steps.abilities.source).toBe("array");
  });

  it("writes what a player typed into a text step", () => {
    const typed = expectCharacter(
      updateCreationDraft(owner, roomId, characterId, { stepId: "anything-else", text: "Afraid of doors." })
    );
    expect(typed.sheet.notes).toBe("Afraid of doors.");
    expect(typed.creation?.steps["anything-else"].chosen).toBe("Afraid of doors.");
  });

  it("replaces an editable rolled name with the player's own", () => {
    rollCreationStep(owner, roomId, characterId, { stepId: "name" });
    const typed = expectCharacter(
      updateCreationDraft(owner, roomId, characterId, { stepId: "name", text: "Custom Name" })
    );
    expect(typed.name).toBe("Custom Name");
    expect(typed.creation?.steps.name.chosen).toBe("Custom Name");
  });

  it("stows the gear a packet offered, once the player says so and not before", () => {
    rollCreationStep(owner, roomId, characterId, { stepId: "hit-protection" });
    rollCreationStep(owner, roomId, characterId, { stepId: "trade", choice: "Cooper" });
    expect(sheetNow().inventory).toBeUndefined();

    const taken = expectCharacter(
      updateCreationDraft(owner, roomId, characterId, { stepId: "trade", take: ["Crowbar"] })
    );
    expect(taken.sheet.inventory).toEqual(["Crowbar"]);
    expect(taken.sheet.trade).toBe("Cooper");
  });

  it("keeps fixed kit when the final review adds background gear", () => {
    rollCreationStep(owner, roomId, characterId, { stepId: "hit-protection" });
    rollCreationStep(owner, roomId, characterId, { stepId: "trade", choice: "Cooper" });
    const prepared = expectCharacter(rollCreationStep(owner, roomId, characterId, { stepId: "kit" }));
    expect(prepared.creation?.steps.kit.candidates?.some((candidate) => candidate.text === "Crowbar")).toBe(true);

    const reviewed = expectCharacter(
      updateCreationDraft(owner, roomId, characterId, { stepId: "kit", take: ["Crowbar"] })
    );
    expect(reviewed.sheet.inventory).toEqual(["Cudgel (d6)", "Lantern", "Chalk and twine", "Crowbar"]);
  });

  it("files each reviewed result as either description or inventory and can change that choice", () => {
    rollCreationStep(owner, roomId, characterId, { stepId: "hit-protection" });
    rollCreationStep(owner, roomId, characterId, { stepId: "trade", choice: "Cooper" });
    rollCreationStep(owner, roomId, characterId, { stepId: "kit" });

    const described = expectCharacter(
      updateCreationDraft(owner, roomId, characterId, { stepId: "kit", take: [], describe: ["Crowbar"] })
    );
    expect(described.sheet.notes).toContain("Crowbar");
    expect(described.sheet.inventory).toEqual(["Cudgel (d6)", "Lantern", "Chalk and twine"]);

    const inventoried = expectCharacter(
      updateCreationDraft(owner, roomId, characterId, { stepId: "kit", take: ["Crowbar"], describe: [] })
    );
    expect(inventoried.sheet.notes).not.toContain("\nCrowbar");
    expect(inventoried.sheet.inventory).toEqual(["Cudgel (d6)", "Lantern", "Chalk and twine", "Crowbar"]);
  });

  it("files a packet's gear in the list the step names rather than guessing", () => {
    rollCreationStep(owner, roomId, characterId, { stepId: "hit-protection" });
    const chosen = expectCharacter(rollCreationStep(owner, roomId, characterId, { stepId: "trade", choice: "Cooper" }));
    // Both of Cooper's bullets match the catalogue, and the step names the list
    // anyway: `listKey` is what an unmatched one would have had to go on.
    expect(chosen.creation?.steps.trade.candidates?.map((entry) => entry.listKey)).toEqual([
      "inventory",
      "inventory",
      "inventory"
    ]);
  });

  it("refuses to file a candidate that matches nothing and has no list to go in", () => {
    rollCreationStep(owner, roomId, characterId, { stepId: "hit-protection" });
    rollCreationStep(owner, roomId, characterId, { stepId: "trade", choice: "Cooper" });
    // Bent by hand rather than by the fixture: toybox's own gear all matches, and
    // what is under test is the sheet with two lists that Monolith already has.
    const draft = JSON.parse(row().creation_json!) as {
      steps: Record<string, { candidates: { text: string; listKey?: string }[] }>;
    };
    draft.steps.trade.candidates = [{ text: "A hoop that fits nothing" }];
    db.prepare("UPDATE characters SET creation_json = ? WHERE id = ?").run(JSON.stringify(draft), characterId);

    expect(
      updateCreationDraft(owner, roomId, characterId, { stepId: "trade", take: ["A hoop that fits nothing"] })
    ).toMatchObject({ status: 400, error: /put it in a slot in your own words/ });
    expect(sheetNow().inventory).toBeUndefined();
  });

  it("refuses gear the step never offered", () => {
    rollCreationStep(owner, roomId, characterId, { stepId: "hit-protection" });
    rollCreationStep(owner, roomId, characterId, { stepId: "trade", choice: "Cooper" });
    expect(updateCreationDraft(owner, roomId, characterId, { stepId: "trade", take: ["Longblade"] })).toMatchObject({
      status: 400
    });
  });

  it("takes a skipped step's slots and lines back, and leaves what it set outright", () => {
    rollCreationStep(owner, roomId, characterId, { stepId: "kit" });
    expect(sheetNow().inventory).toHaveLength(3);
    const skipped = expectCharacter(updateCreationDraft(owner, roomId, characterId, { stepId: "kit", skip: true }));
    expect(skipped.creation?.steps.kit.skipped).toBe(true);
    expect(skipped.sheet.inventory).toEqual([]);
    // What a step wrote outright stays. The sheet is the player's and the
    // builder keeps no record of what a field held before it, so blanking one
    // would be as likely to throw away something typed since as to undo a roll.
    expect(skipped.sheet.coin).toBe(sheetNow().coin);
  });

  /**
   * A skip suspends a step; it does not unmake it. Dropping the write meant an
   * un-skipped `roll-scores` came back with its numbers on the sheet and
   * nothing anywhere saying which step put them there, so the running summary
   * fell back to reciting the raw totals.
   */
  it("puts a step's work back when the skip is taken back", () => {
    rollCreationStep(owner, roomId, characterId, { stepId: "kit" });
    const stowed = sheetNow().inventory;
    const coin = sheetNow().coin;

    updateCreationDraft(owner, roomId, characterId, { stepId: "kit", skip: true });
    const restored = expectCharacter(updateCreationDraft(owner, roomId, characterId, { stepId: "kit", skip: false }));

    expect(restored.creation?.steps.kit.skipped).toBe(false);
    expect(restored.creation?.steps.kit.applied).toBeTruthy();
    expect(restored.sheet.inventory).toEqual(stowed);
    // And nothing is put back twice: the coin was never taken out.
    expect(restored.sheet.coin).toBe(coin);
  });

  it("rolls one name however many times it is rolled", () => {
    // The row is created with a placeholder name, because `POST /characters`
    // requires one. Joining onto it made every rolled name an addition to it.
    const first = expectCharacter(rollCreationStep(owner, roomId, characterId, { stepId: "name" }));
    expect(first.name.split(" ")).toHaveLength(2);
    expect(first.name).not.toMatch(/Nobody/);

    const again = expectCharacter(rollCreationStep(owner, roomId, characterId, { stepId: "name" }));
    expect(again.name.split(" ")).toHaveLength(2);
    expect(again.creation?.steps.name.runs).toBe(2);
  });

  it("files a rolled result in either its description or a slot", () => {
    const rolled = expectCharacter(rollCreationStep(owner, roomId, characterId, { stepId: "odds-and-ends" }));
    const offered = rolled.creation!.steps["odds-and-ends"].candidates!;
    expect(offered).toHaveLength(1);
    expect(offered[0].listKey).toBe("inventory");
    expect(rolled.sheet.inventory).toBeUndefined();

    const taken = expectCharacter(
      updateCreationDraft(owner, roomId, characterId, {
        stepId: "odds-and-ends",
        take: [offered[0].text],
        describe: []
      })
    );
    expect(taken.sheet.inventory).toEqual([offered[0].label ?? offered[0].text]);
    expect(taken.sheet.notes).toBe("");

    const described = expectCharacter(
      updateCreationDraft(owner, roomId, characterId, {
        stepId: "odds-and-ends",
        take: [],
        describe: [offered[0].text]
      })
    );
    expect(described.sheet.inventory).toEqual([]);
    expect(described.sheet.notes).toBe(offered[0].description);
  });

  it("moves between steps without touching the sheet", () => {
    const moved = expectCharacter(updateCreationDraft(owner, roomId, characterId, { stepId: "kit" }));
    expect(moved.creation?.stepId).toBe("kit");
    expect(moved.sheet).toEqual({});
  });

  it("clears the draft when the build is finished, leaving a plain sheet", () => {
    rollCreationStep(owner, roomId, characterId, { stepId: "hit-protection" });
    const finished = expectCharacter(finishCreation(owner, roomId, characterId));
    expect(finished.creation).toBeNull();
    expect(typeof finished.sheet.hpMax).toBe("number");
    expect(finished.sheet).toMatchObject({ armor: 0, criticalDamage: false, deprived: false });
    expect(row().creation_json).toBeNull();
  });
});

describe("a save's branch, through the routes", () => {
  beforeEach(() => {
    db.prepare("UPDATE characters SET sheet_json = ? WHERE id = ?").run(
      JSON.stringify({ nerveCurrent: 20 }),
      characterId
    );
  });

  it("opens the branch on the outcome the step names, and closes it again on a reroll", () => {
    // A nerve of 20 is a save that only the automatic failure can lose, so the
    // branch opens sooner or later without the test reaching into the dice.
    let opened = false;
    for (let attempt = 0; attempt < 200 && !opened; attempt += 1) {
      const rolled = expectCharacter(rollCreationStep(owner, roomId, characterId, { stepId: "vice" }));
      opened = Boolean(rolled.creation?.steps.vice.save?.matched);
    }
    expect(opened).toBe(true);

    expectCharacter(rollCreationStep(owner, roomId, characterId, { stepId: "vice-roll" }));
    expect(Array.isArray(sheetNow().vices)).toBe(true);

    let closed = false;
    for (let attempt = 0; attempt < 200 && !closed; attempt += 1) {
      const rolled = expectCharacter(rollCreationStep(owner, roomId, characterId, { stepId: "vice" }));
      closed = !rolled.creation?.steps.vice.save?.matched;
    }
    expect(closed).toBe(true);
    // The branch that did not happen takes its vice back with it, rather than
    // leaving the sheet disagreeing with the ledger that produced it.
    expect(sheetNow().vices).toEqual([]);
  });
});
