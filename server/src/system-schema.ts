import { z } from "zod";
import {
  NPC_STATBLOCK_PARSERS,
  SYSTEM_CREATION_DERIVE_OPS,
  SYSTEM_CREATION_STEPS,
  SYSTEM_CREATION_STEP_ID,
  SYSTEM_ID_PATTERN,
  SYSTEM_RULE_FEATURES,
  SYSTEM_RULE_ID,
  THEME_IDS,
  creationSteps,
  type CharacterCreationDefinition,
  type GameSystem,
  type SystemCreationStepKind
} from "@devils-toys/shared";

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

/**
 * An optional rule. `feature` is the whole of what one does: the application
 * withholds that behaviour until a rule naming it is on, and nothing anywhere
 * reads a rule's id to decide what it means. A rule naming a feature this build
 * does not have is refused rather than ignored, because a system whose tags
 * silently never appear is worse than one that will not install.
 */
const optionalRule = z
  .object({
    id: z.string().regex(SYSTEM_RULE_ID, "A rule id is lower-case words joined by hyphens."),
    label: nonEmpty,
    hint: z.string().optional(),
    feature: z.enum(SYSTEM_RULE_FEATURES),
    default: z.boolean(),
    required: z.boolean().optional(),
    rulesQuery: z.string().optional()
  })
  .strict()
  .refine((rule) => !rule.required || rule.default, {
    message: "A required rule is always on, so its default cannot be false."
  });

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

/**
 * The book's creation chapter, declared as steps rather than written as code.
 *
 * A step's `kind` is this application's word and not the system's, so the union
 * below is the whole of what may be declared. A kind this build has not got is
 * refused here rather than skipped, because a wizard whose third screen silently
 * never appears is worse than one that will not install.
 */
const creationStepId = z
  .string()
  .regex(SYSTEM_CREATION_STEP_ID, "A creation step id is lower-case words joined by hyphens.");

/**
 * The kinds, taken from the shared list rather than restated. A member below
 * naming something that list has not got does not compile, which is the same
 * guarantee `SYSTEM_RULE_FEATURES` gives an optional rule's `feature`.
 */
const kind = Object.fromEntries(SYSTEM_CREATION_STEPS.map((step) => [step, step])) as {
  [Kind in SystemCreationStepKind]: Kind;
};

const creationStepBase = {
  id: creationStepId,
  label: nonEmpty,
  hint: z.string().optional(),
  rulesQuery: z.string().optional(),
  optional: z.boolean().optional()
};

const creationScore = z
  .object({ label: nonEmpty, dice: nonEmpty, currentKey: nonEmpty, maximumKey: nonEmpty.optional() })
  .strict();

/** What a player may do with the numbers after the server has rolled them. */
const creationRearrange = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("swap"), count: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal("substitute"), value: z.number().int(), count: z.number().int().positive() }).strict()
]);

/**
 * The numbers offered instead of rolling. Not a rearrangement, and separate for
 * the reason the contract gives: a rearrangement is checked against the multiset
 * the dice produced, so an array checked that way would reject every assignment
 * of itself.
 */
const creationScoreArray = z.object({ values: z.array(z.number().int()).min(1), label: nonEmpty.optional() }).strict();

/**
 * Which name a joined line is captioned with. Two labels rather than one switch,
 * because a step rolling five tables and a step rolling ten columns of one want
 * different halves of the same sentence.
 */
const creationJoin = z
  .object({ field: nonEmpty, separator: z.string(), prefixWith: z.enum(["table", "column"]).optional() })
  .strict();

const creationTableRoll = z
  .object({
    table: nonEmpty.optional(),
    firstOf: z.array(nonEmpty).min(1).optional(),
    fromPacket: creationStepId.optional(),
    position: z.number().int().positive().optional(),
    column: nonEmpty.optional(),
    columnFirstOf: z.array(nonEmpty).min(1).optional(),
    field: nonEmpty.optional(),
    stowInto: nonEmpty.optional(),
    fromStep: creationStepId.optional()
  })
  .strict()
  // One table, a choice between several, or a position under an earlier packet:
  // never none and never more than one. A roll naming none references nothing
  // and then rolls nothing at all.
  .refine((roll) => [roll.table, roll.firstOf, roll.fromPacket].filter(Boolean).length === 1, {
    message: "A table roll names one table, a firstOf choice, or an earlier packet, and only one."
  })
  .refine((roll) => Boolean(roll.fromPacket) === Boolean(roll.position), {
    message: "A table roll resolving an earlier packet names both fromPacket and position."
  })
  // A column may be left out entirely, which is every single-column table — so
  // this is the weaker "not both" rather than the exclusive-or above.
  .refine((roll) => !(roll.column && roll.columnFirstOf), {
    message: "A table roll names either one column or a columnFirstOf to choose between, and not both."
  });

