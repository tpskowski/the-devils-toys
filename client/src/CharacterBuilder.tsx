import { useState } from "react";
import { createPortal } from "react-dom";
import { BookOpen, Check, Dices, Flag, SkipForward, X } from "lucide-react";
import type {
  CharacterItem,
  CharacterSheetDefinition,
  CreationDerivation,
  CreationDraft,
  CreationGearCandidate,
  CreationGrantStep,
  CreationPacketStep,
  CreationRollRecord,
  CreationRollScoresStep,
  CreationRollTableStep,
  CreationSaveStep,
  CreationScoreSource,
  CreationSetStep,
  CreationTextStep,
  ResolvedCreationDefinition,
  SystemId
} from "@devils-toys/shared";
import { CREATION_NAME_KEY } from "@devils-toys/shared";
import { api } from "./api";
import { InlineMarkdown } from "./InlineMarkdown";
import { ReadOnlyCharacterSheet, type ReadOnlyCharacter } from "./ReadOnlyCharacterSheet";
import { RulesMarkdown } from "./RulesMarkdown";
import { findRuleExcerpt } from "./rules";
import {
  builderSteps,
  currentStepIndex,
  describedCandidates,
  describeDerivation,
  plannedRolls,
  rearrangeWarning,
  seedArrangement,
  stepDecision,
  stepState,
  swapValues,
  takenCandidates,
  unfinishedSteps
} from "./character-builder";
import "./CharacterBuilder.css";

/**
 * The character builder: the book's own creation chapter, one step per screen.
 *
 * One step per screen is not a preference. The standing constraint is that a
 * player's workflows are phone-ready, and a five-row score table with a
 * rearrange interaction beside a sheet is not something a 375px screen can
 * hold. So the step is the page, the sheet being built sits beside it on a wide
 * screen and one tap away on a narrow one, and every screen carries Skip and
 * Finish — leaving early is a supported ending rather than an escape hatch.
 *
 * Nothing here rolls anything. Every die goes through
 * `POST …/creation/roll`, every arrangement of what the dice said is checked by
 * `PATCH …/creation`, and this draws what came back. Where a screen does
 * arithmetic of its own — counting the trades a rearrangement took — it is to
 * warn before a round trip, never to decide.
 */

export type BuilderCharacter = ReadOnlyCharacter & { creation: CreationDraft | null };

/**
 * A score screen the player has started arranging, against the step and the roll
 * it belongs to. Both are recorded so a reroll, or a move to another step,
 * abandons it rather than carrying numbers across.
 */
interface Placing {
  stepId: string;
  runs: number;
  source: CreationScoreSource;
  values: number[];
  /** The row waiting for a second tap to trade with. */
  picked?: number;
}

/** The wizard writes the sheet through the routes, so a screen only ever reads it. */
function sheetValue(sheet: Record<string, unknown>, key: string) {
  const value = sheet[key];
  if (value === true) return "yes";
  if (value === false) return "no";
  const text = String(value ?? "").trim();
  return text || "—";
}

