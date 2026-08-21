/**
 * Character creation: the book's own creation chapter, declared as steps a
 * system lists and the application performs.
 *
 * A system declares it the way it declares everything else — as data. There is
 * no hook, no expression, and nothing evaluated: a step names a `kind` from the
 * list below, and each kind is a thing this build already knows how to do. A
 * step naming a kind this build has not got is refused at install rather than
 * skipped, because a wizard whose third screen silently never appears is worse
 * than one that will not install.
 *
 * The whole of it is optional. A system that declares nothing here keeps the
 * blank sheet and the placeholder name, which is how every system worked before
 * this existed and is still a perfectly good way to make a character.
 *
 * What a system declares is the first half of this file. The second half is what
 * a run of it produces — the ledger a half-built character carries and the
 * resolved definition a client is sent. Those are here rather than beside the
 * engine because they ride on a route a browser reads, and a payload declared
 * where only the server can reach it is a payload the client restates.
 */

import type { SystemId } from "./index.js";

/**
 * What a creation step may be. Deliberately short, and short for a reason: each
 * kind is here because one of the books in use actually does it, not because it
 * seemed general. Adding one is adding a screen the application can draw.
 */
export const SYSTEM_CREATION_STEPS = [
  "roll-scores",
  "roll-table",
  "packet",
  "grant",
  "save",
  "derive",
  "set",
  "text",
  "rules"
] as const;

export type SystemCreationStepKind = (typeof SYSTEM_CREATION_STEPS)[number];

/** Lower-case words joined by single hyphens, as every other id a system writes. */
export const SYSTEM_CREATION_STEP_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * The character's name, which is a column on the row rather than a field on the
 * sheet. It is the one target a step may write that `characterSheet` does not
 * declare, so it needs a spelling the two cannot confuse — and a sheet that
 * declares a field of this name is refused at install rather than quietly
 * shadowed.
 */
export const CREATION_NAME_KEY = "$name";

interface CreationStepBase {
  /** Unique within the system. It is what the ledger records against, so it is as permanent as an optional rule's id. */
  id: string;
  label: string;
  hint?: string;
  /** The heading in the book that explains this step, shown beside it. */
  rulesQuery?: string;
  /**
   * True where the book itself calls the step optional — Monolith's finishing
   * touches and its vices both say so. Every step can be skipped regardless;
   * this only says which ones the book expects to be.
   */
  optional?: boolean;
}

/* -------------------------------------------------------------------------- */
/* Where a total comes from                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A table is read at a total, and that total is either rolled on the table's own
 * die or taken from a step that already rolled one.
 *
 * The second is not a convenience. Monolith prints each background's signature
 * gear against a die column reading `1 HP` through `6 HP`: it is read at the Hit
 * Protection the character already rolled, not rolled again. One roll, two
 * tables. `fromStep` must name an earlier step that rolls, which is checked at
 * install — nothing here computes a total, and nothing reads one that does not
 * exist yet.
 */
export interface CreationRollSource {
  fromStep?: string;
}

/* -------------------------------------------------------------------------- */
/* The steps                                                                    */
/* -------------------------------------------------------------------------- */

export interface CreationScore {
  label: string;
  /** The dice expression, such as `3d6`. */
  dice: string;
  currentKey: string;
  /** Omit for a score the sheet keeps no maximum of. */
  maximumKey?: string;
}

/**
 * What a player may do with the numbers **after they are rolled**. Both forms are
 * a book's own words: Monolith and Cairn let you swap any two results, and
 * Cities Without Number lets you replace one of them with a 14.
 *
 * The rearrangement happens in the browser over numbers the server rolled, and
 * what comes back is checked against what was rolled. That check is the only
 * thing between the ledger and a fiction, which is why the rules for it are here
 * rather than in the client that draws them.
 */
export type CreationRearrange = { kind: "swap"; count: number } | { kind: "substitute"; value: number; count: number };

/**
 * A set of numbers offered **instead of rolling**, assigned across the scores as
 * the player likes. Cities Without Number's is 14/12/11/10/9/7.
 *
 * It is not a `rearrange`, and the difference is the whole of it: a rearrangement
 * is checked against the multiset the dice produced, so an array checked that way
 * would reject every assignment of itself and leave a step rolling numbers the
 * player could never keep. Taking the array is choosing not to roll — which is
 * also why CWN can say that a score taken from the array may not be substituted
 * with a 14 later, and why nothing here has to enforce that separately.
 */
