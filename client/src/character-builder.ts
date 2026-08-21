import type {
  CreationDerivation,
  CreationDraft,
  CreationRearrange,
  CreationRollScoresStep,
  CreationRollTableStep,
  CreationScoreSource,
  CreationStepRecord,
  CreationTableRoll,
  CreationWrite,
  ResolvedCreationDefinition,
  ResolvedCreationStep
} from "@devils-toys/shared";
import { creationEntryFrom } from "@devils-toys/shared";
import { singularLabel } from "./character-entries";

/**
 * What the wizard reads, and the small amount of arithmetic it does before it
 * asks the server.
 *
 * The engine is `server/src/character-creation.ts` and it stays the authority:
 * every die is thrown there, and every arrangement of what the dice said is
 * checked there. What is here is the part a screen needs and a route does not —
 * which step a player is on, what each finished step should say in a summary,
 * and how tapping two scores turns into an assignment worth sending.
 *
 * The payload shapes come from `shared/src/system-creation.ts`, beside the step
 * kinds they describe. They ride on a route this reads, so they belong where
 * both ends of it can see them.
 */

/**
 * The steps a player can be on, in order.
 *
 * A save's branch is only a screen once the save has landed on the outcome the
 * step branches on. Showing it before that would put a page in front of a
 * player that the dice have said nothing about, and the roll route refuses it
 * anyway — `availableCreationSteps` is the same rule on the server, and the two
 * have to agree or Next walks into a 400.
 */
export function builderSteps(
  definition: ResolvedCreationDefinition,
  draft: CreationDraft | null | undefined
): ResolvedCreationStep[] {
  return definition.steps.flatMap((entry) =>
    entry.step.kind === "save" && draft?.steps[entry.step.id]?.save?.matched
      ? [entry, ...(entry.then ?? []).filter((nested) => nested.step.kind !== "roll-table")]
      : [entry]
  );
}

/**
 * Where the wizard is, falling back to the first step for a build that has not
 * started.
 *
 * A save's table roll lives inside the save's screen. The server still records
 * that nested step as the draft's current step when it is rolled, so map it
 * back to its open parent instead of treating its id as a vanished screen.
 */
export function currentStepIndex(steps: readonly ResolvedCreationStep[], draft: CreationDraft | null | undefined) {
  const at = steps.findIndex(
    (entry) =>
      entry.step.id === draft?.stepId ||
      (entry.step.kind === "save" &&
        Boolean(draft?.steps[entry.step.id]?.save?.matched) &&
        Boolean(entry.then?.some((nested) => nested.step.kind === "roll-table" && nested.step.id === draft?.stepId)))
  );
  return at < 0 ? 0 : at;
}

/** Whether a step has run, been passed over, or is still waiting. */
export function stepState(record: CreationStepRecord | undefined): "done" | "skipped" | "waiting" {
  if (record?.skipped) return "skipped";
  return record?.runs || record?.chosen !== undefined || record?.applied ? "done" : "waiting";
}

/**
 * The steps nothing has been done to yet.
 *
 * It is a count beside Finish and never a condition on it. Decision 8 is that
 * the wizard can be left at any point and that a half-built character is an
 * ordinary unfinished one — what says so is the sheet's own warnings, not a
 * button that refuses to end.
 */
export function unfinishedSteps(
  steps: readonly ResolvedCreationStep[],
  draft: CreationDraft | null | undefined
): ResolvedCreationStep[] {
  return steps.filter((entry) => stepState(draft?.steps[entry.step.id]) === "waiting");
}

function values(write: CreationWrite | undefined) {
  return Object.entries(write?.set ?? {});
}

/**
 * The one line a finished step contributes to the running summary.
 *
 * Read from the ledger rather than from the sheet, because two steps may share
 * a field: Monolith's background and its finishing touches both write into
 * `details`, and a summary built from the sheet would credit each of them with
 * everything the other wrote.
 */
