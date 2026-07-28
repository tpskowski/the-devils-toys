import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from "react";
import {
  Check,
  Eye,
  EyeOff,
  FileText,
  FileUp,
  Image as ImageIcon,
  Pencil,
  Radio,
  Search,
  Trash2,
  X
} from "lucide-react";
import type { MediaAsset } from "@devils-toys/shared";
import { api } from "./api";
import { isMarkdownAsset } from "./MediaContent";
import { mediaKindLabel, mediaLabel } from "./media-label";
import type { RoomMediaState } from "./MediaModal";

type LibraryFilter = "all" | "map" | "scene" | "reference";
type UploadKind = Exclude<LibraryFilter, "all">;

export function LibraryModal({
  roomId,
  media,
  onChanged,
  onClose
}: {
  roomId: number;
  media: RoomMediaState;
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [query, setQuery] = useState("");
  const [uploadKind, setUploadKind] = useState<UploadKind>("scene");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [editingId, setEditingId] = useState<number>();
  const [editName, setEditName] = useState("");
  const [deletingId, setDeletingId] = useState<number>();
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === "Escape" && !editingId && onClose();
    addEventListener("keydown", close);
    return () => removeEventListener("keydown", close);
  }, [editingId, onClose]);

  const library = media.library ?? [];
  const items = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return library.filter(
      (item) =>
        (filter === "all" || item.kind === filter) &&
        (!needle || mediaLabel(item).toLowerCase().includes(needle) || item.filename.toLowerCase().includes(needle))
    );
  }, [filter, library, query]);

  function isActive(item: MediaAsset) {
    if (item.kind === "map") return media.map?.id === item.id;
    if (item.kind === "scene") return media.scene?.id === item.id;
    return item.visible;
  }

  async function upload(files: File[]) {
    if (!files.length) return;
    setError("");
    let uploaded = 0;
    try {
      for (const [index, file] of files.entries()) {
        setBusy(`Uploading ${index + 1} of ${files.length}?`);
        const body = new FormData();
        body.append("kind", uploadKind);
        body.append("file", file);
        await api(`/api/rooms/${roomId}/media`, { method: "POST", body });
        uploaded += 1;
      }
      if (uploaded) await onChanged();
    } catch (cause) {
      setError(`${uploaded ? `${uploaded} uploaded. ` : ""}${(cause as Error).message}`);
      if (uploaded) await onChanged();
    } finally {
      setBusy("");
      if (input.current) input.current.value = "";
    }
  }

  function choose(event: ChangeEvent<HTMLInputElement>) {
    void upload([...(event.target.files ?? [])]);
  }

  function drop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    void upload([...event.dataTransfer.files]);
  }

  async function setActive(item: MediaAsset) {
    setError("");
    setBusy(`Setting ${mediaLabel(item)}?`);
    try {
      if (item.kind === "reference") {
        await api(`/api/rooms/${roomId}/references/${item.id}/reveal`, { method: "POST" });
      } else {
        await api(`/api/rooms/${roomId}/${item.kind}`, {
          method: "PATCH",
          body: JSON.stringify({ mediaId: item.id })
        });
      }
      await onChanged();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function toggleVisibility(item: MediaAsset) {
    setError("");
    setBusy(`${item.visible ? "Hiding" : "Showing"} ${mediaLabel(item)}?`);
    try {
      await api(`/api/rooms/${roomId}/media/${item.id}/visibility`, {
        method: "PATCH",
        body: JSON.stringify({ visible: !item.visible })
      });
      await onChanged();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy("");
    }
  }

  function beginRename(item: MediaAsset) {
    setDeletingId(undefined);
    setEditingId(item.id);
    setEditName(item.displayName ?? mediaLabel(item));
  }

  async function rename(event: FormEvent, item: MediaAsset) {
    event.preventDefault();
    setError("");
    setBusy(`Renaming ${mediaLabel(item)}?`);
    try {
      await api(`/api/rooms/${roomId}/media/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ displayName: editName.trim() || null })
      });
      setEditingId(undefined);
      await onChanged();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function remove(item: MediaAsset) {
    setError("");
    setBusy(`Deleting ${mediaLabel(item)}?`);
    try {
      await api(`/api/rooms/${roomId}/media/${item.id}`, { method: "DELETE" });
      setDeletingId(undefined);
      await onChanged();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy("");
    }
  }

  return (
    <div
      className="modal-scrim library-scrim"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section className="modal library-modal" role="dialog" aria-modal="true" aria-label="Library manager">
        <header>
          <div>
            <p className="eyebrow">Room media</p>
            <h2>Library</h2>
            <p className="library-summary">
              {library.length} {library.length === 1 ? "asset" : "assets"} in this room
            </p>
          </div>
          <button onClick={onClose} aria-label="Close Library">
            <X />
          </button>
        </header>

        <div
          className={`library-upload${dragging ? " is-dragging" : ""}`}
          onDragEnter={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => event.currentTarget === event.target && setDragging(false)}
          onDrop={drop}
        >
          <div className="library-upload-copy">
            <FileUp />
            <div>
              <strong>{dragging ? "Drop files to add them" : "Add to Library"}</strong>
              <span>PNG, JPEG, WebP{uploadKind === "reference" ? ", or Markdown" : ""}</span>
            </div>
          </div>
          <label>
            <span>Use as</span>
            <select
              value={uploadKind}
              onChange={(event) => setUploadKind(event.target.value as UploadKind)}
              disabled={Boolean(busy)}
            >
              <option value="map">Map</option>
              <option value="scene">Scene</option>
              <option value="reference">Reference</option>
            </select>
          </label>
          <input
            ref={input}
            type="file"
            multiple
            accept={
              uploadKind === "reference"
                ? "image/png,image/jpeg,image/webp,.md,text/markdown,text/plain"
                : "image/png,image/jpeg,image/webp"
            }
            onChange={choose}
            hidden
          />
          <button
            className="primary-button library-upload-button"
            onClick={() => input.current?.click()}
            disabled={Boolean(busy)}
          >
            <FileUp /> {busy.startsWith("Uploading") ? busy : "Choose files"}
          </button>
        </div>

        <div className="library-tools">
          <label className="library-search">
            <Search />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search Library"
              aria-label="Search Library"
            />
            {query && (
              <button onClick={() => setQuery("")} aria-label="Clear search">
                <X />
              </button>
            )}
          </label>
          <div className="library-filters" role="group" aria-label="Filter Library">
            {(["all", "map", "scene", "reference"] as const).map((value) => (
              <button key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>
                {value === "all" ? "All" : mediaKindLabel(value)}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <p className="form-error library-error" role="alert">
            {error}
          </p>
        )}
        {busy && !busy.startsWith("Uploading") && (
          <p className="library-busy" aria-live="polite">
            {busy}
          </p>
        )}

        <div className="library-grid">
          {!items.length && (
            <div className="library-empty">
              <ImageIcon />
              <strong>{library.length ? "No matching assets" : "Your Library is empty"}</strong>
              <p>
                {library.length ? "Try another search or filter." : "Upload a Map, Scene, or Reference to get started."}
              </p>
            </div>
          )}
          {items.map((item) => {
            const active = isActive(item);
            const editing = editingId === item.id;
            const confirmingDelete = deletingId === item.id;
            return (
              <article className={`library-item${active ? " is-active" : ""}`} key={item.id}>
                <div className="library-thumb">
                  {isMarkdownAsset(item) ? <FileText /> : <img src={item.url} alt="" />}
                  <span className="library-kind">{mediaKindLabel(item.kind)}</span>
                  {active && (
                    <span className="library-active-badge">
                      <Check /> {item.kind === "reference" ? "Revealed" : "Active"}
                    </span>
                  )}
                </div>

                <div className="library-item-body">
                  {editing ? (
                    <form className="library-rename" onSubmit={(event) => void rename(event, item)}>
                      <label htmlFor={`media-name-${item.id}`}>Display name</label>
                      <div>
                        <input
                          id={`media-name-${item.id}`}
                          value={editName}
                          maxLength={120}
                          onChange={(event) => setEditName(event.target.value)}
                          autoFocus
                          placeholder={mediaLabel({ ...item, displayName: null })}
                        />
                        <button type="submit" disabled={Boolean(busy)} aria-label="Save name">
                          <Check />
                        </button>
                        <button type="button" onClick={() => setEditingId(undefined)} aria-label="Cancel rename">
                          <X />
                        </button>
                      </div>
                      <small>Leave blank to use the original file name.</small>
                    </form>
                  ) : (
                    <div className="library-item-title">
                      <strong title={item.filename}>{mediaLabel(item)}</strong>
                      <span>{Math.max(1, Math.round(item.size / 1024)).toLocaleString()} KB</span>
                    </div>
                  )}

                  {!editing && (
                    <div className="library-actions">
                      <button onClick={() => void setActive(item)} disabled={active || Boolean(busy)}>
                        {item.kind === "reference" ? <Radio /> : <Eye />}
                        {active
                          ? item.kind === "reference"
                            ? "Revealed"
                            : "Active"
                          : item.kind === "reference"
                            ? "Reveal"
                            : "Set active"}
                      </button>
                      <button onClick={() => beginRename(item)} disabled={Boolean(busy)} title="Rename">
                        <Pencil />
                        <span>Rename</span>
                      </button>
                      <button
                        className={`library-visibility${item.visible ? " is-visible" : ""}`}
                        onClick={() => void toggleVisibility(item)}
                        disabled={Boolean(busy)}
                        aria-pressed={item.visible}
                        title={item.visible ? "Hide from players" : "Show to players"}
                      >
                        {item.visible ? <Eye /> : <EyeOff />}
                        <span>{item.visible ? "Visible" : "Hidden"}</span>
                      </button>
                      {confirmingDelete ? (
                        <span className="library-delete-confirm">
                          <button onClick={() => void remove(item)} disabled={Boolean(busy)}>
                            Delete
                          </button>
                          <button onClick={() => setDeletingId(undefined)}>Cancel</button>
                        </span>
                      ) : (
                        <button
                          className="danger-text"
                          onClick={() => {
                            setEditingId(undefined);
                            setDeletingId(item.id);
                          }}
                          disabled={Boolean(busy)}
                          title="Delete"
                        >
                          <Trash2 />
                          <span>Delete</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
