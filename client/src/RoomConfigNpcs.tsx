import { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpen, Copy, CopyPlus, Plus, Save, Trash2 } from "lucide-react";
import type { NpcStatblockDefinition, RoomConfigRoom, SystemId } from "@devils-toys/shared";
import { api } from "./api";
import { RulesMarkdown } from "./RulesMarkdown";

interface BuiltInNpc {
  name: string;
  markdown: string;
}

interface CustomNpc {
  id: number;
  name: string;
  notes: string;
  statblock: Record<string, string | number>;
  updatedAt: string;
}

interface Draft {
  name: string;
  notes: string;
  statblock: Record<string, string>;
}

function draftOf(npc: CustomNpc, definition: NpcStatblockDefinition): Draft {
  return {
    name: npc.name,
    notes: npc.notes,
    statblock: Object.fromEntries(definition.fields.map((field) => [field.key, String(npc.statblock[field.key] ?? "")]))
  };
}

/**
 * A draft's statblock as the server takes it: numeric fields as numbers, and a
 * field left blank dropped rather than sent as an empty string, which the
 * system's own validation would refuse.
 */
function statblockFrom(draft: Draft, definition: NpcStatblockDefinition) {
  const statblock: Record<string, string | number> = {};
  for (const field of definition.fields) {
    const value = draft.statblock[field.key]?.trim() ?? "";
    if (!value) continue;
    if (field.kind === "number") {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) statblock[field.key] = numeric;
    } else {
      statblock[field.key] = value;
    }
  }
  return statblock;
}

