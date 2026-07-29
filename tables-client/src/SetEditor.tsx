import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, Code, Download, Plus, Save } from "lucide-react";
import {
  appendTable,
  parseRollTables,
  serializeSet,
  spliceTable,
  tagLabel,
  type RollTable,
  type TableTag,
  type TableTagDefinition
} from "@devils-toys/shared";
import { api, download } from "./api";
import { CsvImport } from "./CsvImport";
import { TableGrid } from "./TableGrid";
import { TagPicker } from "./TagPicker";
import { blankTable, tablesWithTag, tagTallies } from "./tables";
import type { Permissions } from "./session";

interface StoredSet {
  id: number | string;
  name: string;
  markdown: string;
  tags: TableTag[];
  updatedAt: string | null;
  readOnly: boolean;
}

/**
 * A whole set. The Markdown is the set — the grid is a view onto it, parsed with
 * exactly the parser the roller uses, so what is shown is what will be rolled.
 * Applying an edit splices that one table back into the document and leaves
 * every other line of it alone.
 */
export function SetEditor({
  setId,
  permissions,
  vocabulary,
  onClose,
  onSaved,
  onCreateTag
}: {
  setId: string;
  permissions: Permissions;
  vocabulary: readonly TableTagDefinition[];
  onClose: () => void;
  onSaved: () => void;
  onCreateTag: (label: string) => Promise<TableTag>;
}) {
  const [name, setName] = useState("");
  const [tags, setTags] = useState<TableTag[]>([]);
  const [markdown, setMarkdown] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [locked, setLocked] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [raw, setRaw] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [editing, setEditing] = useState<RollTable>();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const [tagFilter, setTagFilter] = useState<TableTag | "">("");

  const tables = useMemo(() => parseRollTables(markdown), [markdown]);
  const tallies = useMemo(() => tagTallies(tables, tags, vocabulary), [tables, tags, vocabulary]);
  const shown = useMemo(() => tablesWithTag(tables, tags, tagFilter), [tables, tags, tagFilter]);
  const customId = setId.startsWith("custom:") ? Number(setId.replace("custom:", "")) : undefined;
  const readOnly = !permissions.canEdit || locked;

  // A filter that no longer matches anything would hide the whole set with no
  // way back, so it is dropped as soon as its tag leaves the document.
  useEffect(() => {
    if (tagFilter && !tallies.some((tally) => tally.slug === tagFilter)) setTagFilter("");
  }, [tagFilter, tallies]);

  const reload = useCallback(
    () =>
      api<{ set: StoredSet }>(`/api/table-sets/${setId}`).then((result) => {
        setName(result.set.name);
        setTags(result.set.tags);
        setMarkdown(result.set.markdown);
        setLocked(result.set.readOnly);
        setLoaded(true);
        setDirty(false);
      }),
    [setId]
  );

  useEffect(() => {
    reload().catch((cause: Error) => setError(cause.message));
  }, [reload]);

  function openTable(table: RollTable) {
    setEditingId(table.id);
    setEditing(table);
  }

  function applyEdit() {
    if (!editing) return;
    setMarkdown((current) => spliceTable(current, editing));
    setDirty(true);
    setEditing(undefined);
    setEditingId("");
  }

  function addTable() {
    const table = blankTable(`New table ${tables.length + 1}`);
    setMarkdown((current) => (current.trim() ? appendTable(current, table) : serializeSet([table])));
    setDirty(true);
  }

  async function save() {
    if (customId === undefined) return;
    setSaving(true);
    setError("");
    try {
      await api(`/api/table-sets/${customId}`, { method: "PATCH", body: JSON.stringify({ name, markdown, tags }) });
      setDirty(false);
      onSaved();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) return <main className="loading">{error || "Loading…"}</main>;

  return (
    <section className="set-editor">
      <div className="set-editor-bar">
        <button type="button" onClick={onClose}>
          <ChevronLeft size={15} aria-hidden /> All sets
        </button>
        <label className="set-editor-name">
          <span className="nav-label">Set name</span>
          <input
            value={name}
            maxLength={80}
            readOnly={readOnly}
            onChange={(event) => {
              setName(event.target.value);
              setDirty(true);
            }}
          />
        </label>
        {locked && <span className="set-editor-status">Built in · read only</span>}
        <button type="button" className={raw ? "active" : ""} onClick={() => setRaw((current) => !current)}>
          <Code size={15} aria-hidden /> {raw ? "Grid" : "Markdown"}
        </button>
        {permissions.canAdminister && (
          <button
            type="button"
            title="A zip shaped for the repository, with instructions for folding it in"
            onClick={() =>
              download(
                `/api/table-sets/${encodeURIComponent(setId)}/repo-bundle`,
                `set-${setId.replace(":", "-")}-repo.zip`
              ).catch((cause: Error) => setError(cause.message))
            }
          >
            <Download size={15} aria-hidden /> Repo bundle
          </button>
        )}
        {!readOnly && (
          <button
            type="button"
            className="primary-button"
            disabled={!dirty || saving || name.trim().length < 2}
            onClick={save}
          >
            <Save size={15} aria-hidden /> {saving ? "Saving…" : "Save"}
          </button>
        )}
      </div>

      <TagPicker
        label="Tags for every table in this set"
        selected={tags}
        vocabulary={vocabulary}
        readOnly={readOnly}
        onCreate={onCreateTag}
        onChange={(next) => {
          setTags(next);
          setDirty(true);
        }}
      />

      {error && <p className="form-error">{error}</p>}

      {raw ? (
        <label className="set-editor-raw">
          <span className="nav-label">Markdown</span>
          <textarea
            value={markdown}
            rows={24}
            readOnly={readOnly}
            spellCheck={false}
            onChange={(event) => {
              setMarkdown(event.target.value);
              setDirty(true);
            }}
          />
          <p className="empty-note">
            A table is found when its first column is a die and its rows are keyed by die values, exactly as the system
            books are written. Tags for a single table live in a <code>&lt;!-- tags: … --&gt;</code> comment above it.
          </p>
        </label>
      ) : (
        <div className="set-editor-body">
          <aside className="set-editor-list">
            <div className="set-editor-list-head">
              <span className="nav-label">
                {tagFilter ? `${shown.length} of ${tables.length}` : tables.length} table
                {(tagFilter ? shown.length : tables.length) === 1 ? "" : "s"}
              </span>
              {!readOnly && (
                <button type="button" className="icon-button" title="Add a table" onClick={addTable}>
                  <Plus size={15} aria-hidden />
                </button>
              )}
            </div>

            {tallies.length > 0 && (
              <div className="set-tag-filter" role="group" aria-label="Filter tables by tag">
                <button
                  type="button"
                  className={tagFilter ? "" : "active"}
                  aria-pressed={!tagFilter}
                  onClick={() => setTagFilter("")}
                >
                  All <span>({tables.length})</span>
                </button>
                {tallies.map((tally) => (
                  <button
                    type="button"
                    key={tally.slug}
                    className={tagFilter === tally.slug ? "active" : ""}
                    aria-pressed={tagFilter === tally.slug}
                    title={tally.fromSet ? "Carried by every table, from the set" : undefined}
                    onClick={() => setTagFilter((current) => (current === tally.slug ? "" : tally.slug))}
                  >
                    {tagLabel(tally.slug, vocabulary)} <span>({tally.count})</span>
                  </button>
                ))}
              </div>
            )}

            {shown.length ? (
              <ul>
                {shown.map((table) => (
                  <li key={table.id}>
                    <button
                      type="button"
                      className={table.id === editingId ? "active" : ""}
                      onClick={() => openTable(table)}
                    >
                      <strong>{table.name}</strong>
                      <span>
                        {table.dice} · {table.rows.length} row{table.rows.length === 1 ? "" : "s"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty-note">
                {tagFilter ? "No table in this set carries that tag." : "No tables yet. Add one, or import a CSV."}
              </p>
            )}
          </aside>

          <div className="set-editor-table">
            {editing ? (
              <>
                <TableGrid
                  table={editing}
                  vocabulary={vocabulary}
                  readOnly={readOnly}
                  canRename={editing.source?.soleTable ?? true}
                  onChange={setEditing}
                  onCreateTag={onCreateTag}
                />
                <div className="set-editor-apply">
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(undefined);
                      setEditingId("");
                    }}
                  >
                    {readOnly ? "Close" : "Discard"}
                  </button>
                  {!readOnly && (
                    <button type="button" className="primary-button" onClick={applyEdit}>
                      Apply to the set
                    </button>
                  )}
                </div>
              </>
            ) : (
              <p className="empty-note">Choose a table to {readOnly ? "read" : "edit"}.</p>
            )}
          </div>
        </div>
      )}

      {!raw && customId !== undefined && permissions.canEdit && (
        <CsvImport setId={customId} onImported={() => reload().catch((cause: Error) => setError(cause.message))} />
      )}
    </section>
  );
}
