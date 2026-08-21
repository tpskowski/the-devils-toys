import {
  CREATION_NAME_KEY,
  creationStepRolls,
  creationSteps,
  type CharacterCreationDefinition,
  type CharacterItem,
  type CharacterVice,
  type CreationDerivation,
  type CreationDraft,
  type CreationGearCandidate,
  type CreationGrantStep,
  type CreationJoin,
  type CreationPacketOption,
  type CreationPacketStep,
  type CreationRearrange,
  type CreationRollRecord,
  type CreationRollScoresStep,
  type CreationRollTableStep,
  type CreationSaveRecord,
  type CreationSaveStep,
  type CreationScoreRoll,
  type CreationScoreSource,
  type CreationStep,
  type CreationStepRecord,
  type CreationTableRoll,
  type CreationWrite,
  type GameSystem,
  type GroupPageDefinition,
  type ResolvedCreationDefinition,
  type ResolvedCreationStep,
  type SystemCreationStepKind,
  type SystemId
} from "@devils-toys/shared";
import { characterItemsFor } from "./character-items.js";
import { characterVicesFor } from "./character-vices.js";
import { evaluateSave, rollDice } from "./dice.js";
import { compactEntry, compactTables, parseCompactRollTables, type CompactRollTable } from "./roll-tables.js";
import { systemMarkdown, systemOrThrow } from "./systems.js";

/**
 * The creation engine: one step at a time, rolled on the server.
 *
 * A system declares its creation chapter as data — `shared/src/system-creation.ts`
 * is the whole of the vocabulary — and this is the part of the application that
 * knows how to perform each of the nine kinds. Nothing read from a system is
 * evaluated here any more than anywhere else: a `kind` selects a branch of a
 * switch that was written before the system was installed.
 *
 * Everything the install checks have already established is assumed rather than
 * re-checked. `refuseUninstallableCreation` has confirmed that every field a
 * step writes exists, that every table it names is in the bundle, that every
 * `fromStep` points backwards at a step that rolls, and that every dice
 * expression can be rolled. What is left for the engine is what an install
 * cannot see: which branch actually ran, and what the dice said.
 *
 * `rollHirelingCreation` lives here too. It was the older and narrower thing —
 * one atomic roll from `groupPage.hirelings.creationRoll` — and it is now that
 * declaration translated into steps and handed to this engine, so there is one
 * place that knows how to roll a table into a field rather than two that drift.
 */

/** Names in a book are matched however they were cased or spaced, as the roller matches them. */
const folded = (value: string) => value.trim().toLocaleLowerCase();

/* -------------------------------------------------------------------------- */
/* What a step produces                                                         */
/* -------------------------------------------------------------------------- */

export interface CreationStepOutcome {
  stepId: string;
  kind: SystemCreationStepKind;
  applied: CreationWrite;
  rolled: CreationRollRecord[];
  /** The total a later step's `fromStep` reads. Only a step that rolls exactly one has one. */
  total?: number;
  /** Rolled and left unplaced, for a `roll-scores` that declares a `rearrange`. */
  scores?: CreationScoreRoll[];
  /** Which of a `roll-scores` step's two ways this outcome came from. */
  source?: CreationScoreSource;
  /** The packet section taken, rolled or picked. */
  chosen?: string;
  candidates?: CreationGearCandidate[];
  save?: CreationSaveRecord;
  /**
   * True where the step could not run and wrote nothing — a table read at a
   * total that was never rolled, because the step that rolls it was skipped or
   * sat in a save branch that did not run. The install checks cannot see across
   * branches and should not try; the engine treats a missing total as a step to
   * skip, exactly as it treats any other unfilled step.
   */
  skipped?: boolean;
}

/* -------------------------------------------------------------------------- */
/* Running one step                                                             */
/* -------------------------------------------------------------------------- */

/** Where the tables come from: an installed system, or Markdown handed straight in. */
export type CreationTableSource = { kind: "system"; system: SystemId } | { kind: "markdown"; markdown: string };

export interface CreationRunContext {
  system: SystemId;
  /** The room, so a room's own additions to the item catalogue are the ones offered. */
  roomId?: number;
  /** The sheet as it stands, which a `derive` reads and a `save` is rolled against. */
  sheet: Readonly<Record<string, unknown>>;
  /** Totals earlier steps rolled, keyed by step id. A step not in here was never rolled. */
  totals?: ReadonlyMap<string, number>;
  /** Earlier decisions, used when a later gear step reviews what they offered. */
  records?: Readonly<Record<string, CreationStepRecord>>;
  /** Defaults to the system's own installed tables. */
  tables?: CreationTableSource;
  random?: () => number;
  /** A packet section the player picked instead of rolling for it. */
  choice?: string;
}

interface Run {
  step: CreationStep;
  context: CreationRunContext;
  random: () => number;
  /**
   * Read on demand rather than up front, because a hireling rolled from plain
   * Markdown brings tables and no system, and neither of its two steps reaches
   * anything the definition holds.
   */
  definition: () => GameSystem;
  rolled: CreationRollRecord[];
  set: Record<string, unknown>;
  join: { field: string; separator: string; lines: string[] }[];
  stow: { key: string; items: unknown[] }[];
}

export function performCreationStep(step: CreationStep, context: CreationRunContext): CreationStepOutcome {
  let definition: GameSystem | undefined;
  const run: Run = {
    step,
    context,
    random: context.random ?? Math.random,
    definition: () => (definition ??= systemOrThrow(context.system)),
    rolled: [],
    set: {},
    join: [],
    stow: []
  };

  const partial = perform(run);
  const applied: CreationWrite = {
    ...(Object.keys(run.set).length ? { set: run.set } : {}),
    ...(run.join.length ? { join: run.join } : {}),
    ...(run.stow.length ? { stow: run.stow } : {})
  };
  return {
    stepId: step.id,
    kind: step.kind,
    applied,
    rolled: run.rolled,
    ...partial
  };
}