export interface CreationScoreArray {
  values: readonly number[];
  /** What the choice is called, where the book names it. */
  label?: string;
}

export interface CreationRollScoresStep extends CreationStepBase {
  kind: "roll-scores";
  scores: readonly CreationScore[];
  rearrange?: CreationRearrange;
  /** Offered beside the dice as the other way to fill these scores in. */
  array?: CreationScoreArray;
}

/**
 * Which table is rolled on: one named table, one chosen at random from several,
 * or one at a fixed position under the section an earlier packet chose.
 * Monolith picks between its three first-name tables the second way and walks
 * the three tables under its selected background the third way.
 *
 * Exactly one of the three, and the type says so rather than leaving it to a
 * check. A roll naming none would pass every static table cross-reference and
 * then roll nothing at all, which is the sort of thing that is found by a
 * player looking at an empty box.
 */
export type CreationTableChoice =
  | { table: string; firstOf?: never; fromPacket?: never; position?: never }
  | { table?: never; firstOf: readonly string[]; fromPacket?: never; position?: never }
  | {
      table?: never;
      firstOf?: never;
      /** An earlier packet whose chosen section owns the table. */
      fromPacket: string;
      /** One-based position among the chosen section's tables. */
      position: number;
    };

/**
 * Which column is read: one named column, the first where none is named, or one
 * chosen at random from several.
 *
 * The choice `firstOf` makes between tables, one level down. Cairn has a single
 * name table carrying `Female Name` and `Male Name` as two of its four columns,
 * so the thing Monolith says with three tables Cairn says with two columns of
 * one. Rolling both and joining them into a name is not the same instruction:
 * the book asks for one name, and two joined steps accumulate.
 *
 * Exactly one of the two, made unrepresentable rather than checked, for the
 * reason `CreationTableChoice` is.
 */
export type CreationColumnChoice =
  { column?: string; columnFirstOf?: never } | { column?: never; columnFirstOf: readonly string[] };

export type CreationTableRoll = CreationTableChoice &
  CreationColumnChoice &
  CreationRollSource & {
    /** Where this one result is written. Omit to show it and write it nowhere. */
    field?: string;
    /**
     * A sheet list the result is **offered** into, on the terms a `packet`'s
     * gear bullets are offered on: matched against the room's catalogue where
     * the name matches, left as the book's own words where it does not, and
     * never stowed until the player takes it. Cairn's seven starting-gear rolls
     * are all inventory items, and a rolled item that can only be written to a
     * text box is one the player retypes into a slot themselves.
     */
    stowInto?: string;
  };

export interface CreationJoin {
  field: string;
  separator: string;
  /**
   * Write each line as `<name>: <result>`, so a box holding several rolls says
   * where each of them came from.
   *
   * Which name depends on what the step rolled, and the two are not
   * interchangeable. Monolith's five finishing touches are five separate
   * tables, so the table's name is the label. Cairn's ten traits are ten
   * columns of one table: prefixed by table they would read `Character Traits
   * (d10)` ten times over, and unprefixed they are ten bare words — and row 1 of
   * that table is `Ambitious` under both **Virtue** and **Reputation**, so the
   * caption is the only thing between two identical words.
   */
  prefixWith?: "table" | "column";
}

export interface CreationRollTableStep extends CreationStepBase {
  kind: "roll-table";
  /** The part of the book the tables are read from, matching a table's section or category. */
  section: string;
  tables: readonly CreationTableRoll[];
  /** Collect every result into one field, for a sheet with one box rather than five. */
  joinInto?: CreationJoin;
  /**
   * Let the player replace the joined result with their own words. The generated
   * result remains the starting value, so this is one editable answer rather
   * than a separate custom-value step.
   */
  editable?: { placeholder?: string; multiline?: boolean };
}

/**
 * Choose one of the sections under a heading, and take what it owns.
 *
 * This is the one composite kind, and it exists because "roll 1D12, consult the
 * corresponding background, then roll on all the tables listed under it" is a
 * single instruction in two of the three books in use. A system may instead set
 * `rollTablesUnder: false` and walk those tables through later roll-table steps
 * using `fromPacket`, as Monolith does. The options are enumerated from the
 * book's own headings and the tables filed beneath them; nothing about them is
 * restated in `system.json`, which is what stops the list of backgrounds
 * existing in two places.
 */
