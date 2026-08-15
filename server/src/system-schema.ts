import { z } from "zod";
import { NPC_STATBLOCK_PARSERS, SYSTEM_ID_PATTERN, THEME_IDS, type GameSystem } from "@devils-toys/shared";

/**
 * What a system may say about itself.
 *
 * This is the whole of `GameSystem` as data. It exists because an installed
 * system arrives as a file an admin uploaded, and the only safe way to accept
 * one is to check every field and evaluate none of it — no `import()`, no `vm`,
 * no callback anywhere in the shape. That `characterWarnings` became
 * `warningRules` is what made this possible at all.
 *
 * Objects are strict. A misspelled key in a hand-written bundle is a mistake
 * worth a message, not a field to drop silently, and the alternative is an
 * author wondering why their sheet has no armour box.
 *
 * The schema's own test is that it accepts all three compiled systems unchanged.
 * Anything it gets wrong shows up there rather than in a rejected upload.
 */

const nonEmpty = z.string().min(1);

const characterFieldKind = z.enum(["text", "number", "checkbox", "textarea", "entries", "vices"]);

const characterField = z
  .object({
    key: nonEmpty,
    label: z.string(),
    kind: characterFieldKind,
    placeholder: z.string().optional(),
    roll: z
      .object({ kind: z.literal("save"), label: z.string() })
      .strict()
      .optional()
  })
  .strict();

const groupField = characterField.extend({ rulesQuery: z.string().optional() }).strict();

const characterSection = z
  .object({
    id: nonEmpty,
    label: z.string(),
    layout: z.literal("paired-current-max").optional(),
    fields: z.array(characterField)
  })
  .strict();

const groupSection = z.object({ id: nonEmpty, label: z.string(), fields: z.array(groupField) }).strict();

const weaponRange = z.object({ melee: z.array(z.string()), ranged: z.array(z.string()) }).strict();

const characterList = z
  .object({
    key: nonEmpty,
    label: z.string(),
    slots: z.array(z.string()),
    slotTypes: z.array(z.string()).optional(),
    groupStarts: z.array(z.number().int().nonnegative()).optional(),
    editInDialog: z.boolean().optional(),
    itemHeadings: z.array(z.string()).optional(),
    skipCategories: z.array(z.string()).optional(),
    weaponCategories: z.array(z.string()).optional(),
    weaponRange: weaponRange.optional()
  })
  .strict();

/** A named arrangement the client knows how to draw, chosen rather than shipped. */
const sheetLayout = z
  .object({
    kind: z.literal("rails"),
    left: z.array(z.string()).optional(),
    feature: z.array(z.string()).optional(),
    right: z
      .object({ sections: z.array(z.string()).optional(), lists: z.array(z.string()).optional() })
      .strict()
      .optional()
  })
  .strict();

const characterSheet = z
  .object({ sections: z.array(characterSection), lists: z.array(characterList), layout: sheetLayout.optional() })
  .strict();

const starshipSize = z
  .object({
    id: nonEmpty,
    label: z.string(),
    holds: z.number().int().nonnegative(),
    fixed: z.record(z.string(), z.union([z.string(), z.number()])),
    note: z.string().optional()
  })
  .strict();

const starshipPart = z
  .object({
    category: z.string(),
    name: z.string(),
    spec: z.string(),
    detail: z.string(),
    cost: z.string(),
    bulky: z.boolean(),
    label: z.string()
  })
  .strict();

const starshipSheet = characterSheet
  .extend({
    sizes: z.array(starshipSize).optional(),
    baseValues: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
    partsList: z.string().optional(),
    // Read out of the book at runtime like any other table, so a bundle that
    // states them is stating something that will be overwritten. Accepted
    // because an export writes what it read.
    parts: z.array(starshipPart).optional()
  })
  .strict();

const groupAsset = z
  .object({
    kind: nonEmpty,
    label: z.string(),
    singularLabel: z.string(),
    emptyHint: z.string().optional(),
    sheet: starshipSheet
  })
  .strict();