type PartialOutcome = Omit<CreationStepOutcome, "stepId" | "kind" | "applied" | "rolled">;

function perform(run: Run): PartialOutcome {
  switch (run.step.kind) {
    case "roll-scores":
      return performRollScores(run, run.step);
    case "roll-table":
      return performRollTable(run, run.step);
    case "packet":
      return performPacket(run, run.step);
    case "grant":
      return performGrant(run, run.step);
    case "save":
      return performSave(run, run.step);
    case "derive":
      return performDerive(run, run.step.derive);
    case "set": {
      const setStep = run.step;
      run.set = Object.fromEntries(
        Object.entries(setStep.values).filter(
          ([key]) => !setStep.defaults || run.context.sheet[key] === undefined || run.context.sheet[key] === ""
        )
      );
      return {};
    }
    case "text":
    case "rules":
      // Neither rolls. A `text` field is written by the player through the
      // creation PATCH, which is the same act as choosing a packet section.
      return {};
  }
}

/* -------------------------------------------------------------------------- */
/* roll-scores                                                                  */
/* -------------------------------------------------------------------------- */

function performRollScores(run: Run, step: CreationRollScoresStep): PartialOutcome {
  const scores = step.scores.map((score) => {
    const roll = rollDice(score.dice, run.random);
    run.rolled.push({ label: score.label, expression: roll.expression, total: roll.total, detail: roll.detail });
    return { label: score.label, currentKey: score.currentKey, maximumKey: score.maximumKey, total: roll.total };
  });

  // With a rearrangement on offer the numbers are returned unplaced: assignment
  // is a separate act, checked against what was rolled when it comes back. An
  // array changes nothing here — taking it is choosing not to roll at all, so a
  // step that has been rolled has been filled in whether it offers one or not.
  if (!step.rearrange)
    run.set = scoreAssignment(
      step,
      scores.map((score) => score.total)
    );

  return {
    scores,
    source: "rolled",
    ...(creationStepRolls(step) ? { total: scores[0].total } : {})
  };
}

/** Where the numbers land, in the order the scores are declared. */
export function scoreAssignment(step: CreationRollScoresStep, values: readonly number[]): Record<string, unknown> {
  const set: Record<string, unknown> = {};
  for (const [index, score] of step.scores.entries()) {
    set[score.currentKey] = values[index];
    if (score.maximumKey) set[score.maximumKey] = values[index];
  }
  return set;
}

/* -------------------------------------------------------------------------- */
/* roll-table                                                                   */
/* -------------------------------------------------------------------------- */

function tablesIn(run: Run, section: string): Map<string, CompactRollTable> {
  const source = run.context.tables ?? { kind: "system" as const, system: run.context.system };
  const tables =
    source.kind === "system" ? compactTables(source.system, section) : parseCompactRollTables(source.markdown, section);
  return new Map(tables.map((table) => [folded(table.name), table]));
}

/**
 * Rolls one entry of a `roll-table`, or reports that it has nothing to roll at.
 *
 * A `firstOf` chooses at random before anything else, which is how Monolith
 * picks between its three first-name tables, and is the one piece of the old
 * hireling roll with no other home. A `columnFirstOf` is the same choice one
 * level down, and is made on the same terms and at the same moment.
 */
function rollTableEntry(
  run: Run,
  section: string,
  entry: CreationTableRoll,
  tables: Map<string, CompactRollTable>
): { table: CompactRollTable; column: string; total: number; value: string } | undefined {
  let name: string | undefined;
  if (entry.fromPacket) {
    const creation = run.definition().characterCreation;
    const packet = creation && creationSteps(creation).find((candidate) => candidate.id === entry.fromPacket);
    if (!packet || packet.kind !== "packet")
      throw new Error(`The "${run.step.id}" step reads tables from a packet called "${entry.fromPacket}".`);
    const chosen = run.context.records?.[entry.fromPacket]?.chosen;
    // A skipped packet has no section and therefore no table. This is the same
    // conditional absence as a table whose fromStep never produced a total.
    if (!chosen) return undefined;
    const options = creationPacketOptions(systemMarkdown(run.context.system), [...tables.values()], packet);
    const option = options.find((candidate) => folded(candidate.name) === folded(chosen));
    if (!option) throw new Error(`The "${entry.fromPacket}" packet no longer offers "${chosen}".`);
    name = option.tables[entry.position - 1]?.name;
    if (!name)
      throw new Error(
        `The "${run.step.id}" step reads table ${entry.position} from "${chosen}", which has only ${option.tables.length}.`
      );
  } else {
    name = entry.table ?? choose(entry.firstOf ?? [], run.random);
  }
  if (!name) throw new Error(`The ${section} source has no tables configured for this roll.`);
  const table = tables.get(folded(name));
  if (!table) throw new Error(`The ${section} source has no rollable "${name}" table.`);
  const wanted = entry.columnFirstOf ? choose(entry.columnFirstOf, run.random) : entry.column;

  let total: number;
  let record: CreationRollRecord;
  if (entry.fromStep) {
    const carried = run.context.totals?.get(entry.fromStep);
    // A total that was never rolled means this table is skipped, not that
    // anything is wrong: the step that rolls it may have been skipped, or may
    // sit in a save branch that did not run.
    if (carried === undefined) return undefined;
    total = carried;
    record = {
      label: table.name,
      expression: table.dice,
      total,
      detail: `read at the ${entry.fromStep} roll`,
      table: table.name,
      fromStep: entry.fromStep
    };
  } else {
    const roll = rollDice(table.dice, run.random);
    total = roll.total;
    record = { label: table.name, expression: roll.expression, total, detail: roll.detail, table: table.name };
  }

  const value = compactEntry(table, total, wanted);
  if (value === undefined) throw new Error(`The "${table.name}" table has no result for ${total}.`);
  // The column is recorded rather than left for a reader to reconstruct. The
  // engine is the only thing that knows which one a `columnFirstOf` landed on,
  // and a step that rolls one table ten times down ten columns gives a reader
  // nothing but the order of the declaration to pair them back up by.
  const column = wanted ?? table.columns[0] ?? "";
  run.rolled.push({ ...record, ...(column ? { column } : {}), result: value });
  return { table, column, total, value };
}