export interface CreationPacketStep extends CreationStepBase {
  kind: "packet";
  /** The heading whose sections are the options, such as `BACKGROUNDS`. */
  under: string;
  /** Offered as a roll as well as a choice. Omit where the book only ever lets you pick. */
  dice?: string;
  /** The sub-heading to show as an option's description, such as `PROFILE`. */
  prose?: string;
  /** The sub-heading whose bullets become the gear checklist, such as `STARTING GEAR`. */
  grantFrom?: string;
  /** Roll every rollable table the chosen section owns. Defaults to true; a packet is usually its tables. */
  rollTablesUnder?: boolean;
  /**
   * Tables under the chosen section that are read at an earlier step's roll
   * rather than rolled. `position` is one-based and in the book's own order,
   * which is the only handle there is: the twelve tables Monolith reads at the
   * HP roll share no name, no column, and no tag with the twenty-four beside
   * them that are rolled normally.
   */
  reuse?: readonly { position: number; fromStep: string }[];
  /**
   * The sheet list `grantFrom`'s bullets are offered into. A matched item could
   * be filed by the catalogue entry it resolved to, but an unmatched one has
   * nothing to go on — and guessing at the first list is wrong on any sheet with
   * two, which Monolith's equipment and augmentations already are.
   */
  listKey?: string;
  /** Offer the packet's rolled table results for later gear review as well as its prose bullets. */
  offerTableResults?: boolean;
  /** Where the chosen section's name goes, and where its rolled results are collected. */
  into?: { field?: string; joinInto?: CreationJoin };
}

export interface CreationGrantRoll {
  dice: string;
  field: string;
  label: string;
}

/**
 * Fixed starting gear, and the money that comes with it.
 *
 * `items` names catalogue ids where the book priced the thing and free text
 * where it did not. A slot holds a plain string either way, so an unmatched name
 * is not a failure — it is what the slot would have held if the player had typed
 * it.
 */
export interface CreationGrantStep extends CreationStepBase {
  kind: "grant";
  /** The sheet list the items are stowed in. Omit for a step that only rolls money. */
  listKey?: string;
  /**
   * Each entry is matched against the room's item catalogue by id, by the label
   * the catalogue renders, and by plain name, and falls back to the text itself
   * where none of those hit. A slot holds a plain string either way, so a book
   * that priced nothing still grants what it says it grants.
   */
  items?: readonly string[];
  roll?: readonly CreationGrantRoll[];
  /** Earlier steps whose offered gear is copied into this step for one final review. */
  reviewFrom?: readonly string[];
  /**
   * Let the final review file an offered result as character description instead
   * of gear. The step's `listKey` (or the candidate's own list) is the other
   * destination, so the UI can present one explicit choice between the two.
   */
  describeInto?: { field: string; separator: string };
}

/**
 * A step nested inside a save. Not a save itself: a branch that needs a branch
 * is a book worth looking at before it is a feature, and one level is what
 * Monolith's "make a WIL save, and on a failure roll for a vice" needs.
 */
export type CreationNestedStep =
  | CreationRollScoresStep
  | CreationRollTableStep
  | CreationPacketStep
  | CreationGrantStep
  | CreationDeriveStep
  | CreationSetStep
  | CreationTextStep
  | CreationRulesStep;

export interface CreationSaveStep extends CreationStepBase {
  kind: "save";
  /** The sheet key holding the value the save is rolled against. */
  key: string;
  /** One of the system's own `dice.save.types` ids. */
  type: string;
  on: "success" | "failure";
  then: readonly CreationNestedStep[];
}

/**
 * How one field is worked out from others.
 *
 * A closed list of operations rather than an expression, and it stays closed.
 * Between them these cover what the books actually ask for: Monolith reads
 * armor from carried equipment, and Cities Without Number reads a modifier off
 * a ladder and sets a save target to fifteen minus the better of two of them.
 */
export const SYSTEM_CREATION_DERIVE_OPS = [
  "copy",
  "constant",
  "sum",
  "difference",
  "lookup",
  "equipment-armor"
] as const;

export type CreationDeriveOp = (typeof SYSTEM_CREATION_DERIVE_OPS)[number];

