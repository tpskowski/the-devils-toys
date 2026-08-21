import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { CREATION_NAME_KEY } from "@devils-toys/shared";
import { builtinSystems } from "./builtin-systems.js";
import { buildSystemBundle, readSystemBundle, renameSystem } from "./system-bundles.js";
import {
  installedSystemIds,
  refuseUninstallableBundle,
  refuseUninstallableCreation,
  systemContentFor,
  writeSystemBundle
} from "./system-install.js";
import { installedSystemRoot } from "./system-content.js";
import { installToybox } from "./test-fixture.js";

installToybox();

const bundleFor = (id: string, as = `${id}-2`) =>
  readSystemBundle(buildSystemBundle(renameSystem(systemContentFor(id), as)));

/** A readable bundle whose definition can be bent one way at a time. */
const bent = (change: (system: Record<string, never>) => void) => {
  const bundle = bundleFor("toybox");
  change(bundle.system as never);
  return bundle;
};

describe("what a bundle has to be true of to install", () => {
  // The check has to pass a real system before it may reject anything: a rule
  // the fixture itself fails is a wrong rule, not a bad system.
  it("accepts a whole system, renamed and bundled", () => {
    expect(() => refuseUninstallableBundle(bundleFor("toybox"))).not.toThrow();
  });

  /**
   * Nothing is compiled into this build, so the guard has no case to catch. The
   * built-in list is stood up for the length of the test rather than left to
   * rot — see the same arrangement in `systems.test.ts`.
   */
  it("refuses to overwrite a system this application ships", () => {
    const bundle = readSystemBundle(buildSystemBundle(systemContentFor("toybox")));
    builtinSystems.toybox = bundle.system;
    try {
      expect(() => refuseUninstallableBundle(bundle)).toThrow(/is a system this application ships/);
    } finally {
      delete builtinSystems.toybox;
    }
  });

  it("refuses two sheet lists under one key", () => {
    const bundle = bent((system) => {
      const sheet = (system as Record<string, { lists: unknown[] }>).characterSheet;
      sheet.lists = [...sheet.lists, sheet.lists[0]];
    });
    expect(() => refuseUninstallableBundle(bundle)).toThrow(/declares two lists called "inventory"/);
  });

  it("refuses a hit points key that names no statblock field", () => {
    const bundle = bent((system) => {
      (system as Record<string, { hitPointsKey: string }>).npcStatblock.hitPointsKey = "wounds";
    });
    expect(() => refuseUninstallableBundle(bundle)).toThrow(/hitPointsKey is "wounds", which is not one of/);
  });

  it("refuses an armour key that names no statblock field", () => {
    const bundle = bent((system) => {
      (system as Record<string, { armorKey: string }>).npcStatblock.armorKey = "plating";
    });
    expect(() => refuseUninstallableBundle(bundle)).toThrow(/armorKey is "plating"/);
  });

  it("refuses a warning rule that reads a field the sheet has not got", () => {
    // A rule naming a field nothing writes can never fire. Silent, and so worse
    // than being told at the door.
    const bundle = bent((system) => {
      (system as Record<string, unknown[]>).warningRules = [
        { kind: "range", key: "sanity", max: 10, message: "Sanity is failing." }
      ];
    });
    expect(() => refuseUninstallableBundle(bundle)).toThrow(/reads "sanity", which is not a field or list/);
  });

  it("refuses a comparison against a field the sheet has not got", () => {
    const bundle = bent((system) => {
      (system as Record<string, unknown[]>).warningRules = [
        { kind: "compare", key: "hpCurrent", against: "luck", operator: ">", message: "over" }
      ];
    });
    expect(() => refuseUninstallableBundle(bundle)).toThrow(/reads "luck"/);
  });

  it("accepts a warning rule that reads one of the sheet's lists", () => {
    const bundle = bent((system) => {
      (system as Record<string, unknown[]>).warningRules = [
        { kind: "list-occupancy", listKey: "inventory", tiers: [{ atLeast: 6, message: "Full." }] }
      ];
    });
    expect(() => refuseUninstallableBundle(bundle)).not.toThrow();
  });

  it("refuses a content module pointing at a source document the bundle has not got", () => {
    const bundle = bent((system) => {
      (system as Record<string, { sourceDocumentId: string }[]>).contentModules[0].sourceDocumentId = "elsewhere";
    });
    expect(() => refuseUninstallableBundle(bundle)).toThrow(/names source document "elsewhere"/);
  });
});