function performRollTable(run: Run, step: CreationRollTableStep): PartialOutcome {
  const tables = tablesIn(run, step.section);
  const lines: string[] = [];
  const offered: { text: string; listKey: string; description?: string }[] = [];
  let only: number | undefined;
  let ran = 0;

  for (const entry of step.tables) {
    const result = rollTableEntry(run, step.section, entry, tables);
    if (!result) continue;
    ran += 1;
    only = result.total;
    if (entry.field) writeField(run, entry.field, result.value, result.table, result.total);
    const description = step.joinInto
      ? joinLine(step.joinInto, result.table.name, result.column, result.value)
      : undefined;
    if (entry.stowInto) offered.push({ text: result.value, listKey: entry.stowInto, description });
    if (description) lines.push(description);
  }

  if (!ran) return { skipped: true };
  if (step.joinInto && lines.length) run.join.push({ ...joinTarget(step.joinInto), lines });
  return {
    // Offered and never applied, exactly as a packet's bullets are: decision 10
    // says the parse is presented rather than imposed, and a rolled item is no
    // more the player's than a printed one until they say so.
    ...(offered.length ? { candidates: gearCandidates(run, offered) } : {}),
    ...(creationStepRolls(step) && only !== undefined ? { total: only } : {})
  };
}

function joinLine(join: CreationJoin, table: string, column: string, value: string) {
  if (join.prefixWith === "table") return `${table}: ${value}`;
  if (join.prefixWith === "column" && column) return `${column}: ${value}`;
  return value;
}

function joinTarget(join: CreationJoin) {
  return { field: join.field, separator: join.separator };
}

/**
 * Writes one rolled result into the field a step names.
 *
 * A `vices` field is the exception, and it is the sheet's exception rather than
 * this one's: it holds `CharacterVice` records, not text, so a rolled vice is
 * matched against the system's own vice catalogue and appended in the shape the
 * sheet reads. Writing the row's text there would leave a field the sheet
 * silently drops on the next read.
 */
function writeField(run: Run, field: string, value: string, table: CompactRollTable, total: number) {
  if (fieldKind(run.definition(), field) !== "vices") {
    run.set[field] = value;
    return;
  }
  run.stow.push({ key: field, items: [viceFor(run, value, table, total)] });
}

function fieldKind(definition: GameSystem, key: string) {
  for (const section of definition.characterSheet.sections)
    for (const field of section.fields) if (field.key === key) return field.kind;
  return undefined;
}

/**
 * The rolled row as the sheet's vices field holds it.
 *
 * `characterVicesFor` is asked first, because it is the reader the sheet's own
 * picker uses and a system that declares a `viceCatalog` has already said which
 * table is the authority. Where the roll was on some other table, the two
 * columns beside the one that was read are what the book writes there, which is
 * the same three cells in the same order.
 */
function viceFor(run: Run, name: string, table: CompactRollTable, total: number): CharacterVice {
  const known = characterVicesFor(run.context.system).find((vice) => folded(vice.name) === folded(name));
  if (known) return known;
  const beside = table.columns.filter((column) => compactEntry(table, total, column) !== name);
  return {
    name,
    triggers: (beside[0] && compactEntry(table, total, beside[0])) ?? "",
    satisfying: (beside[1] && compactEntry(table, total, beside[1])) ?? ""
  };
}

/* -------------------------------------------------------------------------- */
/* packet                                                                       */
/* -------------------------------------------------------------------------- */

interface MarkdownHeading {
  level: number;
  text: string;
  line: number;
}