export interface CreationDerivation {
  key: string;
  op: CreationDeriveOp;
  /**
   * The keys read. `pick` says which of them where more than one is named.
   * `equipment-armor` reads one sheet list instead of numeric fields.
   */
  from?: readonly string[];
  pick?: "highest" | "lowest" | "total";
  /** `constant`'s value, and the number `difference` counts down from. */
  value?: number;
  /** `lookup` only: what `from` is read against, matched at the highest `atLeast` it reaches. */
  ladder?: readonly { atLeast: number; value: number }[];
}

export interface CreationDeriveStep extends CreationStepBase {
  kind: "derive";
  derive: readonly CreationDerivation[];
  /** Run when the player finishes instead of presenting this as a screen. */
  automatic?: boolean;
}

export interface CreationSetStep extends CreationStepBase {
  kind: "set";
  values: Readonly<Record<string, number | string | boolean>>;
  /** Fill only blank keys instead of replacing values already on the sheet. */
  defaults?: boolean;
  /** Run when the player finishes instead of presenting this as a screen. */
  automatic?: boolean;
}

export interface CreationTextStep extends CreationStepBase {
  kind: "text";
  /** A sheet field, or `CREATION_NAME_KEY` for the character's own name. */
  field: string;
  placeholder?: string;
  multiline?: boolean;
}

/** A passage of the book with nothing to fill in. `rulesQuery` carries which one. */
export interface CreationRulesStep extends CreationStepBase {
  kind: "rules";
}

export type CreationStep = CreationNestedStep | CreationSaveStep;

export interface CharacterCreationDefinition {
  /** What the button says, in the system's own words: "Build a freelancer". */
  label: string;
  /** The chapter this all comes out of, for the link to the full text. */
  rulesQuery?: string;
  steps: readonly CreationStep[];
}

/* -------------------------------------------------------------------------- */
/* What a run of it produces                                                    */
/* -------------------------------------------------------------------------- */

/** One die a step threw, kept so a resumed screen can show what happened. */
export interface CreationRollRecord {
  label: string;
  expression: string;
  total: number;
  detail: string;
  /** The table it was rolled on, where it was rolled on one. */
  table?: string;
  /**
   * The column the result was read at. Recorded rather than worked out again
   * from the declaration, because a step may roll one table many times down
   * different columns and the table's name tells those apart from nothing.
   */
  column?: string;
  /** The row the total landed on. */
  result?: string;
  /** Set where the total was read from an earlier step rather than rolled here. */
  fromStep?: string;
}

/** A score rolled but not yet placed, because the step lets the player rearrange. */
export interface CreationScoreRoll {
  label: string;
  currentKey: string;
  maximumKey?: string;
  total: number;
}

/**
 * A line of a book's gear list, matched against the room's catalogue where the
 * name matches and left as the book's own words where it does not.
 *
 * Candidates are offered and never stowed. Decision 10 is explicit that the
 * parse is presented rather than imposed: a slot holds a plain string either
 * way, so an unmatched line is not a failure — it is what the player would have
 * typed.
 */
export interface CreationGearCandidate {
  text: string;
  /** The line written when this result is filed as description rather than in a slot. */
  description?: string;
  /** The list the matched item belongs to. */
  listKey?: string;
  itemId?: string;
  /** The catalogue's own spelling, which is what goes in the slot when it is taken. */
  label?: string;
}

export interface CreationSaveRecord {
  type: string;
  roll: number;
  target: number;
  passed: boolean;
  label: string;
  /** True where the outcome is the one the step branches on, so its `then` steps are available. */
  matched: boolean;
}

/**
 * What a step wrote, as contributions rather than as final values.
 *
 * Two steps may share a field — Monolith's background and its finishing touches
 * both join into `details` — and a step may be run twice, which decision 7
 * allows. Recording "these lines, in this box" rather than "this box now says
 * X" is what lets a rerun take its own previous contribution back out without
 * taking the other step's lines with it.
 */
export interface CreationWrite {
  /** Keys written outright, the last writer winning. `CREATION_NAME_KEY` is the character's own name. */
  set?: Record<string, unknown>;
  /** Lines appended to a text field, so a details box can hold five steps' worth. */
  join?: readonly { field: string; separator: string; lines: readonly string[] }[];
  /** Entries appended to an array field: a list's slots, or a vices field's own shape. */
  stow?: readonly { key: string; items: readonly unknown[] }[];
}

