import { useEffect, useState } from "react";
import { Columns3, Map as MapIcon, Pencil, Plus } from "lucide-react";
import type {
  AttributeDamageDefinition,
  InitiativeRules,
  MediaAsset,
  NpcStatblockDefinition,
  RangedWeaponIcon,
  SystemId
} from "@devils-toys/shared";
import { api } from "./api";
import { EncounterMap } from "./EncounterMap";
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
  /** Normalized coordinates on the encounter map, or absent while in its roster. */
  mapPosition?: { x: number; y: number } | null;
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
  onChanged,
  onCreated
}: {
  roomId: number;
  encounter?: EncounterRecord;
  isGm: boolean;
  /** Who is looking, so a player can move their own character and no one else. */
  viewerId: number;
  /** The room's maps, for the GM to choose what this encounter is fought over. */
  maps: { id: number; label: string }[];
  onChanged: () => void;
  onCreated?: (id: number) => void | Promise<void>;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [candidates, setCandidates] = useState<Candidates>(noCandidates);
  const [editor, setEditor] = useState<"name" | "notes" | "new" | "npc">();
  const [draft, setDraft] = useState("");
  const [npcNotes, setNpcNotes] = useState("");
  const [npcFields, setNpcFields] = useState<Record<string, string>>({});
  const [candidateRevision, setCandidateRevision] = useState(0);
  useEffect(() => {
    setEditor(undefined);
    setError("");
  }, [encounter?.id]);

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
  }, [roomId, isGm, candidateRevision]);

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
      const result = await api<{ encounter: EncounterRecord }>(`/api/rooms/${roomId}/encounters`, {
        method: "POST",
        body: JSON.stringify({ name: name.trim() })
      });
      setName("");
      setEditor(undefined);
      await onCreated?.(result.encounter.id);
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

  function edit(next: "name" | "notes" | "new" | "npc") {
    setError("");
    setEditor(next);
    setDraft(next === "name" ? encounter!.name : next === "notes" ? (encounter!.notes ?? "") : "");
    setNpcNotes("");
    setNpcFields({});
  }

  async function saveEdit() {
    if (editor === "new") return create();
    await act(async () => {
      if (editor === "npc") {
        const statblock = Object.fromEntries(
          (encounter!.npcStatblock?.fields ?? []).flatMap((field) => {
            const value = npcFields[field.key]?.trim();
            return value ? [[field.key, field.kind === "number" ? Number(value) : value]] : [];
          })
        );
        await api(`/api/rooms/${roomId}/encounters/${encounter!.id}/combatants`, {
          method: "POST",
          body: JSON.stringify({ kind: "npc", newNpc: { name: draft.trim(), notes: npcNotes, statblock } })
        });
        setCandidateRevision((value) => value + 1);
      } else {
        await api(`/api/rooms/${roomId}/encounters/${encounter!.id}`, {
          method: "PATCH",
          body: JSON.stringify(editor === "name" ? { name: draft.trim() } : { notes: draft })
        });
      }
      setEditor(undefined);
    });
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
          <div className="encounter-title">
            <h2>{encounter.name}</h2>
            {isGm && (
              <button
                className="encounter-edit-icon"
                aria-label="Edit encounter name"
                title="Edit encounter name"
                disabled={busy}
                onClick={() => edit("name")}
              >
                <Pencil />
              </button>
            )}
            {encounter.active && <span className="eyebrow">Active</span>}
          </div>
        </div>
        {isGm && (
          <div className="encounter-header-actions">
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => {
                setName("");
                edit("new");
              }}
            >
              <Plus /> New encounter
            </button>
            <button
              className="secondary-button"
              onClick={() => void toggleActive()}
              disabled={busy}
              title={
                encounter.active
                  ? "Deactivate this encounter"
                  : "Activate this encounter and deactivate any other in this room"
              }
            >
              {busy ? "Saving…" : encounter.active ? "Deactivate" : "Activate"}
            </button>
          </div>
        )}
      </header>
      {isGm && editor && (
        <form
          className="encounter-editor"
          onSubmit={(event) => {
            event.preventDefault();
            void saveEdit();
          }}
        >
          <label>
            {editor === "new"
              ? "New encounter name"
              : editor === "npc"
                ? "NPC name"
                : editor === "name"
                  ? "Encounter name"
                  : "Encounter description"}
            {editor === "notes" ? (
              <textarea
                autoFocus
                value={draft}
                maxLength={10000}
                disabled={busy}
                onChange={(event) => setDraft(event.target.value)}
              />
            ) : (
              <input
                autoFocus
                required
                maxLength={editor === "npc" ? 100 : 120}
                disabled={busy}
                value={editor === "new" ? name : draft}
                onChange={(event) => (editor === "new" ? setName(event.target.value) : setDraft(event.target.value))}
              />
            )}
          </label>
          {editor === "npc" && (
            <>
              <label>
                NPC notes
                <textarea
                  value={npcNotes}
                  maxLength={10000}
                  disabled={busy}
                  onChange={(event) => setNpcNotes(event.target.value)}
                />
              </label>
              <div className="encounter-npc-fields">
                {encounter.npcStatblock?.fields.map((field) => (
                  <label key={field.key}>
                    {field.label}
                    <input
                      type={field.kind === "number" ? "number" : "text"}
                      disabled={busy}
                      value={npcFields[field.key] ?? ""}
                      onChange={(event) => setNpcFields((current) => ({ ...current, [field.key]: event.target.value }))}
                    />
                  </label>
                ))}
              </div>
            </>
          )}
          <div className="encounter-header-actions">
            <button
              className="primary-button"
              disabled={busy || (editor !== "notes" && !(editor === "new" ? name : draft).trim())}
            >
              {editor === "new" ? "Create encounter" : editor === "npc" ? "Create and add NPC" : "Save"}
            </button>
            <button type="button" className="secondary-button" disabled={busy} onClick={() => setEditor(undefined)}>
              Cancel
            </button>
          </div>
        </form>
      )}
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
        <EncounterMap roomId={roomId} encounter={encounter} isGm={isGm} viewerId={viewerId} onChanged={onChanged} />
      ) : (
        <p className="encounter-zones-empty">
          {isGm ? "Choose a map above, or lay the encounter out in zones." : "The GM has not put up a map."}
        </p>
      )}
      {encounter.notes && <p className="encounter-notes">{encounter.notes}</p>}
      {isGm && (
        <button className="encounter-edit-description" disabled={busy} onClick={() => edit("notes")}>
          <Pencil /> {encounter.notes ? "Edit description" : "Add description"}
        </button>
      )}
      {error && <p className="form-error">{error}</p>}

      {isGm && (
        <div className="encounter-add" aria-label="Add combatants">
          <h3>Add to this encounter</h3>
          <button className="secondary-button" disabled={busy} onClick={() => edit("npc")}>
            <Plus /> Create NPC
          </button>
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
