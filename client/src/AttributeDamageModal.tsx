import { useState } from "react";
import { Dices, X } from "lucide-react";
import { ArrowUpRight } from "lucide-react";
import type { AttributeDamageDefinition, ChatMessage, SystemId } from "@devils-toys/shared";
import { api } from "./api";
import type { EncounterCombatant } from "./EncounterPage";
import { headingSlug, rulesAnchorPath } from "./rules";
import { rollSave, saveSetupForScore } from "./save-roll";
import { StatStepper } from "./StatStepper";
import { useStatDrafts } from "./stat-drafts";

type Attribute = AttributeDamageDefinition["attributes"][number];

function numeric(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Where a score is kept depends on what the combatant is: a character's and a
 * hireling's on their sheet, an NPC's in its statblock.
 */
function scoreOf(combatant: EncounterCombatant, attribute: Attribute) {
  if (combatant.kind === "npc") {
    const current = attribute.statblockKey ? numeric(combatant.statblock?.[attribute.statblockKey]) : undefined;
    // A statblock states one number. What it said before anything was spent is
    // kept beside it once something is, and until then the two are the same.
    const recorded = attribute.statblockKey
      ? numeric(combatant.statblock?.[`${attribute.statblockKey}Max`])
      : undefined;
    return { current, maximum: recorded ?? current };
  }
  const sheet = combatant.kind === "character" ? combatant.character?.sheet : combatant.hireling;
  return { current: numeric(sheet?.[attribute.currentKey]), maximum: numeric(sheet?.[attribute.maximumKey]) };
}

/**
 * The dialog behind a combatant's zero-HP mark. Cairn and Monolith both send
 * damage past 0 HP into an attribute, and there is nowhere else in the rail to
 * spend one.
 */
export function AttributeDamageModal({
  roomId,
  encounterId,
  system,
  combatant,
  definition,
  onChanged,
  onRolled,
  onClose
}: {
  roomId: number;
  encounterId: number;
  /** The room's system, for pointing at the rule behind the mark. */
  system: SystemId;
  combatant: EncounterCombatant;
  definition: AttributeDamageDefinition;
  onChanged: () => void;
  /** Puts the roll in the room's log, as the dice builder's own rolls arrive. */
  onRolled: (message: ChatMessage) => void;
  onClose: () => void;
}) {
  const [error, setError] = useState("");
  const [rolling, setRolling] = useState(false);
  // The rail is not the chat pane, so the roll it just made is reported here too.
  const [outcome, setOutcome] = useState("");
  const scores = useStatDrafts({
    current: (id) => {
      const attribute = definition.attributes.find((candidate) => candidate.id === id);
      return attribute && scoreOf(combatant, attribute).current;
    },
    revision: combatant,
    write: (id, target) =>
      api(`/api/rooms/${roomId}/encounters/${encounterId}/combatants/${combatant.id}`, {
        method: "PATCH",
        body: JSON.stringify({ attributes: { [id]: target } })
      }).then(onChanged),
    onError: setError
  });

  const mark = definition.criticalDamage;

  function setCriticalDamage(marked: boolean) {
    return api(`/api/rooms/${roomId}/encounters/${encounterId}/combatants/${combatant.id}`, {
      method: "PATCH",
      body: JSON.stringify({ criticalDamage: marked })
    }).then(onChanged);
  }

  async function roll(attribute: Attribute, score: number) {
    const setup = saveSetupForScore(attribute.label, score);
    if (!setup || rolling) return;
    setRolling(true);
    setError("");
    try {
      const { message, roll: result } = await rollSave(roomId, setup);
      setOutcome(message.body);
      onRolled(message);
      // Failing the save this system names is what critical damage is, so the
      // mark is set here rather than left for someone to remember.
      if (mark?.attributeId === attribute.id && result.outcome?.passed === false) await setCriticalDamage(true);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setRolling(false);
    }
  }

  const rows = definition.attributes.flatMap((attribute) => {
    // Every PC and creature in these systems has all three scores, so one missing
    // from the sheet is a gap to fill rather than a score that does not exist —
    // except on a statblock the system gives no field for.
    if (combatant.kind === "npc" && !attribute.statblockKey) return [];
    const score = scoreOf(combatant, attribute);
    return [{ attribute, current: scores.draft(attribute.id) ?? score.current ?? 0, maximum: score.maximum }];
  });

  return (
    <div
      className="modal-scrim"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section className="modal attribute-damage" role="dialog" aria-modal="true" aria-label={`${definition.label}`}>
        <header>
          <p className="eyebrow">{definition.label}</p>
          <h2>{combatant.name}</h2>
          <button onClick={onClose} aria-label="Close">
            <X />
          </button>
        </header>
        <div className="attribute-damage-body">
          {definition.note && <p className="attribute-damage-note">{definition.note}</p>}
          {error && <p className="form-error">{error}</p>}
          {rows.length === 0 ? (
            <p className="attribute-damage-note">No attributes are recorded for {combatant.name}.</p>
          ) : (
            <dl className="attribute-damage-scores">
              {rows.map(({ attribute, current, maximum }) => (
                <div key={attribute.id}>
                  <dt>{attribute.label}</dt>
                  <dd>
                    <span>
                      {current}
                      {maximum !== undefined && `/${maximum}`}
                    </span>
                    <StatStepper
                      label={`${combatant.name}'s ${attribute.label}`}
                      value={current}
                      maximum={maximum}
                      onStep={(target) => scores.step(attribute.id, target)}
                    />
                    <button
                      className="attribute-damage-roll"
                      disabled={rolling || !saveSetupForScore(attribute.label, current)}
                      title={
                        saveSetupForScore(attribute.label, current)
                          ? `Roll ${attribute.label} save (target ${current})`
                          : `A ${attribute.label} save needs a score from 1 to 20`
                      }
                      aria-label={`Roll ${combatant.name}'s ${attribute.label} save at target ${current}`}
                      onClick={() => void roll(attribute, current)}
                    >
                      <Dices aria-hidden="true" />
                    </button>
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {mark && (
            <label className="attribute-damage-mark">
              <input
                type="checkbox"
                checked={combatant.criticalDamage === true}
                disabled={rolling}
                onChange={(event) =>
                  void setCriticalDamage(event.target.checked).catch((cause) => setError((cause as Error).message))
                }
              />
              <span>{mark.label}</span>
              <a
                className="group-rules-link"
                href={rulesAnchorPath(system, roomId, headingSlug(mark.label))}
                target="_blank"
                rel="noreferrer"
                title={`Open ${mark.label} in the rules`}
                onClick={(event) => event.stopPropagation()}
              >
                Rules <ArrowUpRight aria-hidden="true" />
              </a>
            </label>
          )}
          {outcome && <p className="attribute-damage-outcome">{outcome}</p>}
        </div>
      </section>
    </div>
  );
}
