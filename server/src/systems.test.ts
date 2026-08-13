import { describe, expect, it } from "vitest";
import { BUILTIN_SYSTEM_IDS, evaluateCharacterWarnings, groupViewsForDefinition } from "@devils-toys/shared";
import { cairn } from "@devils-toys/system-cairn";
import { monolith } from "@devils-toys/system-monolith";
import { cwn } from "@devils-toys/system-cwn";
import { characterItemsFor } from "./character-items.js";
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

describe("the system registry", () => {
  it("holds every compiled system on start", () => {
    expect(systemIds()).toEqual([...BUILTIN_SYSTEM_IDS]);
    expect(allSystems().map((system) => system.name)).toEqual(["Cairn", "Monolith", "Cities Without Number"]);
  });

  it("names the system it was asked for when it does not have one", () => {
    expect(() => systemOrThrow("monolith-2")).toThrow("No such system: monolith-2.");
  });

  it("rejects an unknown id through the request schema rather than letting it reach a route", () => {
    const rejected = systemIdSchema.safeParse("monolith-2");
    expect(rejected.success).toBe(false);
    expect(rejected.error?.issues[0]?.message).toBe("No such system: monolith-2.");
    expect(systemIdSchema.safeParse("monolith").success).toBe(true);
  });

  it("accepts a system registered after start, without a restart", () => {
    const installed = { ...monolith, id: "monolith-2", name: "Monolith (installed)" };
    expect(systemIdSchema.safeParse("monolith-2").success).toBe(false);

    registerSystem(installed);
    try {
      expect(hasSystem("monolith-2")).toBe(true);
      expect(systemIdSchema.safeParse("monolith-2").success).toBe(true);
      expect(systemOrThrow("monolith-2").name).toBe("Monolith (installed)");
    } finally {
      unregisterSystem("monolith-2");
    }
    expect(hasSystem("monolith-2")).toBe(false);
  });

  it("refuses to unregister a compiled system", () => {
    expect(unregisterSystem("monolith")).toBe(false);
    expect(hasSystem("monolith")).toBe(true);
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

describe("character system definitions", () => {
  it("describes Cairn's source sheet and reports advisory constraints", () => {
    expect(cairn.characterSheet.lists.find((list) => list.key === "inventory")?.slots).toHaveLength(10);
    expect(cairn.characterSheet.sections.flatMap((section) => section.fields).map((field) => field.key)).toEqual(
      expect.arrayContaining(["background", "strCurrent", "strMax", "hpCurrent", "hpMax", "armor", "deprived"])
    );
    expect(
      evaluateCharacterWarnings(cairn.warningRules, {
        armor: 4,
        deprived: true,
        hpCurrent: 5,
        hpMax: 3,
        inventory: Array.from({ length: 10 }, () => "gear")
      })
    ).toEqual([
      "Cairn armor cannot normally exceed 3.",
      "A full 10-slot inventory reduces HP to 0.",
      "A deprived character cannot recover HP or ability scores.",
      "HP current value is above its recorded maximum."
    ]);
  });

  it("ships Monolith's weapon classification, corrections included", () => {
    const catalogue = characterItemsFor("monolith");
    const weapon = (list: string, name: string) => catalogue[list]?.find((item) => item.name === name);

    // The armoury's own categories, and a weapon the book files under Tools.
    expect(weapon("equipment", "Stun Gun")?.weapon).toBe(true);
    expect(weapon("equipment", "Sledgehammer")).toMatchObject({ weapon: true, damage: "D8" });
    expect(weapon("equipment", "Medkit")?.weapon).toBe(false);

    // Corrected by hand, because its damage is in a second parenthetical.
    expect(weapon("augmentations", "Basilisk Gland")).toMatchObject({
      weapon: true,
      damage: "1D8",
      traits: ["biological", "blast", "30 feet"]
    });
  });

  it("gives each system the group tabs its own definition asks for", () => {
    // The client used to pick these by matching the system's name, so a system
    // could only ever have the tabs Monolith has.
    expect(groupViewsForDefinition(cairn.groupPage)).toEqual([
      { id: "party", label: "Party Members" },
      { id: "group", label: "Hirelings" }
    ]);
    expect(groupViewsForDefinition(monolith.groupPage)).toEqual([
      { id: "party", label: "Party Members" },
      { id: "group", label: "Freelancers" },
      { id: "obligations", label: "Group Obligations" },
      { id: "starship", label: "Starships" }
    ]);
    // Cities Without Number has no group page at all, and so no tabs but one.
    expect(groupViewsForDefinition(cwn.groupPage)).toEqual([{ id: "party", label: "Party Members" }]);
  });

  it("defines Cairn's shared hireling sheet", () => {
    expect(cairn.groupPage?.hirelings?.label).toBe("Hirelings");
    expect(cairn.groupPage?.hirelings?.singularLabel).toBe("Hireling");
    expect(cairn.groupPage?.hirelings?.sheet.lists[0]?.slots).toHaveLength(10);
    expect(cairn.groupPage?.starshipSheet).toBeUndefined();
  });

  it("defines import-ready Without Number content modules without enabling imports", () => {
    expect(cwn.compatibility).toEqual({ family: "without-number", version: 1 });
    expect(cwn.imports).toEqual([]);
    expect(cwn.contentModules.map((module) => module.id)).toEqual([
      "cwn/core",
      "cwn/gear",
      "cwn/cyberware",
      "cwn/hacking",
      "cwn/antagonists",
      "cwn/magic"
    ]);
    expect(cwn.contentModules.find((module) => module.id === "cwn/cyberware")).toMatchObject({
      classification: "player",
      storageNamespace: "cwn.cyberware",
      provides: ["without-number/cyberware@1"],
      requires: ["without-number/core@1"]
    });
  });

  it("describes the Cities Without Number sheet and reports advisory constraints", () => {
    const fields = cwn.characterSheet.sections.flatMap((section) => section.fields);
    expect(fields.map((field) => field.key)).toEqual(
      expect.arrayContaining([
        "strScore",
        "physicalSave",
        "skillProgram",
        "cwn.cyberware.alienation",
        "cwn.hacking.programs",
        "cwn.magic.powers"
      ])
    );
    expect(fields.find((field) => field.key === "physicalSave")?.roll).toEqual({
      kind: "save",
      label: "Physical"
    });
    expect(
      evaluateCharacterWarnings(cwn.warningRules, {
        hpCurrent: 9,
        hpMax: 4,
        physicalSave: 21,
        wisScore: 10,
        "cwn.cyberware.alienation": 11,
        strScore: 11,
        readiedEncumbrance: 7,
        stowedEncumbrance: 16
      })
      // Readied is over half of STR 11 but within the extra 2; stowed is past
      // STR by more than 4, so it reports the further of the two sentences.
    ).toEqual([
      "Hit points current value is above its recorded maximum.",
      "Physical save target must be between 1 and 20.",
      "Alienation above Wisdom leaves the character in cyber-induced psychosis.",
      "Readied encumbrance is above normal capacity and reduces Move.",
      "Stowed encumbrance is beyond the normal extended-hauling allowance."
    ]);
  });

  it("describes Monolith's source sheet and reports advisory constraints", () => {
    expect(monolith.characterSheet.sections.find((section) => section.id === "vices")?.fields).toEqual([
      { key: "vices", label: "Vices", kind: "vices" }
    ]);
    const equipment = monolith.characterSheet.lists.find((list) => list.key === "equipment");
    expect(equipment?.slots).toHaveLength(10);
    expect(equipment?.slots.filter((slot) => slot.startsWith("Backpack"))).toHaveLength(6);
    expect(equipment?.groupStarts).toEqual([4]);
    const augmentations = monolith.characterSheet.lists.find((list) => list.key === "augmentations");
    expect(augmentations?.slots).toHaveLength(12);
    expect(augmentations?.slotTypes).toEqual([
      "neural",
      "eyes",
      "lower-face",
      "skin",
      "arm",
      "arm",
      "leg",
      "leg",
      "internal",
      "internal",
      "torso",
      "torso"
    ]);
    // The lone `groupDebt` textarea that used to sit in `sections` became the
    // obligations roster: its data was migrated into rows and the key stripped
    // from the group blob, and no client had drawn the field since.
    expect(monolith.groupPage?.sections).toEqual([]);
    expect(monolith.groupPage?.obligations).toMatchObject({
      label: "Group Obligations",
      singularLabel: "Obligation",
      rulesQuery: "Group Debt"
    });
    expect(monolith.groupPage?.hirelings?.label).toBe("Freelancers");
    expect(monolith.groupPage?.hirelings?.singularLabel).toBe("Freelancer");
    expect(monolith.groupPage?.hirelings?.creationRoll).toMatchObject({
      abilities: [
        { currentKey: "strCurrent", maximumKey: "strMax", dice: "3d6" },
        { currentKey: "dexCurrent", maximumKey: "dexMax", dice: "3d6" },
        { currentKey: "wilCurrent", maximumKey: "wilMax", dice: "3d6" }
      ],
      hitProtection: { currentKey: "hpCurrent", maximumKey: "hpMax", dice: "1d6" },
      weapon: "Standard weapon (D6)"
    });
    expect(
      monolith.groupPage?.hirelings?.sheet.sections.flatMap((section) => section.fields).map((field) => field.key)
      // No weapon field: a freelancer draws from their slots like a character.
    ).toEqual(expect.arrayContaining(["name", "strCurrent", "dexCurrent", "wilCurrent", "hpCurrent"]));
    expect(
      monolith.groupPage?.hirelings?.sheet.sections.flatMap((section) => section.fields).map((field) => field.key)
    ).not.toContain("weapon");
    expect(
      monolith.groupPage?.starshipSheet?.sections.flatMap((section) => section.fields).map((field) => field.key)
    ).toEqual(
      expect.arrayContaining([
        "name",
        "size",
        "crew",
        "shieldsCurrent",
        "hullCurrent",
        "enginesCurrent",
        "systemsCurrent",
        "armoring",
        "movement",
        "mobility"
      ])
    );
    expect(monolith.groupPage?.starshipSheet?.lists.find((list) => list.key === "holds")?.slots).toHaveLength(20);
    expect(
      evaluateCharacterWarnings(monolith.warningRules, {
        strMax: 19,
        strCurrent: 20,
        corruption: 31,
        augmentations: Array.from({ length: 12 }, () => "aug")
      })
      // A full rack reports only the twelfth socket, never also the sixth.
    ).toEqual([
      "STR maximum cannot normally exceed 18.",
      "STR current value is above its recorded maximum.",
      "Corruption is normally recorded from 1 to 30.",
      "All 12 augmentation sockets are occupied; reduce WIL by another 1d6."
    ]);
  });
});