export function CharacterBuilder<C extends BuilderCharacter>({
  roomId,
  system,
  character,
  definition,
  sheetDefinition,
  itemCatalogue,
  rulesMarkdown,
  onCharacter,
  onClose
}: {
  roomId: number;
  system: SystemId;
  character: C;
  definition: ResolvedCreationDefinition;
  sheetDefinition: CharacterSheetDefinition;
  /** The room's own gear, so a step naming catalogue ids can name them as the book does. */
  itemCatalogue: Readonly<Record<string, CharacterItem[]>>;
  /** The room's rules, already loaded by the sheet this opened from. */
  rulesMarkdown: string;
  onCharacter: (character: C) => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /** Narrow screens show one of the two panes at a time; wide ones show both. */
  const [showingSheet, setShowingSheet] = useState(false);
  const [placing, setPlacing] = useState<Placing>();
  const [filing, setFiling] = useState<{
    stepId: string;
    runs: number;
    inventory: string[];
    description: string[];
  }>();
  const [typing, setTyping] = useState<{ stepId: string; runs: number; value: string }>();
  const [portalHost] = useState<HTMLElement | null>(() =>
    typeof document === "undefined" ? null : (document.querySelector<HTMLElement>("main.workspace") ?? document.body)
  );

  const draft = character.creation;
  const steps = builderSteps(definition, draft);
  const index = currentStepIndex(steps, draft);
  const entry = steps[index];
  const step = entry.step;
  const record = draft?.steps[step.id];
  const runs = record?.runs ?? 0;

  /**
   * A declared item as the player will see it in the slot. Monolith's grant
   * names catalogue ids, and `monolith/glo-torch` is not what the book calls it
   * — the server resolves them on the way in, and this resolves them on the way
   * out so the screen offering the gear names the same thing the slot will.
   */
  function catalogueName(text: string) {
    for (const items of Object.values(itemCatalogue)) for (const item of items) if (item.id === text) return item.label;
    return text;
  }

  function labelFor(key: string) {
    if (key === CREATION_NAME_KEY) return "Name";
    for (const section of sheetDefinition.sections)
      for (const field of section.fields) if (field.key === key) return field.label;
    for (const list of sheetDefinition.lists) if (list.key === key) return list.label;
    return key;
  }

  const stepLabels = new Map(steps.map((candidate) => [candidate.step.id, candidate.step.label]));

  // What a screen holds before it is sent is worked out from the ledger, and
  // only replaced once the player has touched this step. Copying it into state
  // with an effect instead would draw the previous step's numbers under this
  // step's labels for a frame, because an effect runs after the paint — and a
  // reroll would leave the arrangement of dice that are no longer on the table.
  const placed = placing?.stepId === step.id && placing.runs === runs ? placing : undefined;
  const filed = filing?.stepId === step.id && filing.runs === runs ? filing : undefined;

  const source: CreationScoreSource = placed?.source ?? record?.source ?? "rolled";
  const arrangement =
    placed?.values ?? (step.kind === "roll-scores" ? seedArrangement(step, record, character.sheet, source) : []);
  const picked = placed?.picked;
  const inventoried = new Set(filed?.inventory ?? takenCandidates(record));
  const descriptionField =
    step.kind === "grant" ? step.describeInto?.field : step.kind === "roll-table" ? step.joinInto?.field : undefined;
  const described = new Set(filed?.description ?? describedCandidates(record, descriptionField));
  const joined =
    step.kind === "roll-table" && step.editable && step.joinInto
      ? record?.applied?.join
          ?.find((entry) => entry.field === step.joinInto?.field)
          ?.lines.join(step.joinInto.separator)
      : undefined;
  const typed =
    (typing?.stepId === step.id && typing.runs === runs ? typing.value : undefined) ??
    (step.kind === "text" ? (record?.chosen ?? String(character.sheet[step.field] ?? "")) : (joined ?? ""));

  const reviewedGearSteps = new Set(
    definition.steps.flatMap((candidate) =>
      candidate.step.kind === "grant" ? [...(candidate.step.reviewFrom ?? [])] : []
    )
  );

  const place = (changes: Partial<Omit<Placing, "stepId" | "runs">>) =>
    setPlacing({ stepId: step.id, runs, source, values: arrangement, ...changes });

  async function act(work: () => Promise<{ character: C }>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      onCharacter((await work()).character);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const creationPath = `/api/rooms/${roomId}/characters/${character.id}/creation`;

  const roll = (body: { stepId: string; choice?: string }) =>
    act(() => api<{ character: C }>(`${creationPath}/roll`, { method: "POST", body: JSON.stringify(body) }));

  const requestChange = (body: Record<string, unknown>) =>
    api<{ character: C }>(creationPath, { method: "PATCH", body: JSON.stringify(body) });

  const change = (body: Record<string, unknown>) => act(() => requestChange(body));

  const move = (to: number) => {
    const target = steps[Math.max(0, Math.min(steps.length - 1, to))];
    return target && change({ stepId: target.step.id });
  };

  function pendingChange() {
    const body: Record<string, unknown> = { stepId: step.id };
    if (step.kind === "roll-scores" && arrangement.length > 0 && (source === "array" || step.rearrange))
      Object.assign(body, source === "array" ? { array: arrangement } : { assign: arrangement });
    if (step.kind === "text" || (step.kind === "roll-table" && step.editable)) body.text = typed;
    if (record?.candidates?.length && !reviewedGearSteps.has(step.id)) {
      body.take = [...inventoried];
      if ((step.kind === "grant" && step.describeInto) || (step.kind === "roll-table" && step.joinInto))
        body.describe = [...described];
    }
    return Object.keys(body).length > 1 ? body : undefined;
  }

  function advance(to: number) {
    const target = steps[Math.max(0, Math.min(steps.length - 1, to))];
    if (!target) return;
    return act(async () => {
      const pending = pendingChange();
      if (pending) await requestChange(pending);
      return requestChange({ stepId: target.step.id });
    });
  }

  async function finish() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const pending = pendingChange();
      if (pending) await requestChange(pending);
      const result = await api<{ character: C }>(`${creationPath}/finish`, { method: "POST" });
      onCharacter(result.character);
      onClose();
    } catch (cause) {
      setError((cause as Error).message);
      setBusy(false);
    }
  }

  /* ------------------------------------------------------------------------ */
  /* The parts every kind shares                                               */
  /* ------------------------------------------------------------------------ */

  function renderRules(query: string | undefined) {
    if (!query) return null;
    const excerpt = findRuleExcerpt(rulesMarkdown, query);
    if (!excerpt) return null;
    return (
      <details className="cb-rules">
        <summary>
          <BookOpen size={14} aria-hidden="true" />
          <span>{query}</span>
        </summary>
        <div className="cb-rules-body markdown">
          <RulesMarkdown markdown={excerpt} idPrefix={`character-builder-${step.id}`} roomId={roomId} />
        </div>
      </details>
    );
  }

  function renderRolls(rolls: readonly CreationRollRecord[] | undefined) {
    if (!rolls?.length) return null;
    return (
      <ul className="cb-results">
        {rolls.map((roll, position) => (
          <li key={position}>
            <p className="cb-result-head">
              <strong>{roll.table ?? roll.label}</strong>
              <span>
                {roll.expression} · {roll.total}
                {roll.column ? ` · ${roll.column}` : ""}
                {roll.fromStep ? ` · read at the ${stepLabels.get(roll.fromStep) ?? roll.fromStep} roll` : ""}
              </span>
            </p>
            {roll.result && (
              <p className="cb-result-value">
                <InlineMarkdown>{roll.result}</InlineMarkdown>
              </p>
            )}
          </li>
        ))}
      </ul>
    );
  }

  /* ------------------------------------------------------------------------ */
  /* roll-scores                                                               */
  /* ------------------------------------------------------------------------ */

  function renderRollScores(scores: CreationRollScoresStep) {
    const rolled = (record?.scores ?? []).map((score) => score.total);
    const array = scores.array;
    const rearrange = scores.rearrange;
    const placeable = source === "array" || (Boolean(rearrange) && rolled.length > 0);
    const warning = source === "rolled" ? rearrangeWarning(rearrange, rolled, arrangement) : "";

    const pick = (position: number) => {
      if (picked === undefined) return place({ picked: position });
      if (picked === position) return place({ picked: undefined });
      place({ values: swapValues(arrangement, picked, position), picked: undefined });
    };

    const substitute = (position: number) => {
      if (rearrange?.kind !== "substitute") return;
      const value = arrangement[position] === rearrange.value ? rolled[position] : rearrange.value;
      place({ values: arrangement.map((current, at) => (at === position ? value : current)) });
    };

    const take = (next: CreationScoreSource) =>
      place({ source: next, values: seedArrangement(scores, record, character.sheet, next), picked: undefined });

    return (
      <>
        {array && (
          <div className="cb-source-picker" role="group" aria-label="How these scores are filled in">
            <button
              type="button"
              className={source === "rolled" ? "is-current" : ""}
              aria-pressed={source === "rolled"}
              onClick={() => take("rolled")}
            >
              Roll the dice
            </button>
            <button
              type="button"
              className={source === "array" ? "is-current" : ""}
              aria-pressed={source === "array"}
              onClick={() => take("array")}
            >
              {array.label ?? "Take the printed numbers"}
            </button>
          </div>
        )}

        {source === "rolled" ? (
          <p className="cb-note">
            {scores.scores.map((score) => `${score.label} ${score.dice}`).join(" · ")}
            {rearrange?.kind === "swap" && ` · swap any ${rearrange.count}`}
            {rearrange?.kind === "substitute" && ` · replace up to ${rearrange.count} with ${rearrange.value}`}
          </p>
        ) : (
          <p className="cb-note">
            {[...(array?.values ?? [])].join(" · ")} — taking these is choosing not to roll, and puts the dice away.
          </p>
        )}

        {source === "rolled" && (
          <div className="cb-actions">
            <button type="button" className="cb-roll" disabled={busy} onClick={() => roll({ stepId: step.id })}>
              <Dices size={15} aria-hidden="true" /> {rolled.length ? "Roll again" : "Roll"}
            </button>
          </div>
        )}

        {/* A step the book places in the order they fell has nothing to
            rearrange, so its numbers are only reported below rather than drawn
            twice as a set of buttons that do nothing. */}
        {placeable && arrangement.length > 0 && (
          <>
            {(source === "array" || rearrange?.kind === "swap") && (
              <p className="cb-hint">Tap one score, then another, to trade their numbers.</p>
            )}
            <ol className="cb-scores">
              {scores.scores.map((score, position) => (
                <li key={score.currentKey}>
                  <button
                    type="button"
                    className={`cb-score${picked === position ? " is-picked" : ""}`}
                    aria-pressed={picked === position}
                    disabled={busy || (source === "rolled" && rearrange?.kind === "substitute")}
                    onClick={() => pick(position)}
                  >
                    <span className="cb-score-label">{score.label}</span>
                    <span className="cb-score-value">{arrangement[position]}</span>
                  </button>
                  {rearrange?.kind === "substitute" && source === "rolled" && (
                    <button
                      type="button"
                      className="cb-score-substitute"
                      aria-pressed={arrangement[position] === rearrange.value}
                      disabled={busy}
                      onClick={() => substitute(position)}
                    >
                      {arrangement[position] === rearrange.value
                        ? `Rolled ${rolled[position]}`
                        : `Use ${rearrange.value}`}
                    </button>
                  )}
                </li>
              ))}
            </ol>
            {warning && <p className="cb-warning">{warning}</p>}
            <p className="cb-hint">Next writes this arrangement onto the sheet.</p>
          </>
        )}

        <dl className="cb-written">
          {scores.scores.map((score) => (
            <div key={score.currentKey}>
              <dt>{labelFor(score.currentKey)}</dt>
              <dd>{sheetValue(character.sheet, score.currentKey)}</dd>
            </div>
          ))}
        </dl>
      </>
    );
  }

  /* ------------------------------------------------------------------------ */
  /* roll-table                                                                */
  /* ------------------------------------------------------------------------ */

  function renderRollTable(rollTable: CreationRollTableStep) {
    return (
      <>
        {plannedRolls(rollTable.tables, entry.tables, definition, draft).map((planned) => (
          <p className="cb-note" key={planned.table}>
            {planned.table}
            {planned.columns.length > 0 && ` — ${planned.columns.join(", ")}`}
          </p>
        ))}
        <div className="cb-actions">
          <button type="button" className="cb-roll" disabled={busy} onClick={() => roll({ stepId: step.id })}>
            <Dices size={15} aria-hidden="true" /> {record?.rolled?.length ? "Roll again" : "Roll"}
          </button>
        </div>
        {renderRolls(record?.rolled)}
        {rollTable.editable && rollTable.joinInto && (
          <label className="cb-text">
            <span>{labelFor(rollTable.joinInto.field)}</span>
            {rollTable.editable.multiline ? (
              <textarea
                value={typed}
                placeholder={rollTable.editable.placeholder}
                disabled={busy}
                onChange={(event) => setTyping({ stepId: step.id, runs, value: event.target.value })}
              />
            ) : (
              <input
                value={typed}
                placeholder={rollTable.editable.placeholder}
                disabled={busy}
                onChange={(event) => setTyping({ stepId: step.id, runs, value: event.target.value })}
              />
            )}
            <small>Use the roll, edit it, or replace it. Next saves what is here.</small>
          </label>
        )}
        {/* A result a step offers into a list is drawn the way a packet's own
            bullets are, because it is the same offer: matched where the
            catalogue knows the name, and never in a slot until it is ticked. */}
        {record?.candidates?.length && !reviewedGearSteps.has(step.id) ? renderGear(record.candidates) : null}
      </>
    );
  }

  /* ------------------------------------------------------------------------ */
  /* packet                                                                    */
  /* ------------------------------------------------------------------------ */

  function renderGear(candidates: readonly CreationGearCandidate[]) {
    const matched = candidates.filter((candidate) => candidate.listKey);
    const unmatched = candidates.filter((candidate) => !candidate.listKey);
    const canDescribe =
      (step.kind === "grant" && Boolean(step.describeInto)) || (step.kind === "roll-table" && Boolean(step.joinInto));

    function file(text: string, destination: "description" | "inventory") {
      const nextInventory = new Set(inventoried);
      const nextDescription = new Set(described);
      nextInventory.delete(text);
      nextDescription.delete(text);
      if (destination === "inventory") nextInventory.add(text);
      else nextDescription.add(text);
      setFiling({
        stepId: step.id,
        runs,
        inventory: [...nextInventory],
        description: [...nextDescription]
      });
    }

    if (canDescribe)
      return (
        <section className="cb-gear" aria-label="File background results">
          <h4>{step.kind === "roll-table" ? "File this result" : "File background results"}</h4>
          <p className="cb-note">Choose where each result belongs. Next writes the choice to the sheet.</p>
          {candidates.map((candidate, position) => (
            <div className="cb-gear-choice" key={`${candidate.text}-${position}`}>
              <div className="cb-gear-copy">
                <span className="cb-gear-name">
                  <InlineMarkdown>{candidate.label ?? candidate.text}</InlineMarkdown>
                </span>
                {candidate.itemId && candidate.label !== candidate.text ? (
                  <small>The book calls it {candidate.text}</small>
                ) : null}
              </div>
              <div
                className="cb-gear-destinations"
                role="group"
                aria-label={`File ${candidate.label ?? candidate.text}`}
              >
                <button
                  type="button"
                  className={described.has(candidate.text) ? "is-current" : ""}
                  aria-pressed={described.has(candidate.text)}
                  disabled={busy}
                  onClick={() => file(candidate.text, "description")}
                >
                  Add to description
                </button>
                <button
                  type="button"
                  className={inventoried.has(candidate.text) ? "is-current" : ""}
                  aria-pressed={inventoried.has(candidate.text)}
                  disabled={busy || !candidate.listKey}
                  onClick={() => file(candidate.text, "inventory")}
                >
                  Add to slot
                </button>
              </div>
            </div>
          ))}
        </section>
      );

    return (
      <section className="cb-gear" aria-label="Starting gear">
        <h4>Review starting gear</h4>
        <p className="cb-note">Tick what belongs in your equipment. Next stows the selection.</p>
        {matched.map((candidate) => (
          <label className="cb-gear-row" key={candidate.text}>
            <input
              type="checkbox"
              checked={inventoried.has(candidate.text)}
              disabled={busy}
              onChange={(event) => {
                const next = new Set(inventoried);
                if (event.target.checked) next.add(candidate.text);
                else next.delete(candidate.text);
                setFiling({ stepId: step.id, runs, inventory: [...next], description: [...described] });
              }}
            />
            <span className="cb-gear-copy">
              <span className="cb-gear-name">
                <InlineMarkdown>{candidate.label ?? candidate.text}</InlineMarkdown>
              </span>
              {/* A slot holds a plain string either way, so a line the catalogue
                  never heard of is still worth taking — it says so rather than
                  looking like an entry that resolved. */}
              {candidate.itemId ? (
                candidate.label !== candidate.text && <small>The book calls it {candidate.text}</small>
              ) : (
                <small>Not in the catalogue; it goes into the slot in the book's own words.</small>
              )}
            </span>
          </label>
        ))}
        {unmatched.map((candidate) => (
          <p className="cb-gear-loose" key={candidate.text}>
            <span className="cb-gear-name">
              <InlineMarkdown>{candidate.text}</InlineMarkdown>
            </span>
            <small>
              Nothing in the catalogue matches this and the step names no list, so file it in a slot in your own words.
            </small>
          </p>
        ))}
      </section>
    );
  }

  function renderPacket(packet: CreationPacketStep) {
    return (
      <>
        {packet.dice && (
          <div className="cb-actions">
            <button type="button" className="cb-roll" disabled={busy} onClick={() => roll({ stepId: step.id })}>
              <Dices size={15} aria-hidden="true" />{" "}
              {record?.chosen ? `Roll ${packet.dice} again` : `Roll ${packet.dice}`}
            </button>
          </div>
        )}
        <ul className="cb-options">
          {(entry.options ?? []).map((option) => {
            const current = record?.chosen === option.name;
            return (
              <li className={current ? "is-current" : ""} key={option.name}>
                <div className="cb-option-head">
                  <strong>{option.name}</strong>
                  <button type="button" disabled={busy} onClick={() => roll({ stepId: step.id, choice: option.name })}>
                    {current
                      ? packet.rollTablesUnder === false
                        ? "Choose again"
                        : "Roll its tables again"
                      : "Take this one"}
                  </button>
                </div>
                {option.prose && (
                  <p className="cb-option-prose">
                    <InlineMarkdown>{option.prose}</InlineMarkdown>
                  </p>
                )}
                {option.tables.length > 0 && (
                  <p className="cb-option-tables">{option.tables.map((table) => table.name).join(" · ")}</p>
                )}
                {option.gear.length > 0 && (
                  <p className="cb-option-gear">
                    <InlineMarkdown>{option.gear.join(", ")}</InlineMarkdown>
                  </p>
                )}
              </li>
            );
          })}
        </ul>
        {renderRolls(record?.rolled)}
        {record?.candidates?.length && !reviewedGearSteps.has(step.id) ? renderGear(record.candidates) : null}
      </>
    );
  }

  /* ------------------------------------------------------------------------ */
  /* The plain kinds                                                           */
  /* ------------------------------------------------------------------------ */

  function renderGrant(grant: CreationGrantStep) {
    return (
      <>
        {grant.items?.length ? <p className="cb-note">{grant.items.map(catalogueName).join(" · ")}</p> : null}
        {grant.roll?.length ? (
          <p className="cb-note">{grant.roll.map((money) => `${money.label} ${money.dice}`).join(" · ")}</p>
        ) : null}
        <div className="cb-actions">
          <button type="button" className="cb-roll" disabled={busy} onClick={() => roll({ stepId: step.id })}>
            <Dices size={15} aria-hidden="true" /> {record?.runs ? "Take it again" : "Take it"}
          </button>
        </div>
        {record?.applied?.stow?.length ? (
          <ul className="cb-stowed">
            {record.applied.stow.flatMap((entry) =>
              entry.items.map((item, position) => <li key={`${entry.key}-${position}`}>{String(item)}</li>)
            )}
          </ul>
        ) : null}
        {renderRolls(record?.rolled)}
        {record?.candidates?.length ? renderGear(record.candidates) : null}
      </>
    );
  }

  function renderSave(save: CreationSaveStep) {
    const outcome = record?.save;
    return (
      <>
        <p className="cb-note">
          {save.type} save against {labelFor(save.key)}, which reads {sheetValue(character.sheet, save.key)}.
        </p>
        <div className="cb-actions">
          <button type="button" className="cb-roll" disabled={busy} onClick={() => roll({ stepId: step.id })}>
            <Dices size={15} aria-hidden="true" /> {outcome ? `Roll ${save.type} save again` : `Roll ${save.type} save`}
          </button>
        </div>
        {outcome && (
          <div className="cb-save">
            <p className="cb-save-outcome">{outcome.label}</p>
            <p className="cb-note">
              Rolled {outcome.roll} against {outcome.target}.
            </p>
            <p className="cb-note">
              {outcome.matched ? "The failed save opens the table below." : "Nothing follows from this one."}
            </p>
          </div>
        )}
        {outcome?.matched &&
          (entry.then ?? [])
            .filter((nested) => nested.step.kind === "roll-table")
            .map((nested) => {
              const nestedStep = nested.step as CreationRollTableStep;
              const nestedRecord = draft?.steps[nestedStep.id];
              return (
                <section className="cb-save-followup" key={nestedStep.id}>
                  <h4>{nestedStep.label}</h4>
                  {plannedRolls(nestedStep.tables, nested.tables, definition, draft).map((planned) => (
                    <p className="cb-note" key={planned.table}>
                      {planned.table}
                      {planned.columns.length > 0 && ` — ${planned.columns.join(", ")}`}
                    </p>
                  ))}
                  <div className="cb-actions">
                    <button
                      type="button"
                      className="cb-roll"
                      disabled={busy}
                      onClick={() => roll({ stepId: nestedStep.id })}
                    >
                      <Dices size={15} aria-hidden="true" />{" "}
                      {nestedRecord?.runs
                        ? `Roll ${nestedStep.label.toLocaleLowerCase()} again`
                        : `Roll ${nestedStep.label.toLocaleLowerCase()}`}
                    </button>
                  </div>
                  {renderRolls(nestedRecord?.rolled)}
                </section>
              );
            })}
      </>
    );
  }

  function renderDerive(derivations: readonly CreationDerivation[]) {
    return (
      <>
        <ul className="cb-plain">
          {derivations.map((derivation) => (
            <li key={derivation.key}>
              <strong>{labelFor(derivation.key)}</strong>
              <span>{describeDerivation(derivation, labelFor)}</span>
            </li>
          ))}
        </ul>
        <div className="cb-actions">
          <button type="button" className="cb-primary" disabled={busy} onClick={() => roll({ stepId: step.id })}>
            <Check size={15} aria-hidden="true" /> {record?.runs ? "Work them out again" : "Work them out"}
          </button>
        </div>
        <dl className="cb-written">
          {derivations.map((derivation) => (
            <div key={derivation.key}>
              <dt>{labelFor(derivation.key)}</dt>
              <dd>{sheetValue(character.sheet, derivation.key)}</dd>
            </div>
          ))}
        </dl>
      </>
    );
  }

  function renderSet(setStep: CreationSetStep) {
    return (
      <>
        <ul className="cb-plain">
          {Object.entries(setStep.values).map(([key, value]) => (
            <li key={key}>
              <strong>{labelFor(key)}</strong>
              <span>{value === true ? "yes" : value === false ? "no" : String(value)}</span>
            </li>
          ))}
        </ul>
        <div className="cb-actions">
          <button type="button" className="cb-primary" disabled={busy} onClick={() => roll({ stepId: step.id })}>
            <Check size={15} aria-hidden="true" /> {record?.runs ? "Write them again" : "Write them in"}
          </button>
        </div>
      </>
    );
  }

  function renderText(textStep: CreationTextStep) {
    return (
      <>
        <label className="cb-text">
          <span>{labelFor(textStep.field)}</span>
          {textStep.multiline ? (
            <textarea
              value={typed}
              placeholder={textStep.placeholder}
              disabled={busy}
              onChange={(event) => setTyping({ stepId: step.id, runs, value: event.target.value })}
            />
          ) : (
            <input
              value={typed}
              placeholder={textStep.placeholder}
              disabled={busy}
              onChange={(event) => setTyping({ stepId: step.id, runs, value: event.target.value })}
            />
          )}
        </label>
        <p className="cb-hint">Next writes this onto the sheet.</p>
      </>
    );
  }

  function renderStep() {
    switch (step.kind) {
      case "roll-scores":
        return renderRollScores(step);
      case "roll-table":
        return renderRollTable(step);
      case "packet":
        return renderPacket(step);
      case "grant":
        return renderGrant(step);
      case "save":
        return renderSave(step);
      case "derive":
        return renderDerive(step.derive);
      case "set":
        return renderSet(step);
      case "text":
        return renderText(step);
      case "rules":
        return null;
    }
  }

  const remaining = unfinishedSteps(steps, draft).length;

  return createPortal(
    <div
      className="modal-scrim"
      role="presentation"
      onMouseDown={(event) => {
        // Closing loses nothing: the draft is the server's, and the sheet the
        // wizard opened from offers to carry on with it.
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        className="modal modal-wide character-builder"
        role="dialog"
        aria-modal="true"
        aria-label={definition.label}
      >
        <header>
          <p className="eyebrow">{character.name}</p>
          <h2>{definition.label}</h2>
          <button type="button" onClick={onClose} aria-label="Close" disabled={busy}>
            <X />
          </button>
        </header>

        {error && <p className="form-error cb-error">{error}</p>}

        <div className={`cb-workspace${showingSheet ? " showing-sheet" : ""}`}>
          <div className="cb-main">
            <div className="cb-progress">
              <p>
                Step {index + 1} of {steps.length}
              </p>
              <div className="cb-progress-bar" aria-hidden="true">
                <span style={{ width: `${((index + 1) / steps.length) * 100}%` }} />
              </div>
              <button type="button" className="cb-pane-toggle" onClick={() => setShowingSheet(true)}>
                The sheet so far
              </button>
            </div>

            <article className="cb-step">
              <h3>
                {step.label}
                {step.optional && <em>the book calls this one optional</em>}
              </h3>
              {step.hint && <p className="cb-step-hint">{step.hint}</p>}
              {renderRules(step.rulesQuery ?? definition.rulesQuery)}
              {record?.skipped && <p className="cb-warning">This step is marked as passed over.</p>}
              {renderStep()}
            </article>

            <footer className="cb-nav">
              <button type="button" disabled={busy || index === 0} onClick={() => move(index - 1)}>
                Back
              </button>
              <button type="button" disabled={busy} onClick={() => change({ stepId: step.id, skip: !record?.skipped })}>
                <SkipForward size={15} aria-hidden="true" /> {record?.skipped ? "Stop skipping" : "Skip"}
              </button>
              <button
                type="button"
                className="cb-primary"
                disabled={busy || index === steps.length - 1}
                onClick={() => advance(index + 1)}
              >
                Next
              </button>
              <button type="button" className="cb-finish" disabled={busy} onClick={() => void finish()}>
                <Flag size={15} aria-hidden="true" /> Finish
              </button>
              {remaining > 0 && (
                <p className="cb-nav-note">
                  {remaining} {remaining === 1 ? "step is" : "steps are"} still untouched. Finishing keeps what the
                  sheet already has; its own warnings say what is missing.
                </p>
              )}
            </footer>
          </div>

          <aside className="cb-aside" aria-label="What has been decided">
            <button type="button" className="cb-pane-toggle cb-pane-back" onClick={() => setShowingSheet(false)}>
              Back to the step
            </button>
            <ol className="cb-summary">
              {steps.map((candidate, position) => {
                const state = stepState(draft?.steps[candidate.step.id]);
                const decided = stepDecision(candidate, draft?.steps[candidate.step.id], labelFor);
                return (
                  <li key={candidate.step.id}>
                    <button
                      type="button"
                      className={`cb-summary-row is-${state}${position === index ? " is-current" : ""}`}
                      disabled={busy}
                      aria-current={position === index ? "step" : undefined}
                      onClick={() => move(position)}
                    >
                      <span className="cb-summary-label">{candidate.step.label}</span>
                      <span className="cb-summary-value">
                        <InlineMarkdown>{decided || (state === "waiting" ? "—" : "")}</InlineMarkdown>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
            <div className="cb-sheet">
              <ReadOnlyCharacterSheet character={character} definition={sheetDefinition} system={system} />
            </div>
          </aside>
        </div>
      </section>
    </div>,
    portalHost ?? document.body
  );
}