const creationDerivation = z
  .object({
    key: nonEmpty,
    op: z.enum(SYSTEM_CREATION_DERIVE_OPS),
    from: z.array(nonEmpty).optional(),
    pick: z.enum(["highest", "lowest", "total"]).optional(),
    value: z.number().optional(),
    ladder: z.array(z.object({ atLeast: z.number(), value: z.number() }).strict()).optional()
  })
  .strict();

const creationRollScoresStep = z
  .object({
    ...creationStepBase,
    kind: z.literal(kind["roll-scores"]),
    scores: z.array(creationScore).min(1),
    rearrange: creationRearrange.optional(),
    array: creationScoreArray.optional()
  })
  .strict();

const creationRollTableStep = z
  .object({
    ...creationStepBase,
    kind: z.literal(kind["roll-table"]),
    section: nonEmpty,
    tables: z.array(creationTableRoll).min(1),
    joinInto: creationJoin.optional(),
    editable: z.object({ placeholder: z.string().optional(), multiline: z.boolean().optional() }).strict().optional()
  })
  .strict();

const creationPacketStep = z
  .object({
    ...creationStepBase,
    kind: z.literal(kind.packet),
    under: nonEmpty,
    dice: nonEmpty.optional(),
    prose: nonEmpty.optional(),
    grantFrom: nonEmpty.optional(),
    rollTablesUnder: z.boolean().optional(),
    reuse: z.array(z.object({ position: z.number().int().positive(), fromStep: creationStepId }).strict()).optional(),
    listKey: nonEmpty.optional(),
    offerTableResults: z.boolean().optional(),
    into: z.object({ field: nonEmpty.optional(), joinInto: creationJoin.optional() }).strict().optional()
  })
  .strict();

const creationGrantStep = z
  .object({
    ...creationStepBase,
    kind: z.literal(kind.grant),
    listKey: nonEmpty.optional(),
    items: z.array(nonEmpty).optional(),
    roll: z.array(z.object({ dice: nonEmpty, field: nonEmpty, label: nonEmpty }).strict()).optional(),
    reviewFrom: z.array(creationStepId).min(1).optional(),
    describeInto: z.object({ field: nonEmpty, separator: z.string() }).strict().optional()
  })
  .strict();

const creationDeriveStep = z
  .object({
    ...creationStepBase,
    kind: z.literal(kind.derive),
    derive: z.array(creationDerivation).min(1),
    automatic: z.boolean().optional()
  })
  .strict();

const creationSetStep = z
  .object({
    ...creationStepBase,
    kind: z.literal(kind.set),
    values: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])),
    defaults: z.boolean().optional(),
    automatic: z.boolean().optional()
  })
  .strict();

const creationTextStep = z
  .object({
    ...creationStepBase,
    kind: z.literal(kind.text),
    field: nonEmpty,
    placeholder: z.string().optional(),
    multiline: z.boolean().optional()
  })
  .strict();

const creationRulesStep = z.object({ ...creationStepBase, kind: z.literal(kind.rules) }).strict();

/**
 * What a save may branch to. Not another save: one level is what "make a WIL
 * save, and on a failure roll for a vice" needs, and a branch that needs a
 * branch is a book worth looking at before it is a feature.
 */
const creationNestedStep = z.discriminatedUnion("kind", [
  creationRollScoresStep,
  creationRollTableStep,
  creationPacketStep,
  creationGrantStep,
  creationDeriveStep,
  creationSetStep,
  creationTextStep,
  creationRulesStep
]);

const creationSaveStep = z
  .object({
    ...creationStepBase,
    kind: z.literal(kind.save),
    key: nonEmpty,
    type: nonEmpty,
    on: z.enum(["success", "failure"]),
    then: z.array(creationNestedStep)
  })
  .strict();

const creationStep = z.discriminatedUnion("kind", [
  creationRollScoresStep,
  creationRollTableStep,
  creationPacketStep,
  creationGrantStep,
  creationDeriveStep,
  creationSetStep,
  creationTextStep,
  creationRulesStep,
  creationSaveStep
]);

/** A kind added to the shared list without a member above does not compile. */
const _everyKindDeclared: Record<SystemCreationStepKind, z.infer<typeof creationStep>["kind"]> = kind;

const characterCreation = z
  .object({ label: nonEmpty, rulesQuery: z.string().optional(), steps: z.array(creationStep).min(1) })
  .strict()
  .refine(
    (creation) => {
      const ids = creationSteps(creation as CharacterCreationDefinition).map((step) => step.id);
      return new Set(ids).size === ids.length;
    },
    { message: "Two creation steps share an id; a half-built character records what it has done against those ids." }
  );

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
    optionalRules: z
      .array(optionalRule)
      .refine((rules) => new Set(rules.map((rule) => rule.id)).size === rules.length, {
        message: "Two optional rules share an id; a room records its settings against those ids."
      })
      .optional(),
    characterCreation: characterCreation.optional(),
    dice
  })
  .strict();

/** The definition a validated bundle describes. */
export type ParsedGameSystem = z.infer<typeof gameSystemSchema> & GameSystem;