/**
 * Which of a `roll-scores` step's two ways the numbers being placed came from.
 *
 * A step may offer both, and the two are checked against different things: a
 * rearrangement against the multiset the dice produced, an array against the
 * numbers the book printed. Keeping them apart is also what lets Cities Without
 * Number say a score taken from its array may not be substituted with a 14
 * later without anything enforcing it — a substitution belongs to the rolled
 * path and the array is the other one.
 */
export type CreationScoreSource = "rolled" | "array";

/**
 * What one step has done, recorded against the step's own id.
 *
 * Against the id and never the index: an install replaces a system in place, and
 * a draft that recorded "step 4" would go on pointing at whatever is fourth
 * afterwards. Recording against ids is what lets a reader drop a step the system
 * no longer declares and keep the rest, which is exactly what `effectiveRules`
 * does with a setting for a rule that has gone.
 */
export interface CreationStepRecord {
  /** The total a later step's `fromStep` reads. */
  total?: number;
  rolled?: CreationRollRecord[];
  scores?: CreationScoreRoll[];
  /**
   * Which of a `roll-scores` step's two ways the numbers in `applied` came from.
   * A step may offer both, and a resumed wizard has to know which panel the
   * player was on — the dice they rolled, or the array they took instead.
   */
  source?: CreationScoreSource;
  /** The section taken, or the text typed: what the player settled on. */
  chosen?: string;
  candidates?: CreationGearCandidate[];
  save?: CreationSaveRecord;
  /**
   * This step's own contribution to the sheet, so a rerun can take it back out.
   * Kept through a skip as well, because a skip suspends a step rather than
   * unmaking it: what a step wrote is how the ledger says what it decided, and
   * taking the skip back has to have something to put back.
   */
  applied?: CreationWrite;
  skipped?: boolean;
  /** How many times it has run. Decision 7 makes a reroll visible; it does not prevent one. */
  runs?: number;
}

export interface CreationDraft {
  /**
   * The system the draft was started under. A character never changes system, so
   * this is belt and braces — but a draft is JSON in a column, and JSON in a
   * column is the one place a wrong shape can arrive from.
   */
  system: SystemId;
  /** Where the wizard is. */
  stepId: string;
  steps: Record<string, CreationStepRecord>;
}

/* -------------------------------------------------------------------------- */
/* The resolved definition a client is sent                                     */
/* -------------------------------------------------------------------------- */

/** One of the sections under a packet's heading, enumerated out of the book. */
export interface CreationPacketOption {
  name: string;
  prose?: string;
  /** The bullets under the packet's `grantFrom` heading, as the book wrote them. */
  gear: string[];
  /** The rollable tables the section owns, in the book's own order. */
  tables: { name: string; dice: string; columns: readonly string[] }[];
}

export interface ResolvedCreationStep {
  step: CreationStep;
  /** A `roll-table`'s tables, resolved so a client can name what it is about to roll. */
  tables?: { name: string; dice: string; columns: readonly string[] }[];
  /** A `packet`'s sections, enumerated out of the book. */
  options?: CreationPacketOption[];
  /** A `save`'s branch, resolved on the same terms. */
  then?: ResolvedCreationStep[];
}

export interface ResolvedCreationDefinition {
  label: string;
  rulesQuery?: string;
  steps: ResolvedCreationStep[];
}

/* -------------------------------------------------------------------------- */
/* Reading a declaration                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Every step in a declaration, including the ones nested inside a save.
 *
 * The install checks and the engine both need this and must agree on it, so it
 * is written once. A nested step is a step: it writes to the same sheet and is
 * checked on the same terms.
 */
export function creationSteps(definition: CharacterCreationDefinition): CreationStep[] {
  return definition.steps.flatMap((step) => (step.kind === "save" ? [step, ...step.then] : [step]));
}

/**
 * The sheet fields a step writes, so a key naming nothing can be refused at
 * install rather than discovered by a player with an empty box.
 *
 * `CREATION_NAME_KEY` is left in deliberately. It is not a sheet field and the
 * caller has to know that, which is better than this quietly dropping the one
 * target whose spelling matters most.
 */