const abilityRoll = z.object({ currentKey: nonEmpty, maximumKey: nonEmpty, dice: nonEmpty }).strict();

const groupPage = z
  .object({
    sections: z.array(groupSection),
    hirelings: z
      .object({
        label: z.string(),
        singularLabel: z.string(),
        rulesQuery: z.string(),
        creationHint: z.string(),
        creationRoll: z
          .object({
            abilities: z.array(abilityRoll),
            hitProtection: abilityRoll,
            weapon: z.string(),
            finishingTouches: z
              .object({
                section: z.string(),
                details: z.array(z.string()),
                firstNames: z.array(z.string()),
                lastName: z.string()
              })
              .strict()
              .optional()
          })
          .strict()
          .optional(),
        sheet: characterSheet,
        levelUpHint: z.string()
      })
      .strict()
      .optional(),
    obligations: z
      .object({
        label: z.string(),
        singularLabel: z.string(),
        emptyHint: z.string().optional(),
        rulesQuery: z.string().optional()
      })
      .strict()
      .optional(),
    starshipSheet: starshipSheet.optional(),
    groupAssets: z.array(groupAsset).optional()
  })
  .strict();

const saveOutcomes = z.object({ success: z.string(), failure: z.string() }).strict();

const dice = z
  .object({
    save: z
      .object({
        sides: z.literal(20),
        success: z.enum(["equal-or-under", "equal-or-over"]),
        automaticSuccess: z.number().int(),
        automaticFailure: z.number().int(),
        types: z.array(z.object({ id: nonEmpty, label: z.string() }).strict()),
        outcomes: z
          .object({
            normal: saveOutcomes,
            advantage: saveOutcomes.optional(),
            disadvantage: saveOutcomes.optional()
          })
          .strict()
      })
      .strict(),
    damage: z
      .object({
        impairedSides: z.literal(4),
        enhancedSides: z.literal(12),
        multipleRolls: z.literal("keep-highest")
      })
      .strict()
      .optional(),
    skillCheck: z
      .object({
        dice: z.literal("2d6"),
        success: z.literal("equal-or-over"),
        defaultDifficulty: z.number().int(),
        label: z.string()
      })
      .strict()
      .optional()
  })
  .strict();

const initiative = z
  .object({
    model: z.enum(["none", "side", "individual"]),
    sides: z.array(z.object({ id: nonEmpty, label: z.string() }).strict()).optional(),
    sideOrder: z.enum(["fixed", "roll"]).optional(),
    roll: z
      .object({
        dice: nonEmpty,
        modifierFrom: z.enum(["best-dex", "dex"]).optional(),
        label: z.string()
      })
      .strict()
      .optional(),
    entrySave: z
      .object({
        label: z.string(),
        appliesTo: z.literal("party"),
        onFailure: z.enum(["after-opponents", "skip-first-turn"]),
        description: z.string()
      })
      .strict()
      .optional(),
    tieBreak: z.literal("party-wins").optional(),
    allowIndividualVariant: z.boolean().optional(),
    note: z.string().optional()
  })
  .strict();

const npcStatblock = z
  .object({
    hitPointsKey: nonEmpty,
    armorKey: z.string().optional(),
    parser: z.enum(NPC_STATBLOCK_PARSERS).optional(),
    weaponKeys: z.array(z.string()).optional(),
    weaponRange: weaponRange.optional(),
    fields: z
      .array(
        z
          .object({
            key: nonEmpty,
            label: z.string(),
            kind: z.enum(["number", "text"]),
            inSummary: z.boolean().optional()
          })
          .strict()
      )
      .min(1)
  })
  .strict();

