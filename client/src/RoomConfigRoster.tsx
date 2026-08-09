import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, CopyPlus, Dices, ImagePlus, Plus, Save, Trash2, UserRound, X } from "lucide-react";
import type { CharacterSheetDefinition, GroupPageDefinition } from "@devils-toys/shared";
import { groupAssetDefinitions } from "@devils-toys/shared";
import { ApiError, api } from "./api";
import { RoomConfigSheetFields } from "./RoomConfigSheetFields";

interface RosterRow {
  id: number;
  name: string;
  kind?: string;
  sheet: Record<string, unknown>;
  sortOrder: number;
  imageUrl: string | null;
  revision: number;
  updatedAt: string;
}

interface GroupPayload {
  definition: GroupPageDefinition;
  hirelings?: RosterRow[];
  assets?: RosterRow[];
}

const imageLimitBytes = 5 * 1024 * 1024;
const imageTypes = new Set(["image/png", "image/jpeg", "image/webp"]);

/**
 * The Hirelings and Group assets sections. They are one component because on
 * rows they are the same thing: a list of records with a name, a sheet the
 * system defines, a picture, and an order. Only the route and the labels differ.
 */
export function RoomConfigRoster({
  roomId,
  kind,
  revision: roomRevision
}: {
  roomId: number;
  kind: "hirelings" | "assets";
  revision: number;
}) {
  const [payload, setPayload] = useState<GroupPayload>();
  const [selectedId, setSelectedId] = useState<number>();
  const [assetKind, setAssetKind] = useState<string>();
  // The draft carries the id and revision it was built from, so a reload never
  // rebuilds an edit in progress and a save can tell a clash from a success.
  const [draft, setDraft] = useState<{ id: number; revision: number; name: string; sheet: Record<string, unknown> }>();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const result = await api<GroupPayload>(`/api/rooms/${roomId}/group`);
    setPayload(result);
    return result;
  }, [roomId]);

  useEffect(() => {
    load().catch((cause) => setError((cause as Error).message));
  }, [load, roomRevision]);

  const assetKinds = useMemo(() => groupAssetDefinitions(payload?.definition), [payload?.definition]);
  const rows = useMemo(() => {
    const all = (kind === "hirelings" ? payload?.hirelings : payload?.assets) ?? [];
    return kind === "assets" && assetKind ? all.filter((row) => row.kind === assetKind) : all;
  }, [payload, kind, assetKind]);

  const hirelingDefinition = payload?.definition.hirelings;
  const selected = rows.find((row) => row.id === selectedId);
  const sheetDefinition: CharacterSheetDefinition | undefined =
    kind === "hirelings"
      ? hirelingDefinition?.sheet
      : assetKinds.find((asset) => asset.kind === (selected?.kind ?? assetKind ?? assetKinds[0]?.kind))?.sheet;

  const singular =
    kind === "hirelings"
      ? (hirelingDefinition?.singularLabel ?? "Hireling")
      : (assetKinds[0]?.singularLabel ?? "Asset");

  useEffect(() => {
    setDraft((current) => {
      if (!selected) return undefined;
      return current?.id === selected.id
        ? current
        : { id: selected.id, revision: selected.revision, name: selected.name, sheet: { ...selected.sheet } };
    });
    setConfirmingDelete(false);
  }, [selected]);

  const dirty = Boolean(
    draft &&
    selected &&
    (draft.name !== selected.name || JSON.stringify(draft.sheet) !== JSON.stringify(selected.sheet))
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
      setError(
        cause instanceof ApiError && cause.status === 409
          ? `${cause.message} Your edits are still on this page.`
          : (cause as Error).message
      );
    } finally {
      setBusy("");
    }
  }

  async function save() {
    if (!draft) return;
    await act(
      "Saving…",
      async () => {
        const result = await api<{ hireling?: RosterRow; asset?: RosterRow }>(
          `/api/rooms/${roomId}/group/${kind}/${draft.id}`,
          {
            method: "PATCH",
            body: JSON.stringify({ name: draft.name, sheet: draft.sheet, revision: draft.revision })
          }
        );
        const saved = result.hireling ?? result.asset;
        // Settle on what the server stored, and carry its revision so the next
        // save is judged against the write this one just made.
        if (saved) setDraft({ id: saved.id, revision: saved.revision, name: saved.name, sheet: { ...saved.sheet } });
      },
      "Saved."
    );
  }

  async function create(from?: RosterRow) {
    await act(`Adding…`, async () => {
      const body =
        kind === "assets"
          ? { kind: from?.kind ?? assetKind ?? assetKinds[0]?.kind ?? "starship" }
          : ({} as Record<string, unknown>);
      if (from) Object.assign(body, { name: `${from.name || singular} (copy)`.slice(0, 120), sheet: from.sheet });
      const result = await api<{ hireling?: RosterRow; asset?: RosterRow }>(`/api/rooms/${roomId}/group/${kind}`, {
        method: "POST",
        body: JSON.stringify(body)
      });
      const created = result.hireling ?? result.asset;
      if (created) setSelectedId(created.id);
    });
  }

  async function rollHireling() {
    await act("Rolling…", async () => {
      const rolled = await api<{ hireling: Record<string, unknown> }>(`/api/rooms/${roomId}/group/hirelings/roll`, {
        method: "POST"
      });
      const { name, ...sheet } = rolled.hireling;
      const result = await api<{ hireling: RosterRow }>(`/api/rooms/${roomId}/group/hirelings`, {
        method: "POST",
        body: JSON.stringify({ name: String(name ?? ""), sheet })
      });
      setSelectedId(result.hireling.id);
    });
  }

  async function move(row: RosterRow, by: -1 | 1) {
    const order = rows.map((entry) => entry.id);
    const at = order.indexOf(row.id);
    if (at < 0 || at + by < 0 || at + by >= order.length) return;
    const next = [...order];
    next.splice(at + by, 0, ...next.splice(at, 1));
    await act("Reordering…", () =>
      api(`/api/rooms/${roomId}/group/order`, { method: "PATCH", body: JSON.stringify({ kind, ids: next }) })
    );
  }

  async function uploadImage(file?: File) {
    if (!selected || !file) return;
    if (file.size > imageLimitBytes) return setError("Images may be at most 5 MB.");
    if (!imageTypes.has(file.type)) return setError("Choose a PNG, JPEG, or WebP image.");
    const body = new FormData();
    body.append("file", file);
    await act("Uploading…", () =>
      api(`/api/rooms/${roomId}/group/${kind}/${selected.id}/image`, { method: "POST", body })
    );
  }

  if (!payload) return <p className="room-config-muted">{error || "Loading the roster…"}</p>;
  if (kind === "hirelings" && !hirelingDefinition)
    return <p className="room-config-muted">This system has no hirelings.</p>;

  return (
    <div className="rc-roster">
      <section className="rc-panel-block rc-roster-list">
        <header>
          <h3>{kind === "hirelings" ? (hirelingDefinition?.label ?? "Hirelings") : "Shared property"}</h3>
          <span className="room-config-muted">{rows.length}</span>
        </header>

        {kind === "assets" && assetKinds.length > 1 && (
          <select value={assetKind ?? ""} onChange={(event) => setAssetKind(event.target.value || undefined)}>
            <option value="">Every kind</option>
            {assetKinds.map((asset) => (
              <option key={asset.kind} value={asset.kind}>
                {asset.label}
              </option>
            ))}
          </select>
        )}

        <ul className="rc-list">
          {rows.map((row, index) => (
            <li key={row.id}>
              <button
                type="button"
                className={row.id === selectedId ? "is-current" : ""}
                onClick={() => setSelectedId(row.id)}
              >
                <span>{row.name || `${singular} ${index + 1}`}</span>
                <small>{row.imageUrl ? "Has a picture" : "No picture"}</small>
              </button>
              <button
                type="button"
                className="rc-inline-action"
                title="Move up"
                disabled={index === 0 || Boolean(busy)}
                onClick={() => move(row, -1)}
              >
                <ArrowUp size={13} />
              </button>
              <button
                type="button"
                className="rc-inline-action"
                title="Move down"
                disabled={index === rows.length - 1 || Boolean(busy)}
                onClick={() => move(row, 1)}
              >
                <ArrowDown size={13} />
              </button>
            </li>
          ))}
        </ul>
        {rows.length === 0 && (
          <p className="room-config-muted">
            {kind === "hirelings"
              ? `No ${(hirelingDefinition?.label ?? "hirelings").toLocaleLowerCase()} yet.`
              : (assetKinds[0]?.emptyHint ?? "Nothing shared yet.")}
          </p>
        )}

        <footer className="rc-roster-add">
          <button type="button" disabled={Boolean(busy)} onClick={() => create()}>
            <Plus size={14} /> New {singular.toLocaleLowerCase()}
          </button>
          {kind === "hirelings" && hirelingDefinition?.creationRoll && (
            <button type="button" disabled={Boolean(busy)} onClick={rollHireling}>
              <Dices size={14} /> Roll one
            </button>
          )}
        </footer>
      </section>

      <section className="rc-panel-block rc-roster-editor">
        {busy && <p className="room-config-muted">{busy}</p>}
        {error && <p className="room-config-error">{error}</p>}
        {notice && !dirty && <p className="rc-notice">{notice}</p>}

        {!selected || !draft || !sheetDefinition ? (
          <p className="room-config-muted">Choose one to edit, or add one.</p>
        ) : (
          <>
            <header>
              <input
                className="rc-title-input"
                value={draft.name}
                aria-label={`${singular} name`}
                placeholder={singular}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
              <button type="button" className="rc-primary" disabled={!dirty || Boolean(busy)} onClick={save}>
                <Save size={14} /> {dirty ? "Save changes" : "Saved"}
              </button>
            </header>

            <div className="rc-portrait">
              <div className={`rc-portrait-frame${selected.imageUrl ? " has-image" : ""}`}>
                {selected.imageUrl ? (
                  <img src={selected.imageUrl} alt={`${draft.name || singular} portrait`} />
                ) : (
                  <UserRound aria-hidden="true" />
                )}
              </div>
              <div className="rc-portrait-actions">
                <button type="button" disabled={Boolean(busy)} onClick={() => fileInput.current?.click()}>
                  <ImagePlus size={14} /> {selected.imageUrl ? "Replace picture" : "Add a picture"}
                </button>
                {selected.imageUrl && (
                  <button
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() =>
                      act("Removing…", () =>
                        api(`/api/rooms/${roomId}/group/${kind}/${selected.id}/image`, { method: "DELETE" })
                      )
                    }
                  >
                    <X size={14} /> Remove
                  </button>
                )}
                <input
                  ref={fileInput}
                  type="file"
                  hidden
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    void uploadImage(file);
                  }}
                />
              </div>
            </div>

            <RoomConfigSheetFields
              definition={sheetDefinition}
              sheet={draft.sheet}
              disabled={Boolean(busy)}
              omit={["name"]}
              onChange={(key, value) => setDraft({ ...draft, sheet: { ...draft.sheet, [key]: value } })}
            />

            <footer className="rc-npc-actions">
              <button type="button" disabled={Boolean(busy)} onClick={() => create(selected)}>
                <CopyPlus size={14} /> Duplicate
              </button>
              {confirmingDelete ? (
                <>
                  <button
                    type="button"
                    className="rc-danger"
                    onClick={() =>
                      act(`Deleting…`, async () => {
                        await api(`/api/rooms/${roomId}/group/${kind}/${selected.id}`, { method: "DELETE" });
                        setSelectedId(undefined);
                      })
                    }
                  >
                    <Trash2 size={14} /> Delete {draft.name || singular.toLocaleLowerCase()}
                    {kind === "hirelings" && " and remove from any fight"}
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
