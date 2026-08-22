import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { ArrowDown, ArrowUp, Check, FileUp, GripVertical, ListMusic, Pencil, Plus, Trash2, X } from "lucide-react";
import type { MediaAsset, RoomAudioState, RoomPlaylist } from "@devils-toys/shared";
import { api } from "./api";

/** The drag payload: a position in the running order, not a track id. */
const SLOT = "application/x-devils-toys-playlist-slot";

function trackLabel(track: MediaAsset) {
  const title = track.title?.trim();
  const artist = track.artist?.trim();
  if (title && artist) return `${artist} — ${title}`;
  return title || track.filename;
}

function move<T>(items: T[], from: number, to: number) {
  if (to < 0 || to >= items.length || from === to) return items;
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * An album plays in the order it was pressed in, so a track number decides the
 * order and the name settles ties. A track with no number is a loose track and
 * sits after the numbered ones rather than in front of them.
 */
function byTrackOrder(left: MediaAsset, right: MediaAsset) {
  const first = left.trackNo ?? Number.MAX_SAFE_INTEGER;
  const second = right.trackNo ?? Number.MAX_SAFE_INTEGER;
  if (first !== second) return first - second;
  return trackLabel(left).localeCompare(trackLabel(right));
}

interface Album {
  /** The album's name, or an empty string for the tracks that name none. */
  name: string;
  tracks: MediaAsset[];
}

/**
 * The room's music as albums. Tracks the tag reader found no album for are
 * gathered into one unnamed group and kept last, so an untagged upload never
 * pushes itself in among the albums.
 */
function albums(tracks: MediaAsset[]): Album[] {
  const groups = new Map<string, MediaAsset[]>();
  for (const track of tracks) {
    const name = track.album?.trim() ?? "";
    groups.set(name, [...(groups.get(name) ?? []), track]);
  }
  return [...groups]
    .map(([name, held]) => ({ name, tracks: [...held].sort(byTrackOrder) }))
    .sort((left, right) => {
      if (!left.name || !right.name) return left.name ? -1 : right.name ? 1 : 0;
      return left.name.localeCompare(right.name);
    });
}

const unfiled = "No album";

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
  const [tagDraft, setTagDraft] = useState({ artist: "", title: "", album: "", trackNo: "" });
  const [confirmingDelete, setConfirmingDelete] = useState<number>();
  const [grouped, setGrouped] = useState(true);
  const [dragging, setDragging] = useState<number>();
  const [over, setOver] = useState<number>();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

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
  const library = useMemo(() => albums(audio?.tracks ?? []), [audio]);
  const unheld = useMemo(() => albums(rest), [rest]);

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

  /**
   * Music arrives here as well as from the room, because this is the screen a GM
   * is on when they are putting a soundtrack together and going back into the
   * room to add the file they forgot is not part of that job.
   *
   * A file at a time, so one the server refuses — not really an MP3, past the
   * size limit, past the server's storage allowance — costs itself and not the
   * rest of the selection. What failed is named beside what went in.
   */
  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    if (!files.length) return;
    setError("");
    const failures: string[] = [];
    try {
      for (const [index, file] of files.entries()) {
        setBusy(`Uploading ${index + 1} of ${files.length}…`);
        const form = new FormData();
        form.append("file", file);
        try {
          await api(`/api/rooms/${roomId}/audio`, { method: "POST", body: form });
        } catch (cause) {
          failures.push(`${file.name}: ${(cause as Error).message}`);
        }
      }
      await load();
    } catch (cause) {
      failures.push((cause as Error).message);
    } finally {
      setBusy("");
      setError(failures.join(" "));
    }
  }

  const setTracks = (playlist: RoomPlaylist, trackIds: number[]) =>
    act("Saving…", () =>
      api(`/api/rooms/${roomId}/playlists/${playlist.id}`, { method: "PATCH", body: JSON.stringify({ trackIds }) })
    );

  // The running order as the screen shows it. A playlist naming a track that has
  // gone is simply shorter, so moving by position works off this and not off the
  // stored ids, which may still carry the name of something deleted.
  const heldIds = held.map((track) => track.id);

  const add = (ids: number[]) => selected && setTracks(selected, [...heldIds, ...ids]);

  /**
   * Where the dragged track lands. The position it started from travels in the
   * drag itself rather than in state, so the drop reads it back from the event
   * that carried it and never depends on a render having happened in between.
   */
  function drop(event: { dataTransfer: DataTransfer }, to: number) {
    setOver(undefined);
    setDragging(undefined);
    const from = Number(event.dataTransfer.getData(SLOT));
    if (selected && Number.isInteger(from) && from >= 0 && from < heldIds.length)
      setTracks(selected, move(heldIds, from, to));
  }

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
            <small className="room-config-muted">Played in this order — drag a track to move it</small>
          </header>
          {held.length === 0 ? (
            <p className="room-config-muted">Nothing in it yet. Add tracks from the room’s music below.</p>
          ) : (
            <ol className="rc-slot-list rc-running-order">
              {held.map((track, index) => (
                <li
                  key={track.id}
                  className={`${dragging === index ? "is-dragging" : ""}${over === index ? " is-over" : ""}`}
                  onDragOver={(event) => {
                    if (!event.dataTransfer.types.includes(SLOT)) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    setOver(index);
                  }}
                  onDragLeave={() => setOver((current) => (current === index ? undefined : current))}
                  onDrop={(event) => {
                    event.preventDefault();
                    drop(event, index);
                  }}
                >
                  {/* Dragging is the quick way; the arrows beside it are the one
                      a keyboard and a phone can both take. */}
                  <span
                    className="rc-grip"
                    draggable={!busy}
                    aria-hidden="true"
                    title={`Drag ${trackLabel(track)} to move it`}
                    onDragStart={(event) => {
                      event.dataTransfer.setData(SLOT, String(index));
                      event.dataTransfer.effectAllowed = "move";
                      setDragging(index);
                    }}
                    onDragEnd={() => {
                      setDragging(undefined);
                      setOver(undefined);
                    }}
                  >
                    <GripVertical size={14} />
                  </span>
                  <span className="rc-ordinal">{index + 1}</span>
                  <span className="rc-track-name">{trackLabel(track)}</span>
                  {track.album?.trim() && <small className="rc-track-album">{track.album.trim()}</small>}
                  <button
                    type="button"
                    title="Move up"
                    aria-label={`Move ${trackLabel(track)} up`}
                    disabled={index === 0 || Boolean(busy)}
                    onClick={() => setTracks(selected, move(heldIds, index, index - 1))}
                  >
                    <ArrowUp size={13} />
                  </button>
                  <button
                    type="button"
                    title="Move down"
                    aria-label={`Move ${trackLabel(track)} down`}
                    disabled={index === held.length - 1 || Boolean(busy)}
                    onClick={() => setTracks(selected, move(heldIds, index, index + 1))}
                  >
                    <ArrowDown size={13} />
                  </button>
                  <button
                    type="button"
                    className="rc-danger"
                    title="Take it out of this playlist"
                    aria-label={`Take ${trackLabel(track)} out of ${selected.name}`}
                    onClick={() =>
                      setTracks(
                        selected,
                        heldIds.filter((id) => id !== track.id)
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
            <footer className="rc-playlist-add">
              <div className="rc-playlist-add-head">
                <span className="room-config-muted">Add to {selected.name}:</span>
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => add(unheld.flatMap((album) => album.tracks).map((track) => track.id))}
                >
                  <Plus size={13} /> Add all {rest.length}
                </button>
              </div>
              {unheld.map((album) => (
                <div key={album.name || unfiled} className="rc-add-album">
                  <div className="rc-add-album-head">
                    <strong>{album.name || unfiled}</strong>
                    <button
                      type="button"
                      disabled={Boolean(busy)}
                      onClick={() => add(album.tracks.map((track) => track.id))}
                    >
                      <Plus size={13} /> Add {album.tracks.length}
                    </button>
                  </div>
                  <div className="rc-add-tracks">
                    {album.tracks.map((track) => (
                      <button key={track.id} type="button" disabled={Boolean(busy)} onClick={() => add([track.id])}>
                        <Plus size={13} /> {track.trackNo ? `${track.trackNo}. ` : ""}
                        {trackLabel(track)}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </footer>
          )}
        </section>
      )}

      <section className="rc-panel-block">
        <header>
          <h3>The room’s music</h3>
          <small className="room-config-muted">
            {audio.tracks.length} track{audio.tracks.length === 1 ? "" : "s"} ·{" "}
            {library.filter((album) => album.name).length} album
            {library.filter((album) => album.name).length === 1 ? "" : "s"}
          </small>
          <div className="rc-upload">
            <button type="button" onClick={() => fileInput.current?.click()} disabled={Boolean(busy)}>
              <FileUp size={15} /> Add MP3s
            </button>
            <input ref={fileInput} type="file" multiple hidden accept="audio/mpeg,.mp3" onChange={upload} />
          </div>
          <label className="rc-checkbox">
            <input type="checkbox" checked={grouped} onChange={(event) => setGrouped(event.target.checked)} />
            Group by album
          </label>
        </header>
        {audio.tracks.length === 0 ? (
          <p className="room-config-muted">No music yet. Add MP3s above and their tags are read as they arrive.</p>
        ) : (
          <div className="rc-table-wrap">
            <table className="rc-table rc-music-table">
              <thead>
                <tr>
                  <th scope="col" className="rc-track-no">
                    #
                  </th>
                  <th scope="col">Title</th>
                  <th scope="col">Artist</th>
                  <th scope="col">Album</th>
                  <th scope="col">File</th>
                  <th scope="col">In</th>
                  <th scope="col" className="rc-actions-column">
                    Actions
                  </th>
                </tr>
              </thead>
              {(grouped ? library : [{ name: "", tracks: audio.tracks }]).map((album) => (
                <tbody key={grouped ? album.name || unfiled : "all"}>
                  {grouped && (
                    <tr className="rc-album-row">
                      <th scope="colgroup" colSpan={7}>
                        {album.name || unfiled}
                        <small>
                          {album.tracks.length} track{album.tracks.length === 1 ? "" : "s"}
                        </small>
                      </th>
                    </tr>
                  )}
                  {album.tracks.map((track) => {
                    const inLists = playlists.filter((entry) => entry.trackIds.includes(track.id));
                    const editing = editingTags === track.id;
                    return (
                      <tr key={track.id}>
                        <td className="rc-track-no">
                          {editing ? (
                            <input
                              value={tagDraft.trackNo}
                              inputMode="numeric"
                              aria-label="Track number"
                              onChange={(event) =>
                                setTagDraft({ ...tagDraft, trackNo: event.target.value.replace(/\D/g, "").slice(0, 4) })
                              }
                            />
                          ) : (
                            track.trackNo || <span className="room-config-muted">—</span>
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
                              value={tagDraft.album}
                              aria-label="Album"
                              onChange={(event) => setTagDraft({ ...tagDraft, album: event.target.value })}
                            />
                          ) : (
                            track.album?.trim() || <span className="room-config-muted">{unfiled}</span>
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
                                      body: JSON.stringify({
                                        artist: tagDraft.artist,
                                        title: tagDraft.title,
                                        album: tagDraft.album,
                                        trackNo: Number(tagDraft.trackNo) || null
                                      })
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
                                  setTagDraft({
                                    artist: track.artist ?? "",
                                    title: track.title ?? "",
                                    album: track.album ?? "",
                                    trackNo: track.trackNo ? String(track.trackNo) : ""
                                  });
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
              ))}
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
