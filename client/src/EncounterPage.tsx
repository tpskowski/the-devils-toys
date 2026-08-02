import { useEffect, useState } from "react";
import { Columns3, Map as MapIcon, Plus } from "lucide-react";
import type {
  AttributeDamageDefinition,
  InitiativeRules,
  MediaAsset,
  NpcStatblockDefinition,
  RangedWeaponIcon,
  SystemId
} from "@devils-toys/shared";
import { api } from "./api";
import { EncounterZones } from "./EncounterZones";
import type { ReadOnlyCharacter } from "./ReadOnlyCharacterSheet";

export interface EncounterCombatant {
  id: number;
  kind: "character" | "hireling" | "npc";
  /** The character, hireling, or NPC record this combatant was made from. */
  sourceId?: number | string;
  name: string;
  side: string;
  initiative: number | null;
  actsFirstTurn: boolean | null;
  sortOrder: number;
  included: boolean;
  hpCurrent?: number | null;
  hpMax?: number | null;
  /** What they are wearing, where the system records any. */
  armor?: number;
  /** Marked by a failed save, where the system carries such a mark. */
  criticalDamage?: boolean;
  /**
   * The first weapon this combatant carries. Shown to the whole table — a drawn
   * weapon is plain to look at — though only its own side may roll it.
   */
  weapon?: { name: string; damage?: string; traits?: readonly string[]; range?: string; notes?: string };
  /** The second weapon, where they are fighting with one in each hand. */
  offhand?: { name: string; damage?: string; traits?: readonly string[]; range?: string; notes?: string };
  conditions?: string;
  /** A portrait where the combatant has one. NPCs have no image store yet. */
  imageUrl?: string | null;
  /** The zone they are standing in, where the encounter is laid out in zones. */
  zoneId?: number | null;
  /** Present for a character the viewer is allowed to see in full. */
  character?: ReadOnlyCharacter;
  /** The hireling's flat sheet fields, as stored in the group blob. */
  hireling?: Record<string, unknown>;
  /** GM only; absent for players by design. */
  statblock?: Record<string, string | number>;
}

/** Everything the GM can put into an encounter, gathered from the room's existing lists. */
interface Candidates {
  characters: { id: number; name: string }[];
  hirelings: { id: string; name: string }[];
  npcs: { id: number; name: string }[];
  catalog: { name: string }[];
}

const noCandidates: Candidates = { characters: [], hirelings: [], npcs: [], catalog: [] };

function hirelingEntries(state: unknown): { id: string; name: string }[] {
  const hirelings = (state as { hirelings?: unknown })?.hirelings;
  if (!Array.isArray(hirelings)) return [];
  return hirelings.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    return typeof record.id === "string" ? [{ id: record.id, name: String(record.name ?? "Hireling") }] : [];
  });
}

export interface EncounterRecord {
  id: number;
  name: string;
  active: boolean;
  media: MediaAsset | null;
  notes?: string;
  /** What the tab shows above the roster: the chosen map, or the zone board. */
  display: "map" | "zones";
  zones: { id: number; name: string; sortOrder: number }[];
  individualInitiative: boolean;
  sides: { side: string; initiative: number | null }[];
  combatants: EncounterCombatant[];
  initiative: InitiativeRules;
  npcStatblock?: NpcStatblockDefinition;
  /** Present only for a system that spends attributes once hit points run out. */
  attributeDamage?: AttributeDamageDefinition;
  /** What this system draws a weapon used at a distance as. */
  rangedWeaponIcon: RangedWeaponIcon;
  system: SystemId;
}

