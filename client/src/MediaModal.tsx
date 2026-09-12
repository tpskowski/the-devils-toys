import { useEffect, useRef, useState, type ClipboardEvent, type ChangeEvent } from "react";
import { BookOpen, Eye, FileText, FileUp, Radio, Trash2, X } from "lucide-react";
import type { MediaAsset } from "@devils-toys/shared";
import { api } from "./api";
import { isMarkdownAsset, MediaContent } from "./MediaContent";
import { WikiWorkspace } from "./WikiWorkspace";
import type { WikiMentionTarget } from "./RulesMarkdown";

export interface RoomMediaState {
  map: (MediaAsset & { legend?: MapLegend | null }) | null;
  scene: MediaAsset | null;
  references: MediaAsset[];
  library?: MediaAsset[];
  revealedReferenceIds?: number[];
}

/** Sent only where the normal wiki reader gate allows this account to know it. */
export interface MapLegend {
  slug: string;
  title: string;
}

export function MediaModal({
  roomId,
  role,
  accountId,
  media,
  wikiEnabled,
  wikiRevision,
  onChanged,
  onClose,
  onOpenMention,
  wikiPageSlug,
  assetToOpen
}: {
  roomId: number;
  role: "gm" | "player";
  accountId?: number;
  media: RoomMediaState;
  wikiEnabled: boolean;
  wikiRevision: number;
  onChanged: () => Promise<void>;
  onClose: () => void;
  onOpenMention?: (mention: WikiMentionTarget) => void;
  wikiPageSlug?: string;
  assetToOpen?: number;
}) {
  const [kind, setKind] = useState<"map" | "scene" | "reference">("scene");
  const [tab, setTab] = useState<"assets" | "wiki">("assets");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<MediaAsset>();
  const input = useRef<HTMLInputElement>(null);
  const wikiLeaveRequest = useRef<((afterDiscard: () => void) => void) | undefined>(undefined);

  function requestClose() {
    if (tab === "wiki" && wikiLeaveRequest.current) wikiLeaveRequest.current(onClose);
    else onClose();
  }

  function requestTab(next: "assets" | "wiki") {
    if (next === tab) return;
    if (tab === "wiki" && wikiLeaveRequest.current) wikiLeaveRequest.current(() => setTab(next));
    else setTab(next);
  }

  async function upload(file?: File) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const body = new FormData();
      body.append("kind", kind);
      body.append("file", file);
      await api(`/api/rooms/${roomId}/media`, { method: "POST", body });
      await onChanged();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  function choose(event: ChangeEvent<HTMLInputElement>) {
    upload(event.target.files?.[0]);
  }

  function paste(event: ClipboardEvent<HTMLDivElement>) {
    const file = [...event.clipboardData.files].find((item) => item.type.startsWith("image/"));
    if (file) {
      event.preventDefault();
      upload(file);
    }
  }

  async function act(action: "map" | "scene" | "reveal" | "delete", item: MediaAsset) {
    setError("");
    try {
      if (action === "map")
        await api(`/api/rooms/${roomId}/map`, { method: "PATCH", body: JSON.stringify({ mediaId: item.id }) });
      if (action === "scene")
        await api(`/api/rooms/${roomId}/scene`, { method: "PATCH", body: JSON.stringify({ mediaId: item.id }) });
      if (action === "reveal") await api(`/api/rooms/${roomId}/references/${item.id}/reveal`, { method: "POST" });
      if (action === "delete") {
        if (!confirm(`Permanently delete “${item.filename}”?`)) return;
        await api(`/api/rooms/${roomId}/media/${item.id}`, { method: "DELETE" });
      }

      await onChanged();
      if (action === "delete") setPreview(undefined);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  const items = role === "gm" ? (media.library ?? []) : media.references;

  function openWikiMention(mention: WikiMentionTarget) {
    if (mention.kind === "asset") {
      const asset = items.find((item) => item.id === Number(mention.target));
      if (asset) {
        requestTab("assets");
        setPreview(asset);
        return;
      }
    }
    onOpenMention?.(mention);
  }

  useEffect(() => {
    if (!wikiPageSlug) return;
    setTab("wiki");
  }, [wikiPageSlug]);

  useEffect(() => {
    if (!assetToOpen) return;
    const asset = items.find((item) => item.id === assetToOpen);
    if (!asset) return;
    requestTab("assets");
    setPreview(asset);
  }, [assetToOpen, items]);

  return (
    <div
      className="modal-scrim"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && requestClose()}
    >
      <section
        className="modal modal-wide media-modal"
        role="dialog"
        aria-modal="true"
        aria-label={role === "gm" ? "Library" : "References"}
      >
        <header>
          <p className="eyebrow">{role === "gm" ? "Room media" : "Visible media"}</p>
          <h2>{role === "gm" ? "Library" : "References"}</h2>
          <button onClick={requestClose} aria-label="Close">
            <X />
          </button>
        </header>
        {wikiEnabled && (
          <nav className="library-tabs" aria-label="Library contents" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "assets"}
              aria-controls="media-assets-panel"
              className={tab === "assets" ? "is-current" : ""}
              onClick={() => requestTab("assets")}
            >
              {role === "gm" ? "Assets" : "References"}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "wiki"}
              aria-controls="media-wiki-panel"
              className={tab === "wiki" ? "is-current" : ""}
              onClick={() => requestTab("wiki")}
            >
              <BookOpen size={14} /> Wiki
            </button>
          </nav>
        )}
        {tab === "assets" ? (
          <div id="media-assets-panel" role="tabpanel">
            {role === "gm" && (
              <div className="media-upload" onPaste={paste} tabIndex={0}>
                <div>
                  <p className="eyebrow">Add media</p>
                  <p>Maps and Scenes accept PNG, JPEG, or WebP. References also accept Markdown.</p>
                </div>
                <label>
                  Classify as
                  <select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
                    <option value="map">Map</option>
                    <option value="scene">Scene</option>
                    <option value="reference">Reference</option>
                  </select>
                </label>
                <input
                  ref={input}
                  type="file"
                  accept={
                    kind === "reference"
                      ? "image/png,image/jpeg,image/webp,.md,text/markdown,text/plain"
                      : "image/png,image/jpeg,image/webp"
                  }
                  onChange={choose}
                  aria-label="Choose media file"
                  hidden
                />
                <button className="primary-button" disabled={busy} onClick={() => input.current?.click()}>
                  <FileUp /> {busy ? "Uploading…" : "Choose file"}
                </button>
              </div>
            )}
            {error && (
              <p className="form-error media-error" role="alert">
                {error}
              </p>
            )}
            {preview && (
              <section className="reference-preview" aria-label={`Preview ${preview.filename}`}>
                <MediaContent asset={preview} />
                <p>{preview.filename}</p>
              </section>
            )}
            <div className="media-library">
              {!items.length && (
                <div className="media-empty">
                  <Eye />
                  <p>{role === "gm" ? "No media has been added yet." : "No visible References yet."}</p>
                </div>
              )}
              {items.map((item) => (
                <article className="media-card" key={item.id}>
                  <button
                    className="media-thumbnail"
                    onClick={() => setPreview(item)}
                    aria-label={`Open ${item.filename}`}
                  >
                    {isMarkdownAsset(item) ? (
                      <span className="media-document-thumbnail">
                        <FileText />
                      </span>
                    ) : (
                      <img src={item.thumbnailUrl ?? item.url} alt="" loading="lazy" decoding="async" />
                    )}
                  </button>
                  <div>
                    <p className="eyebrow">{item.kind}</p>
                    <strong title={item.filename}>{item.filename}</strong>
                    <small>{Math.max(1, Math.round(item.size / 1024))} KB</small>
                  </div>
                  <div className="media-actions">
                    {role === "gm" && item.kind === "map" && (
                      <button onClick={() => act("map", item)} disabled={media.map?.id === item.id}>
                        <Eye /> {media.map?.id === item.id ? "Current" : "Set Map"}
                      </button>
                    )}
                    {role === "gm" && item.kind === "scene" && (
                      <button onClick={() => act("scene", item)} disabled={media.scene?.id === item.id}>
                        <Eye /> {media.scene?.id === item.id ? "Current" : "Set Scene"}
                      </button>
                    )}
                    {role === "gm" && item.kind === "reference" && (
                      <button
                        onClick={() => act("reveal", item)}
                        disabled={media.revealedReferenceIds?.includes(item.id)}
                      >
                        <Radio /> {media.revealedReferenceIds?.includes(item.id) ? "Revealed" : "Reveal"}
                      </button>
                    )}
                    {role === "gm" && (
                      <button className="danger-text" onClick={() => act("delete", item)} title="Delete">
                        <Trash2 />
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </div>
        ) : (
          <div id="media-wiki-panel" role="tabpanel">
            <WikiWorkspace
              roomId={roomId}
              accountId={accountId}
              isGm={role === "gm"}
              revision={wikiRevision}
              embedded
              onClose={onClose}
              leaveRequestRef={wikiLeaveRequest}
              onOpenMention={openWikiMention}
              initialSlug={wikiPageSlug}
            />
          </div>
        )}
      </section>
    </div>
  );
}