export function RoomConfigNpcs({
  room,
  system,
  revision
}: {
  room: RoomConfigRoom;
  system: { id: SystemId; npcStatblock: NpcStatblockDefinition };
  revision: number;
}) {
  const roomId = room.id;
  const definition = system.npcStatblock;
  const [catalog, setCatalog] = useState<BuiltInNpc[]>([]);
  const [custom, setCustom] = useState<CustomNpc[]>([]);
  const [selectedId, setSelectedId] = useState<number>();
  const [reading, setReading] = useState<string>();
  // The draft carries the id it was built from. Anything that reloads the roster
  // — a save here, a change made at the table — replaces the record object, and
  // without that id an edit in progress would be quietly rebuilt out from under
  // whoever was typing. Only a genuinely different NPC starts a new draft.
  const [draft, setDraft] = useState<{ id: number; value: Draft }>();
  const [query, setQuery] = useState("");
  const [catalogQuery, setCatalogQuery] = useState("");
  const [copyTargets, setCopyTargets] = useState<RoomConfigRoom[]>([]);
  const [copyTarget, setCopyTarget] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const result = await api<{ catalog: BuiltInNpc[]; custom: CustomNpc[] }>(`/api/rooms/${roomId}/npcs`);
    setCatalog(result.catalog);
    setCustom(result.custom);
    return result.custom;
  }, [roomId]);

  useEffect(() => {
    load().catch((cause) => setError((cause as Error).message));
  }, [load, revision]);

  // The rooms this NPC could be copied into: the ones this account may also
  // configure, running the same system, minus the one it is already in.
  useEffect(() => {
    api<{ rooms: RoomConfigRoom[] }>("/api/room-config/rooms")
      .then((result) =>
        setCopyTargets(result.rooms.filter((entry) => entry.id !== roomId && entry.system === system.id))
      )
      .catch(() => setCopyTargets([]));
  }, [roomId, system.id]);

  const selected = custom.find((npc) => npc.id === selectedId);

  useEffect(() => {
    setDraft((current) => {
      if (!selected) return undefined;
      return current?.id === selected.id ? current : { id: selected.id, value: draftOf(selected, definition) };
    });
  }, [selected, definition]);

  useEffect(() => {
    setConfirmingDelete(false);
  }, [selectedId]);

  const roster = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return custom;
    return custom.filter((npc) =>
      `${npc.name} ${npc.notes} ${Object.values(npc.statblock).join(" ")}`.toLocaleLowerCase().includes(needle)
    );
  }, [custom, query]);

  const bestiary = useMemo(() => {
    const needle = catalogQuery.trim().toLocaleLowerCase();
    if (!needle) return catalog;
    return catalog.filter((entry) => entry.name.toLocaleLowerCase().includes(needle));
  }, [catalog, catalogQuery]);

  /**
   * `after` is handed the roster as it now stands, which is how saving settles
   * the draft: it is rebuilt from the record the server actually stored rather
   * than from what was typed, so what the editor shows is what was written.
   */
  async function act(
    label: string,
    action: () => Promise<unknown>,
    { success, after }: { success?: string; after?: (custom: CustomNpc[]) => void } = {}
  ) {
    setBusy(label);
    setError("");
    setNotice("");
    try {
      await action();
      after?.(await load());
      if (success) setNotice(success);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy("");
    }
  }

  const value = draft?.value;
  const dirty = Boolean(value && selected && JSON.stringify(value) !== JSON.stringify(draftOf(selected, definition)));

  const edit = (changes: Partial<Draft>) =>
    setDraft((current) => (current ? { ...current, value: { ...current.value, ...changes } } : current));

  return (
    <div className="rc-npcs">
      <div className="rc-npc-lists">
        <section className="rc-panel-block">
          <header>
            <h3>This room’s NPCs</h3>
            <button
              type="button"
              onClick={() =>
                act("Creating…", async () => {
                  const result = await api<{ npc: { id: number } }>(`/api/rooms/${roomId}/npcs`, {
                    method: "POST",
                    body: JSON.stringify({ name: "New NPC", notes: "" })
                  });
                  setSelectedId(result.npc.id);
                })
              }
            >
              <Plus size={14} /> New
            </button>
          </header>
          <input
            className="rc-search"
            value={query}
            placeholder="Search names, notes, and stats"
            onChange={(event) => setQuery(event.target.value)}
          />
          <ul className="rc-list">
            {roster.map((npc) => (
              <li key={npc.id}>
                <button
                  type="button"
                  className={npc.id === selectedId ? "is-current" : ""}
                  onClick={() => {
                    setSelectedId(npc.id);
                    setReading(undefined);
                  }}
                >
                  <span>{npc.name}</span>
                  <small>
                    {definition.fields
                      .slice(0, 3)
                      .map((field) => `${field.label} ${npc.statblock[field.key] ?? "—"}`)
                      .join(" · ")}
                  </small>
                </button>
              </li>
            ))}
          </ul>
          {roster.length === 0 && (
            <p className="room-config-muted">{custom.length ? "Nothing matches that." : "No NPCs in this room yet."}</p>
          )}
        </section>

        <section className="rc-panel-block">
          <header>
            <h3>Bestiary</h3>
            <span className="room-config-muted">{catalog.length} entries</span>
          </header>
          <input
            className="rc-search"
            value={catalogQuery}
            placeholder="Search the rulebook"
            onChange={(event) => setCatalogQuery(event.target.value)}
          />
          <ul className="rc-list">
            {bestiary.map((entry) => (
              <li key={entry.name} className="rc-bestiary-row">
                <button
                  type="button"
                  className={reading === entry.name ? "is-current" : ""}
                  onClick={() => setReading(reading === entry.name ? undefined : entry.name)}
                >
                  <span>{entry.name}</span>
                  <small>
                    <BookOpen size={11} /> Read the entry
                  </small>
                </button>
                <button
                  type="button"
                  className="rc-inline-action"
                  title={`Add ${entry.name} to this room`}
                  onClick={() =>
                    act(`Adding ${entry.name}…`, async () => {
                      const result = await api<{ npc: { id: number } }>(`/api/rooms/${roomId}/npcs/from-catalog`, {
                        method: "POST",
                        body: JSON.stringify({ name: entry.name })
                      });
                      setSelectedId(result.npc.id);
                    })
                  }
                >
                  <Plus size={14} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="rc-npc-editor rc-panel-block">
        {busy && <p className="room-config-muted">{busy}</p>}
        {error && <p className="room-config-error">{error}</p>}
        {notice && <p className="rc-notice">{notice}</p>}
        {reading ? (
          <>
            <header>
              <h3>{reading}</h3>
              <button type="button" onClick={() => setReading(undefined)}>
                Close
              </button>
            </header>
            <div className="rc-reading">
              <RulesMarkdown
                markdown={catalog.find((entry) => entry.name === reading)?.markdown ?? ""}
                idPrefix="room-config-bestiary"
                roomId={roomId}
                isGm
              />
            </div>
          </>
        ) : !value || !selected ? (
          <p className="room-config-muted">Choose an NPC to edit, or add one from the bestiary.</p>
        ) : (
          <>
            <header>
              <input
                className="rc-title-input"
                value={value.name}
                aria-label="NPC name"
                onChange={(event) => edit({ name: event.target.value })}
              />
              <button
                type="button"
                className="rc-primary"
                disabled={!dirty || Boolean(busy)}
                onClick={() =>
                  act(
                    "Saving…",
                    () =>
                      api(`/api/rooms/${roomId}/npcs/${selected.id}`, {
                        method: "PATCH",
                        body: JSON.stringify({
                          name: value.name.trim() || selected.name,
                          notes: value.notes,
                          statblock: statblockFrom(value, definition)
                        })
                      }),
                    {
                      success: "Saved.",
                      after: (custom) => {
                        const saved = custom.find((npc) => npc.id === selected.id);
                        if (saved) setDraft({ id: saved.id, value: draftOf(saved, definition) });
                      }
                    }
                  )
                }
              >
                <Save size={14} /> {dirty ? "Save changes" : "Saved"}
              </button>
            </header>

            <div className="rc-statblock">
              {definition.fields.map((field) => (
                <label key={field.key}>
                  <span>{field.label}</span>
                  <input
                    value={value.statblock[field.key] ?? ""}
                    inputMode={field.kind === "number" ? "numeric" : "text"}
                    onChange={(event) => edit({ statblock: { ...value.statblock, [field.key]: event.target.value } })}
                  />
                </label>
              ))}
            </div>

            <label className="rc-notes">
              <span>Notes</span>
              <textarea rows={14} value={value.notes} onChange={(event) => edit({ notes: event.target.value })} />
            </label>

            <footer className="rc-npc-actions">
              <button
                type="button"
                onClick={() =>
                  act("Duplicating…", async () => {
                    const result = await api<{ npc: { id: number } }>(
                      `/api/rooms/${roomId}/npcs/${selected.id}/clone`,
                      { method: "POST" }
                    );
                    setSelectedId(result.npc.id);
                  })
                }
              >
                <CopyPlus size={14} /> Duplicate here
              </button>
              {copyTargets.length > 0 && (
                <span className="rc-copy-to">
                  <select value={copyTarget} onChange={(event) => setCopyTarget(event.target.value)}>
                    <option value="">Copy to another room…</option>
                    {copyTargets.map((target) => (
                      <option key={target.id} value={target.id}>
                        {target.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={!copyTarget || Boolean(busy)}
                    onClick={() => {
                      const target = copyTargets.find((entry) => String(entry.id) === copyTarget);
                      act(
                        "Copying…",
                        () =>
                          api(`/api/rooms/${roomId}/npcs/${selected.id}/copy-to`, {
                            method: "POST",
                            body: JSON.stringify({ roomId: Number(copyTarget) })
                          }),
                        { success: `Copied ${selected.name} to ${target?.name ?? "that room"}.` }
                      );
                    }}
                  >
                    <Copy size={14} /> Copy
                  </button>
                </span>
              )}
              {confirmingDelete ? (
                <>
                  <button
                    type="button"
                    className="rc-danger"
                    onClick={() =>
                      act(`Deleting ${selected.name}…`, async () => {
                        await api(`/api/rooms/${roomId}/npcs/${selected.id}`, { method: "DELETE" });
                        setSelectedId(undefined);
                      })
                    }
                  >
                    <Trash2 size={14} /> Delete {selected.name}
                  </button>
                  <button type="button" onClick={() => setConfirmingDelete(false)}>
                    Keep it
                  </button>
                </>
              ) : (
                <button type="button" className="rc-danger" onClick={() => setConfirmingDelete(true)}>
                  <Trash2 size={14} /> Delete
                </button>
              )}
            </footer>
          </>
        )}
      </section>
    </div>
  );
}
