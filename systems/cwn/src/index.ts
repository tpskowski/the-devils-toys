import type {
  CharacterSheetSection,
  GameSystem,
  GameSystemContentModule,
  SystemCompatibility
} from "@devils-toys/shared";

const compatibility: SystemCompatibility = { family: "without-number", version: 1 };

const identity: CharacterSheetSection = {
  id: "identity",
  label: "Operator",
  fields: [
    { key: "background", label: "Background", kind: "text" },
    { key: "level", label: "Level", kind: "number" },
    { key: "xp", label: "XP", kind: "number" },
    { key: "goal", label: "Goal", kind: "text" },
    { key: "languages", label: "Languages", kind: "text" },
    { key: "credits", label: "Credits", kind: "number" }
  ]
};

const attributes: CharacterSheetSection = {
  id: "attributes",
  label: "Attributes",
  fields: [
    { key: "strScore", label: "Strength", kind: "number" },
    { key: "strModifier", label: "Strength modifier", kind: "number" },
    { key: "dexScore", label: "Dexterity", kind: "number" },
    { key: "dexModifier", label: "Dexterity modifier", kind: "number" },
    { key: "conScore", label: "Constitution", kind: "number" },
    { key: "conModifier", label: "Constitution modifier", kind: "number" },
    { key: "intScore", label: "Intelligence", kind: "number" },
    { key: "intModifier", label: "Intelligence modifier", kind: "number" },
    { key: "wisScore", label: "Wisdom", kind: "number" },
    { key: "wisModifier", label: "Wisdom modifier", kind: "number" },
    { key: "chaScore", label: "Charisma", kind: "number" },
    { key: "chaModifier", label: "Charisma modifier", kind: "number" }
  ]
};

const resources: CharacterSheetSection = {
  id: "resources",
  label: "Health & strain",
  layout: "paired-current-max",
  fields: [
    { key: "hpCurrent", label: "Hit points current", kind: "number" },
    { key: "hpMax", label: "Hit points maximum", kind: "number" },
    { key: "damageSoakCurrent", label: "Damage Soak current", kind: "number" },
    { key: "damageSoakMax", label: "Damage Soak maximum", kind: "number" },
    { key: "systemStrainCurrent", label: "System Strain current", kind: "number" },
    { key: "systemStrainMax", label: "System Strain maximum", kind: "number" }
  ]
};

const combat: CharacterSheetSection = {
  id: "combat",
  label: "Combat & saves",
  fields: [
    { key: "rangedAc", label: "Ranged AC", kind: "number" },
    { key: "meleeAc", label: "Melee AC", kind: "number" },
    { key: "traumaTarget", label: "Trauma Target", kind: "number" },
    { key: "attackBonus", label: "Attack bonus", kind: "number" },
    { key: "physicalSave", label: "Physical save", kind: "number", roll: { kind: "save", label: "Physical" } },
    { key: "evasionSave", label: "Evasion save", kind: "number", roll: { kind: "save", label: "Evasion" } },
    { key: "mentalSave", label: "Mental save", kind: "number", roll: { kind: "save", label: "Mental" } },
    { key: "luckSave", label: "Luck save", kind: "number", roll: { kind: "save", label: "Luck" } }
  ]
};

const skillNames = [
  "Administer",
  "Connect",
  "Drive",
  "Exert",
  "Fix",
  "Heal",
  "Know",
  "Lead",
  "Notice",
  "Perform",
  "Program",
  "Punch",
  "Shoot",
  "Sneak",
  "Stab",
  "Survive",
  "Talk",
  "Trade",
  "Work",
  "Cast",
  "Summon"
] as const;

const skills: CharacterSheetSection = {
  id: "skills",
  label: "Skills",
  fields: skillNames.map((label) => ({
    key: `skill${label}`,
    label,
    kind: "number" as const,
    placeholder: "-1 to 4"
  }))
};

const contacts: CharacterSheetSection = {
  id: "contacts",
  label: "Contacts",
  fields: [{ key: "contacts", label: "Contacts", kind: "entries" }]
};

const edges: CharacterSheetSection = {
  id: "edges",
  label: "Edges",
  fields: [{ key: "edges", label: "Edges", kind: "entries" }]
};

const foci: CharacterSheetSection = {
  id: "foci",
  label: "Foci",
  fields: [{ key: "foci", label: "Foci", kind: "entries" }]
};

const gear: CharacterSheetSection = {
  id: "gear",
  label: "Gear & encumbrance",
  fields: [
    { key: "readiedEncumbrance", label: "Readied encumbrance", kind: "number" },
    { key: "readiedGear", label: "Readied gear", kind: "textarea" },
    { key: "stowedEncumbrance", label: "Stowed encumbrance", kind: "number" },
    { key: "stowedGear", label: "Stowed gear", kind: "textarea" }
  ]
};

const cyberware: CharacterSheetSection = {
  id: "cyberware",
  label: "Cyberware",
  fields: [
    { key: "cwn.cyberware.alienation", label: "Alienation", kind: "number" },
    { key: "cwn.cyberware.systems", label: "Cyberware systems", kind: "entries" }
  ]
};

