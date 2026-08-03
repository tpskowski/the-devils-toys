import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Check, ListMusic, Pencil, Plus, Trash2, X } from "lucide-react";
import type { MediaAsset, RoomAudioState, RoomPlaylist } from "@devils-toys/shared";
import { api } from "./api";

function trackLabel(track: MediaAsset) {
  const title = track.title?.trim();
  const artist = track.artist?.trim();
  if (title && artist) return `${artist} — ${title}`;
  return title || track.filename;
}

function move<T>(items: T[], from: number, to: number) {
  if (to < 0 || to >= items.length) return items;
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * Playlists, and the room's music beside them. Building a running order and
 * fixing what the tag reader got wrong are the same job, so they are one screen
 * rather than a Library that owns the tracks and a section that owns the lists.
 *
 * Choosing which playlist is playing is not here. That is a live act, and it
 * stays in the room with the rest of the transport.
 */
export function RoomConfigPlaylists({ roomId, revision }: { roomId: number; revision: number }) {
  const [audio, setAudio] = useState<RoomAudioState>();
  const [selectedId, setSelectedId] = useState<number>();
  const [renaming, setRenaming] = useState<number>();
  const [renameValue, setRenameValue] = useState("");
  const [editingTags, setEditingTags] = useState<number>();
  const [tagDraft, setTagDraft] = useState({ artist: "", title: "" });
  const [confirmingDelete, setConfirmingDelete] = useState<number>();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setAudio(await api<RoomAudioState>(`/api/rooms/${roomId}/audio`));
  }, [roomId]);

  useEffect(() => {
    load().catch((cause) => setError((cause as Error).message));
  }, [load, revision]);

  const playlists = audio?.playlists ?? [];
  const selected = playlists.find((entry) => entry.id === selectedId);
  const held = useMemo(
    () => (selected?.trackIds ?? []).flatMap((id) => (audio?.tracks ?? []).filter((track) => track.id === id)),
    [selected, audio]
  );
  const rest = useMemo(
    () => (audio?.tracks ?? []).filter((track) => !selected?.trackIds.includes(track.id)),
    [selected, audio]
  );

  async function act(label: string, action: () => Promise<unknown>) {
    setBusy(label);
    setError("");
    try {
      await action();
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy("");
    }
  }

  const setTracks = (playlist: RoomPlaylist, trackIds: number[]) =>
    act("Saving…", () =>
      api(`/api/rooms/${roomId}/playlists/${playlist.id}`, { method: "PATCH", body: JSON.stringify({ trackIds }) })
    );

  if (!audio) return <p className="room-config-muted">{error || "Loading the music…"}</p>;

  return (
    <div className="rc-playlists">
      {error && <p className="room-config-error">{error}</p>}
      {busy && <p className="room-config-muted">{busy}</p>}

      <section className="rc-panel-block">
        <header>
          <h3>Playlists</h3>
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() =>
              act("Adding…", async () => {
                const result = await api<{ playlist: RoomPlaylist }>(`/api/rooms/${roomId}/playlists`, {
                  method: "POST",
                  body: JSON.stringify({ name: "New playlist" })
                });
                setSelectedId(result.playlist.id);
              })
            }
          >
            <Plus size={14} /> New playlist
          </button>
        </header>
        {playlists.length === 0 ? (
          <p className="room-config-muted">
            No playlists yet. Without one the room plays everything it has, which is what it did before.
          </p>
        ) : (
          <ul className="rc-list">
            {playlists.map((entry) => (
              <li key={entry.id}>
                {renaming === entry.id ? (
                  <input
                    autoFocus
                    className="rc-rename"
                    value={renameValue}
                    onChange={(event) => setRenameValue(event.target.value)}
                    onBlur={() => {
                      setRenaming(undefined);
                      if (renameValue.trim() && renameValue !== entry.name)
                        act("Renaming…", () =>
                          api(`/api/rooms/${roomId}/playlists/${entry.id}`, {
                            method: "PATCH",
                            body: JSON.stringify({ name: renameValue.trim() })
                          })
                        );
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.currentTarget.blur();
                      if (event.key === "Escape") setRenaming(undefined);
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className={entry.id === selectedId ? "is-current" : ""}
                    onClick={() => setSelectedId(entry.id)}
                  >
                    <span>
                      <ListMusic size={13} /> {entry.name}
                    </span>
                    <small>
                      {entry.trackIds.length} track{entry.trackIds.length === 1 ? "" : "s"}
                    </small>
                  </button>
                )}
                <button
                  type="button"
                  className="rc-inline-action"
                  title={`Rename ${entry.name}`}
                  onClick={() => {
                    setRenaming(entry.id);
                    setRenameValue(entry.name);
                  }}
                >
                  <Pencil size={13} />
                </button>
                <button
                  type="button"
                  className="rc-inline-action rc-danger"
                  title={`Delete ${entry.name}`}
                  onClick={() =>
                    act("Deleting…", async () => {
                      await api(`/api/rooms/${roomId}/playlists/${entry.id}`, { method: "DELETE" });
                      setSelectedId((current) => (current === entry.id ? undefined : current));
                    })
                  }
                >
                  <Trash2 size={13} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {selected && (
        <section className="rc-panel-block">
          <header>
            <h3>{selected.name}</h3>
            <small className="room-config-muted">Played in this order</small>
          </header>
          {held.length === 0 ? (
            <p className="room-config-muted">Nothing in it yet. Add tracks from the room’s music below.</p>
          ) : (
            <ol className="rc-slot-list">
              {held.map((track, index) => (
                <li key={track.id}>
                  <span className="rc-ordinal">{index + 1}</span>
                  <span className="rc-track-name">{trackLabel(track)}</span>
                  <button
                    type="button"
                    title="Move up"
                    disabled={index === 0 || Boolean(busy)}
                    onClick={() => setTracks(selected, move(selected.trackIds, index, index - 1))}
                  >
                    <ArrowUp size={13} />
                  </button>
                  <button
                    type="button"
                    title="Move down"
                    disabled={index === held.length - 1 || Boolean(busy)}
                    onClick={() => setTracks(selected, move(selected.trackIds, index, index + 1))}
                  >
                    <ArrowDown size={13} />
                  </button>
                  <button
                    type="button"
                    className="rc-danger"
                    title="Take it out of this playlist"
                    onClick={() =>
                      setTracks(
                        selected,
                        selected.trackIds.filter((id) => id !== track.id)
                      )
                    }
                  >
                    <X size={13} />
                  </button>
                </li>
              ))}
            </ol>
          )}
          {rest.length > 0 && (
            <footer className="rc-roster-add">
              <span className="room-config-muted">Add:</span>
              {rest.map((track) => (
                <button
                  key={track.id}
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => setTracks(selected, [...selected.trackIds, track.id])}
                >
                  <Plus size={13} /> {trackLabel(track)}
                </button>
              ))}
            </footer>
          )}
        </section>
      )}

      <section className="rc-panel-block">
        <header>
          <h3>The room’s music</h3>
          <small className="room-config-muted">
            {audio.tracks.length} track{audio.tracks.length === 1 ? "" : "s"} · uploaded in the room
          </small>
        </header>
        {audio.tracks.length === 0 ? (
          <p className="room-config-muted">No music uploaded yet.</p>
        ) : (
          <div className="rc-table-wrap">
            <table className="rc-table">
              <thead>
                <tr>
                  <th scope="col">Artist</th>
                  <th scope="col">Title</th>
                  <th scope="col">File</th>
                  <th scope="col">In</th>
                  <th scope="col" className="rc-actions-column">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {audio.tracks.map((track) => {
                  const inLists = playlists.filter((entry) => entry.trackIds.includes(track.id));
                  const editing = editingTags === track.id;
                  return (
                    <tr key={track.id}>
                      <td>
                        {editing ? (
                          <input
                            value={tagDraft.artist}
                            aria-label="Artist"
                            onChange={(event) => setTagDraft({ ...tagDraft, artist: event.target.value })}
                          />
                        ) : (
                          track.artist?.trim() || <span className="room-config-muted">Unknown</span>
                        )}
                      </td>
                      <td>
                        {editing ? (
                          <input
                            value={tagDraft.title}
                            aria-label="Title"
                            onChange={(event) => setTagDraft({ ...tagDraft, title: event.target.value })}
                          />
                        ) : (
                          track.title?.trim() || <span className="room-config-muted">Untitled</span>
                        )}
                      </td>
                      <td>
                        <small>{track.filename}</small>
                      </td>
                      <td className={inLists.length ? "" : "room-config-muted"}>
                        {inLists.length ? inLists.map((entry) => entry.name).join(", ") : "No playlist"}
                      </td>
                      <td className="rc-actions-column">
                        {editing ? (
                          <>
                            <button
                              type="button"
                              onClick={() =>
                                act("Saving…", async () => {
                                  await api(`/api/rooms/${roomId}/audio/${track.id}/tags`, {
                                    method: "PATCH",
                                    body: JSON.stringify(tagDraft)
                                  });
                                  setEditingTags(undefined);
                                })
                              }
                            >
                              <Check size={13} /> Save
                            </button>
                            <button type="button" onClick={() => setEditingTags(undefined)}>
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              title="Fix what the tag reader got wrong"
                              onClick={() => {
                                setEditingTags(track.id);
                                setTagDraft({ artist: track.artist ?? "", title: track.title ?? "" });
                              }}
                            >
                              <Pencil size={13} /> Details
                            </button>
                            {confirmingDelete === track.id ? (
                              <>
                                <button
                                  type="button"
                                  className="rc-danger"
                                  onClick={() =>
                                    act("Deleting…", async () => {
                                      await api(`/api/rooms/${roomId}/audio/${track.id}`, { method: "DELETE" });
                                      setConfirmingDelete(undefined);
                                    })
                                  }
                                >
                                  <Trash2 size={13} /> Delete for good
                                </button>
                                <button type="button" onClick={() => setConfirmingDelete(undefined)}>
                                  Keep
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                className="rc-danger"
                                title="Delete this track from the room"
                                onClick={() => setConfirmingDelete(track.id)}
                              >
                                <Trash2 size={13} />
                              </button>
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
