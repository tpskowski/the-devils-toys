import { useEffect, useState, type FormEvent } from "react";
import { Plus, Save, Search, Trash2, X } from "lucide-react";
import { tagsMatch } from "@devils-toys/shared";
import { RulesMarkdown } from "./RulesMarkdown";
import { api } from "./api";
import { useRoomTags } from "./room-tags";
import { TagChips, TagField } from "./TagField";

interface BuiltInNpc {
  name: string;
  markdown: string;
}
interface CustomNpc {
  id: number;
  name: string;
  notes: string;
  updatedAt: string;
}

export function NpcModal({ roomId, revision, onClose }: { roomId: number; revision: number; onClose: () => void }) {
  const [catalog, setCatalog] = useState<BuiltInNpc[]>([]);
  const [custom, setCustom] = useState<CustomNpc[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string>();
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const roomTags = useRoomTags(roomId, revision);

  async function load(preferred?: string) {
    const result = await api<{ catalog: BuiltInNpc[]; custom: CustomNpc[] }>(`/api/rooms/${roomId}/npcs`);
    setCatalog(result.catalog);
    setCustom(result.custom);
    setSelected(preferred ?? selected ?? (result.catalog[0] ? `builtin:${result.catalog[0].name}` : undefined));
  }
  useEffect(() => {
    load().catch((cause: Error) => setError(cause.message));
  }, [roomId, revision]);

  const items = [
    ...catalog.map((npc) => ({ key: `builtin:${npc.name}`, name: npc.name, kind: "System", tags: [] as string[] })),
    ...custom.map((npc) => ({
      key: `custom:${npc.id}`,
      name: npc.name,
      kind: "Custom",
      tags: roomTags.tagsOn("npc", npc.id)
    }))
    // The search box the panel already has finds by tag as well as by name,
    // rather than the cast gaining a second box beside the first.
  ].filter((npc) => npc.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()) || tagsMatch(npc.tags, query));
  const builtIn = selected?.startsWith("builtin:")
    ? catalog.find((npc) => `builtin:${npc.name}` === selected)
    : undefined;
  const customNpc = selected?.startsWith("custom:") ? custom.find((npc) => `custom:${npc.id}` === selected) : undefined;

  async function create(event: FormEvent) {
    event.preventDefault();
    try {
      const result = await api<{ npc: CustomNpc }>(`/api/rooms/${roomId}/npcs`, {
        method: "POST",
        body: JSON.stringify({ name: name || "New NPC", notes })
      });
      setName("");
      setNotes("");
      await load(`custom:${result.npc.id}`);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  async function save() {
    if (!customNpc) return;
    await api(`/api/rooms/${roomId}/npcs/${customNpc.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: customNpc.name, notes: customNpc.notes })
    });
    await load(selected);
  }

  return (
    <div
      className="modal-scrim"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className="modal modal-wide npc-modal"
        role="dialog"
        aria-modal="true"
        aria-label="NPC and monster catalog"
      >
        <header>
          <p className="eyebrow">GM reference</p>
          <h2>NPCs &amp; monsters</h2>
          <button onClick={onClose} aria-label="Close">
            <X />
          </button>
        </header>
        <form className="npc-create" onSubmit={create}>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Custom NPC name"
            maxLength={100}
          />
          <input
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Quick notes"
            maxLength={10000}
          />
          <button className="primary-button">
            <Plus /> Add
          </button>
        </form>
        {error && <p className="form-error npc-error">{error}</p>}
        <div className="npc-workspace">
          <aside>
            <label>
              <Search />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search catalog…" />
            </label>
            {items.map((npc) => (
              <button
                key={npc.key}
                className={selected === npc.key ? "active" : ""}
                onClick={() => setSelected(npc.key)}
              >
                <strong>{npc.name}</strong>
                <small>{npc.kind}</small>
                {roomTags.enabled && <TagChips tags={npc.tags} />}
              </button>
            ))}
          </aside>
          <div className="npc-detail">
            {builtIn && (
              <div className="markdown">
                <RulesMarkdown markdown={builtIn.markdown} idPrefix="npc-reference" />
              </div>
            )}
            {customNpc && (
              <>
                <input
                  value={customNpc.name}
                  onChange={(event) =>
                    setCustom((current) =>
                      current.map((npc) => (npc.id === customNpc.id ? { ...npc, name: event.target.value } : npc))
                    )
                  }
                />
                <textarea
                  value={customNpc.notes}
                  onChange={(event) =>
                    setCustom((current) =>
                      current.map((npc) => (npc.id === customNpc.id ? { ...npc, notes: event.target.value } : npc))
                    )
                  }
                  placeholder="Stats, motives, abilities, and notes…"
                />
                {roomTags.enabled && (
                  <TagField
                    tags={roomTags.tagsOn("npc", customNpc.id)}
                    vocabulary={roomTags.vocabulary}
                    canEdit
                    label="Tags"
                    of={customNpc.name}
                    hint="Faction, location, whatever you look them up by"
                    onChange={(next) => roomTags.save("npc", customNpc.id, next)}
                  />
                )}
                <div className="npc-actions">
                  <button onClick={save}>
                    <Save /> Save
                  </button>
                  <button
                    className="danger-text"
                    onClick={async () => {
                      if (!confirm(`Delete ${customNpc.name}?`)) return;
                      await api(`/api/rooms/${roomId}/npcs/${customNpc.id}`, { method: "DELETE" });
                      await load();
                    }}
                  >
                    <Trash2 /> Delete
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