export function creationStepFieldKeys(step: CreationStep): string[] {
  switch (step.kind) {
    case "roll-scores":
      return step.scores.flatMap((score) => [score.currentKey, ...(score.maximumKey ? [score.maximumKey] : [])]);
    case "roll-table":
      return [
        ...step.tables.flatMap((table) => (table.field ? [table.field] : [])),
        ...(step.joinInto ? [step.joinInto.field] : [])
      ];
    case "packet":
      return [
        ...(step.into?.field ? [step.into.field] : []),
        ...(step.into?.joinInto ? [step.into.joinInto.field] : [])
      ];
    case "grant":
      return [...(step.roll ?? []).map((roll) => roll.field), ...(step.describeInto ? [step.describeInto.field] : [])];
    case "save":
      return [];
    case "derive":
      return step.derive.map((derivation) => derivation.key);
    case "set":
      return Object.keys(step.values);
    case "text":
      return [step.field];
    case "rules":
      return [];
  }
}

/** The sheet fields a step reads but does not write, which must exist just as surely. */
export function creationStepReadKeys(step: CreationStep): string[] {
  if (step.kind === "derive")
    return step.derive.flatMap((derivation) =>
      derivation.op === "equipment-armor" ? [] : [...(derivation.from ?? [])]
    );
  if (step.kind === "save") return [step.key];
  return [];
}

/**
 * The sheet lists a step stows into. A `packet` names one for the same reason a
 * `grant` does — its `grantFrom` bullets have to land somewhere — and a
 * `roll-table`'s `stowInto` names one for the same reason again, so all three
 * are checked at install on the same terms rather than discovered by a player
 * pressing Take on a list the sheet has not got.
 */
export function creationStepListKeys(step: CreationStep): string[] {
  if (step.kind === "grant" || step.kind === "packet") return step.listKey ? [step.listKey] : [];
  if (step.kind === "roll-table") return step.tables.flatMap((entry) => (entry.stowInto ? [entry.stowInto] : []));
  if (step.kind === "derive")
    return step.derive.flatMap((derivation) =>
      derivation.op === "equipment-armor" ? [...(derivation.from ?? [])] : []
    );
  return [];
}

/**
 * The tables a step reads, as the name it names them by and the column it wants.
 * A `firstOf` contributes every table it might choose and a `columnFirstOf`
 * every column, because any of them may be the one rolled and all of them have
 * to be there.
 */
export function creationStepTables(step: CreationStep): { table: string; column?: string }[] {
  if (step.kind !== "roll-table") return [];
  return step.tables.flatMap((entry) => {
    const columns: (string | undefined)[] = entry.columnFirstOf
      ? [...entry.columnFirstOf]
      : [entry.column ?? undefined];
    return [...(entry.table ? [entry.table] : []), ...(entry.firstOf ?? [])].flatMap((table) =>
      columns.map((column) => ({ table, column }))
    );
  });
}

/** Dynamic table references, resolved from the section an earlier packet chose. */
export function creationStepPacketTables(
  step: CreationStep
): { fromPacket: string; position: number; column?: string }[] {
  if (step.kind !== "roll-table") return [];
  return step.tables.flatMap((entry) =>
    entry.fromPacket
      ? [
          {
            fromPacket: entry.fromPacket,
            position: entry.position,
            ...(entry.column ? { column: entry.column } : {})
          }
        ]
      : []
  );
}

/**
 * Every dice expression a step declares. The roller is the authority on what one
 * is — how many dice, which sides it knows — so an install checks these by
 * handing them to it rather than by keeping a second grammar beside it.
 */
export function creationStepDice(step: CreationStep): string[] {
  switch (step.kind) {
    case "roll-scores":
      return step.scores.map((score) => score.dice);
    case "packet":
      return step.dice ? [step.dice] : [];
    case "grant":
      return (step.roll ?? []).map((roll) => roll.dice);
    default:
      return [];
  }
}

/**
 * Whether a step produces a total another step can read. Only these can be named
 * by a `fromStep`, and only from later in the list.
 */
export function creationStepRolls(step: CreationStep): boolean {
  switch (step.kind) {
    case "roll-scores":
      return step.scores.length === 1;
    case "roll-table":
      return step.tables.length === 1;
    case "packet":
      return Boolean(step.dice);
    default:
      return false;
  }
}

/** Every `fromStep` in a step, wherever it is written. */
export function creationStepRollSources(step: CreationStep): string[] {
  if (step.kind === "roll-table") return step.tables.flatMap((table) => (table.fromStep ? [table.fromStep] : []));
  if (step.kind === "packet") return (step.reuse ?? []).flatMap((reuse) => (reuse.fromStep ? [reuse.fromStep] : []));
  return [];
}