export function stepDecision(
  entry: ResolvedCreationStep,
  record: CreationStepRecord | undefined,
  labelFor: (key: string) => string
): string {
  if (!record) return "";
  if (record.skipped) return "Skipped";
  const step = entry.step;
  switch (step.kind) {
    case "roll-scores": {
      const placed = values(record.applied);
      if (placed.length)
        return step.scores
          .map((score) => `${score.label} ${String(record.applied?.set?.[score.currentKey] ?? "—")}`)
          .join(" · ");
      return (record.scores ?? []).map((score) => score.total).join(", ");
    }
    case "roll-table":
      return record.chosen ?? (record.rolled ?? []).map((roll) => roll.result ?? String(roll.total)).join(" · ");
    case "packet":
      return record.chosen ?? "";
    case "grant": {
      const stowed = (record.applied?.stow ?? []).flatMap((entry) => entry.items).length;
      const rolled = values(record.applied)
        .map(([key, value]) => `${labelFor(key)} ${String(value)}`)
        .join(" · ");
      return [stowed ? `${stowed} ${stowed === 1 ? "item" : "items"}` : "", rolled].filter(Boolean).join(" · ");
    }
    case "save":
      return record.save ? `${record.save.roll} vs ${record.save.target} — ${record.save.label}` : "";
    case "derive":
    case "set":
      return values(record.applied)
        .map(([key, value]) => `${labelFor(key)} ${value === true ? "yes" : value === false ? "no" : String(value)}`)
        .join(" · ");
    case "text":
      return record.chosen ?? "";
    case "rules":
      return record.runs ? "Read" : "";
  }
}

/* -------------------------------------------------------------------------- */
/* What a step is about to roll                                                */
/* -------------------------------------------------------------------------- */

/** Names in a book are matched however they were cased or spaced, as the engine matches them. */
const folded = (value: string | undefined) => (value ?? "").trim().toLocaleLowerCase();

/**
 * What a `roll-table` step is about to roll, as one line per table.
 *
 * Grouped by table rather than listed per roll, because a step that reads ten
 * columns of one table declares ten entries against the same name and would
 * otherwise announce it ten times. The die is left off where the book has
 * already put it in the table's own name, which Cairn does throughout.
 *
 * A `columnFirstOf` is announced as the choice it is rather than as one of its
 * columns, since which one it lands on is the server's to decide and is only
 * known once it has.
 */
export function plannedRolls(
  declared: readonly CreationTableRoll[],
  resolved?: readonly { name: string; dice: string; columns: readonly string[] }[],
  definition?: ResolvedCreationDefinition,
  draft?: CreationDraft | null,
  chosenTable?: string
): { table: string; columns: string[] }[] {
  const lines = new Map<string, string[]>();
  for (const entry of declared) {
    const packet = entry.fromPacket
      ? definition?.steps.find((candidate) => candidate.step.id === entry.fromPacket)
      : undefined;
    const chosen = entry.fromPacket ? draft?.steps[entry.fromPacket]?.chosen : undefined;
    const packetPosition = entry.fromPacket ? entry.position : undefined;
    const dynamic =
      packetPosition === undefined
        ? undefined
        : packet?.options?.find((option) => folded(option.name) === folded(chosen))?.tables[packetPosition - 1];
    const names = dynamic
      ? [dynamic.name]
      : entry.fromPacket
        ? [`Table ${packetPosition} from ${packet?.step.label ?? entry.fromPacket}`]
        : // A `choose` has already been decided by the time this is drawn, so it
          // announces the one table the player picked rather than the three the
          // step could have rolled.
          entry.choose && chosenTable
          ? [chosenTable]
          : [...(entry.table ? [entry.table] : []), ...(entry.firstOf ?? [])];
    const found =
      dynamic ?? resolved?.find((candidate) => names.some((name) => folded(name) === folded(candidate.name)));
    const die = found && !new RegExp(`\\(${found.dice}\\)\\s*$`, "i").test(names[0] ?? "") ? ` (${found.dice})` : "";
    const table = `${names.join(" or ")}${die}`;
    const column = entry.columnFirstOf ? [entry.columnFirstOf.join(" or ")] : entry.column ? [entry.column] : [];
    lines.set(table, [...(lines.get(table) ?? []), ...column]);
  }
  return [...lines].map(([table, columns]) => ({ table, columns }));
}