export function EncounterPage({
  roomId,
  encounter,
  isGm,
  viewerId,
  maps,
  onChanged
}: {
  roomId: number;
  encounter?: EncounterRecord;
  isGm: boolean;
  /** Who is looking, so a player can move their own character and no one else. */
  viewerId: number;
  /** The room's maps, for the GM to choose what this encounter is fought over. */
  maps: { id: number; label: string }[];
  onChanged: () => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [candidates, setCandidates] = useState<Candidates>(noCandidates);

  // The roster is assembled from lists the room already publishes, so nothing here
  // is a second source of truth for who exists.
  useEffect(() => {
    if (!isGm) return setCandidates(noCandidates);
    let active = true;
    Promise.all([
      api<{ characters: { id: number; name: string }[] }>(`/api/rooms/${roomId}/characters`).catch(() => ({
        characters: []
      })),
      api<{ state: unknown }>(`/api/rooms/${roomId}/group`).catch(() => ({ state: {} })),
      api<{ catalog: { name: string }[]; custom: { id: number; name: string }[] }>(`/api/rooms/${roomId}/npcs`).catch(
        () => ({ catalog: [], custom: [] })
      )
    ])
      .then(([characterList, group, npcList]) => {
        if (!active) return;
        setCandidates({
          characters: characterList.characters,
          hirelings: hirelingEntries(group.state),
          npcs: npcList.custom,
          catalog: npcList.catalog
        });
      })
      .catch(() => active && setError("Could not load who is available to add."));
    return () => {
      active = false;
    };
  }, [roomId, isGm]);

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

  function addCombatant(body: Record<string, unknown>) {
    return act(() =>
      api(`/api/rooms/${roomId}/encounters/${encounter!.id}/combatants`, {
        method: "POST",
        body: JSON.stringify(body)
      })
    );
  }

  function setDisplay(display: "map" | "zones") {
    return act(() =>
      api(`/api/rooms/${roomId}/encounters/${encounter!.id}`, {
        method: "PATCH",
        body: JSON.stringify({ display })
      })
    );
  }

  /** The chosen map is shown here whether or not the Maps tab has revealed it. */
  function setMap(mediaId: number | null) {
    return act(() =>
      api(`/api/rooms/${roomId}/encounters/${encounter!.id}`, {
        method: "PATCH",
        body: JSON.stringify({ mediaId })
      })
    );
  }

  async function create() {
    if (!name.trim()) return;
    await act(async () => {
      await api(`/api/rooms/${roomId}/encounters`, {
        method: "POST",
        body: JSON.stringify({ name: name.trim() })
      });
      setName("");
    });
  }

  async function toggleActive() {
    await act(() =>
      api(`/api/rooms/${roomId}/encounters/${encounter!.id}/activate`, {
        method: encounter!.active ? "DELETE" : "POST",
        body: encounter!.active ? undefined : JSON.stringify({ confirm: true })
      })
    );
  }

  if (!encounter) {
    return (
      <div className="encounter-empty">
        <p className="eyebrow">Encounter ledger</p>
        <h2>{isGm ? "Create an encounter" : "No active encounters"}</h2>
        {isGm ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void create();
            }}
          >
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Encounter name" />
            <button className="primary-button" disabled={busy || !name.trim()}>
              {busy ? "Creating…" : "Create encounter"}
            </button>
          </form>
        ) : (
          <p>The GM has not activated an encounter.</p>
        )}
        {error && <p className="form-error">{error}</p>}
      </div>
    );
  }

  const present = new Set(
    encounter.combatants.flatMap((combatant) =>
      combatant.sourceId === undefined ? [] : [`${combatant.kind}:${combatant.sourceId}`]
    )
  );
  const inEncounter = (kind: string, sourceId: number | string) => present.has(`${kind}:${sourceId}`);

  return (
    <div className="encounter-page">
      <header className="encounter-header">
        <div>
          <p className="eyebrow">{encounter.active ? "Active encounter" : "Encounter"}</p>
          <h2>{encounter.name}</h2>
        </div>
        {isGm && (
          <button className="secondary-button" onClick={() => void toggleActive()} disabled={busy}>
            {busy ? "Saving…" : encounter.active ? "Deactivate" : "Activate"}
          </button>
        )}
      </header>
      {isGm && (
        <div className="encounter-display" role="group" aria-label="What this encounter shows">
          {(["map", "zones"] as const).map((mode) => (
            <button
              key={mode}
              className={encounter.display === mode ? "selected" : ""}
              disabled={busy}
              onClick={() => void setDisplay(mode)}
            >
              {mode === "map" ? <MapIcon /> : <Columns3 />}
              {mode === "map" ? "Map" : "Zones"}
            </button>
          ))}
          {encounter.display === "map" && (
            <select
              value={encounter.media ? String(encounter.media.id) : ""}
              aria-label="Encounter map"
              disabled={busy}
              onChange={(event) => void setMap(event.target.value ? Number(event.target.value) : null)}
            >
              <option value="">No map</option>
              {maps.map((map) => (
                <option value={map.id} key={map.id}>
                  {map.label}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {encounter.display === "zones" ? (
        <EncounterZones roomId={roomId} encounter={encounter} isGm={isGm} viewerId={viewerId} onChanged={onChanged} />
      ) : encounter.media ? (
        <img
          className="encounter-image"
          src={encounter.media.url}
          alt={encounter.media.displayName ?? encounter.media.filename}
        />
      ) : (
        <p className="encounter-zones-empty">
          {isGm ? "Choose a map above, or lay the encounter out in zones." : "The GM has not put up a map."}
        </p>
      )}
      {encounter.notes && <p className="encounter-notes">{encounter.notes}</p>}
      {error && <p className="form-error">{error}</p>}

      {isGm && (
        <div className="encounter-add" aria-label="Add combatants">
          <h3>Add to this encounter</h3>
          {(
            [
              {
                key: "characters",
                label: "Party",
                items: candidates.characters.map((character) => ({
                  key: `character-${character.id}`,
                  label: character.name,
                  taken: inEncounter("character", character.id),
                  body: { kind: "character", characterId: character.id }
                }))
              },
              {
                key: "hirelings",
                label: "Hirelings",
                items: candidates.hirelings.map((hireling) => ({
                  key: `hireling-${hireling.id}`,
                  label: hireling.name,
                  taken: inEncounter("hireling", hireling.id),
                  body: { kind: "hireling", hirelingId: hireling.id }
                }))
              },
              {
                key: "npcs",
                label: "Your NPCs",
                items: candidates.npcs.map((npc) => ({
                  key: `npc-${npc.id}`,
                  label: npc.name,
                  taken: false,
                  body: { kind: "npc", npcId: npc.id }
                }))
              },
              {
                key: "catalog",
                label: "Bestiary",
                items: candidates.catalog.map((entry) => ({
                  key: `catalog-${entry.name}`,
                  label: entry.name,
                  taken: false,
                  body: { kind: "npc", catalogName: entry.name }
                }))
              }
            ] as const
          ).map((group) => (
            <section key={group.key}>
              <p className="eyebrow">{group.label}</p>
              {group.items.length === 0 ? (
                <p className="encounter-add-empty">Nothing available.</p>
              ) : (
                <div className="encounter-add-options">
                  {group.items.map((item) => (
                    <button
                      key={item.key}
                      disabled={busy || item.taken}
                      title={item.taken ? `${item.label} is already here` : `Add ${item.label}`}
                      onClick={() => void addCombatant({ ...item.body })}
                    >
                      <Plus /> {item.label}
                    </button>
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
