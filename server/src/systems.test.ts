import { beforeAll, describe, expect, it } from "vitest";
import { evaluateCharacterWarnings, groupViewsForDefinition } from "@devils-toys/shared";
import { builtinSystems } from "./builtin-systems.js";
import { characterItemsFor } from "./character-items.js";
import { installToybox, toyboxDefinition } from "./test-fixture.js";
import {
  allSystems,
  filterPlayerRules,
  hasSystem,
  registerSystem,
  systemIdSchema,
  systemIds,
  systemOrThrow,
  unregisterSystem
} from "./systems.js";

/**
 * What this file used to be, and why it is not: every assertion below was once
 * made against Cairn, Monolith, or Cities Without Number, which were compiled
 * into this repository. They are repositories of their own now, so the *content*
 * assertions went with them and what remains is the machinery — which is what
 * belonged here all along. `toybox` stands in for a system.
 */

describe("the system registry", () => {
  it("starts empty, because this application ships no game system", () => {
    expect(systemIds()).toEqual([]);
    expect(allSystems()).toEqual([]);
    expect(builtinSystems).toEqual({});
  });

  it("names the system it was asked for when it does not have one", () => {
    expect(() => systemOrThrow("toybox")).toThrow("No such system: toybox.");
  });

  it("accepts a system registered after start, without a restart", () => {
    expect(systemIdSchema.safeParse("toybox").success).toBe(false);

    registerSystem(toyboxDefinition());
    try {
      expect(hasSystem("toybox")).toBe(true);
      expect(systemIdSchema.safeParse("toybox").success).toBe(true);
      expect(systemOrThrow("toybox").name).toBe("Toybox");
    } finally {
      unregisterSystem("toybox");
    }
    expect(hasSystem("toybox")).toBe(false);
  });

  it("rejects an unknown id through the request schema rather than letting it reach a route", () => {
    const rejected = systemIdSchema.safeParse("nowhere");
    expect(rejected.success).toBe(false);
    expect(rejected.error?.issues[0]?.message).toBe("No such system: nowhere.");
  });

  /**
   * Nothing is built in today, so these two guards protect a case that cannot
   * arise — which is exactly how a guard rots. The built-in list is stood up for
   * the length of the test so that the rule survives until a system ships in the
   * image again.
   */
  describe("with a system compiled into the build", () => {
    const definition = toyboxDefinition();
    beforeAll(() => {
      builtinSystems.toybox = definition;
      return () => {
        delete builtinSystems.toybox;
      };
    });

    it("refuses to replace one", () => {
      expect(() => registerSystem({ ...definition, name: "Counterfeit Toybox" })).toThrow(
        /Cannot replace built-in system/
      );
    });

    it("refuses to unregister one", () => {
      expect(unregisterSystem("toybox")).toBe(false);
    });
  });
});

describe("role-filtered rules", () => {
  const source = `# Rules

Open text.

## Secret Tables

Hidden introduction.

### Hidden child

Hidden detail.

## Player Rules

Visible again.`;

  it("removes a configured section and all of its children", () => {
    const visible = filterPlayerRules(source, ["Secret Tables"]);
    expect(visible).not.toContain("Hidden introduction");
    expect(visible).not.toContain("Hidden child");
    expect(visible).toContain("Open text");
    expect(visible).toContain("Player Rules");
  });
});

describe("a system's declared sheet", () => {
  beforeAll(() => {
    installToybox();
  });

  it("is read from the definition rather than from anything compiled in", () => {
    const toybox = systemOrThrow("toybox");
    expect(toybox.characterSheet.lists.find((list) => list.key === "inventory")?.slots).toHaveLength(6);
    expect(toybox.characterSheet.sections.flatMap((section) => section.fields).map((field) => field.key)).toEqual(
      expect.arrayContaining(["hpCurrent", "hpMax", "muscleCurrent", "muscleMax", "deprived", "vices"])
    );
  });

  /** Every warning kind the schema allows, fired at once. */
  it("reports advisory constraints from its declared rules", () => {
    expect(
      evaluateCharacterWarnings(systemOrThrow("toybox").warningRules, {
        hpCurrent: 5,
        hpMax: 3,
        muscleMax: 19,
        deprived: true,
        inventory: Array.from({ length: 6 }, () => "gear")
      })
    ).toEqual([
      "Hit Protection is above its maximum.",
      "Muscle is outside 3-18.",
      "Deprived: no recovery until it is resolved.",
      "Every slot is full."
    ]);
  });

  /**
   * The client used to pick these by matching the system's name, so a system
   * could only ever have the tabs Monolith had.
   */
  it("gives a system with no group page the one tab it can have", () => {
    expect(groupViewsForDefinition(undefined)).toEqual([{ id: "party", label: "Party Members" }]);
  });

  it("gives a system the tabs its own group page asks for", () => {
    expect(groupViewsForDefinition(systemOrThrow("toybox").groupPage)).toEqual([
      { id: "party", label: "Party Members" },
      { id: "group", label: "Hands" },
      { id: "obligations", label: "Debts" },
      { id: "starship", label: "Starships" }
    ]);
  });

  it("gives a system the group tabs its own definition asks for", () => {
    const withGroup = {
      ...toyboxDefinition(),
      groupPage: {
        sections: [],
        hirelings: {
          label: "Hands",
          singularLabel: "Hand",
          rulesQuery: "Hirelings",
          creationHint: "",
          levelUpHint: "",
          sheet: { sections: [], lists: [] }
        },
        obligations: { label: "Debts", singularLabel: "Debt" }
      }
    };
    expect(groupViewsForDefinition(withGroup.groupPage)).toEqual([
      { id: "party", label: "Party Members" },
      { id: "group", label: "Hands" },
      { id: "obligations", label: "Debts" }
    ]);
  });

  it("serves the gear catalogue its repository committed, classified by the book's own words", () => {
    const catalogue = characterItemsFor("toybox");
    const item = (name: string) => catalogue.inventory?.find((entry) => entry.name === name);

    expect(item("Cudgel")).toMatchObject({ weapon: true, damage: "d6" });
    expect(item("Longblade")).toMatchObject({ weapon: true, damage: "d8", bulky: true });
    expect(item("Hand Axe")).toMatchObject({ weapon: true, range: "thrown" });
    // A tool is gear, not something to attack with, however it is priced.
    expect(item("Lantern")?.weapon).toBe(false);
    expect(item("Rope, 50 feet")).toMatchObject({ weapon: false, bulky: true });
  });
});
