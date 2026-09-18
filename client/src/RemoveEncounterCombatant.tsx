import { useState } from "react";
import { X } from "lucide-react";
import { api } from "./api";
import type { EncounterCombatant } from "./EncounterPage";

export function RemoveEncounterCombatant({
  roomId,
  encounterId,
  combatant,
  onRemoved
}: {
  roomId: number;
  encounterId: number;
  combatant: EncounterCombatant;
  onRemoved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <>
      <button
        type="button"
        className="encounter-unplaced-remove"
        disabled={busy}
        title={`Remove ${combatant.name} from encounter`}
        aria-label={`Remove ${combatant.name} from encounter`}
        onClick={async (event) => {
          event.stopPropagation();
          setBusy(true);
          setError("");
          try {
            await api(`/api/rooms/${roomId}/encounters/${encounterId}/combatants/${combatant.id}`, {
              method: "DELETE"
            });
            onRemoved();
          } catch (cause) {
            setError((cause as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <X />
      </button>
      {error && (
        <span className="form-error" role="alert">
          {error}
        </span>
      )}
    </>
  );
}
