import { useEffect, useRef, useState } from "react";
import { Trash2, X } from "lucide-react";
import type { CharacterSheetDefinition, NpcStatblockDefinition, SystemId } from "@devils-toys/shared";
import { api } from "./api";
import { ReadOnlyCharacterSheet, type ReadOnlyCharacter } from "./ReadOnlyCharacterSheet";
import type { EncounterCombatant } from "./EncounterPage";

/**
 * A hireling shaped for `ReadOnlyCharacterSheet`. Hirelings carry a string id and
 * flat fields, so they are adapted here rather than widening `ReadOnlyCharacter`
 * — which every other caller already satisfies.
 */
function hirelingAsCharacter(combatant: EncounterCombatant): ReadOnlyCharacter {
  const { id: _id, name: _name, ...sheet } = combatant.hireling ?? {};
  return {
    id: -combatant.id,
    ownerAccountId: null,
    ownerUsername: null,
    name: combatant.name,
    sheet,
    portraitUrl: null,
    warnings: [],
    activeBy: []
  };
}

export function CombatantSheet({
  combatant,
  system,
  characterSheet,
  hirelingSheet,
  npcStatblock,
  roomId,
  encounterId,
  isGm,
  onChanged,
  onClose
}: {
  combatant: EncounterCombatant;
  system: SystemId;
  characterSheet?: CharacterSheetDefinition;
  hirelingSheet?: CharacterSheetDefinition;
  npcStatblock?: NpcStatblockDefinition;
  roomId: number;
  /** Absent where the sheet was opened from outside a fight. */
  encounterId?: number;
  isGm: boolean;
  onChanged: () => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLElement>(null);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    dialog.current?.focus();
    const keepFocusInside = (event: KeyboardEvent) => {
      if (event.key === "Escape") return onClose();
      if (event.key !== "Tab") return;
      const focusable = [
        ...(dialog.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [href], select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ) ?? [])
      ];
      if (!focusable.length) return event.preventDefault();
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", keepFocusInside);
    return () => {
      document.removeEventListener("keydown", keepFocusInside);
      previous?.focus();
    };
  }, [onClose]);

  /**
   * Who is in the fight is managed from here, since the rail is the one list of
   * it. Excluding keeps a combatant and their hit points but takes them out of
   * the order; removing takes them out of the encounter altogether.
   */
  async function act(run: () => Promise<unknown>, close: boolean) {
    setBusy(true);
    setError("");
    try {
      await run();
      setBusy(false);
      onChanged();
      if (close) onClose();
    } catch (cause) {
      setError((cause as Error).message);
      setBusy(false);
    }
  }
  // Numbers tile into a compact grid; prose such as Cairn's attacks or CWN's gear
  // is given the full width rather than being squeezed into a numeric column.
  const statblockFields = npcStatblock?.fields.flatMap((field) => {
    const value = combatant.statblock?.[field.key];
    const text = String(value ?? "").trim();
    return text ? [{ label: field.label, text, wide: field.kind === "text" || text.length > 24 }] : [];
  });

  // A player is sent no statblock and no sheet for what they may not see, so the
  // dialog says so rather than rendering an empty shell.
  const nothingToShow =
    (combatant.kind === "npc" && !statblockFields?.length) ||
    (combatant.kind === "character" && !combatant.character) ||
    (combatant.kind === "hireling" && !combatant.hireling);

  return (
    <div
      className="modal-scrim"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className="modal combatant-sheet"
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label={combatant.name}
        tabIndex={-1}
      >
        <header>
          <p className="eyebrow">
            {combatant.kind === "npc" ? "Statblock" : combatant.kind === "hireling" ? "Hireling" : "Character"}
          </p>
          <h2>{combatant.name}</h2>
          <button onClick={onClose} aria-label="Close">
            <X />
          </button>
        </header>

        <div className="combatant-sheet-body">
          {nothingToShow ? (
            <p className="combatant-sheet-empty">Nothing further is available to you for {combatant.name}.</p>
          ) : combatant.kind === "npc" ? (
            <dl className="combatant-statblock">
              {statblockFields!.map((field) => (
                <div className={field.wide ? "combatant-statblock-wide" : undefined} key={field.label}>
                  <dt>{field.label}</dt>
                  <dd>{field.text}</dd>
                </div>
              ))}
            </dl>
          ) : combatant.kind === "character" && characterSheet ? (
            <ReadOnlyCharacterSheet character={combatant.character!} definition={characterSheet} system={system} />
          ) : combatant.kind === "hireling" && hirelingSheet ? (
            <ReadOnlyCharacterSheet
              character={hirelingAsCharacter(combatant)}
              definition={hirelingSheet}
              system={system}
            />
          ) : (
            <p className="combatant-sheet-empty">This system defines no sheet for {combatant.name}.</p>
          )}

          {combatant.conditions && (
            <p className="combatant-sheet-conditions">
              <span>Conditions</span>
              {combatant.conditions}
            </p>
          )}

          {isGm && encounterId !== undefined && (
            <div className="combatant-sheet-manage">
              <label title="Include in the initiative order">
                <input
                  type="checkbox"
                  checked={combatant.included}
                  disabled={busy}
                  onChange={(event) =>
                    void act(
                      () =>
                        api(`/api/rooms/${roomId}/encounters/${encounterId}/combatants/${combatant.id}`, {
                          method: "PATCH",
                          body: JSON.stringify({ included: event.target.checked })
                        }),
                      false
                    )
                  }
                />
                <span>In the fight</span>
              </label>
              <button
                className="danger-text"
                disabled={busy}
                title={`Remove ${combatant.name} from this encounter`}
                onClick={() =>
                  void act(
                    () =>
                      api(`/api/rooms/${roomId}/encounters/${encounterId}/combatants/${combatant.id}`, {
                        method: "DELETE"
                      }),
                    true
                  )
                }
              >
                <Trash2 /> Remove from encounter
              </button>
              {error && <p className="form-error">{error}</p>}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
