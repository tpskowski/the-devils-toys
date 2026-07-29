import type { GameSystem } from "@devils-toys/shared";

const statFields = [
  { key: "strCurrent", label: "STR current", kind: "number", roll: { kind: "save", label: "STR" } },
  { key: "strMax", label: "STR maximum", kind: "number" },
  { key: "dexCurrent", label: "DEX current", kind: "number", roll: { kind: "save", label: "DEX" } },
  { key: "dexMax", label: "DEX maximum", kind: "number" },
  { key: "wilCurrent", label: "WIL current", kind: "number", roll: { kind: "save", label: "WIL" } },
  { key: "wilMax", label: "WIL maximum", kind: "number" },
  { key: "hpCurrent", label: "HP current", kind: "number" },
  { key: "hpMax", label: "HP maximum", kind: "number" }
] as const;

function numeric(sheet: Record<string, unknown>, key: string) {
  const value = Number(sheet[key]);
  return Number.isFinite(value) ? value : undefined;
}

export const cairn: GameSystem = {
  id: "cairn",
  name: "Cairn",
  shortName: "Cairn",
  glyph: "C",
  defaultTheme: "heroic",
  tagline: "Strange folk, hidden treasure, and the dark Wood.",
  rollRulesQuery: "Saves",
  sourceDocuments: [
    {
      id: "cairn",
      markdownFile: "Cairn.md",
      correctionsFile: "corrections.md",
      license: "CC BY-SA 4.0"
    }
  ],
  contentModules: [
    {
      id: "cairn/core",
      label: "Cairn core rules",
      sourceDocumentId: "cairn",
      rootHeadings: ["Cairn"],
      classification: "player",
      storageNamespace: "cairn.core",
      provides: ["cairn/core"],
      requires: []
    },
    {
      id: "cairn/gm",
      label: "Cairn Warden rules",
      sourceDocumentId: "cairn",
      rootHeadings: ["Principles for Wardens", "Bestiary"],
      classification: "gm",
      storageNamespace: "cairn.gm",
      provides: ["cairn/gm"],
      requires: ["cairn/core"]
    }
  ],
  imports: [],
  partyLabel: "Party",
  abilities: ["Strength", "Dexterity", "Will"],
  gmOnlyHeadings: ["Principles for Wardens", "Bestiary"],
  npcCatalog: { heading: "Bestiary", entryLevel: 3, exclude: ["Creating Monsters"] },
  tableCatalog: {
    label: "Cairn tables",
    exclude: [],
    tags: ["fantasy"]
  },
  dice: {
    save: {
      sides: 20,
      success: "equal-or-under",
      automaticSuccess: 1,
      automaticFailure: 20,
      types: [
        { id: "STR", label: "STR" },
        { id: "DEX", label: "DEX" },
        { id: "WIL", label: "WIL" }
      ],
      outcomes: {
        normal: { success: "Success", failure: "Failure" }
      }
    },
    damage: {
      impairedSides: 4,
      enhancedSides: 12,
      multipleRolls: "keep-highest"
    }
  },
  characterSheet: {
    sections: [
      {
        id: "identity",
        label: "Identity",
        fields: [{ key: "background", label: "Background", kind: "text" }]
      },
      { id: "attributes", label: "Attributes", layout: "paired-current-max", fields: statFields },
      {
        id: "state",
        label: "Protection & state",
        fields: [
          { key: "armor", label: "Armor", kind: "number" },
          { key: "deprived", label: "Deprived", kind: "checkbox" }
        ]
      },
      {
        id: "coin",
        label: "Coin",
        fields: [
          { key: "gp", label: "GP", kind: "number" },
          { key: "sp", label: "SP", kind: "number" },
          { key: "cp", label: "CP", kind: "number" }
        ]
      },
      {
        id: "notes",
        label: "Fatigue & notes",
        fields: [
          { key: "fatigue", label: "Fatigue", kind: "text" },
          { key: "notes", label: "Notes", kind: "textarea" }
        ]
      }
    ],
    lists: [
      {
        key: "inventory",
        label: "Inventory",
        slots: Array.from({ length: 10 }, (_, index) => `Slot ${index + 1}`)
      }
    ]
  },
  groupPage: {
    sections: [],
    hirelings: {
      label: "Hirelings",
      placeholder: "A shared hireling roster will live here."
    }
  },
  characterWarnings(sheet) {
    const warnings: string[] = [];
    if ((numeric(sheet, "armor") ?? 0) > 3) warnings.push("Cairn armor cannot normally exceed 3.");
    const inventory = Array.isArray(sheet.inventory) ? sheet.inventory : [];
    if (inventory.filter((item) => String(item ?? "").trim()).length >= 10)
      warnings.push("A full 10-slot inventory reduces HP to 0.");
    if (sheet.deprived === true) warnings.push("A deprived character cannot recover HP or ability scores.");
    for (const key of ["str", "dex", "wil", "hp"]) {
      const current = numeric(sheet, `${key}Current`);
      const maximum = numeric(sheet, `${key}Max`);
      if (current !== undefined && maximum !== undefined && current > maximum)
        warnings.push(`${key.toUpperCase()} current value is above its recorded maximum.`);
    }
    return warnings;
  }
};
