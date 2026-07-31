import type { GameSystem } from "@devils-toys/shared";

const statFields = [
  { key: "hpCurrent", label: "Hit Protection current", kind: "number" },
  { key: "hpMax", label: "Hit Protection maximum", kind: "number" },
  { key: "strCurrent", label: "Strength current", kind: "number", roll: { kind: "save", label: "STR" } },
  { key: "strMax", label: "Strength maximum", kind: "number" },
  { key: "dexCurrent", label: "Dexterity current", kind: "number", roll: { kind: "save", label: "DEX" } },
  { key: "dexMax", label: "Dexterity maximum", kind: "number" },
  { key: "wilCurrent", label: "Willpower current", kind: "number", roll: { kind: "save", label: "WIL" } },
  { key: "wilMax", label: "Willpower maximum", kind: "number" },
  { key: "armorCurrent", label: "Armor current", kind: "number" },
  { key: "armorMax", label: "Armor maximum", kind: "number" }
] as const;

function numeric(sheet: Record<string, unknown>, key: string) {
  const value = Number(sheet[key]);
  return Number.isFinite(value) ? value : undefined;
}

export const monolith: GameSystem = {
  id: "monolith",
  name: "Monolith",
  shortName: "MONOLITH",
  glyph: "M",
  defaultTheme: "digital",
  tagline: "Freelancers at the edge of a sprawling, dangerous cosmos.",
  rollRulesQuery: "Tests",
  sourceDocuments: [
    {
      id: "monolith",
      markdownFile: "Monolith.md",
      correctionsFile: "corrections.md",
      license: "CC BY-SA 4.0"
    }
  ],
  contentModules: [
    {
      id: "monolith/core",
      label: "Monolith core rules",
      sourceDocumentId: "monolith",
      rootHeadings: ["MONOLITH"],
      classification: "player",
      storageNamespace: "monolith.core",
      provides: ["monolith/core"],
      requires: []
    },
    {
      id: "monolith/gm",
      label: "Monolith GM rules",
      sourceDocumentId: "monolith",
      rootHeadings: ["NPCS", "SAMPLE BESTIARY", "PLANETS", "FACTION RULES", "SAMPLE FACTIONS", "TABLES & GENERATORS"],
      classification: "gm",
      storageNamespace: "monolith.gm",
      provides: ["monolith/gm"],
      requires: ["monolith/core"]
    }
  ],
  imports: [],
  partyLabel: "Company",
  abilities: ["Strength", "Dexterity", "Will"],
  gmOnlyHeadings: ["NPCS", "SAMPLE BESTIARY", "PLANETS", "FACTION RULES", "SAMPLE FACTIONS", "TABLES & GENERATORS"],
  npcCatalog: { heading: "SAMPLE BESTIARY", entryLevel: 3, exclude: [] },
  tableCatalog: {
    label: "Monolith tables",
    exclude: [],
    tags: ["scifi"]
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
        normal: { success: "Success", failure: "Failure" },
        advantage: { success: "Enhanced success", failure: "Reduced failure" },
        disadvantage: { success: "Mixed success", failure: "Disastrous failure" }
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
        fields: [
          { key: "level", label: "Level", kind: "number" },
          { key: "xp", label: "XP", kind: "number" },
          { key: "corruption", label: "Corruption", kind: "number", placeholder: "1–30" }
        ]
      },
      { id: "core", label: "Core statistics", layout: "paired-current-max", fields: statFields },
      {
        id: "talents",
        label: "Talents",
        // Stored under the original `abilities` key so existing sheets keep their text.
        fields: [{ key: "abilities", label: "Talents", kind: "entries" }]
      },
      {
        id: "vices",
        label: "Vices",
        fields: [{ key: "vices", label: "Vices", kind: "vices" }]
      }
    ],
    lists: [
      {
        key: "equipment",
        label: "Equipment slots",
        // Ten slots per INVENTORY: four on the body, six in the backpack.
        slots: [
          "Body 1",
          "Body 2",
          "Body 3",
          "Body 4",
          "Backpack 1",
          "Backpack 2",
          "Backpack 3",
          "Backpack 4",
          "Backpack 5",
          "Backpack 6"
        ],
        groupStarts: [4],
        itemHeadings: ["ARMORY", "EQUIPMENT"],
        // Priced, but hired or travelled in rather than carried in a slot.
        skipCategories: [
          "LAND VEHICLES (DAILY RENTING PRICE IS 1/1OTH COST)",
          "FOOD, DRINKS, & SERVICES",
          "SPECIALISTS (COST IS DAILY)"
        ]
      },
      {
        key: "augmentations",
        label: "Augmentation slots",
        slots: [
          "Brain",
          "Eyes",
          "Face",
          "Body (any)",
          "Left arm",
          "Right arm",
          "Left leg",
          "Right leg",
          "Body internal 1",
          "Body internal 2",
          "Body external 1",
          "Body external 2"
        ],
        // Twelve sockets are mostly empty, so the sheet lists only the filled ones.
        editInDialog: true,
        itemHeadings: ["AUGMENTATIONS"]
      }
    ]
  },
  groupPage: {
    sections: [
      {
        id: "debt",
        label: "Shared obligation",
        fields: [
          {
            key: "groupDebt",
            label: "Group Debt",
            kind: "textarea",
            placeholder: "Creditor, balance, terms, and consequences…",
            rulesQuery: "Group Debt"
          }
        ]
      }
    ],
    hirelings: {
      label: "Freelancers",
      placeholder: "A shared freelancer roster will live here."
    },
    starshipSheet: {
      sections: [
        {
          id: "identity",
          label: "Vessel",
          fields: [
            { key: "name", label: "Starship name", kind: "text" },
            { key: "size", label: "Size", kind: "text" },
            { key: "crew", label: "Crew", kind: "text", placeholder: "Minimum–maximum" }
          ]
        },
        {
          id: "scores",
          label: "Starship scores",
          layout: "paired-current-max",
          fields: [
            { key: "shieldsCurrent", label: "Shields current", kind: "number" },
            { key: "shieldsMax", label: "Shields maximum", kind: "number" },
            { key: "hullCurrent", label: "Hull current", kind: "number" },
            { key: "hullMax", label: "Hull maximum", kind: "number" },
            { key: "enginesCurrent", label: "Engines current", kind: "number" },
            { key: "enginesMax", label: "Engines maximum", kind: "number" },
            { key: "systemsCurrent", label: "Systems current", kind: "number" },
            { key: "systemsMax", label: "Systems maximum", kind: "number" }
          ]
        },
        {
          id: "handling",
          label: "Handling",
          fields: [
            { key: "armoring", label: "Armoring", kind: "number" },
            { key: "movement", label: "Movement", kind: "number" },
            { key: "mobility", label: "Mobility", kind: "number" }
          ]
        },
        {
          id: "notes",
          label: "Status & notes",
          fields: [{ key: "notes", label: "Notes", kind: "textarea" }]
        }
      ],
      lists: [
        {
          key: "holds",
          label: "Holds",
          slots: Array.from({ length: 20 }, (_, index) => `Hold ${index + 1}`),
          groupStarts: [4, 8, 12, 16]
        }
      ],
      // "Starships come in 5 Sizes… Each size has a fixed number of holds", and a
      // ship costs 500C per hold.
      sizes: [
        { id: "fighter", label: "Fighter", holds: 4, fixed: { crew: "1-2", movement: 5, mobility: 3 } },
        { id: "small", label: "Small", holds: 8, fixed: { crew: "2-6", movement: 5, mobility: 2 } },
        { id: "medium", label: "Medium", holds: 12, fixed: { crew: "6-10", movement: 4, mobility: 2 } },
        { id: "large", label: "Large", holds: 16, fixed: { crew: "10-20", movement: 3, mobility: 1 } },
        { id: "giant", label: "Giant", holds: 20, fixed: { crew: "20-50", movement: 2, mobility: 1 } }
      ].map((size) => ({
        ...size,
        note: `Crew ${size.fixed.crew} · ${size.holds} holds · movement ${size.fixed.movement}, mobility ${size.fixed.mobility} · base cost ${(size.holds * 500).toLocaleString("en-US")}C · ${size.holds > 12 ? "bridge" : "cockpit"}`
      })),
      // "All ships start with Starship Scores of 10", and no ship starts armoured.
      baseValues: {
        shieldsCurrent: 10,
        shieldsMax: 10,
        hullCurrent: 10,
        hullMax: 10,
        enginesCurrent: 10,
        enginesMax: 10,
        systemsCurrent: 10,
        systemsMax: 10,
        armoring: 0
      },
      // The parts on offer are read from the book's own STARSHIP PARTS tables.
      partsList: "holds"
    }
  },
  characterWarnings(sheet) {
    const warnings: string[] = [];
    for (const key of ["hp", "str", "dex", "wil"]) {
      const current = numeric(sheet, `${key}Current`);
      const maximum = numeric(sheet, `${key}Max`);
      const label = key === "hp" ? "HP" : key.toUpperCase();
      if (maximum !== undefined && maximum > 18) warnings.push(`${label} maximum cannot normally exceed 18.`);
      if (current !== undefined && maximum !== undefined && current > maximum)
        warnings.push(`${label} current value is above its recorded maximum.`);
    }
    const corruption = numeric(sheet, "corruption");
    if (corruption !== undefined && (corruption < 1 || corruption > 30))
      warnings.push("Corruption is normally recorded from 1 to 30.");
    const augmentations = Array.isArray(sheet.augmentations) ? sheet.augmentations : [];
    const occupied = augmentations.filter((item) => String(item ?? "").trim()).length;
    if (occupied >= 12) warnings.push("All 12 augmentation sockets are occupied; reduce WIL by another 1d6.");
    else if (occupied >= 6) warnings.push("Six or more augmentation sockets are occupied; reduce WIL by 1d6.");
    return warnings;
  }
};
