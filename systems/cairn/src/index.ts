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

/**
 * Cairn's weapons state damage and bulk and nothing about reach, so almost every
 * one of them reads as unknown until someone records otherwise. The few words the
 * book does use are recognised rather than invented ones being read in.
 */
const weaponRange = {
  melee: [String.raw`\bmelee\b`, String.raw`^close$`],
  ranged: [String.raw`range`, String.raw`\b(?:feet|foot|ft|paces?)\b`]
} as const;

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
  initiative: {
    model: "side",
    sides: [
      { id: "party", label: "Party" },
      { id: "enemies", label: "Enemies" }
    ],
    sideOrder: "fixed",
    entrySave: {
      label: "DEX",
      appliesTo: "party",
      onFailure: "after-opponents",
      description:
        "A PC who passes acts before opponents at the start of combat; Cairn does not state the later side order."
    },
    note: "At the start of combat, each PC makes a DEX save for a chance to act before opponents."
  },
  rangedWeaponIcon: "bow",
  npcStatblock: {
    hitPointsKey: "hp",
    weaponRange,
    attacksKey: "attacks",
    armorKey: "armor",
    fields: [
      { key: "hp", label: "HP", kind: "number", inSummary: true },
      { key: "armor", label: "Armor", kind: "number", inSummary: true },
      { key: "str", label: "STR", kind: "number" },
      { key: "dex", label: "DEX", kind: "number", inSummary: true },
      { key: "wil", label: "WIL", kind: "number" },
      { key: "attacks", label: "Attacks", kind: "text" }
    ]
  },
  attributeDamage: {
    label: "Attribute damage",
    note: "Damage past 0 HP takes STR by the remainder, and the target then saves against STR to avoid critical damage.",
    attributes: [
      { id: "str", label: "STR", currentKey: "strCurrent", maximumKey: "strMax", statblockKey: "str" },
      { id: "dex", label: "DEX", currentKey: "dexCurrent", maximumKey: "dexMax", statblockKey: "dex" },
      { id: "wil", label: "WIL", currentKey: "wilCurrent", maximumKey: "wilMax", statblockKey: "wil" }
    ]
  },
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
        slots: Array.from({ length: 10 }, (_, index) => `Slot ${index + 1}`),
        weaponRange
      }
    ]
  },
  groupPage: {
    sections: [],
    hirelings: {
      label: "Hirelings",
      singularLabel: "Hireling",
      rulesQuery: "Hirelings",
      creationHint:
        "Roll 3d6 for each ability, 1d6 HP, add a simple d6 weapon, then use the Character Creation tables.",
      levelUpHint: "Advancement support is not available in v1.",
      sheet: {
        sections: [
          {
            id: "identity",
            label: "Identity",
            fields: [
              { key: "name", label: "Name", kind: "text" },
              { key: "details", label: "Character details", kind: "textarea" }
            ]
          },
          { id: "attributes", label: "Attributes", layout: "paired-current-max", fields: statFields },
          {
            id: "gear",
            label: "Gear",
            fields: [{ key: "notes", label: "Notes", kind: "textarea" }]
          }
        ],
        lists: [
          {
            key: "inventory",
            label: "Inventory",
            slots: Array.from({ length: 10 }, (_, index) => `Slot ${index + 1}`),
            weaponRange
          }
        ]
      }
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