/**
 * The tables a step hands the player the choice between, and which one it last
 * rolled on.
 *
 * One entry at most: a step's roll carries one choice, which the install
 * refuses more than one of. The rolled name is read back off the ledger rather
 * than kept in the screen's own state, so a build resumed on another device
 * opens on the table the last roll actually used.
 */
export function tableChoice(
  step: CreationRollTableStep,
  record: CreationStepRecord | undefined
): { options: readonly string[]; rolled?: string } | undefined {
  const entry = step.tables.find((table) => table.choose && table.firstOf?.length);
  const options = entry?.firstOf;
  if (!options) return undefined;
  const rolled = (record?.rolled ?? []).find((roll) =>
    options.some((name) => folded(name) === folded(roll.table))
  )?.table;
  return { options, ...(rolled ? { rolled } : {}) };
}

/**
 * A table's name as the roll button says it: "Male Names" becomes "male name",
 * so the button reads "Roll male name" and a player can see which of the three
 * they are about to throw a die on.
 */
export function tableChoiceLabel(name: string) {
  return singularLabel(name.replace(/\s*\([^)]*\)\s*$/, "").trim()).toLocaleLowerCase();
}

/* -------------------------------------------------------------------------- */
/* Rearranging what the dice said                                              */
/* -------------------------------------------------------------------------- */