/**
 * The creation declaration is checked against the rest of the bundle it will be
 * performed over, so every case here bends the fixture's own steps one way and
 * asks for the message an author would act on.
 */
describe("what a creation declaration has to be true of to install", () => {
  type Step = Record<string, unknown>;
  type Creation = { label: string; steps: Step[] };

  const flattened = (creation: Creation): Step[] =>
    creation.steps.flatMap((step) => (Array.isArray(step.then) ? [step, ...(step.then as Step[])] : [step]));

  /** A step of the fixture's own declaration, wherever it is written. */
  const stepOf = (creation: Creation, id: string): Step => {
    const step = flattened(creation).find((candidate) => candidate.id === id);
    if (!step) throw new Error(`The fixture has no "${id}" creation step.`);
    return step;
  };

  /** The fixture's declaration, bent one way. */
  const bentCreation = (change: (creation: Creation) => void) =>
    bent((system) => change((system as Record<string, Creation>).characterCreation));

  // As with the bundle checks, the rule has to pass a real declaration before it
  // may refuse anything: toybox declares all nine kinds, a save with a step
  // nested in it, a packet over the book's own headings, a table read by a named
  // column, and a total taken from an earlier step's roll.
  it("accepts the fixture's own declaration, which exercises every step kind", () => {
    expect(() => refuseUninstallableCreation(bundleFor("toybox"))).not.toThrow();
  });

  it("accepts a system that declares no creation at all", () => {
    const bundle = bent((system) => {
      delete (system as Record<string, unknown>).characterCreation;
    });
    expect(() => refuseUninstallableCreation(bundle)).not.toThrow();
  });

  it("refuses a step of a kind this build has no way to perform", () => {
    const bundle = bentCreation((creation) => {
      stepOf(creation, "how-it-works").kind = "portrait";
    });
    expect(() => refuseUninstallableCreation(bundle)).toThrow(
      /"how-it-works" is of kind "portrait", which this build has no way to perform/
    );
  });

  it("refuses two steps sharing an id, counting the ones nested in a save", () => {
    const bundle = bentCreation((creation) => {
      stepOf(creation, "vice-roll").id = "abilities";
    });
    expect(() => refuseUninstallableCreation(bundle)).toThrow(/Two creation steps share the id "abilities"/);
  });

  it("refuses a step that writes a field the sheet has not got", () => {
    const bundle = bentCreation((creation) => {
      stepOf(creation, "anything-else").field = "sanity";
    });
    expect(() => refuseUninstallableCreation(bundle)).toThrow(
      /"anything-else" writes "sanity", which is not a field the sheet declares/
    );
  });

  // The character's name is a column on the row rather than a field on the
  // sheet, and is the one target a step may write that `characterSheet` has not
  // got. The fixture rolls one; typing one is the same target. `multiline` goes
  // with it, because a name is one line and the field-kind check says so.
  it("accepts the character's own name as a target no sheet declares", () => {
    const bundle = bentCreation((creation) => {
      const step = stepOf(creation, "anything-else");
      step.field = CREATION_NAME_KEY;
      step.multiline = false;
    });
    expect(() => refuseUninstallableCreation(bundle)).not.toThrow();
  });

  it("refuses a step that reads a field the sheet has not got", () => {
    const bundle = bentCreation((creation) => {
      stepOf(creation, "vice").key = "resolve";
    });
    expect(() => refuseUninstallableCreation(bundle)).toThrow(
      /"vice" reads "resolve", which is not a field the sheet declares/
    );
  });

  it("refuses a step that stows into a list the sheet has not got", () => {
    const bundle = bentCreation((creation) => {
      stepOf(creation, "kit").listKey = "backpack";
    });
    expect(() => refuseUninstallableCreation(bundle)).toThrow(
      /"kit" stows into "backpack", which is not a list the sheet declares/
    );
  });

  it("refuses an editable table step with nowhere to write the custom value", () => {
    const bundle = bentCreation((creation) => {
      delete stepOf(creation, "name").joinInto;
    });
    expect(() => refuseUninstallableCreation(bundle)).toThrow(/"name" is editable but has no joined field/);
  });

  it("refuses a gear review that points forward", () => {
    const bundle = bentCreation((creation) => {
      stepOf(creation, "kit").reviewFrom = ["anything-else"];
    });
    expect(() => refuseUninstallableCreation(bundle)).toThrow(
      /"kit" reviews gear from "anything-else", which is not a step before it/
    );
  });

  it("refuses equipment-derived armor from a list the sheet has not got", () => {
    const bundle = bentCreation((creation) => {
      const [derivation] = stepOf(creation, "currents").derive as Step[];
      derivation.op = "equipment-armor";
      derivation.from = ["backpack"];
    });
    expect(() => refuseUninstallableCreation(bundle)).toThrow(
      /"currents" reads armor from "backpack", which is not a list the sheet declares/
    );
  });

  it("refuses a roll on a table the bundle does not carry", () => {
    const bundle = bentCreation((creation) => {
      (stepOf(creation, "name").tables as Step[])[0].table = "Name & Trade (d8)";
    });
    expect(() => refuseUninstallableCreation(bundle)).toThrow(
      /"name" rolls on "Name & Trade \(d8\)", which is not a table the bundle has/
    );
  });

  it("refuses a column the named table has not got", () => {
    const bundle = bentCreation((creation) => {
      (stepOf(creation, "name").tables as Step[])[1].column = "Surname";
    });
    expect(() => refuseUninstallableCreation(bundle)).toThrow(
      /"name" reads the "Surname" column of "Names \(d6\)", which that table has not got/
    );
  });

  // A choice between columns is checked as every column it might land on. One
  // of them missing is a screen that works four times in five.
  it("refuses a column the table has not got from inside a choice between columns", () => {
    const bundle = bentCreation((creation) => {
      (stepOf(creation, "name").tables as Step[])[0].columnFirstOf = ["Given Name", "Surname"];
    });
    expect(() => refuseUninstallableCreation(bundle)).toThrow(
      /"name" reads the "Surname" column of "Names \(d6\)", which that table has not got/
    );
  });

  it("refuses a rolled result offered into a list the sheet has not got", () => {
    const bundle = bentCreation((creation) => {
      (stepOf(creation, "odds-and-ends").tables as Step[])[0].stowInto = "backpack";
    });
    expect(() => refuseUninstallableCreation(bundle)).toThrow(
      /"odds-and-ends" stows into "backpack", which is not a list the sheet declares/
    );
  });

  it("refuses a packet naming a heading the book does not have", () => {
    const bundle = bentCreation((creation) => {
      stepOf(creation, "trade").under = "BACKGROUNDS";
    });
    expect(() => refuseUninstallableCreation(bundle)).toThrow(
      /"trade" names the heading "BACKGROUNDS", which the bundle's rules do not have/
    );
  });

  /**
   * `prose` and `grantFrom` are read out of a packet's own sections, so asking
   * whether they exist anywhere in the book answers a different question.
   * Cairn's Optional Gear Packages are ten headings with bullets directly
   * beneath them: a packet naming `grantFrom: "Starting Gear"` passes the loose
   * test — that heading is real, under Character Creation — and offers an empty
   * checklist to every player who ever takes one.
   */
  it("refuses a packet reading a heading that exists in the book but not under its own sections", () => {
    const bundle = bentCreation((creation) => {
      stepOf(creation, "trade").grantFrom = "Inventory";
    });
    expect(() => refuseUninstallableCreation(bundle)).toThrow(
      /"trade" reads "Inventory" out of the sections under "Trades", and none of them has a heading of that name/
    );
  });

  it("accepts a heading that is beneath the packet's own sections", () => {
    // The other direction, and the reason the check is a descent rather than a
    // ban: `Kit` and `About` are exactly this, one level inside each trade.
    const bundle = bentCreation((creation) => {
      const step = stepOf(creation, "trade");
      step.prose = "Kit";
      step.grantFrom = "About";
    });
    expect(() => refuseUninstallableCreation(bundle)).not.toThrow();
  });

  it("accepts a later table step resolved from the packet section the player chose", () => {
    const bundle = bentCreation((creation) => {
      const declared = creation.steps as Step[];
      declared.splice(declared.findIndex((step) => step.id === "trade") + 1, 0, {
        id: "trade-keepsake",
        kind: "roll-table",
        label: "Trade keepsake",
        section: "Trades",
        tables: [{ fromPacket: "trade", position: 1, fromStep: "hit-protection" }],
        joinInto: { field: "notes", separator: "\n", prefixWith: "table" }
      });
    });
    expect(() => refuseUninstallableCreation(bundle)).not.toThrow();
  });

  it("refuses a packet table position one of its sections does not have", () => {
    const bundle = bentCreation((creation) => {
      const declared = creation.steps as Step[];
      declared.splice(declared.findIndex((step) => step.id === "trade") + 1, 0, {
        id: "trade-second-table",
        kind: "roll-table",
        label: "Trade table two",
        section: "Trades",
        tables: [{ fromPacket: "trade", position: 2 }]
      });
    });
    expect(() => refuseUninstallableCreation(bundle)).toThrow(
      /"trade-second-table" reads table 2 from "Cooper", which has only 1/
    );
  });

  it("refuses a save of a type the system does not declare", () => {
    const bundle = bentCreation((creation) => {
      stepOf(creation, "vice").type = "grit";
    });
    expect(() => refuseUninstallableCreation(bundle)).toThrow(
      /"vice" makes a "grit" save, which is not one of the save types the system declares/
    );
  });

  it("refuses a total taken from a step that has not run yet", () => {
    const bundle = bentCreation((creation) => {
      (stepOf(creation, "trade").reuse as Step[])[0].fromStep = "currents";
    });
    expect(() => refuseUninstallableCreation(bundle)).toThrow(
      /"trade" takes its total from "currents", which is not a step before it/
    );
  });

  it("refuses a total taken from a step that rolls no die of its own", () => {
    const bundle = bentCreation((creation) => {
      (stepOf(creation, "trade").reuse as Step[])[0].fromStep = "how-it-works";
    });
    expect(() => refuseUninstallableCreation(bundle)).toThrow(
      /"trade" takes its total from "how-it-works", which rolls no die of its own/
    );
  });

  // A book with three backgrounds has no die to offer: `SUPPORTED_DIE_SIDES` has
  // no d3. Finding that out at install is the whole point of checking it here.
  it("refuses a die the roller has no sides for", () => {
    const bundle = bentCreation((creation) => {
      stepOf(creation, "trade").dice = "d3";
    });
    expect(() => refuseUninstallableCreation(bundle)).toThrow(/"trade" rolls "d3", which this build cannot roll/);
  });

  it("refuses a dice expression that rolls more dice than the roller will throw", () => {
    const bundle = bentCreation((creation) => {
      (stepOf(creation, "abilities").scores as { dice: string }[])[0].dice = "40d6";
    });
    expect(() => refuseUninstallableCreation(bundle)).toThrow(/"abilities" rolls "40d6", which this build cannot roll/);
  });

  /**
   * Check three proves the key exists; this one proves the box behind it can
   * hold what the step is about to put there. The `vices` case is the one that
   * turned up in practice — a rolled result written as text into a field that
   * keeps records passes every other check and draws an empty panel.
   */
  it("refuses a rolled number written where the sheet keeps a yes or a no", () => {
    const bundle = bentCreation((creation) => {
      (stepOf(creation, "kit").roll as { field: string }[])[0].field = "deprived";
    });
    expect(() => refuseUninstallableCreation(bundle)).toThrow(
      /"kit" writes a number to "deprived", which the sheet keeps as a checkbox field/
    );
  });

  it("refuses a table result written where the sheet keeps a number", () => {
    const bundle = bentCreation((creation) => {
      (stepOf(creation, "name").tables as Step[])[0].field = "coin";
    });
    expect(() => refuseUninstallableCreation(bundle)).toThrow(
      /"name" writes a rolled table result to "coin", which the sheet keeps as a number field/
    );
  });

  // The other half of the same case, and the reason the engine writes a vice as
  // a record: a `vices` field is the one place a table result is not text.
  it("accepts a table result written into the field that keeps rolled vices", () => {
    expect(() => refuseUninstallableCreation(bundleFor("toybox"))).not.toThrow();
  });

  it("refuses a constant of the wrong shape for the field it is written to", () => {
    const bundle = bentCreation((creation) => {
      (stepOf(creation, "starting-state").values as Record<string, unknown>).trade = true;
    });
    expect(() => refuseUninstallableCreation(bundle)).toThrow(
      /"starting-state" writes a yes or a no to "trade", which the sheet keeps as a text field/
    );
  });

  it("refuses several lines joined into a field that holds one", () => {
    const bundle = bentCreation((creation) => {
      (stepOf(creation, "trade").into as { joinInto: { field: string } }).joinInto.field = "trade";
    });
    expect(() => refuseUninstallableCreation(bundle)).toThrow(
      /"trade" writes text with line breaks in it to "trade", which the sheet keeps as a text field/
    );
  });

  // A join whose separator has no line break in it is one line however many
  // results go into it, which is how Monolith rolls a first name and a surname
  // into the character's own name.
  it("accepts a join with no line break in its separator into a single-line target", () => {
    const bundle = bentCreation((creation) => {
      const join = (stepOf(creation, "trade").into as { joinInto: { field: string; separator: string } }).joinInto;
      join.field = "trade";
      join.separator = ", ";
    });
    expect(() => refuseUninstallableCreation(bundle)).not.toThrow();
  });

  it("refuses paragraphs typed into the character's own name", () => {
    const bundle = bentCreation((creation) => {
      const step = stepOf(creation, "anything-else");
      step.field = CREATION_NAME_KEY;
      step.multiline = true;
    });
    expect(() => refuseUninstallableCreation(bundle)).toThrow(
      /"anything-else" writes text with line breaks in it to the character's own name/
    );
  });

  // Nothing this build performs produces an entry, so a step naming an entries
  // field is a screen that would draw nothing at all.
  it("refuses a step writing to a field the sheet keeps as entries", () => {
    const bundle = bent((system) => {
      const sheet = (system as Record<string, { sections: { fields: unknown[] }[] }>).characterSheet;
      sheet.sections[2].fields.push({ key: "log", label: "Log", kind: "entries" });
      const creation = (system as Record<string, Creation>).characterCreation;
      (stepOf(creation, "trade").into as { field: string }).field = "log";
    });
    expect(() => refuseUninstallableCreation(bundle)).toThrow(
      /"trade" writes a line of text to "log", which the sheet keeps as entries — no creation step produces one/
    );
  });

  it("refuses a packet that offers its gear into a list the sheet has not got", () => {
    const bundle = bentCreation((creation) => {
      stepOf(creation, "trade").listKey = "backpack";
    });
    expect(() => refuseUninstallableCreation(bundle)).toThrow(
      /"trade" stows into "backpack", which is not a list the sheet declares/
    );
  });

  it("refuses an array offering a different number of values than the step has scores", () => {
    const bundle = bentCreation((creation) => {
      (stepOf(creation, "abilities").array as { values: number[] }).values = [14, 11];
    });
    expect(() => refuseUninstallableCreation(bundle)).toThrow(/"abilities" offers 2 numbers to assign across 3 scores/);
  });

  it("refuses a sheet that declares a field named as the character's own name", () => {
    const bundle = bent((system) => {
      const sheet = (system as Record<string, { sections: { fields: unknown[] }[] }>).characterSheet;
      sheet.sections[0].fields.push({ key: CREATION_NAME_KEY, label: "Name", kind: "text" });
    });
    expect(() => refuseUninstallableCreation(bundle)).toThrow(
      /sheet declares a field called "\$name", which is how a creation step names the character's own name/
    );
  });
});

