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

function numeric(sheet: Record<string, unknown>, key: string) {
  if (sheet[key] === "" || sheet[key] === null || sheet[key] === undefined || typeof sheet[key] === "boolean")
    return undefined;
  const value = Number(sheet[key]);
  return Number.isFinite(value) ? value : undefined;
}

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
  characterWarnings(sheet) {
    const warnings: string[] = [];

    for (const prefix of ["str", "dex", "con", "int", "wis", "cha"]) {
      const score = numeric(sheet, `${prefix}Score`);
      const modifier = numeric(sheet, `${prefix}Modifier`);
      if (score !== undefined && (score < 3 || score > 18))
        warnings.push(`${prefix.toUpperCase()} is normally between 3 and 18.`);
      if (modifier !== undefined && (modifier < -2 || modifier > 3))
        warnings.push(`${prefix.toUpperCase()} modifier is normally between -2 and +3.`);
    }

    for (const skill of skillNames) {
      const value = numeric(sheet, `skill${skill}`);
      if (value !== undefined && (value < -1 || value > 4))
        warnings.push(`${skill} is normally untrained (-1) or level 0 to 4.`);
    }

    for (const [label, currentKey, maximumKey] of [
      ["Hit points", "hpCurrent", "hpMax"],
      ["Damage Soak", "damageSoakCurrent", "damageSoakMax"],
      ["System Strain", "systemStrainCurrent", "systemStrainMax"]
    ] as const) {
      const current = numeric(sheet, currentKey);
      const maximum = numeric(sheet, maximumKey);
      if (current !== undefined && maximum !== undefined && current > maximum)
        warnings.push(`${label} current value is above its recorded maximum.`);
    }

    for (const [label, key] of [
      ["Physical", "physicalSave"],
      ["Evasion", "evasionSave"],
      ["Mental", "mentalSave"],
      ["Luck", "luckSave"]
    ] as const) {
      const target = numeric(sheet, key);
      if (target !== undefined && (target < 1 || target > 20))
        warnings.push(`${label} save target must be between 1 and 20.`);
    }

    const wisdom = numeric(sheet, "wisScore");
    const alienation = numeric(sheet, "cwn.cyberware.alienation");
    if (wisdom !== undefined && alienation !== undefined && alienation > wisdom)
      warnings.push("Alienation above Wisdom leaves the character in cyber-induced psychosis.");

    const strength = numeric(sheet, "strScore");
    const readied = numeric(sheet, "readiedEncumbrance");
    const stowed = numeric(sheet, "stowedEncumbrance");
    if (strength !== undefined && readied !== undefined && readied > Math.floor(strength / 2))
      warnings.push(
        readied > Math.floor(strength / 2) + 2
          ? "Readied encumbrance is beyond the normal extended-hauling allowance."
          : "Readied encumbrance is above normal capacity and reduces Move."
      );
    if (strength !== undefined && stowed !== undefined && stowed > strength)
      warnings.push(
        stowed > strength + 4
          ? "Stowed encumbrance is beyond the normal extended-hauling allowance."
          : "Stowed encumbrance is above normal capacity and reduces Move."
      );

    return warnings;
  }
};