const hacking: CharacterSheetSection = {
  id: "hacking",
  label: "Programs",
  fields: [{ key: "cwn.hacking.programs", label: "Programs", kind: "entries" }]
};

const magic: CharacterSheetSection = {
  id: "magic",
  label: "Optional magic",
  fields: [{ key: "cwn.magic.powers", label: "Spells, arts, and spirits", kind: "entries" }]
};

const notes: CharacterSheetSection = {
  id: "notes",
  label: "Notes",
  fields: [{ key: "notes", label: "Notes", kind: "textarea" }]
};

const contentModules: readonly GameSystemContentModule[] = [
  {
    id: "cwn/core",
    label: "Cities Without Number core",
    sourceDocumentId: "cwn-srd-1.0",
    rootHeadings: ["1.0.0 Character Creation", "2.0.0 The Rules of the Game"],
    classification: "player",
    compatibility,
    storageNamespace: "cwn.core",
    provides: ["without-number/core@1"],
    requires: [],
    characterSheet: { sections: [identity, attributes, resources, combat, skills, contacts, edges, foci, notes] }
  },
  {
    id: "cwn/gear",
    label: "Cities Without Number gear",
    sourceDocumentId: "cwn-srd-1.0",
    rootHeadings: ["3.0.0 Gear, Vehicles, and Cyberware"],
    classification: "player",
    compatibility,
    storageNamespace: "cwn.gear",
    provides: ["without-number/gear@1"],
    requires: ["without-number/core@1"],
    characterSheet: { sections: [gear] }
  },
  {
    id: "cwn/cyberware",
    label: "Cities Without Number cyberware",
    sourceDocumentId: "cwn-srd-1.0",
    rootHeadings: ["3.6.0 Cyberware"],
    classification: "player",
    compatibility,
    storageNamespace: "cwn.cyberware",
    provides: ["without-number/cyberware@1"],
    requires: ["without-number/core@1"],
    characterSheet: { sections: [cyberware] }
  },
  {
    id: "cwn/hacking",
    label: "Cities Without Number hacking",
    sourceDocumentId: "cwn-srd-1.0",
    rootHeadings: ["4.0.0 Hacking"],
    classification: "player",
    compatibility,
    storageNamespace: "cwn.hacking",
    provides: ["without-number/hacking@1"],
    requires: ["without-number/core@1", "without-number/cyberware@1"],
    characterSheet: { sections: [hacking] }
  },
  {
    id: "cwn/antagonists",
    label: "Cities Without Number antagonists",
    sourceDocumentId: "cwn-srd-1.0",
    rootHeadings: ["5.0.0 Antagonists and NPCs"],
    classification: "gm",
    compatibility,
    storageNamespace: "cwn.antagonists",
    provides: ["without-number/antagonists@1"],
    requires: ["without-number/core@1"]
  },
  {
    id: "cwn/magic",
    label: "Cities Without Number magic",
    sourceDocumentId: "cwn-srd-1.0",
    rootHeadings: ["6.0.0 Magic"],
    classification: "player",
    compatibility,
    storageNamespace: "cwn.magic",
    provides: ["without-number/magic@1"],
    requires: ["without-number/core@1"],
    characterSheet: { sections: [magic] }
  }
];

/**
 * Cities Without Number gives a weapon its range in metres — "30/100" for short
 * and long — and calls the rest melee.
 */
const weaponRange = {
  melee: [String.raw`\bmelee\b`, String.raw`^close$`, String.raw`^touch$`],
  ranged: [String.raw`^\d+\s*/\s*\d+$`, String.raw`range`, String.raw`\b(?:metres?|meters?)\b`]
} as const;