const attributeDamage = z
  .object({
    label: z.string(),
    note: z.string().optional(),
    criticalDamage: z.object({ attributeId: nonEmpty, key: nonEmpty, label: z.string() }).strict().optional(),
    attributes: z.array(
      z
        .object({
          id: nonEmpty,
          label: z.string(),
          currentKey: nonEmpty,
          maximumKey: nonEmpty,
          statblockKey: z.string().optional()
        })
        .strict()
    )
  })
  .strict();

const compatibility = z.object({ family: nonEmpty, version: z.number().int() }).strict();

const sourceDocument = z
  .object({
    id: nonEmpty,
    markdownFile: nonEmpty,
    canonicalFile: z.string().optional(),
    correctionsFile: z.string().optional(),
    tablesFile: z.string().optional(),
    // Required, and never inspected. The operator is responsible for what they
    // upload; this only makes them write down what it is.
    license: nonEmpty
  })
  .strict();

const contentModule = z
  .object({
    id: nonEmpty,
    label: z.string(),
    sourceDocumentId: nonEmpty,
    rootHeadings: z.array(z.string()),
    classification: z.enum(["gm", "player"]),
    compatibility: compatibility.optional(),
    storageNamespace: nonEmpty,
    provides: z.array(z.string()),
    requires: z.array(z.string()),
    conflictsWith: z.array(z.string()).optional(),
    characterSheet: z
      .object({
        sections: z.array(characterSection).optional(),
        lists: z.array(characterList).optional()
      })
      .strict()
      .optional()
  })
  .strict();

const warningRule = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("range"),
      key: nonEmpty,
      min: z.number().optional(),
      max: z.number().optional(),
      message: nonEmpty
    })
    .strict(),
  z.object({ kind: z.literal("flag"), key: nonEmpty, equals: z.boolean(), message: nonEmpty }).strict(),
  z
    .object({
      kind: z.literal("list-occupancy"),
      listKey: nonEmpty,
      tiers: z.array(z.object({ atLeast: z.number().int(), message: nonEmpty }).strict()).min(1)
    })
    .strict(),
  z
    .object({
      kind: z.literal("compare"),
      key: nonEmpty,
      against: nonEmpty,
      operator: z.enum([">", "<"]),
      scale: z.number().optional(),
      offset: z.number().optional(),
      message: nonEmpty,
      beyond: z.object({ offset: z.number(), message: nonEmpty }).strict().optional()
    })
    .strict()
]);

export const gameSystemSchema = z
  .object({
    id: z.string().regex(SYSTEM_ID_PATTERN, "A system id is lowercase, starts with a letter, and is 2-32 characters."),
    name: nonEmpty,
    shortName: nonEmpty,
    glyph: nonEmpty,
    defaultTheme: z.enum(THEME_IDS),
    tagline: z.string(),
    rollRulesQuery: z.string(),
    sourceDocuments: z.array(sourceDocument).min(1, "A system needs at least one source document."),
    contentModules: z.array(contentModule),
    imports: z.array(z.string()),
    compatibility: compatibility.optional(),
    partyLabel: nonEmpty,
    characterSheet,
    groupPage: groupPage.optional(),
    warningRules: z.array(warningRule),
    initiative,
    npcStatblock,
    attributeDamage: attributeDamage.optional(),
    rangedWeaponIcon: z.enum(["gun", "bow"]),
    traitCatalog: z
      .object({ headings: z.array(z.string()) })
      .strict()
      .optional(),
    abilities: z.array(z.string()),
    gmOnlyHeadings: z.array(z.string()),
    npcCatalog: z
      .object({
        heading: z.string(),
        entryLevel: z.number().int().min(1).max(6),
        exclude: z.array(z.string())
      })
      .strict(),
    viceCatalog: z.object({ column: nonEmpty }).strict().optional(),
    tableCatalog: z.object({ label: z.string(), exclude: z.array(z.string()), tags: z.array(z.string()) }).strict(),
    dice
  })
  .strict();

/** The definition a validated bundle describes. */
export type ParsedGameSystem = z.infer<typeof gameSystemSchema> & GameSystem;
