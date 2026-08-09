import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, Pencil, Plus, RotateCcw, Save, Swords, Trash2, X } from "lucide-react";
import type { CharacterItem, RoomConfigRoom, SystemId } from "@devils-toys/shared";
import { ApiError, api } from "./api";

type Source = "system" | "room";
type CatalogueItem = CharacterItem & { source: Source };

interface ItemList {
  key: string;
  label: string;
  items: CatalogueItem[];
}

interface ItemsPayload {
  lists: ItemList[];
  retired: { listKey: string; item: CharacterItem }[];
  counts: { added: number; retired: number };
}

interface Draft {
  listKey: string;
  name: string;
  spec: string;
  detail: string;
  cost: string;
  category: string;
  /** The id being edited, or undefined while adding something new. */
  editing?: string;
}

const blankDraft = (listKey: string): Draft => ({ listKey, name: "", spec: "", detail: "", cost: "", category: "" });

export function RoomConfigItems({
  room,
  system,
  revision
}: {
  room: RoomConfigRoom;
  system: { id: SystemId };
  revision: number;
}) {
  const roomId = room.id;
  const [payload, setPayload] = useState<ItemsPayload>();
  const [listKey, setListKey] = useState<string>();
  const [query, setQuery] = useState("");
  const [onlyMine, setOnlyMine] = useState(false);
  const [draft, setDraft] = useState<Draft>();
  const [copyTargets, setCopyTargets] = useState<RoomConfigRoom[]>([]);
  const [copyTarget, setCopyTarget] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const result = await api<ItemsPayload>(`/api/rooms/${roomId}/items`);
    setPayload(result);
    setListKey((current) => (result.lists.some((list) => list.key === current) ? current : result.lists[0]?.key));
  }, [roomId]);

  useEffect(() => {
    load().catch((cause) => setError((cause as Error).message));
  }, [load, revision]);

  useEffect(() => {
    api<{ rooms: RoomConfigRoom[] }>("/api/room-config/rooms")
      .then((result) =>
        setCopyTargets(result.rooms.filter((entry) => entry.id !== roomId && entry.system === system.id))
      )
      .catch(() => setCopyTargets([]));
  }, [roomId, system.id]);

  const list = payload?.lists.find((entry) => entry.key === listKey);
  const shown = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return (list?.items ?? []).filter((item) => {
      if (onlyMine && item.source !== "room") return false;
      if (!needle) return true;
      return `${item.name} ${item.spec} ${item.detail} ${item.category}`.toLocaleLowerCase().includes(needle);
    });
  }, [list, query, onlyMine]);

  const retiredHere = useMemo(
    () => (payload?.retired ?? []).filter((entry) => entry.listKey === listKey),
    [payload, listKey]
  );

  const mine = useMemo(
    () => (payload?.lists ?? []).flatMap((entry) => entry.items.filter((item) => item.source === "room")),
    [payload]
  );

  async function act(label: string, action: () => Promise<unknown>, success?: string) {
    setBusy(label);
    setError("");
    setNotice("");
    try {
      await action();
      await load();
      if (success) setNotice(success);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : (cause as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function saveDraft() {
    if (!draft) return;
    const body = JSON.stringify(draft);
    await act(
      "Saving…",
      async () => {
        if (draft.editing)
          await api(`/api/rooms/${roomId}/items/${encodeURIComponent(draft.editing)}`, { method: "PATCH", body });
        else await api(`/api/rooms/${roomId}/items`, { method: "POST", body });
        setDraft(undefined);
      },
      draft.editing ? "Saved." : `${draft.name} added to this room.`
    );
  }

  if (!payload) return <p className="room-config-muted">{error || "Loading the catalogue…"}</p>;

  return (
    <div className="rc-items">
      <div className="rc-toolbar">
        <div className="rc-filters" role="group" aria-label="Which list">
          {payload.lists.map((entry) => (
            <button
              key={entry.key}
              type="button"
              className={entry.key === listKey ? "is-current" : ""}
              onClick={() => setListKey(entry.key)}
            >
              {entry.label} ({entry.items.length})
            </button>
          ))}
        </div>
        <input
          className="rc-search"
          value={query}
          placeholder="Search this list"
          onChange={(event) => setQuery(event.target.value)}
        />
        <label className="rc-checkbox">
          <input type="checkbox" checked={onlyMine} onChange={(event) => setOnlyMine(event.target.checked)} />
          <span>Only this room’s ({payload.counts.added})</span>
        </label>
        <button type="button" disabled={!listKey || Boolean(busy)} onClick={() => setDraft(blankDraft(listKey!))}>
          <Plus size={14} /> Add an item
        </button>
      </div>

      {error && <p className="room-config-error">{error}</p>}
      {busy && <p className="room-config-muted">{busy}</p>}
      {notice && <p className="rc-notice">{notice}</p>}

      {draft && (
        <div className="rc-panel-block rc-item-form">
          <header>
            <h3>{draft.editing ? "Edit this room’s item" : `New item in ${list?.label}`}</h3>
            <button type="button" onClick={() => setDraft(undefined)}>
              <X size={14} /> Cancel
            </button>
          </header>
          <div className="rc-field-grid">
            <label>
              <span>Name</span>
              <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
            </label>
            <label>
              <span>Parenthetical</span>
              <input
                value={draft.spec}
                placeholder="D6, bulky"
                onChange={(event) => setDraft({ ...draft, spec: event.target.value })}
              />
            </label>
            <label>
              <span>Cost</span>
              <input value={draft.cost} onChange={(event) => setDraft({ ...draft, cost: event.target.value })} />
            </label>
            <label>
              <span>Category</span>
              <input
                value={draft.category}
                placeholder="As the book files it"
                onChange={(event) => setDraft({ ...draft, category: event.target.value })}
              />
            </label>
          </div>
          <label className="rc-wide-field">
            <span>Description</span>
            <textarea
              rows={3}
              value={draft.detail}
              onChange={(event) => setDraft({ ...draft, detail: event.target.value })}
            />
          </label>
          <Reading draft={draft} />
          <footer className="rc-npc-actions">
            <button
              type="button"
              className="rc-primary"
              disabled={!draft.name.trim() || Boolean(busy)}
              onClick={saveDraft}
            >
              <Save size={14} /> {draft.editing ? "Save changes" : "Add to this room"}
            </button>
          </footer>
        </div>
      )}

      <div className="rc-table-wrap">
        <table className="rc-table">
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col">Reads as</th>
              <th scope="col">Cost</th>
              <th scope="col">From</th>
              <th scope="col" className="rc-actions-column">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((item) => (
              <tr key={item.id}>
                <td>
                  <strong>{item.name}</strong>
                  <small>{item.spec || item.category || "—"}</small>
                </td>
                <td>
                  {item.weapon ? (
                    <span className="rc-weapon">
                      <Swords size={13} /> {item.damage ?? "no die"}
                      {item.traits?.length ? ` · ${item.traits.join(", ")}` : ""}
                    </span>
                  ) : (
                    <span className="room-config-muted">Gear</span>
                  )}
                </td>
                <td>{item.cost || "—"}</td>
                <td className={item.source === "room" ? "" : "room-config-muted"}>
                  {item.source === "room" ? "This room" : "The book"}
                </td>
                <td className="rc-actions-column">
                  {item.source === "room" ? (
                    <>
                      <button
                        type="button"
                        title="Edit"
                        onClick={() =>
                          setDraft({
                            listKey: listKey!,
                            name: item.name,
                            spec: item.spec,
                            detail: item.detail,
                            cost: item.cost,
                            category: item.category,
                            editing: item.id
                          })
                        }
                      >
                        <Pencil size={13} /> Edit
                      </button>
                      <button
                        type="button"
                        className="rc-danger"
                        title="Delete"
                        onClick={() =>
                          act("Deleting…", () =>
                            api(`/api/rooms/${roomId}/items/${encodeURIComponent(item.id)}`, { method: "DELETE" })
                          )
                        }
                      >
                        <Trash2 size={13} />
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        title="Copy it here and change it"
                        onClick={() =>
                          act(
                            "Customising…",
                            () =>
                              api(`/api/rooms/${roomId}/items/${encodeURIComponent(item.id)}/customise`, {
                                method: "POST"
                              }),
                            `${item.name} is now this room’s own.`
                          )
                        }
                      >
                        <Copy size={13} /> Customise
                      </button>
                      <button
                        type="button"
                        className="rc-danger"
                        title="Take it out of this room's pickers"
                        onClick={() =>
                          act("Retiring…", () =>
                            api(`/api/rooms/${roomId}/items/${encodeURIComponent(item.id)}/retire`, { method: "POST" })
                          )
                        }
                      >
                        Retire
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 && <p className="room-config-muted rc-empty">Nothing matches that.</p>}
      </div>

      {retiredHere.length > 0 && (
        <section className="rc-panel-block">
          <header>
            <h3>Retired in this room</h3>
            <small className="room-config-muted">Still on any sheet that already wrote them down</small>
          </header>
          <ul className="rc-list">
            {retiredHere.map(({ item }) => (
              <li key={item.id}>
                {/* Nothing to click: a retired entry is read, and the arrow beside it is the action. */}
                <div className="rc-list-static">
                  <span>{item.name}</span>
                  <small>{item.spec || "—"}</small>
                </div>
                <button
                  type="button"
                  className="rc-inline-action"
                  title={`Put ${item.name} back`}
                  onClick={() =>
                    act("Restoring…", () =>
                      api(`/api/rooms/${roomId}/items/${encodeURIComponent(item.id)}/restore`, { method: "POST" })
                    )
                  }
                >
                  <RotateCcw size={13} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {mine.length > 0 && copyTargets.length > 0 && (
        <footer className="rc-npc-actions">
          <span className="room-config-muted">
            {mine.length} item{mine.length === 1 ? "" : "s"} of this room’s own
          </span>
          <select value={copyTarget} onChange={(event) => setCopyTarget(event.target.value)}>
            <option value="">Copy them all to…</option>
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
                  api(`/api/rooms/${roomId}/items/copy-to`, {
                    method: "POST",
                    body: JSON.stringify({ roomId: Number(copyTarget), itemIds: mine.map((item) => item.id) })
                  }),
                `Copied ${mine.length} to ${target?.name ?? "that room"}.`
              );
            }}
          >
            <Copy size={14} /> Copy
          </button>
        </footer>
      )}
    </div>
  );
}

/**
 * What the parenthetical will be read as, shown before saving. The same reading
 * the rulebook's own entries get, so a GM can see that "D6, bulky" makes a
 * weapon and "3 uses" does not, rather than finding out on a character sheet.
 */
function Reading({ draft }: { draft: Draft }) {
  const spec = draft.spec.trim();
  const damage = /\b\d*[dD]\d+\b/.exec(spec)?.[0];
  const counted = damage ? new RegExp(`${damage}\\s*,?\\s*(uses|charges|rounds|slots)`, "i").test(spec) : false;
  const weapon = Boolean(damage) && !counted;
  return (
    <p className="rc-reading">
      Reads as <strong>{weapon ? `a weapon dealing ${damage}` : "ordinary gear"}</strong>
      {counted && " — a die that counts uses is not damage"}. The server reads it the same way the rulebook is read, and
      what it decides is what the slot will show.
    </p>
  );
}