describe("writing an installed system", () => {
  const system = "toybox-2";
  const root = installedSystemRoot(system);
  const staging = `${root}.incoming`;

  const bundle = () => readSystemBundle(buildSystemBundle(renameSystem(systemContentFor("toybox"), system)));

  it("restores the previous content when replacing it cannot rename the staging directory", () => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(`${root}.replaced`, { recursive: true, force: true });
    writeSystemBundle(bundle());

    const rename = fs.renameSync;
    const blocked = vi.spyOn(fs, "renameSync").mockImplementation(((from: fs.PathLike, to: fs.PathLike) => {
      if (String(from) === staging && String(to) === root) throw new Error("rename blocked");
      return rename.call(fs, from, to);
    }) as typeof fs.renameSync);
    try {
      expect(() => writeSystemBundle(bundle())).toThrow("rename blocked");
    } finally {
      blocked.mockRestore();
    }

    expect(fs.existsSync(root)).toBe(true);
    expect(fs.existsSync(`${root}.replaced`)).toBe(false);
  });

  it("recovers a replaced directory left behind by an interrupted replacement on startup", () => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(`${root}.replaced`, { recursive: true, force: true });
    writeSystemBundle(bundle());
    fs.renameSync(root, `${root}.replaced`);

    expect(installedSystemIds()).toContain(system);
    expect(fs.existsSync(root)).toBe(true);
    expect(fs.existsSync(`${root}.replaced`)).toBe(false);
  });
});
