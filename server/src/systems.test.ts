import { describe, expect, it } from "vitest";
import { cairn } from "@devils-toys/system-cairn";
import { monolith } from "@devils-toys/system-monolith";
import { cwn } from "@devils-toys/system-cwn";
import { filterPlayerRules } from "./systems.js";

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
      cairn.characterWarnings({
        armor: 4,
        deprived: true,
        hpCurrent: 5,
        hpMax: 3,
        inventory: Array.from({ length: 10 }, () => "gear")
      })
    ).toHaveLength(4);
  });

  it("enables the shared Group page for Cairn's hirelings placeholder", () => {
    expect(cairn.groupPage?.hirelings?.label).toBe("Hirelings");
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
      cwn.characterWarnings({
        hpCurrent: 9,
        hpMax: 4,
        physicalSave: 21,
        wisScore: 10,
        "cwn.cyberware.alienation": 11,
        strScore: 11,
        readiedEncumbrance: 7,
        stowedEncumbrance: 16
      })
    ).toHaveLength(5);
  });

  it("describes Monolith's source sheet and reports advisory constraints", () => {
    const equipment = monolith.characterSheet.lists.find((list) => list.key === "equipment");
    expect(equipment?.slots).toHaveLength(10);
    expect(equipment?.slots.filter((slot) => slot.startsWith("Backpack"))).toHaveLength(6);
    expect(equipment?.groupStarts).toEqual([4]);
    expect(monolith.characterSheet.lists.find((list) => list.key === "augmentations")?.slots).toHaveLength(12);
    expect(monolith.groupPage?.sections[0]?.fields[0]).toMatchObject({
      key: "groupDebt",
      rulesQuery: "Group Debt"
    });
    expect(monolith.groupPage?.hirelings?.label).toBe("Freelancers");
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
      monolith.characterWarnings({
        strMax: 19,
        strCurrent: 20,
        corruption: 31,
        augmentations: Array.from({ length: 12 }, () => "aug")
      })
    ).toHaveLength(4);
  });
});