/** Two scores traded, which is the whole of the swap interaction. */
export function swapValues(current: readonly number[], from: number, to: number) {
  const next = [...current];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

function sameMultiset(left: readonly number[], right: readonly number[]) {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort((a, b) => a - b);
  const sortedRight = [...right].sort((a, b) => a - b);
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

/**
 * How many trades the arrangement on screen is away from the order the dice fell
 * in, or -1 where it is not a rearrangement of them at all.
 *
 * Searched rather than counted, for the reason the server searches: the moment
 * two scores come up the same, the minimum number of transpositions between two
 * arrangements stops being a formula. Every permutation of n numbers is reachable
 * in n-1 trades, so the walk is bounded by that and always terminates.
 */
export function swapsUsed(rolled: readonly number[], assigned: readonly number[]) {
  if (!sameMultiset(rolled, assigned)) return -1;
  const target = assigned.join(",");
  let frontier = [rolled.join(",")];
  if (frontier[0] === target) return 0;
  const seen = new Set(frontier);
  for (let depth = 1; depth < rolled.length; depth += 1) {
    const next: string[] = [];
    for (const state of frontier) {
      const parts = state.split(",");
      for (let left = 0; left < parts.length; left += 1)
        for (let right = left + 1; right < parts.length; right += 1) {
          const swapped = swapValues(parts.map(Number), left, right).join(",");
          if (swapped === target) return depth;
          if (seen.has(swapped)) continue;
          seen.add(swapped);
          next.push(swapped);
        }
    }
    frontier = next;
  }
  return rolled.length - 1;
}

/** How many of the rolled scores have been replaced with the value the book offers. */
export function substitutionsUsed(rolled: readonly number[], assigned: readonly number[]) {
  return assigned.filter((value, index) => value !== rolled[index]).length;
}

/**
 * The numbers a score screen opens on.
 *
 * On the rolled path that is what the dice said, in the order they said it. On
 * the array path there are no dice to read: taking the array puts them away, so
 * a resumed screen recovers its arrangement from the scores on the sheet where
 * those are the printed numbers, and falls back to the book's own order where
 * they are not.
 */
export function seedArrangement(
  step: CreationRollScoresStep,
  record: CreationStepRecord | undefined,
  sheet: Readonly<Record<string, unknown>>,
  source: CreationScoreSource
): number[] {
  if (source !== "array") return (record?.scores ?? []).map((score) => score.total);
  const printed = [...(step.array?.values ?? [])];
  const onSheet = step.scores.map((score) => Number(sheet[score.currentKey]));
  return onSheet.every(Number.isFinite) && sameMultiset(onSheet, printed) ? onSheet : printed;
}

/**
 * What to say about an arrangement before it is sent, where the book's own limit
 * has been passed.
 *
 * A warning rather than a bar: the standing constraint is to warn rather than to
 * refuse, and the server is the check either way. What this buys is that a
 * player is told which trade was the one too many while they can still undo it,
 * rather than after a round trip.
 */
export function rearrangeWarning(
  rearrange: CreationRearrange | undefined,
  rolled: readonly number[],
  assigned: readonly number[]
): string {
  if (!rearrange) return "";
  if (rearrange.kind === "substitute") {
    const used = substitutionsUsed(rolled, assigned);
    return used > rearrange.count
      ? `The book replaces at most ${rearrange.count} of these with ${rearrange.value}, and ${used} have been.`
      : "";
  }
  const used = swapsUsed(rolled, assigned);
  return used > rearrange.count ? `The book allows ${rearrange.count} swaps, and this arrangement takes ${used}.` : "";
}

/* -------------------------------------------------------------------------- */
/* Derivations, in words                                                       */
/* -------------------------------------------------------------------------- */

/**
 * One derivation as a sentence, so a player knows what a step is about to work
 * out before it does. The five operations do not compose, which is what makes
 * this a lookup table rather than a printer for an expression.
 */
export function describeDerivation(derivation: CreationDerivation, labelFor: (key: string) => string) {
  const from = (derivation.from ?? []).map(labelFor);
  const chosen = derivation.pick === "highest" ? "better" : derivation.pick === "lowest" ? "worse" : "total";
  const of = from.length > 1 ? `the ${chosen} of ${from.join(" and ")}` : (from[0] ?? "nothing");
  switch (derivation.op) {
    case "copy":
      return `copied from ${from[0] ?? "nothing"}`;
    case "constant":
      return `always ${derivation.value ?? 0}`;
    case "sum":
      return from.length > 1 ? `the ${chosen} of ${from.join(", ")}` : `the same as ${of}`;
    case "difference":
      return `${derivation.value ?? 0} minus ${of}`;
    case "lookup":
      return `read off the book's ladder against ${of}`;
    case "equipment-armor":
      return `read from the armor in ${from[0] ?? "equipment"}`;
  }
}

/* -------------------------------------------------------------------------- */
/* A packet's gear                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Which of a packet's gear lines are already in a slot.
 *
 * The ledger records what a step stowed rather than which bullet it came from,
 * so a candidate is matched by the words that went in — the catalogue's spelling
 * where it matched one, and the book's own where it did not. That is the same
 * pairing `takeCandidates` makes on the server, read back the other way.
 */
export function takenCandidates(record: CreationStepRecord | undefined): string[] {
  const stowed = new Set((record?.applied?.stow ?? []).flatMap((entry) => entry.items.map((item) => String(item))));
  return (record?.candidates ?? [])
    .filter((candidate) => stowed.has(candidate.label ?? candidate.text))
    .map((candidate) => candidate.text);
}

/** Which offered lines this review already filed in its configured prose field. */
export function describedCandidates(record: CreationStepRecord | undefined, field: string | undefined): string[] {
  if (!field) return [];
  const described = new Set(
    (record?.applied?.join ?? []).filter((entry) => entry.field === field).flatMap((entry) => entry.lines)
  );
  return (record?.candidates ?? [])
    .filter((candidate) => described.has(candidate.description ?? candidate.text))
    .map((candidate) => candidate.text);
}

/**
 * Which offered lines this review already filed in the sheet's `entries` field.
 *
 * Read back through the same parse that wrote them, for the reason
 * `takenCandidates` reads back through the catalogue's spelling: the ledger
 * records what went on the sheet rather than which bullet it came from, and the
 * title and body are the only handle there is on which one that was.
 */
export function enteredCandidates(record: CreationStepRecord | undefined, field: string | undefined): string[] {
  if (!field) return [];
  const stowed = new Set(
    (record?.applied?.stow ?? [])
      .filter((entry) => entry.key === field)
      .flatMap((entry) => entry.items.map((item) => JSON.stringify(item)))
  );
  return (record?.candidates ?? [])
    .filter((candidate) => stowed.has(JSON.stringify(creationEntryFrom(candidate.text))))
    .map((candidate) => candidate.text);
}
