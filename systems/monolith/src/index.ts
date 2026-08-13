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

/**
 * Monolith's range bands, as ARMORY writes them: `C-R`, `S-R`, `M-R`, `F-R`, or
 * spelled out as "mid-range" and "close/ short range". Anything naming a band or
 * a distance is a range and is reported in the book's own words.
 */
const weaponRange = {
  melee: [String.raw`\bmelee\b`, String.raw`^c-?r$`, String.raw`^close(?:\s+range)?$`, String.raw`^touch$`],
  ranged: [String.raw`range`, String.raw`\b[smf]-r\b`, String.raw`\b(?:feet|foot|ft|metres?|meters?)\b`]
} as const;

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
      tablesFile: "monolith.json",
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
  initiative: {
    model: "side",
    sides: [
      { id: "party", label: "PC turn" },
      { id: "enemies", label: "Enemy turn" }
    ],
    sideOrder: "fixed"
    // Monolith's opening DEX save is played at the table, not tracked here, so the
    // rail carries no per-character save marks for it.
  },
  rangedWeaponIcon: "gun",
  traitCatalog: { headings: ["RANGED PROPERTIES", "MELEE PROPERTIES", "DAMAGE TYPES"] },
  npcStatblock: {
    hitPointsKey: "hp",
    weaponRange,
    // `attacks` is what the bestiary's own line is read into and what every
    // creature already written down carries, so it stays the first weapon
    // rather than being renamed under them.
    weaponKeys: ["attacks", "secondWeapon"],
    armorKey: "armor",
    fields: [
      { key: "hp", label: "HP", kind: "number", inSummary: true },
      { key: "armor", label: "Armor", kind: "number", inSummary: true },
      { key: "str", label: "STR", kind: "number" },
      { key: "dex", label: "DEX", kind: "number", inSummary: true },
      { key: "wil", label: "WIL", kind: "number" },
      { key: "attacks", label: "Weapon 1", kind: "text" },
      { key: "secondWeapon", label: "Weapon 2", kind: "text" }
    ]
  },
  attributeDamage: {
    label: "Attribute damage",
    note: "Damage past 0 HP takes STR by the remainder, and the target then saves against STR to avoid critical damage.",
    criticalDamage: { attributeId: "str", key: "criticalDamage", label: "Critical damage" },
    attributes: [
      { id: "str", label: "STR", currentKey: "strCurrent", maximumKey: "strMax", statblockKey: "str" },
      { id: "dex", label: "DEX", currentKey: "dexCurrent", maximumKey: "dexMax", statblockKey: "dex" },
      { id: "wil", label: "WIL", currentKey: "wilCurrent", maximumKey: "wilMax", statblockKey: "wil" }
    ]
  },
  viceCatalog: { column: "Vice" },
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
    // Identity on the left, talents highlighted, gear and vices to the right,
    // and the numbers in the middle. The client used to draw this by
    // recognising Monolith by name.
    layout: {
      kind: "rails",
      left: ["identity"],
      feature: ["talents"],
      right: { sections: ["vices"], lists: ["equipment"] }
    },
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
        id: "state",
        label: "State",
        fields: [{ key: "criticalDamage", label: "Critical damage", kind: "checkbox" }]
      },
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
        ],
        // The armory's own headings. Explosives belong here because a grenade is
        // thrown at someone, and because a stun gun and a flash grenade state a
        // save rather than a die and would otherwise read as ordinary gear.
        weaponCategories: ["STANDARD WEAPONS", "HIGH ENERGY WEAPONS", "SMART WEAPONS", "EXPLOSIVES"],
        weaponRange
      },
      {
        key: "augmentations",
        label: "Augmentation slots",
        slots: [
          "Cerebral",
          "Eyes",
          "Lower Face",
          "Skin",
          "Left Arm",
          "Right Arm",
          "Left Leg",
          "Right Leg",
          "Internal 1",
          "Internal 2",
          "Torso 1",
          "Torso 2"
        ],
        slotTypes: [
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
        ],
        // Twelve sockets are mostly empty, so the sheet lists only the filled ones.
        editInDialog: true,
        itemHeadings: ["AUGMENTATIONS"],
        // An augment can be a weapon — a Basilisk Gland spits acid 30 feet — so it
        // reads its reach the same way the armory does.
        weaponRange
      }
    ]
  },
  groupPage: {
    // The single `groupDebt` textarea that used to sit here was replaced by the
    // obligations roster below. Its data has been migrated into rows and the
    // key stripped from the group blob, and no client has rendered the field
    // since; it is declared as a roster now rather than as a field nothing draws.
    sections: [],
    obligations: {
      label: "Group Obligations",
      singularLabel: "Obligation",
      emptyHint: "No obligations recorded.",
      rulesQuery: "Group Debt"
    },
    hirelings: {
      label: "Freelancers",
      singularLabel: "Freelancer",
      rulesQuery: "Freelancers & Mercs",
      creationHint:
        "Roll 3D6 for each ability, 1D6 HP, add a standard D6 weapon, then use the Finishing Touches tables.",
      creationRoll: {
        abilities: [
          { currentKey: "strCurrent", maximumKey: "strMax", dice: "3d6" },
          { currentKey: "dexCurrent", maximumKey: "dexMax", dice: "3d6" },
          { currentKey: "wilCurrent", maximumKey: "wilMax", dice: "3d6" }
        ],
        hitProtection: { currentKey: "hpCurrent", maximumKey: "hpMax", dice: "1d6" },
        weapon: "Standard weapon (D6)",
        finishingTouches: {
          section: "FINISHING TOUCHES",
          details: ["Physique", "Hair", "Face", "Mannerisms", "Clothing Style"],
          firstNames: ["Male Names", "Female Names", "Ambiguous Names"],
          lastName: "Last Names"
        }
      },
      levelUpHint: "Level-up automation for crew members is coming in a future update.",
      sheet: {
        sections: [
          {
            id: "identity",
            label: "Identity",
            fields: [
              { key: "name", label: "Name", kind: "text" },
              { key: "details", label: "Finishing touches", kind: "textarea" }
            ]
          },
          {
            id: "core",
            label: "Core statistics",
            layout: "paired-current-max",
            fields: statFields.filter((field) => !field.key.startsWith("armor"))
          },
          {
            id: "state",
            label: "State",
            fields: [{ key: "criticalDamage", label: "Critical damage", kind: "checkbox" }]
          },
          {
            id: "gear",
            label: "Gear",
            fields: [{ key: "notes", label: "Notes", kind: "textarea" }]
          }
        ],
        lists: [
          {
            key: "equipment",
            label: "Equipment slots",
            slots: Array.from({ length: 10 }, (_, index) => `Slot ${index + 1}`),
            weaponRange
          }
        ]
      }
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
  // The cap and the overflow are declared per attribute and in that order, so
  // each attribute's two notes stay together the way the sheet reads.
  warningRules: [
    ...["hp", "str", "dex", "wil"].flatMap((key) => {
      const label = key === "hp" ? "HP" : key.toUpperCase();
      return [
        {
          kind: "range",
          key: `${key}Max`,
          max: 18,
          message: `${label} maximum cannot normally exceed 18.`
        },
        {
          kind: "compare",
          key: `${key}Current`,
          against: `${key}Max`,
          operator: ">",
          message: `${label} current value is above its recorded maximum.`
        }
      ] as const;
    }),
    {
      kind: "range",
      key: "corruption",
      min: 1,
      max: 30,
      message: "Corruption is normally recorded from 1 to 30."
    },
    // Exclusive tiers: a full rack does not also report the sixth socket.
    {
      kind: "list-occupancy",
      listKey: "augmentations",
      tiers: [
        { atLeast: 12, message: "All 12 augmentation sockets are occupied; reduce WIL by another 1d6." },
        { atLeast: 6, message: "Six or more augmentation sockets are occupied; reduce WIL by 1d6." }
      ]
    }
  ]
};