export const cwn: GameSystem = {
  id: "cwn",
  name: "Cities Without Number",
  shortName: "CWN",
  glyph: "CW",
  defaultTheme: "digital",
  tagline: "Operators, chrome, and dangerous jobs in an unforgiving city.",
  rollRulesQuery: "Skill Checks",
  sourceDocuments: [
    {
      id: "cwn-srd-1.0",
      markdownFile: "CitiesWithoutNumberSRDv1.0.md",
      tablesFile: "cwn.json",
      canonicalFile: "CitiesWithoutNumberSRDv1.0.html",
      correctionsFile: "citieswithoutnumber-corrections.md",
      license: "CC0 1.0"
    }
  ],
  contentModules,
  imports: [],
  compatibility,
  partyLabel: "Team",
  abilities: ["Strength", "Dexterity", "Constitution", "Intelligence", "Wisdom", "Charisma"],
  gmOnlyHeadings: ["5.0.0 Antagonists and NPCs"],
  npcCatalog: { heading: "5.0.0 Antagonists and NPCs", entryLevel: 3, exclude: ["5.2.1 Morale Check Situations"] },
  initiative: {
    model: "side",
    sides: [
      { id: "party", label: "Party" },
      { id: "enemies", label: "Enemies" }
    ],
    sideOrder: "roll",
    roll: { dice: "1d8", modifierFrom: "best-dex", label: "Initiative" },
    tieBreak: "party-wins",
    allowIndividualVariant: true
  },
  rangedWeaponIcon: "gun",
  npcStatblock: {
    parser: "labelled",
    hitPointsKey: "hp",
    weaponRange,
    // One weapon, and its own column's name. The rest of this statblock is the
    // book's Atk/Dmg/Shock row transcribed, so `dmg` is not renamed to sit in a
    // numbered pair that the row it belongs to does not have.
    weaponKeys: ["dmg"],
    fields: [
      { key: "hd", label: "HD", kind: "text" },
      { key: "hp", label: "HP", kind: "number", inSummary: true },
      { key: "damageSoak", label: "Damage Soak", kind: "number" },
      { key: "acRanged", label: "Ranged AC", kind: "text", inSummary: true },
      { key: "acMelee", label: "Melee AC", kind: "text", inSummary: true },
      { key: "tt", label: "TT", kind: "text" },
      { key: "skill", label: "Skill", kind: "text" },
      { key: "save", label: "Save", kind: "text" },
      { key: "atk", label: "Atk", kind: "text" },
      { key: "dmg", label: "Dmg", kind: "text" },
      { key: "shock", label: "Shock", kind: "text" },
      { key: "move", label: "Move", kind: "text" },
      { key: "ml", label: "ML", kind: "text" },
      { key: "gear", label: "Gear", kind: "text" }
    ]
  },
  tableCatalog: {
    label: "Cities Without Number tables",
    exclude: [],
    tags: ["scifi"]
  },
  dice: {
    save: {
      sides: 20,
      success: "equal-or-over",
      automaticSuccess: 20,
      automaticFailure: 1,
      types: [
        { id: "physical", label: "Physical" },
        { id: "evasion", label: "Evasion" },
        { id: "mental", label: "Mental" },
        { id: "luck", label: "Luck" }
      ],
      outcomes: {
        normal: { success: "Success", failure: "Failure" }
      }
    },
    skillCheck: {
      dice: "2d6",
      success: "equal-or-over",
      defaultDifficulty: 8,
      label: "Skill check"
    }
  },
  characterSheet: {
    sections: [
      identity,
      attributes,
      resources,
      combat,
      skills,
      contacts,
      edges,
      foci,
      gear,
      cyberware,
      hacking,
      magic,
      notes
    ],
    lists: []
  },
  warningRules: [
    // Each ability contributes its score range and its modifier range, in that
    // order, so the pair reads together the way the sheet lays them out.
    ...["str", "dex", "con", "int", "wis", "cha"].flatMap(
      (prefix) =>
        [
          {
            kind: "range",
            key: `${prefix}Score`,
            min: 3,
            max: 18,
            message: `${prefix.toUpperCase()} is normally between 3 and 18.`
          },
          {
            kind: "range",
            key: `${prefix}Modifier`,
            min: -2,
            max: 3,
            message: `${prefix.toUpperCase()} modifier is normally between -2 and +3.`
          }
        ] as const
    ),
    ...skillNames.map(
      (skill) =>
        ({
          kind: "range",
          key: `skill${skill}`,
          min: -1,
          max: 4,
          message: `${skill} is normally untrained (-1) or level 0 to 4.`
        }) as const
    ),
    ...(
      [
        ["Hit points", "hpCurrent", "hpMax"],
        ["Damage Soak", "damageSoakCurrent", "damageSoakMax"],
        ["System Strain", "systemStrainCurrent", "systemStrainMax"]
      ] as const
    ).map(
      ([label, currentKey, maximumKey]) =>
        ({
          kind: "compare",
          key: currentKey,
          against: maximumKey,
          operator: ">",
          message: `${label} current value is above its recorded maximum.`
        }) as const
    ),
    ...(
      [
        ["Physical", "physicalSave"],
        ["Evasion", "evasionSave"],
        ["Mental", "mentalSave"],
        ["Luck", "luckSave"]
      ] as const
    ).map(
      ([label, key]) =>
        ({
          kind: "range",
          key,
          min: 1,
          max: 20,
          message: `${label} save target must be between 1 and 20.`
        }) as const
    ),
    {
      kind: "compare",
      key: "cwn.cyberware.alienation",
      against: "wisScore",
      operator: ">",
      message: "Alienation above Wisdom leaves the character in cyber-induced psychosis."
    },
    // Readied capacity is half Strength; stowed is Strength itself. Past either
    // by enough and the character is beyond hauling it at all, which is what
    // `beyond` says instead.
    {
      kind: "compare",
      key: "readiedEncumbrance",
      against: "strScore",
      scale: 0.5,
      operator: ">",
      message: "Readied encumbrance is above normal capacity and reduces Move.",
      beyond: { offset: 2, message: "Readied encumbrance is beyond the normal extended-hauling allowance." }
    },
    {
      kind: "compare",
      key: "stowedEncumbrance",
      against: "strScore",
      operator: ">",
      message: "Stowed encumbrance is above normal capacity and reduces Move.",
      beyond: { offset: 4, message: "Stowed encumbrance is beyond the normal extended-hauling allowance." }
    }
  ]
};
