import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ChevronDown, ChevronLeft, Dices, Library, Plus, Save, Search, Trash2, X } from "lucide-react";
import {
  parseRollTables,
  rollTableLabel,
  serializeSet,
  tagLabel,
  type ChatMessage,
  type RollTable,
  type RollTableSet,
  type RollTableSummary,
  type TableRollVisibility,
  type TableTag,
  type TableTagDefinition
} from "@devils-toys/shared";
import { api } from "./api";
import { InlineMarkdown } from "./InlineMarkdown";
import {
  categoryOpensTable,
  countTablesByTag,
  filterTables,
  filterTablesByTag,
  groupByCategory,
  moveHighlight,
  visibilityNotice
} from "./tables";

interface CustomSetDraft {
  id?: number;
  name: string;
  markdown: string;
  tags: TableTag[];
}

const emptyDraft: CustomSetDraft = { name: "", markdown: "", tags: [] };

const sampleMarkdown = `### Rumours in the market (d6)

| d6 | Rumour |
| --- | --- |
| 1 | The well has gone bitter. |
`;

export function TablesModal({
  roomId,
  isGm,
  onRolled,
  onClose
}: {
  roomId: number;
  isGm: boolean;
  onRolled: (message: ChatMessage) => void;
  onClose: () => void;
}) {
  const [sets, setSets] = useState<RollTableSet[]>([]);
  const [vocabulary, setVocabulary] = useState<TableTagDefinition[]>([]);
  const [setId, setSetId] = useState("");
  const [tagFilter, setTagFilter] = useState<TableTag | "">("");
  const [query, setQuery] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [selectedId, setSelectedId] = useState("");
  const [table, setTable] = useState<RollTable>();
  const [rolled, setRolled] = useState<{
    total: number;
    text: string;
    label: string;
    visibility: TableRollVisibility;
  }>();
  const [error, setError] = useState("");
  const [category, setCategory] = useState("");
  const [managing, setManaging] = useState(false);
  const [draft, setDraft] = useState<CustomSetDraft>(emptyDraft);
  const search = useRef<HTMLInputElement>(null);

  const activeSet = sets.find((entry) => entry.id === setId);
  const tables = activeSet?.tables ?? [];
  const tagCounts = useMemo(() => countTablesByTag(tables, vocabulary), [tables, vocabulary]);
  const taggedTables = useMemo(() => filterTablesByTag(tables, tagFilter), [tables, tagFilter]);
  const matches = useMemo(() => filterTables(taggedTables, suggesting ? query : ""), [taggedTables, query, suggesting]);
  const categories = useMemo(() => groupByCategory(taggedTables), [taggedTables]);
  const selectedSummary = tables.find((entry) => entry.id === selectedId);
  // The vocabulary is editable in The Devil's Tables, so it is read rather than
  // assumed; until it arrives a slug stands in for its own label.
  const label = (tag: TableTag) => tagLabel(tag, vocabulary);
  const openCategory = categories.find((entry) => entry.name === category);
  const skippedCategoryList = Boolean(openCategory && categoryOpensTable(openCategory)?.id === selectedId);

  async function loadSets(preferredSetId?: string) {
    const result = await api<{ sets: RollTableSet[]; roomSetId: string }>(`/api/rooms/${roomId}/tables`);
    setSets(result.sets);
    setSetId((current) => {
      const wanted = preferredSetId ?? current ?? "";
      return result.sets.some((entry) => entry.id === wanted) ? wanted : result.roomSetId;
    });
  }

  useEffect(() => {
    loadSets().catch((cause: Error) => setError(cause.message));
    api<{ tags: TableTagDefinition[] }>("/api/table-tags")
      .then((result) => setVocabulary(result.tags))
      .catch((cause: Error) => setError(cause.message));
  }, [roomId]);

  function clearSelection() {
    setSelectedId("");
    setTable(undefined);
    setRolled(undefined);
    setQuery("");
    setHighlight(-1);
    setSuggesting(false);
  }

  useEffect(() => {
    clearSelection();
    setCategory("");
    setTagFilter("");
  }, [setId]);

  useEffect(() => {
    clearSelection();
    setCategory("");
  }, [tagFilter]);

  async function chooseTable(summary: RollTableSummary) {
    setSelectedId(summary.id);
    setQuery(summary.name);
    // Searching can reach a table from anywhere, so follow it to its own part of
    // the book; leaving here then goes back somewhere that makes sense.
    setCategory(summary.category);
    setSuggesting(false);
    setHighlight(-1);
    setRolled(undefined);
    setError("");
    try {
      const result = await api<{ table: RollTable }>(
        `/api/rooms/${roomId}/tables/${encodeURIComponent(setId)}/${encodeURIComponent(summary.id)}`
      );
      setTable(result.table);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  function onSearchKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setSuggesting(true);
      setHighlight((current) => moveHighlight(current, event.key === "ArrowDown" ? 1 : -1, matches.length));
      return;
    }
    if (event.key === "Enter") {
      const choice = matches[highlight] ?? (matches.length === 1 ? matches[0] : undefined);
      if (choice) {
        event.preventDefault();
        chooseTable(choice);
      }
      return;
    }
    if (event.key === "Escape" && suggesting) {
      event.stopPropagation();
      setSuggesting(false);
    }
  }

  async function roll(visibility: TableRollVisibility) {
    if (!table) return;
    setError("");
    try {
      const result = await api<{
        roll: { total: number; text: string; row: { label: string } | null };
        message: ChatMessage;
      }>(`/api/rooms/${roomId}/tables/roll`, {
        method: "POST",
        body: JSON.stringify({ setId, tableId: table.id, visibility })
      });
      setRolled({
        total: result.roll.total,
        text: result.roll.text,
        label: result.roll.row?.label ?? "",
        visibility
      });
      onRolled(result.message);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  async function saveDraft() {
    setError("");
    try {
      if (draft.id) {
        const tables = parseRollTables(draft.markdown).map(({ source: _source, ...table }) => table);
        await api(`/api/table-sets/${draft.id}`, {
          method: "PATCH",
          body: JSON.stringify({ name: draft.name, tables, tags: draft.tags })
        });
        await loadSets(`custom:${draft.id}`);
      } else {
        const tables = parseRollTables(draft.markdown).map(({ source: _source, ...table }) => table);
        const created = await api<{ set: { id: string } }>("/api/table-sets", {
          method: "POST",
          body: JSON.stringify({ name: draft.name, tables, tags: draft.tags })
        });
        await loadSets(created.set.id);
      }
      setDraft(emptyDraft);
      setTagFilter("");
      setManaging(false);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  async function editSet(entry: RollTableSet) {
    setError("");
    try {
      const numericId = Number(entry.id.replace("custom:", ""));
      const result = await api<{ set: { id: number; name: string; tables: RollTable[]; tags: TableTag[] } }>(
        `/api/table-sets/${numericId}`
      );
      setDraft({
        id: result.set.id,
        name: result.set.name,
        markdown: serializeSet(result.set.tables, result.set.name),
        tags: result.set.tags
      });
      setManaging(true);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  async function deleteSet(entry: RollTableSet) {
    if (!confirm(`Delete the table set “${entry.name}”?`)) return;
    setError("");
    try {
      await api(`/api/table-sets/${entry.id.replace("custom:", "")}`, { method: "DELETE" });
      setDraft(emptyDraft);
      await loadSets();
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  const custom = sets.filter((entry) => entry.origin === "custom");
  return (
    <div
      className="modal-scrim"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section className="modal modal-wide tables-modal" role="dialog" aria-modal="true" aria-label="Random tables">
        <header>
          <p className="eyebrow">GM reference</p>
          <h2>Random tables</h2>
          <button onClick={onClose} aria-label="Close">
            <X />
          </button>
        </header>

        <div className="tables-chooser">
          <label className="tables-set">
            Table set
            <select value={setId} onChange={(event) => setSetId(event.target.value)}>
              {sets.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name} ({entry.tables.length})
                </option>
              ))}
            </select>
          </label>
          <div className="tables-combobox">
            <label htmlFor="table-search">Table</label>
            <div className="tables-combobox-field">
              <Search size={15} />
              <input
                id="table-search"
                ref={search}
                role="combobox"
                aria-expanded={suggesting}
                aria-controls="table-suggestions"
                aria-autocomplete="list"
                autoComplete="off"
                value={query}
                placeholder={tables.length ? `Search ${tables.length} tables…` : "No tables in this set"}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setSuggesting(true);
                  setHighlight(-1);
                }}
                onFocus={() => setSuggesting(true)}
                onBlur={() => window.setTimeout(() => setSuggesting(false), 120)}
                onKeyDown={onSearchKeyDown}
              />
              <button
                type="button"
                className="tables-combobox-toggle"
                aria-label={suggesting ? "Hide table list" : "Show all tables"}
                onClick={() => {
                  if (suggesting) return setSuggesting(false);
                  // Opening the list shows the whole set, the way a plain
                  // drop-down would, without discarding a query on the way out.
                  setQuery("");
                  setHighlight(-1);
                  setSuggesting(true);
                  search.current?.focus();
                }}
              >
                <ChevronDown size={16} />
              </button>
              {(selectedId || query) && (
                <button
                  type="button"
                  className="tables-combobox-clear"
                  aria-label="Clear the selected table"
                  title="Clear selection"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={clearSelection}
                >
                  <X size={15} />
                </button>
              )}
            </div>
            {suggesting && (
              <ul className="tables-suggestions" id="table-suggestions" role="listbox">
                {matches.length === 0 && <li className="tables-suggestion-empty">No table matches that.</li>}
                {matches.map((summary, index) => (
                  <li key={summary.id} role="option" aria-selected={summary.id === selectedId}>
                    <button
                      type="button"
                      className={index === highlight ? "highlighted" : ""}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setHighlight(index)}
                      onClick={() => chooseTable(summary)}
                    >
                      <strong>{summary.name}</strong>
                      <small>
                        {summary.dice} · {summary.rowCount} rows{summary.section ? ` · ${summary.section}` : ""}
                        {summary.tags.length ? ` · ${summary.tags.map(label).join(", ")}` : ""}
                      </small>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button
            type="button"
            className={`tables-manage ${managing ? "active" : ""}`}
            onClick={() => {
              setManaging((current) => !current);
              setDraft(emptyDraft);
            }}
            title="Table sets outside a system"
          >
            <Library size={16} /> Sets
          </button>
          <div className="tables-tag-filter" aria-label="Filter tables by tag">
            <span>Tags</span>
            <button
              type="button"
              className={!tagFilter ? "active" : ""}
              aria-pressed={!tagFilter}
              onClick={() => setTagFilter("")}
            >
              All <span>({tables.length})</span>
            </button>
            {tagCounts.map(({ tag, count }) => (
              <button
                type="button"
                key={tag}
                className={tagFilter === tag ? "active" : ""}
                aria-pressed={tagFilter === tag}
                onClick={() => setTagFilter((current) => (current === tag ? "" : tag))}
              >
                {label(tag)} <span>({count})</span>
              </button>
            ))}
          </div>
        </div>

        {error && <p className="form-error tables-error">{error}</p>}

        {managing ? (
          <div className="tables-sets">
            <div className="tables-set-list">
              <p className="nav-label">Custom sets</p>
              {custom.length === 0 && <p className="empty-note">No table sets have been added yet.</p>}
              {custom.map((entry) => (
                <div className="tables-set-row" key={entry.id}>
                  <button type="button" onClick={() => editSet(entry)}>
                    <strong>{entry.name}</strong>
                    <small>{entry.tables.length} tables</small>
                  </button>
                  <button
                    type="button"
                    className="tables-set-delete"
                    onClick={() => deleteSet(entry)}
                    aria-label={`Delete ${entry.name}`}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
            <div className="tables-set-editor">
              <p className="modal-intro">
                Paste Markdown tables. A table is rollable when its first column is a die such as <code>d6</code> and
                its rows are keyed by die values, exactly as the system books are written. Selected tags apply to every
                rollable table in the set.
              </p>
              <label>
                Set name
                <input
                  value={draft.name}
                  maxLength={80}
                  placeholder="Table set name"
                  onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                />
              </label>
              <fieldset className="tables-tag-options">
                <legend>Tags for every table</legend>
                <div>
                  {vocabulary.map(({ slug }) => (
                    <label key={slug} className={draft.tags.includes(slug) ? "active" : ""}>
                      <input
                        type="checkbox"
                        checked={draft.tags.includes(slug)}
                        onChange={() =>
                          setDraft((current) => ({
                            ...current,
                            tags: current.tags.includes(slug)
                              ? current.tags.filter((entry) => entry !== slug)
                              : [...current.tags, slug]
                          }))
                        }
                      />
                      {label(slug)}
                    </label>
                  ))}
                </div>
              </fieldset>
              <label>
                Markdown
                <textarea
                  value={draft.markdown}
                  rows={12}
                  placeholder={sampleMarkdown}
                  onChange={(event) => setDraft((current) => ({ ...current, markdown: event.target.value }))}
                />
              </label>
              <div className="tables-set-actions">
                <button className="primary-button" onClick={saveDraft} disabled={draft.name.trim().length < 2}>
                  {draft.id ? <Save size={16} /> : <Plus size={16} />} {draft.id ? "Save set" : "Add set"}
                </button>
                {draft.id && (
                  <button type="button" onClick={() => setDraft(emptyDraft)}>
                    New set
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="tables-workspace">
            {!table && !openCategory && (
              <div className="tables-browse">
                <p className="nav-label">Sections of {activeSet?.name ?? "this set"}</p>
                {categories.length === 0 ? (
                  <p className="empty-note">This set has no rollable tables yet.</p>
                ) : (
                  <div className="tables-categories">
                    {categories.map((entry) => (
                      <button
                        key={entry.name}
                        type="button"
                        className="tables-category"
                        onClick={() => {
                          const direct = categoryOpensTable(entry);
                          if (direct) return chooseTable(direct);
                          setCategory(entry.name);
                        }}
                      >
                        <strong>{entry.name}</strong>
                        <small>
                          {entry.tables.length} {entry.tables.length === 1 ? "table" : "tables"}
                        </small>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {!table && openCategory && (
              <div className="tables-browse">
                <button type="button" className="tables-back" onClick={() => setCategory("")}>
                  <ChevronLeft size={15} /> All sections
                </button>
                <h3 className="tables-category-heading">{openCategory.name}</h3>
                <div className="tables-category-tables">
                  {openCategory.tables.map((summary) => (
                    <button key={summary.id} type="button" onClick={() => chooseTable(summary)}>
                      <strong>{summary.name}</strong>
                      <small>
                        {summary.dice} · {summary.rowCount} rows{summary.section ? ` · ${summary.section}` : ""}
                        {summary.tags.length ? ` · ${summary.tags.map(label).join(", ")}` : ""}
                      </small>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {table && (
              <>
                <button
                  type="button"
                  className="tables-back"
                  onClick={() => {
                    clearSelection();
                    // A section that opened straight to this table has no list
                    // worth returning to.
                    if (skippedCategoryList) setCategory("");
                  }}
                >
                  <ChevronLeft size={15} /> {skippedCategoryList || !category ? "All sections" : category}
                </button>
                <div className="tables-toolbar">
                  {(
                    [
                      { visibility: "public", label: "Roll" },
                      { visibility: "private", label: "Private" },
                      ...(isGm ? [{ visibility: "invisible" as const, label: "Invisible" }] : []),
                      { visibility: "reveal", label: "Reveal" }
                    ] satisfies { visibility: TableRollVisibility; label: string }[]
                  ).map((option) => (
                    <button
                      type="button"
                      className={`tables-roll${option.visibility === "public" ? "" : " tables-roll-secondary"}`}
                      key={option.visibility}
                      title={visibilityNotice(option.visibility)}
                      aria-label={`${option.label} ${table.dice}. ${visibilityNotice(option.visibility)}`}
                      onClick={() => roll(option.visibility)}
                    >
                      <Dices aria-hidden="true" /> {option.label} {table.dice}
                    </button>
                  ))}
                </div>

                {rolled && (
                  <div className="tables-result" role="status">
                    <span className="tables-result-total">{rolled.total}</span>
                    <span>
                      <span className="tables-result-text">
                        <InlineMarkdown>{rolled.text || `No entry for ${rolled.total}`}</InlineMarkdown>
                      </span>
                      <small>
                        {rollTableLabel(table.name, table.dice)}
                        {rolled.visibility === "public"
                          ? " · shown to GM; players told a roll was made"
                          : rolled.visibility === "reveal"
                            ? " · revealed to the room"
                            : rolled.visibility === "private"
                              ? " · players told a roll was made"
                              : " · hidden from players"}
                      </small>
                    </span>
                  </div>
                )}

                <div className="tables-detail">
                  <div className="tables-detail-heading">
                    <h3>{table.name}</h3>
                    <small>{table.section}</small>
                    {table.tags.length > 0 && (
                      <div className="tables-table-tags" aria-label="Table tags">
                        {table.tags.map((tag) => (
                          <span key={tag}>{label(tag)}</span>
                        ))}
                      </div>
                    )}
                    {Boolean(selectedSummary?.unreachableRows) && (
                      <small className="tables-warning">
                        The source writes {selectedSummary!.rowCount} rows over a {table.dice} heading, so{" "}
                        {selectedSummary!.unreachableRows} of them cannot come up on a roll.
                      </small>
                    )}
                  </div>
                  <div className="tables-grid-scroll">
                    <table className="tables-grid">
                      <thead>
                        <tr>
                          <th>{table.dice}</th>
                          {table.columns.map((column, index) => (
                            <th key={`${column}-${index}`}>
                              <InlineMarkdown>{column}</InlineMarkdown>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {table.rows.map((row) => (
                          <tr key={row.label} className={rolled && row.label === rolled.label ? "rolled" : ""}>
                            <th scope="row">{row.label}</th>
                            {row.cells.map((cell, index) => (
                              <td key={index}>
                                <InlineMarkdown>{cell}</InlineMarkdown>
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
