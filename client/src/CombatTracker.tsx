import { useState } from "react";
import { Dices, Eraser, Shield } from "lucide-react";
import type { ChatMessage, ItemTrait, RoomRole } from "@devils-toys/shared";
import { api } from "./api";
import { AttributeDamageModal } from "./AttributeDamageModal";
import { canEditCharacter, canRollAttack } from "./character-permissions";
import { CombatantAvatar } from "./CombatantAvatar";
import type { EncounterCombatant, EncounterRecord } from "./EncounterPage";
import { StatStepper } from "./StatStepper";
import { WeaponMark } from "./WeaponMark";
import { rollableDamage, rollWeapon } from "./weapon-roll";
import { useStatDrafts } from "./stat-drafts";

/**
 * The initiative rail. Every shipped system is side-based, so combatants are
 * always grouped by side; what differs is how side order is decided — fixed for
 * Cairn and Monolith, rolled for CWN — and CWN alone offers an individual variant.
 */
export function CombatTracker({
  roomId,
  encounter,
  viewer,
  onInspect,
  onRolled,
  traits,
  onChanged
}: {
  roomId: number;
  /** Chosen by the rail's combat tab, which is where encounters are switched. */
  encounter?: EncounterRecord;
  /** Who is looking, which decides whose hit points they may step. */
  viewer: { accountId: number; role: RoomRole };
  onInspect: (combatant: EncounterCombatant) => void;
  /** Notes a save rolled from the attribute dialog in the room's log. */
  onRolled: (message: ChatMessage) => void;
  /** What this system's weapon words mean, for the marks in the rows. */
  traits: readonly ItemTrait[];
  onChanged: () => void;
}) {
  const isGm = viewer.role === "gm";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // The combatant whose attributes are open, held by id so the dialog reads the
  // room's latest figures rather than the ones the row was clicked with.
  const [spending, setSpending] = useState<number>();

  /**
   * The GM steps anyone in the fight; a player steps the characters they own, and
   * the server settles that with the rule the character sheet itself uses. NPC hit
   * points are written to the combatant, a character's or hireling's through to
   * their sheet.
   */
  const hitPoints = useStatDrafts({
    current: (key) => encounter?.combatants.find((combatant) => String(combatant.id) === key)?.hpCurrent,
    revision: encounter,
    write: (key, target) =>
      api(`/api/rooms/${roomId}/encounters/${encounter!.id}/combatants/${key}`, {
        method: "PATCH",
        body: JSON.stringify({ hpCurrent: target })
      }).then(onChanged),
    onError: setError
  });

  if (!encounter) return null;

  const rules = encounter.initiative;
  const attributeDamage = encounter.attributeDamage;
  const rangedIcon = encounter.rangedWeaponIcon;
  // An excluded combatant is one the GM has toggled out of this fight. It keeps
  // its hit points and its place in the roster, but it is not in the order.
  const present = encounter.combatants.filter((combatant) => combatant.included);
  const individual = encounter.individualInitiative;
  // Looked up rather than stored, so an open dialog follows the room's data and
  // closes by itself if the combatant leaves the fight.
  const spent = encounter.combatants.find((combatant) => combatant.id === spending);

  async function act(run: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await run();
      onChanged();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const rollInitiative = () =>
    act(() => api(`/api/rooms/${roomId}/encounters/${encounter.id}/roll-initiative`, { method: "POST" }));

  const clearOpeningSaves = () =>
    act(() => api(`/api/rooms/${roomId}/encounters/${encounter.id}/opening-saves`, { method: "DELETE" }));

  const setOpeningSave = (combatant: EncounterCombatant, passed: boolean) =>
    act(() =>
      api(`/api/rooms/${roomId}/encounters/${encounter.id}/combatants/${combatant.id}`, {
        method: "PATCH",
        body: JSON.stringify({ actsFirstTurn: combatant.actsFirstTurn === passed ? null : passed })
      })
    );

  /**
   * Whose attacks this viewer may roll: their own characters', the party's
   * hirelings', and — for the GM — the creatures'.
   */
  function attackHolder(combatant: EncounterCombatant) {
    return combatant.kind === "character"
      ? ({ kind: "character", ownerAccountId: combatant.character?.ownerAccountId ?? null } as const)
      : ({ kind: combatant.kind } as const);
  }

  async function rollAttack(combatant: EncounterCombatant, weapon: NonNullable<EncounterCombatant["weapon"]>) {
    setError("");
    try {
      const message = await rollWeapon(roomId, combatant.name, {
        name: weapon.name,
        damage: weapon.damage!,
        traits: weapon.traits
      });
      onRolled(message);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  const initiativeFor = (side: string) => encounter.sides.find((entry) => entry.side === side)?.initiative ?? null;

  // Rolled order puts the highest first, and CWN gives a tie to the party.
  const orderedSides = [...(rules.sides ?? [])].sort((left, right) => {
    if (rules.sideOrder !== "roll") return 0;
    const difference = (initiativeFor(right.id) ?? -Infinity) - (initiativeFor(left.id) ?? -Infinity);
    if (difference !== 0) return difference;
    if (rules.tieBreak !== "party-wins") return 0;
    return left.id === "party" ? -1 : right.id === "party" ? 1 : 0;
  });

  function saveMark(combatant: EncounterCombatant, passed: boolean, label: string) {
    const active = combatant.actsFirstTurn === passed;
    return (
      <span
        role="button"
        tabIndex={0}
        aria-pressed={active}
        aria-label={`${combatant.name} ${passed ? "passed" : "failed"} the ${rules.entrySave?.label} save`}
        className={active ? (passed ? "passed" : "failed") : ""}
        onClick={(event) => {
          event.stopPropagation();
          if (!busy) void setOpeningSave(combatant, passed);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          event.stopPropagation();
          if (!busy) void setOpeningSave(combatant, passed);
        }}
      >
        {label}
      </span>
    );
  }

  function row(combatant: EncounterCombatant) {
    const failed = combatant.actsFirstTurn === false;
    // A hireling's sheet is the group's, so only the GM steps one.
    const steppable =
      combatant.hpCurrent !== undefined &&
      (isGm ||
        (combatant.kind === "character" && !!combatant.character && canEditCharacter(viewer, combatant.character)));
    const draft = hitPoints.draft(String(combatant.id));
    const hp = draft ?? combatant.hpCurrent ?? 0;
    const hpMax = typeof combatant.hpMax === "number" ? combatant.hpMax : undefined;
    return (
      <div className={`combat-tracker-row${failed ? " combat-tracker-row-late" : ""}`} key={combatant.id}>
        {individual && <span className="combat-tracker-position">{combatant.initiative ?? "—"}</span>}
        <CombatantAvatar combatant={combatant} />
        <button
          className={`combat-tracker-name combat-side-${combatant.side === "party" ? "friendly" : "hostile"}`}
          onClick={() => onInspect(combatant)}
          title={`View ${combatant.name}`}
        >
          {combatant.name}
        </button>
        {combatant.armor !== undefined && (
          <span
            className="combat-tracker-armor"
            aria-label={`Armor ${combatant.armor}`}
            title={`Armor ${combatant.armor}`}
          >
            <Shield aria-hidden="true" />
            {combatant.armor}
          </span>
        )}
        {failed && (
          <em>{rules.entrySave?.onFailure === "skip-first-turn" ? "sits out first turn" : "acts after opponents"}</em>
        )}
        {[combatant.weapon, combatant.offhand].flatMap((weapon, hand) =>
          weapon
            ? [
                <WeaponMark
                  key={hand}
                  held={{ weapon: true, ...weapon }}
                  name={weapon.name}
                  size={12}
                  traits={traits}
                  rangedIcon={rangedIcon}
                  onRoll={
                    canRollAttack(viewer, attackHolder(combatant)) && rollableDamage(weapon)
                      ? () => void rollAttack(combatant, weapon)
                      : undefined
                  }
                />
              ]
            : []
        )}
        {combatant.hpCurrent !== undefined && (
          <span className="combat-tracker-hp">
            {draft ?? combatant.hpCurrent ?? "—"}/{combatant.hpMax ?? "—"}
          </span>
        )}
        {steppable && (
          <StatStepper
            label={`${combatant.name}'s hit points`}
            value={hp}
            maximum={hpMax}
            onStep={(target) => hitPoints.step(String(combatant.id), target)}
            onFloor={attributeDamage ? () => setSpending(combatant.id) : undefined}
            floorLabel={`Spend ${combatant.name}'s attributes`}
          />
        )}
        {isGm && rules.entrySave && combatant.kind !== "npc" && (
          <span className="combat-tracker-save">
            {saveMark(combatant, true, "✓")}
            {saveMark(combatant, false, "✕")}
          </span>
        )}
      </div>
    );
  }

  return (
    // The rail's own header names the encounter, so this starts at the controls.
    <div className="combat-tracker">
      {!encounter.active && <p className="combat-tracker-note">This encounter is not active.</p>}

      {isGm && (rules.sideOrder === "roll" || rules.entrySave) && (
        <div className="combat-tracker-actions">
          {rules.sideOrder === "roll" && (
            <button onClick={() => void rollInitiative()} disabled={busy}>
              <Dices /> Roll initiative
            </button>
          )}
          {rules.entrySave && present.some((combatant) => combatant.actsFirstTurn !== null) && (
            <button onClick={() => void clearOpeningSaves()} disabled={busy}>
              <Eraser /> Clear opening saves
            </button>
          )}
        </div>
      )}

      {rules.note && <p className="combat-tracker-note">{rules.note}</p>}
      {error && <p className="form-error">{error}</p>}

      {present.length === 0 ? (
        <p className="combat-tracker-note">No combatants in this encounter.</p>
      ) : individual ? (
        <div className="combat-tracker-list">
          {[...present]
            .sort((left, right) => (right.initiative ?? -Infinity) - (left.initiative ?? -Infinity))
            .map(row)}
        </div>
      ) : (
        orderedSides.map((side) => {
          const members = present.filter((combatant) => combatant.side === side.id);
          if (!members.length) return null;
          return (
            <div className="combat-tracker-side" key={side.id}>
              <p className="combat-tracker-side-label">
                <span>{side.label}</span>
                {rules.sideOrder === "roll" && <span>{initiativeFor(side.id) ?? "—"}</span>}
              </p>
              <div className="combat-tracker-list">{members.map(row)}</div>
            </div>
          );
        })
      )}

      {/* Set aside rather than dropped: the GM keeps a way back to anyone they
          took out of the order, since this rail is the only list of the fight. */}
      {isGm && encounter.combatants.some((combatant) => !combatant.included) && (
        <div className="combat-tracker-side combat-tracker-benched">
          <p className="combat-tracker-side-label">
            <span>Out of the fight</span>
          </p>
          <div className="combat-tracker-list">
            {encounter.combatants.filter((combatant) => !combatant.included).map(row)}
          </div>
        </div>
      )}

      {spent && attributeDamage && (
        <AttributeDamageModal
          roomId={roomId}
          encounterId={encounter.id}
          system={encounter.system}
          combatant={spent}
          definition={attributeDamage}
          onChanged={onChanged}
          onRolled={onRolled}
          onClose={() => setSpending(undefined)}
        />
      )}
    </div>
  );
}
