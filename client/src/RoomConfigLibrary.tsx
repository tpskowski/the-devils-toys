import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Eye, EyeOff, FileText, FileUp, Image as ImageIcon, Map as MapIcon, Radio, Trash2 } from "lucide-react";
import type { MediaAsset } from "@devils-toys/shared";
import { api } from "./api";
import { isMarkdownAsset } from "./MediaContent";
import { mediaKindLabel, mediaLabel } from "./media-label";

type LibraryCategory = "map" | "scene" | "reference";
type Filter = "all" | LibraryCategory | "orphans";

interface LibraryPayload {
  map: MediaAsset | null;
  scene: MediaAsset | null;
  library: MediaAsset[];
}

const categories: LibraryCategory[] = ["map", "scene", "reference"];

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * An asset nothing is using: a reference the room has never revealed, or an
 * image filed as a Map or a Scene that has never been the active one. Worked out
 * here rather than asked of the server, because everything it needs is already
 * in the payload the table is drawn from.
 */
function isOrphan(asset: MediaAsset, payload: LibraryPayload) {
  if (asset.kind === "reference") return !asset.visible;
  if (asset.kind === "map") return payload.map?.id !== asset.id;
  return payload.scene?.id !== asset.id;
}

export function RoomConfigLibrary({ roomId, revision }: { roomId: number; revision: number }) {
  const [payload, setPayload] = useState<LibraryPayload>();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState<number[]>([]);
  const [renaming, setRenaming] = useState<number>();
  const [renameValue, setRenameValue] = useState("");
  const [uploadAs, setUploadAs] = useState<LibraryCategory>("scene");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setPayload(await api<LibraryPayload>(`/api/rooms/${roomId}/media`));
  }, [roomId]);

  useEffect(() => {
    load().catch((cause) => setError((cause as Error).message));
  }, [load, revision]);

  const shown = useMemo(() => {
    if (!payload) return [];
    const needle = query.trim().toLocaleLowerCase();
    return payload.library.filter((asset) => {
      if (filter === "orphans" ? !isOrphan(asset, payload) : filter !== "all" && asset.kind !== filter) return false;
      if (!needle) return true;
      return `${mediaLabel(asset)} ${asset.filename} ${asset.kind}`.toLocaleLowerCase().includes(needle);
    });
  }, [payload, filter, query]);

  // A selection survives a refresh only where the asset did, so acting on it
  // can never reach something that has since been deleted elsewhere.
  useEffect(() => {
    if (!payload) return;
    const present = new Set(payload.library.map((asset) => asset.id));
    setSelection((current) => current.filter((id) => present.has(id)));
  }, [payload]);

  const selected = selection.filter((id) => shown.some((asset) => asset.id === id));
  const allShownSelected = shown.length > 0 && shown.every((asset) => selection.includes(asset.id));

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

  const bulk = (body: Record<string, unknown>) =>
    api(`/api/rooms/${roomId}/media/bulk`, { method: "PATCH", body: JSON.stringify({ ids: selected, ...body }) });

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    if (!files.length) return;
    await act(`Uploading ${files.length} file${files.length === 1 ? "" : "s"}…`, async () => {
      for (const file of files) {
        const form = new FormData();
        form.append("file", file);
        form.append("kind", uploadAs);
        await api(`/api/rooms/${roomId}/media`, { method: "POST", body: form });
      }
    });
  }

  async function saveName(asset: MediaAsset) {
    const next = renameValue.trim();
    setRenaming(undefined);
    if (next === (asset.displayName ?? "")) return;
    await act("Renaming…", () =>
      api(`/api/rooms/${roomId}/media/${asset.id}`, {
        method: "PATCH",
        body: JSON.stringify({ displayName: next || null })
      })
    );
  }

  if (!payload) return <p className="room-config-muted">{error || "Loading the library…"}</p>;

  const orphans = payload.library.filter((asset) => isOrphan(asset, payload)).length;

  return (
    <div className="rc-library">
      <div className="rc-toolbar">
        <div className="rc-filters" role="group" aria-label="Filter the library">
          {(["all", ...categories, "orphans"] as Filter[]).map((option) => (
            <button
              key={option}
              type="button"
              className={filter === option ? "is-current" : ""}
              onClick={() => setFilter(option)}
            >
              {option === "all"
                ? `All (${payload.library.length})`
                : option === "orphans"
                  ? `Unused (${orphans})`
                  : `${mediaKindLabel(option)}s (${payload.library.filter((asset) => asset.kind === option).length})`}
            </button>
          ))}
        </div>
        <input
          className="rc-search"
          value={query}
          placeholder="Search names and files"
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="rc-upload">
          <select value={uploadAs} onChange={(event) => setUploadAs(event.target.value as LibraryCategory)}>
            {categories.map((category) => (
              <option key={category} value={category}>
                Upload as {mediaKindLabel(category)}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => fileInput.current?.click()} disabled={Boolean(busy)}>
            <FileUp size={15} /> Add files
          </button>
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            accept={
              uploadAs === "reference" ? "image/png,image/jpeg,image/webp,.md" : "image/png,image/jpeg,image/webp"
            }
            onChange={upload}
          />
        </div>
      </div>

      {error && <p className="room-config-error">{error}</p>}
      {busy && <p className="room-config-muted">{busy}</p>}

      {selected.length > 0 && (
        <div className="rc-bulk">
          <span>
            {selected.length} selected
            {confirmingDelete && " — deleting these cannot be undone"}
          </span>
          {confirmingDelete ? (
            <>
              <button
                type="button"
                className="rc-danger"
                onClick={() =>
                  act(`Deleting ${selected.length}…`, async () => {
                    await api(`/api/rooms/${roomId}/media/bulk-delete`, {
                      method: "POST",
                      body: JSON.stringify({ ids: selected })
                    });
                    setConfirmingDelete(false);
                    setSelection([]);
                  })
                }
              >
                <Trash2 size={14} /> Delete {selected.length}
              </button>
              <button type="button" onClick={() => setConfirmingDelete(false)}>
                Keep them
              </button>
            </>
          ) : (
            <>
              {categories.map((category) => (
                <button
                  key={category}
                  type="button"
                  onClick={() => act("Refiling…", () => bulk({ category }))}
                  disabled={Boolean(busy)}
                >
                  File as {mediaKindLabel(category)}
                </button>
              ))}
              <button type="button" onClick={() => act("Showing…", () => bulk({ visible: true }))}>
                <Eye size={14} /> Show
              </button>
              <button type="button" onClick={() => act("Hiding…", () => bulk({ visible: false }))}>
                <EyeOff size={14} /> Hide
              </button>
              <button type="button" className="rc-danger" onClick={() => setConfirmingDelete(true)}>
                <Trash2 size={14} /> Delete
              </button>
            </>
          )}
        </div>
      )}

      <div className="rc-table-wrap">
        <table className="rc-table">
          <thead>
            <tr>
              <th scope="col" className="rc-check">
                <input
                  type="checkbox"
                  checked={allShownSelected}
                  aria-label="Select everything shown"
                  onChange={() => setSelection(allShownSelected ? [] : shown.map((asset) => asset.id))}
                />
              </th>
              <th scope="col">Name</th>
              <th scope="col">Filed as</th>
              <th scope="col">Size</th>
              <th scope="col">Visible</th>
              <th scope="col">In use</th>
              <th scope="col" className="rc-actions-column">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((asset) => {
              const active =
                payload.map?.id === asset.id ? "Active map" : payload.scene?.id === asset.id ? "Active scene" : "";
              return (
                <tr key={asset.id} className={selection.includes(asset.id) ? "is-selected" : ""}>
                  <td className="rc-check">
                    <input
                      type="checkbox"
                      checked={selection.includes(asset.id)}
                      aria-label={`Select ${mediaLabel(asset)}`}
                      onChange={() =>
                        setSelection((current) =>
                          current.includes(asset.id) ? current.filter((id) => id !== asset.id) : [...current, asset.id]
                        )
                      }
                    />
                  </td>
                  <td>
                    {renaming === asset.id ? (
                      <input
                        autoFocus
                        className="rc-rename"
                        value={renameValue}
                        onChange={(event) => setRenameValue(event.target.value)}
                        onBlur={() => saveName(asset)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") saveName(asset);
                          if (event.key === "Escape") setRenaming(undefined);
                        }}
                      />
                    ) : (
                      <button
                        type="button"
                        className="rc-name"
                        title="Rename"
                        onClick={() => {
                          setRenaming(asset.id);
                          setRenameValue(asset.displayName ?? "");
                        }}
                      >
                        {isMarkdownAsset(asset) ? <FileText size={14} /> : <ImageIcon size={14} />}
                        <span>{mediaLabel(asset)}</span>
                      </button>
                    )}
                    <small>{asset.filename}</small>
                  </td>
                  <td>{mediaKindLabel(asset.kind)}</td>
                  <td>{formatSize(asset.size)}</td>
                  <td>
                    <button
                      type="button"
                      className={`rc-eye${asset.visible ? " is-open" : ""}`}
                      aria-pressed={asset.visible}
                      disabled={Boolean(busy)}
                      title={
                        asset.visible
                          ? `Hide ${mediaLabel(asset)} from the room`
                          : `Show ${mediaLabel(asset)} to the room`
                      }
                      aria-label={
                        asset.visible
                          ? `Hide ${mediaLabel(asset)} from the room`
                          : `Show ${mediaLabel(asset)} to the room`
                      }
                      onClick={() =>
                        act(asset.visible ? "Hiding…" : "Showing…", () =>
                          api(`/api/rooms/${roomId}/media/${asset.id}/visibility`, {
                            method: "PATCH",
                            body: JSON.stringify({ visible: !asset.visible })
                          })
                        )
                      }
                    >
                      {asset.visible ? <Eye size={15} /> : <EyeOff size={15} />}
                    </button>
                  </td>
                  <td className={active ? "" : "room-config-muted"}>{active || "Unused"}</td>
                  <td className="rc-actions-column">
                    {asset.kind !== "reference" ? (
                      <button
                        type="button"
                        title={`Make this the room's ${asset.kind}`}
                        disabled={Boolean(active) || Boolean(busy)}
                        onClick={() =>
                          act("Setting…", () =>
                            api(`/api/rooms/${roomId}/${asset.kind}`, {
                              method: "PATCH",
                              body: JSON.stringify({ mediaId: asset.id })
                            })
                          )
                        }
                      >
                        <MapIcon size={14} /> Make active
                      </button>
                    ) : (
                      <button
                        type="button"
                        title="Reveal this reference to the room"
                        disabled={asset.visible || Boolean(busy)}
                        onClick={() =>
                          act("Revealing…", () =>
                            api(`/api/rooms/${roomId}/references/${asset.id}/reveal`, { method: "POST" })
                          )
                        }
                      >
                        <Radio size={14} /> Reveal
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {shown.length === 0 && (
          <p className="room-config-muted rc-empty">
            {payload.library.length === 0 ? "Nothing in the library yet." : "Nothing matches that."}
          </p>
        )}
      </div>
    </div>
  );
}