function markdownHeadings(markdown: string): MarkdownHeading[] {
  return markdown.split("\n").flatMap((line, index) => {
    const match = /^(#{1,6})[ \t]+(.+?)[ \t]*$/.exec(line);
    return match ? [{ level: match[1].length, text: match[2].replace(/^\*+|\*+$/g, "").trim(), line: index }] : [];
  });
}

/** The headings inside one heading's span: everything up to the next of its level or shallower. */
function within(headings: readonly MarkdownHeading[], index: number) {
  const owner = headings[index];
  const end = headings.findIndex((heading, position) => position > index && heading.level <= owner.level);
  return headings.slice(index + 1, end < 0 ? headings.length : end);
}

/** The lines a heading owns before the next heading of any level. */
function bodyOf(lines: readonly string[], headings: readonly MarkdownHeading[], heading: MarkdownHeading) {
  const next = headings.find((candidate) => candidate.line > heading.line);
  return lines.slice(heading.line + 1, next ? next.line : lines.length);
}

/**
 * The sections beneath a packet's heading, each with the headings it owns.
 *
 * The sections are the shallowest headings beneath the one the step names —
 * which is not always the next level down: Monolith files its twelve
 * backgrounds as `###` directly under a `#` chapter.
 *
 * The install checks read this as well as the engine, and that is the point of
 * its being one function. A packet's `prose` and `grantFrom` name headings
 * *inside* a section, and asking whether they exist anywhere in the book is a
 * question that Cairn's Optional Gear Packages answer yes to while offering an
 * empty checklist forever.
 */
function packetSections(headings: readonly MarkdownHeading[], under: string) {
  const index = headings.findIndex((heading) => folded(heading.text) === folded(under));
  const inside = index < 0 ? [] : within(headings, index);
  if (!inside.length) return [];
  const level = Math.min(...inside.map((heading) => heading.level));
  return inside
    .filter((heading) => heading.level === level)
    .map((section) => ({ section, own: within(inside, inside.indexOf(section)) }));
}

/** The sections a packet enumerates and the headings beneath each of them, by name. */
export function creationPacketSections(markdown: string, under: string): { name: string; headings: string[] }[] {
  return packetSections(markdownHeadings(markdown), under).map(({ section, own }) => ({
    name: section.text,
    headings: own.map((heading) => heading.text)
  }));
}

/**
 * The sections a packet offers, read out of the book rather than restated.
 *
 * A section the tables know about and the headings do not is added after them,
 * so a book whose Markdown and tables have drifted still offers everything
 * either one has.
 */
export function creationPacketOptions(
  markdown: string,
  tables: readonly CompactRollTable[],
  step: Pick<CreationPacketStep, "under" | "prose" | "grantFrom">
): CreationPacketOption[] {
  const lines = markdown.split("\n");
  const headings = markdownHeadings(markdown);

  const options = packetSections(headings, step.under).map(({ section, own }) => {
    const prose = step.prose ? own.find((heading) => folded(heading.text) === folded(step.prose ?? "")) : undefined;
    const gear = step.grantFrom
      ? own.find((heading) => folded(heading.text) === folded(step.grantFrom ?? ""))
      : undefined;
    return {
      name: section.text,
      ...(prose ? { prose: paragraph(bodyOf(lines, headings, prose)) } : {}),
      gear: gear ? bullets(bodyOf(lines, headings, gear)) : [],
      tables: tablesUnder(tables, step.under, section.text)
    };
  });

  const named = new Set(options.map((option) => folded(option.name)));
  for (const table of tables) {
    const owner = sectionUnder(table, step.under);
    if (!owner || named.has(folded(owner))) continue;
    named.add(folded(owner));
    options.push({ name: owner, gear: [], tables: tablesUnder(tables, step.under, owner) });
  }
  return options;
}

/** The heading immediately beneath `under` in a table's own heading path. */
function sectionUnder(table: CompactRollTable, under: string) {
  const path = table.section.split(/\s*·\s*/).map((part) => part.trim());
  const index = path.findIndex((part) => folded(part) === folded(under));
  return index < 0 ? undefined : path[index + 1];
}

function tablesUnder(tables: readonly CompactRollTable[], under: string, section: string) {
  return tables
    .filter((table) => {
      const owner = sectionUnder(table, under);
      return owner !== undefined && folded(owner) === folded(section);
    })
    .map((table) => ({ name: table.name, dice: table.dice, columns: table.columns }));
}

function paragraph(lines: readonly string[]) {
  return lines
    .join("\n")
    .trim()
    .replace(/\n{2,}/g, "\n\n");
}

function bullets(lines: readonly string[]) {
  return lines.flatMap((line) => {
    const match = /^\s*[-*]\s+(.+?)\s*$/.exec(line);
    return match ? [match[1]] : [];
  });
}

function performPacket(run: Run, step: CreationPacketStep): PartialOutcome {
  if (run.context.tables && run.context.tables.kind !== "system")
    throw new Error("A creation packet reads the system's own rules and tables.");
  const tables = compactTables(run.context.system, step.under);
  const options = creationPacketOptions(systemMarkdown(run.context.system), tables, step);
  if (!options.length) throw new Error(`The rules have no sections under "${step.under}".`);

  let chosen: CreationPacketOption | undefined;
  let total: number | undefined;
  if (run.context.choice) {
    chosen = options.find((option) => folded(option.name) === folded(run.context.choice ?? ""));
    if (!chosen) throw new Error(`"${run.context.choice}" is not one of the sections under "${step.under}".`);
  } else {
    if (!step.dice) throw new Error(`The "${step.id}" step is chosen rather than rolled.`);
    const roll = rollDice(step.dice, run.random);
    total = roll.total;
    chosen = options[roll.total - 1];
    if (!chosen)
      throw new Error(
        `The "${step.id}" step rolled ${roll.total} on ${step.dice}, and "${step.under}" has ${options.length} sections.`
      );
    run.rolled.push({ label: step.label, expression: roll.expression, total: roll.total, detail: roll.detail });
  }

  if (step.into?.field) run.set[step.into.field] = chosen.name;

  const lines: string[] = [];
  const tableOffers: { text: string; listKey?: string }[] = [];
  if (step.rollTablesUnder !== false) {
    const byName = new Map(tables.map((table) => [folded(table.name), table]));
    for (const [position, owned] of chosen.tables.entries()) {
      const table = byName.get(folded(owned.name));
      if (!table) continue;
      const reuse = step.reuse?.find((entry) => entry.position === position + 1);
      const entry: CreationTableRoll = reuse ? { table: table.name, fromStep: reuse.fromStep } : { table: table.name };
      const result = rollTableEntry(run, step.under, entry, byName);
      if (!result) continue;
      if (step.into?.joinInto) lines.push(joinLine(step.into.joinInto, table.name, result.column, result.value));
      if (step.offerTableResults)
        tableOffers.push({ text: result.value, ...(step.listKey ? { listKey: step.listKey } : {}) });
    }
  }
  if (step.into?.joinInto && lines.length) run.join.push({ ...joinTarget(step.into.joinInto), lines });

  return {
    chosen: chosen.name,
    candidates: gearCandidates(run, [
      ...chosen.gear.map((text) => ({ text, ...(step.listKey ? { listKey: step.listKey } : {}) })),
      ...tableOffers
    ]),
    ...(total !== undefined ? { total } : {})
  };
}

/* -------------------------------------------------------------------------- */
/* grant                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The catalogue entry a declared item names, by id, by the catalogue's own
 * label, or by the book's plain name.
 *
 * Three spellings because two of them are in use: Monolith's declaration names
 * `monolith/rations`, and the toybox fixture names `Cudgel`. A slot holds a
 * plain string either way, so a name that matches nothing is stowed as written
 * rather than refused.
 */
export function matchCatalogueItem(
  catalogue: Readonly<Record<string, CharacterItem[]>>,
  text: string,
  preferred?: string
): { listKey: string; item: CharacterItem } | undefined {
  const wanted = folded(text);
  const entries = Object.entries(catalogue);
  const lists = [
    ...entries.filter(([listKey]) => listKey === preferred),
    ...entries.filter(([listKey]) => listKey !== preferred)
  ];
  for (const [listKey, items] of lists) {
    const item = items.find(
      (candidate) => candidate.id === text || folded(candidate.label) === wanted || folded(candidate.name) === wanted
    );
    if (item) return { listKey, item };
  }
  return undefined;
}

/**
 * Where each offered line would go if the player took it: the list the step
 * named where it named one, otherwise the list the catalogue entry it matched
 * belongs to, otherwise nowhere.
 *
 * Nowhere is a real answer. An unmatched bullet on a step naming no list has
 * nothing to go on, and guessing at the sheet's first list is wrong on any sheet
 * with two — so it is offered as the book's own words for the player to file
 * themselves rather than filed somewhere plausible on their behalf.
 *
 * A packet's prose bullets and a `roll-table`'s `stowInto` results come through
 * here alike, which is what makes them the same offer on the same terms rather
 * than two similar ones.
 */
function gearCandidates(
  run: Run,
  gear: readonly { text: string; listKey?: string; description?: string }[]
): CreationGearCandidate[] {
  if (!gear.length) return [];
  const catalogue = characterItemsFor(run.context.system, run.context.roomId);
  return gear.map((offer) => {
    const matched = matchCatalogueItem(catalogue, offer.text, offer.listKey);
    const listKey = offer.listKey ?? matched?.listKey;
    return {
      text: offer.text,
      ...(offer.description ? { description: offer.description } : {}),
      ...(listKey ? { listKey } : {}),
      ...(matched ? { itemId: matched.item.id, label: matched.item.label } : {})
    };
  });
}

function performGrant(run: Run, step: CreationGrantStep): PartialOutcome {
  if (step.items?.length && step.listKey) {
    const catalogue = characterItemsFor(run.context.system, run.context.roomId);
    const items = step.items.map((entry) => matchCatalogueItem(catalogue, entry, step.listKey)?.item.label ?? entry);
    run.stow.push({ key: step.listKey, items });
  }
  for (const roll of step.roll ?? []) {
    const result = rollDice(roll.dice, run.random);
    run.rolled.push({ label: roll.label, expression: result.expression, total: result.total, detail: result.detail });
    run.set[roll.field] = result.total;
  }
  const candidates = (step.reviewFrom ?? []).flatMap((stepId) => run.context.records?.[stepId]?.candidates ?? []);
  return { ...(candidates.length ? { candidates } : {}) };
}

/* -------------------------------------------------------------------------- */
/* save                                                                         */
/* -------------------------------------------------------------------------- */

function performSave(run: Run, step: CreationSaveStep): PartialOutcome {
  const rules = run.definition().dice;
  const target = Number(run.context.sheet[step.key]);
  if (!Number.isInteger(target) || target < 1 || target > rules.save.sides)
    throw new Error(`This save is rolled against "${step.key}", which the sheet has no score in yet.`);
  const roll = rollDice(`d${rules.save.sides}`, run.random);
  const outcome = evaluateSave(roll.total, target, "normal", rules);
  run.rolled.push({
    label: step.label,
    expression: roll.expression,
    total: roll.total,
    detail: roll.detail,
    result: outcome.label
  });
  // A save writes nothing. What it produces is whether the branch beneath it is
  // open, which is what the ledger has to remember: re-deciding it on the next
  // screen would be a second roll.
  return {
    save: {
      type: step.type,
      roll: roll.total,
      target,
      passed: outcome.passed,
      label: outcome.label,
      matched: outcome.passed === (step.on === "success")
    }
  };
}

/* -------------------------------------------------------------------------- */
/* derive                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The declared operations do not compose. Composition is what an expression is, so
 * these do not compose: each one reads keys, reduces them to a single number by
 * its `pick`, and writes one key.
 *
 * A derivation whose sources are not all numbers on the sheet writes nothing.
 * The step it reads from may have been skipped, and a field holding NaN is
 * worse than a field left as the player will fill it.
 */
function performDerive(run: Run, derivations: readonly CreationDerivation[]): PartialOutcome {
  for (const derivation of derivations) {
    const value = deriveValue(run.context.sheet, derivation);
    if (value !== undefined) run.set[derivation.key] = value;
  }
  return {};
}

export function deriveValue(
  sheet: Readonly<Record<string, unknown>>,
  derivation: CreationDerivation
): number | undefined {
  if (derivation.op === "constant") return derivation.value ?? 0;

  if (derivation.op === "equipment-armor") {
    const source = derivation.from?.[0];
    const equipment = source && Array.isArray(sheet[source]) ? (sheet[source] as unknown[]) : [];
    return equipmentArmor(equipment);
  }

  const keys = derivation.from ?? [];
  const values: number[] = [];
  for (const key of keys) {
    const value = Number(sheet[key]);
    if (sheet[key] === undefined || sheet[key] === null || sheet[key] === "" || !Number.isFinite(value))
      return undefined;
    values.push(value);
  }
  if (!values.length) return undefined;

  // `copy` is the one-key spelling and stays that way: a `copy` naming two keys
  // and no `pick` takes the first rather than quietly summing them.
  const picked = derivation.op === "copy" && !derivation.pick ? values[0] : pick(values, derivation.pick);
  switch (derivation.op) {
    case "copy":
    case "sum":
      return picked;
    case "difference":
      return (derivation.value ?? 0) - picked;
    case "lookup": {
      const rungs = [...(derivation.ladder ?? [])].sort((left, right) => left.atLeast - right.atLeast);
      const reached = rungs.filter((rung) => picked >= rung.atLeast).at(-1);
      return reached?.value;
    }
  }
}

/**
 * Armor worn from a list of equipment: the best base suit plus explicit bonus
 * sources, capped at the three points Monolith permits. Both "Armor 2" and
 * "2 Armor" occur in the book, while a leading plus marks a stackable source.
 */
export function equipmentArmor(equipment: readonly unknown[]) {
  let base = 0;
  let bonus = 0;
  for (const item of equipment) {
    const text = String(item ?? "");
    for (const match of text.matchAll(/\+(\d+)\s*armor\b/gi)) bonus += Number(match[1]);
    for (const match of text.matchAll(/(?<!\+)\b(?:armor\s*(\d+)|(\d+)\s*armor)\b/gi))
      base = Math.max(base, Number(match[1] ?? match[2]));
  }
  return Math.min(3, base + bonus);
}

function pick(values: readonly number[], how: CreationDerivation["pick"]) {
  if (how === "highest") return Math.max(...values);
  if (how === "lowest") return Math.min(...values);
  return values.reduce((sum, value) => sum + value, 0);
}

/* -------------------------------------------------------------------------- */
/* Applying a step's write                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Folds a step's contribution into a sheet, taking its previous contribution
 * back out first.
 *
 * `previous` is what the same step wrote last time it ran. Rerolling is allowed
 * — decision 7 warns rather than bars — and a reroll that appended a second copy
 * of the background's three lines to the details box would make the ledger a
 * liar. Taking the old contribution out by value rather than rewriting the whole
 * field is what leaves the other steps' lines, and anything the player typed, in
 * place.
 */
export function applyCreationWrite(
  target: Readonly<Record<string, unknown>>,
  write: CreationWrite,
  previous?: CreationWrite
): Record<string, unknown> {
  const sheet: Record<string, unknown> = { ...target };

  for (const entry of write.join ?? []) {
    // A name is not a details box. Every other join target holds a step's lines
    // beside another step's, which is the whole reason a write is a contribution
    // — but the character has one name, and a step joining a first name and a
    // surname into it is stating the whole of it. Appending is what produced
    // "New character Rowen Wesker": the builder's door has to create the row
    // with a name, so the placeholder was still sitting in front of every rolled
    // one. A `text` step writing the same target already replaces, because a
    // `set` does; this makes the two agree.
    if (entry.field === CREATION_NAME_KEY) {
      sheet[entry.field] = entry.lines.join(entry.separator);
      continue;
    }
    const removed = (previous?.join ?? []).find((old) => old.field === entry.field)?.lines ?? [];
    const kept = withoutEach(splitJoined(sheet[entry.field], entry.separator), removed);
    sheet[entry.field] = [...kept, ...entry.lines].join(entry.separator);
  }
  for (const entry of write.stow ?? []) {
    const removed = (previous?.stow ?? []).find((old) => old.key === entry.key)?.items ?? [];
    const kept = withoutEach(Array.isArray(sheet[entry.key]) ? (sheet[entry.key] as unknown[]) : [], removed);
    sheet[entry.key] = [...kept, ...entry.items];
  }
  Object.assign(sheet, write.set ?? {});
  return sheet;
}

/** Undoes a step's contribution without applying a new one, for a skip. */
export function revertCreationWrite(
  target: Readonly<Record<string, unknown>>,
  previous: CreationWrite
): Record<string, unknown> {
  return applyCreationWrite(
    target,
    {
      join: (previous.join ?? []).map((entry) => ({ ...entry, lines: [] })),
      stow: (previous.stow ?? []).map((entry) => ({ ...entry, items: [] }))
    },
    previous
  );
}

function splitJoined(value: unknown, separator: string) {
  const text = typeof value === "string" ? value : "";
  if (!text) return [];
  return separator ? text.split(separator) : [text];
}

/** Removes one occurrence of each unwanted value, comparing by content. */
function withoutEach<T>(values: readonly T[], unwanted: readonly unknown[]) {
  const kept = [...values];
  for (const item of unwanted) {
    const index = kept.findIndex((candidate) => JSON.stringify(candidate) === JSON.stringify(item));
    if (index >= 0) kept.splice(index, 1);
  }
  return kept;
}

/* -------------------------------------------------------------------------- */
/* Checking a score assignment                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Whether what came back is something the step could actually have produced.
 *
 * The placing happens in the browser, over numbers the server rolled or printed,
 * so this is the only thing between the ledger and a fiction. It returns the
 * message to refuse with rather than a boolean, because every refusal here is
 * something the player is entitled to be told.
 */
export function refuseScoreAssignment(
  step: Pick<CreationRollScoresStep, "rearrange" | "array">,
  source: CreationScoreSource,
  rolled: readonly number[],
  assigned: readonly number[]
): string | undefined {
  if (assigned.some((value) => !Number.isInteger(value))) return "An assigned score must be a whole number.";

  if (source === "array") {
    const array = step.array;
    if (!array) return "This step has no array of numbers to take; roll its dice instead.";
    if (assigned.length !== array.values.length)
      return `This step assigns ${array.values.length} values, and ${assigned.length} came back.`;
    return sameMultiset(assigned, array.values)
      ? undefined
      : `An array assignment uses each of ${[...array.values].join(", ")} exactly once.`;
  }

  const rearrange = step.rearrange;
  if (!rearrange) return "This step's scores are placed in the order they were rolled.";
  if (assigned.length !== rolled.length)
    return `This step rolled ${rolled.length} scores, and ${assigned.length} came back.`;

  if (rearrange.kind === "substitute") {
    const changed = assigned.filter((value, index) => value !== rolled[index]);
    if (changed.some((value) => value !== rearrange.value))
      return `A substitution replaces a rolled score with ${rearrange.value} and leaves the rest where they fell.`;
    return changed.length <= rearrange.count
      ? undefined
      : `At most ${rearrange.count} of the rolled scores may be replaced with ${rearrange.value}.`;
  }

  if (!sameMultiset(assigned, rolled)) return "An assignment uses each of the rolled numbers exactly once.";
  return reachableBySwaps(rolled, assigned, rearrange.count)
    ? undefined
    : `That rearrangement takes more than ${rearrange.count} swaps.`;
}

function sameMultiset(left: readonly number[], right: readonly number[]) {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort((a, b) => a - b);
  const sortedRight = [...right].sort((a, b) => a - b);
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

/**
 * Whether one arrangement can be reached from another in at most `count` swaps.
 *
 * Searched rather than reasoned about. The minimum number of transpositions
 * between two arrangements of the same multiset stops being a formula the moment
 * two scores come up the same, and a breadth-first walk over three to six
 * numbers is both exact and instant. A `count` at or above one less than the
 * number of scores reaches every permutation, which is the cheap answer the
 * books mostly declare.
 */
function reachableBySwaps(from: readonly number[], to: readonly number[], count: number) {
  if (count >= from.length - 1) return true;
  // Six scores and two swaps — every rearrangement the three books in use offer
  // — is a few hundred arrangements. Past that the walk is abandoned and a
  // permutation of the rolled numbers is accepted, which is the weaker of the
  // two checks and never the stricter.
  if (count > 2 && from.length > 8) return true;

  const target = to.join(",");
  let frontier = [from.join(",")];
  const seen = new Set(frontier);
  if (frontier[0] === target) return true;
  for (let depth = 1; depth <= count; depth += 1) {
    const next: string[] = [];
    for (const state of frontier) {
      const values = state.split(",");
      for (let left = 0; left < values.length; left += 1)
        for (let right = left + 1; right < values.length; right += 1) {
          const swapped = [...values];
          [swapped[left], swapped[right]] = [swapped[right], swapped[left]];
          const key = swapped.join(",");
          if (key === target) return true;
          if (seen.has(key)) continue;
          seen.add(key);
          next.push(key);
        }
    }
    frontier = next;
  }
  return false;
}

/* -------------------------------------------------------------------------- */
/* The draft                                                                    */
/* -------------------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Reads a stored draft against the system as it is declared now.
 *
 * Tolerant on purpose. An install replaces a system in place, so a half-built
 * character can wake up under a declaration that has lost the step it was on. A
 * record naming a step the system no longer declares is dropped and the sheet
 * keeps whatever that step had already written, in the shape `effectiveRules`
 * drops a room's setting for a rule that no longer exists. A draft that is not
 * an object, or is for another system, or names no step this system has, is not
 * repaired: it is a plain sheet.
 */
export function readCreationDraft(system: SystemId, json: string | null | undefined): CreationDraft | undefined {
  const creation = systemOrThrow(system).characterCreation;
  if (!creation || !json) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || parsed.system !== system) return undefined;

  const declared = new Map(creationSteps(creation).map((step) => [step.id, step]));
  const stored = isRecord(parsed.steps) ? parsed.steps : {};
  const steps: Record<string, CreationStepRecord> = {};
  for (const [id, record] of Object.entries(stored))
    if (declared.has(id) && isRecord(record)) steps[id] = record as CreationStepRecord;

  const stepId = typeof parsed.stepId === "string" && declared.has(parsed.stepId) ? parsed.stepId : undefined;
  // A draft whose every step has gone is a finished character in every way that
  // matters, so it is dropped rather than resumed at a step nothing declares.
  if (!stepId && !Object.keys(steps).length) return undefined;
  const first = creation.steps.find((step) => !("automatic" in step && step.automatic)) ?? creation.steps[0];
  return { system, stepId: stepId ?? first.id, steps };
}

/** The totals a `fromStep` may read, which is every step that recorded one. */
export function creationTotals(draft: CreationDraft | undefined): Map<string, number> {
  const totals = new Map<string, number>();
  for (const [id, record] of Object.entries(draft?.steps ?? {}))
    if (typeof record.total === "number" && !record.skipped) totals.set(id, record.total);
  return totals;
}

/**
 * The steps a player can be on, in order.
 *
 * A save's nested steps are only steps at all once the save has been made and
 * landed on the outcome it branches on; before that they are a branch that did
 * not happen. Flattening them in unconditionally, the way the install checks
 * do, would put a screen in front of a player that the dice said nothing about.
 */
export function availableCreationSteps(
  definition: CharacterCreationDefinition,
  draft: CreationDraft | undefined
): CreationStep[] {
  return definition.steps
    .filter((step) => !("automatic" in step && step.automatic))
    .flatMap((step) => (step.kind === "save" && draft?.steps[step.id]?.save?.matched ? [step, ...step.then] : [step]));
}

/* -------------------------------------------------------------------------- */
/* The resolved definition a client is sent                                     */
/* -------------------------------------------------------------------------- */

/**
 * The declaration with the book folded into it: table names and dice for every
 * roll, the sections a packet offers with their prose and their gear. It rides
 * on the characters payload beside `sheetDefinition` and `itemCatalogue`, which
 * is where a client already looks for what its system offers.
 */
export function resolveCreationDefinition(system: SystemId): ResolvedCreationDefinition | null {
  const creation = systemOrThrow(system).characterCreation;
  if (!creation) return null;
  const markdown = systemMarkdown(system);
  const resolve = (step: CreationStep): ResolvedCreationStep => {
    if (step.kind === "roll-table") {
      const tables = new Map(compactTables(system, step.section).map((table) => [folded(table.name), table]));
      const named = step.tables.flatMap((entry) => [...(entry.table ? [entry.table] : []), ...(entry.firstOf ?? [])]);
      return {
        step,
        tables: named.flatMap((name) => {
          const table = tables.get(folded(name));
          return table ? [{ name: table.name, dice: table.dice, columns: table.columns }] : [];
        })
      };
    }
    if (step.kind === "packet")
      return { step, options: creationPacketOptions(markdown, compactTables(system, step.under), step) };
    if (step.kind === "save") return { step, then: step.then.map(resolve) };
    return { step };
  };
  return {
    label: creation.label,
    ...(creation.rulesQuery ? { rulesQuery: creation.rulesQuery } : {}),
    steps: creation.steps.filter((step) => !("automatic" in step && step.automatic)).map(resolve)
  };
}

/* -------------------------------------------------------------------------- */
/* Hirelings                                                                    */
/* -------------------------------------------------------------------------- */

type HirelingCreationRoll = NonNullable<NonNullable<GroupPageDefinition["hirelings"]>["creationRoll"]>;
export type HirelingCreationSource = { kind: "system"; system: SystemId } | { kind: "markdown"; markdown: string };

function choose<T>(values: readonly T[], random: () => number): T | undefined {
  return values[Math.min(values.length - 1, Math.floor(random() * values.length))];
}

/**
 * A hireling, rolled in one pass.
 *
 * The older, narrower shape of everything above: one atomic roll with no
 * choices, no ordering and no resumption, because a hireling is a supporting
 * character and a PC is not. What it does not need is a second way to roll a
 * table into a field, so its declaration is translated into the steps the engine
 * already performs and handed to them. The order the dice come out in is
 * unchanged, which is what keeps a hireling rolled today the same hireling that
 * would have been rolled yesterday from the same seed.
 */
export function rollHirelingCreation(
  definition: HirelingCreationRoll,
  source: HirelingCreationSource,
  random: () => number = Math.random,
  /** Where the starting weapon is stowed, so it can be drawn like any other. */
  weaponList?: string
) {
  const generated: Record<string, unknown> = {};

  for (const ability of definition.abilities) {
    const score = rollDice(ability.dice, random).total;
    generated[ability.currentKey] = score;
    generated[ability.maximumKey] = score;
  }

  const hp = rollDice(definition.hitProtection.dice, random).total;
  generated[definition.hitProtection.currentKey] = hp;
  generated[definition.hitProtection.maximumKey] = hp;
  // The weapon goes into the first slot rather than into a field of its own: a
  // hireling draws from what they are carrying, exactly as a character does.
  // It is not a `grant` step, because a `grant` resolves against a room's item
  // catalogue and a hireling rolled from plain Markdown has no room.
  if (weaponList) generated[weaponList] = [definition.weapon];
  else generated.weapon = definition.weapon;

  const finishing = definition.finishingTouches;
  if (!finishing) return generated;
  if (!finishing.firstNames.length)
    throw new Error(`The ${finishing.section} source has no first-name tables configured.`);

  const context: CreationRunContext = {
    // The system is only read for the sheet's field kinds and its save rules,
    // neither of which a hireling's two roll-table steps reach.
    system: source.kind === "system" ? source.system : "",
    sheet: {},
    tables: source,
    random
  };
  const step = (id: string, tables: CreationTableRoll[], joinInto: CreationJoin): CreationRollTableStep => ({
    id,
    kind: "roll-table",
    label: id,
    section: finishing.section,
    tables,
    joinInto
  });

  const name = performCreationStep(
    step("name", [{ firstOf: finishing.firstNames }, { table: finishing.lastName }], { field: "name", separator: " " }),
    context
  );
  const details = performCreationStep(
    step(
      "details",
      finishing.details.map((table) => ({ table })),
      { field: "details", separator: "\n", prefixWith: "table" }
    ),
    context
  );

  return applyCreationWrite(applyCreationWrite(generated, name.applied), details.applied);
}
