import { useEffect, useRef, useState } from "react";
import { Trash2, X } from "lucide-react";
import { api } from "./api";

interface SpawnedNpc {
  combatantId: number;
  name: string;
  hpCurrent: number | null;
  hpMax: number | null;
  statblock: Record<string, string | number>;
  included: boolean;
  encounterId: number;
  encounterName: string;
  encounterActive: boolean;
}

/**
 * The NPCs standing in encounters right now. These are combatants, not records:
 * three goblins from one bestiary entry are three rows with three hit-point
 * pools, which is exactly what a GM needs to keep track of mid-fight.
 */
export function SpawnedNpcModal({
  roomId,
  npcRevision,
  encounterRevision,
  onClose
}: {
  roomId: number;
  npcRevision: number;
  encounterRevision: number;
  onClose: () => void;
}) {
  const [spawned, setSpawned] = useState<SpawnedNpc[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const loadVersion = useRef(0);

  async function load() {
    const version = ++loadVersion.current;
    try {
      const result = await api<{ spawned: SpawnedNpc[] }>(`/api/rooms/${roomId}/npcs/spawned`);
      if (version === loadVersion.current) setSpawned(result.spawned);
    } catch (cause) {
      if (version === loadVersion.current) setError((cause as Error).message);
      throw cause;
    }
  }

  useEffect(() => {
    void load().catch(() => undefined);
    return () => {
      // Any pending response from this room/revision is obsolete before the
      // replacement effect starts, so it may not overwrite the new list.
      loadVersion.current += 1;
    };
  }, [roomId, npcRevision, encounterRevision]);

  async function remove(npc: SpawnedNpc) {
    if (!confirm(`Remove ${npc.name} from ${npc.encounterName}?`)) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/rooms/${roomId}/encounters/${npc.encounterId}/combatants/${npc.combatantId}`, {
        method: "DELETE"
      });
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const encounters = spawned.reduce<{ id: number; name: string; active: boolean; npcs: SpawnedNpc[] }[]>(
    (groups, npc) => {
      const group = groups.find((entry) => entry.id === npc.encounterId);
      if (group) group.npcs.push(npc);
      else groups.push({ id: npc.encounterId, name: npc.encounterName, active: npc.encounterActive, npcs: [npc] });
      return groups;
    },
    []
  );

  return (
    <div
      className="modal-scrim"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section className="modal spawned-npc-modal" role="dialog" aria-modal="true" aria-label="Spawned NPCs">
        <header>
          <p className="eyebrow">In play</p>
          <h2>Spawned NPCs</h2>
          <button onClick={onClose} aria-label="Close">
            <X />
          </button>
        </header>
        <div className="spawned-npc-body">
          {error && <p className="form-error">{error}</p>}
          {encounters.length === 0 ? (
            <p className="spawned-npc-empty">
              Nothing has been put into an encounter yet. Add an NPC from the Encounter tab and it appears here.
            </p>
          ) : (
            encounters.map((encounter) => (
              <section key={encounter.id}>
                <p className="eyebrow">
                  {encounter.name}
                  {encounter.active ? "" : " · inactive"}
                </p>
                {encounter.npcs.map((npc) => (
                  <article className={`spawned-npc-row${npc.included ? "" : " spawned-npc-out"}`} key={npc.combatantId}>
                    <strong>{npc.name}</strong>
                    <span>
                      {npc.hpCurrent ?? "—"} / {npc.hpMax ?? "—"} HP
                    </span>
                    {!npc.included && <span>not in the order</span>}
                    <button
                      className="danger-text"
                      disabled={busy}
                      title={`Remove ${npc.name} from ${encounter.name}`}
                      aria-label={`Remove ${npc.name} from ${encounter.name}`}
                      onClick={() => void remove(npc)}
                    >
                      <Trash2 />
                    </button>
                  </article>
                ))}
              </section>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
