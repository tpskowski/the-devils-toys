import { useCallback, useEffect, useState } from "react";
import { Copy, Plus, Search, Trash2 } from "lucide-react";
import { tagLabel, type RollTableSet, type TableTag, type TableTagDefinition } from "@devils-toys/shared";
import { api } from "./api";
import { BundleTools } from "./BundleTools";
import { SetEditor } from "./SetEditor";
import { filterSets } from "./tables";
import type { Permissions } from "./session";

type CatalogueSet = RollTableSet & { updatedAt?: string };

const starterMarkdown = `### Rumours in the market

| d6 | Rumour |
| --- | --- |
| 1 | The well has gone bitter. |
`;

/** The catalogue: every set this instance knows, and what can be done with it. */
export function SetsPage({
  permissions,
  vocabulary,
  onCreateTag
}: {
  permissions: Permissions;
  vocabulary: readonly TableTagDefinition[];
  onCreateTag: (label: string) => Promise<TableTag>;
}) {
  const [sets, setSets] = useState<CatalogueSet[]>([]);
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string>();
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const result = await api<{ sets: CatalogueSet[] }>("/api/table-sets");
    setSets(result.sets);
  }, []);

  useEffect(() => {
    load().catch((cause: Error) => setError(cause.message));
  }, [load]);

  /** The tags a set carries, taken from the tables it holds. */
  function setTags(entry: CatalogueSet): TableTag[] {
    const seen = new Set<TableTag>();
    for (const table of entry.tables) for (const tag of table.tags) seen.add(tag);
    return vocabulary.filter((tag) => seen.has(tag.slug)).map((tag) => tag.slug);
  }

  async function create() {
    setError("");
    try {
      const created = await api<{ set: { id: string } }>("/api/table-sets", {
        method: "POST",
        body: JSON.stringify({ name: "New table set", markdown: starterMarkdown, tags: [] })
      });
      await load();
      setOpenId(created.set.id);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  async function duplicate(entry: CatalogueSet) {
    setError("");
    try {
      await api(`/api/table-sets/${encodeURIComponent(entry.id)}/duplicate`, { method: "POST" });
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  async function remove(entry: CatalogueSet) {
    if (!confirm(`Delete the table set “${entry.name}”? This cannot be undone.`)) return;
    setError("");
    try {
      await api(`/api/table-sets/${entry.id.replace("custom:", "")}`, { method: "DELETE" });
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  if (openId !== undefined) {
    return (
      <SetEditor
        setId={openId}
        permissions={permissions}
        vocabulary={vocabulary}
        onCreateTag={onCreateTag}
        onClose={() => {
          setOpenId(undefined);
          load().catch((cause: Error) => setError(cause.message));
        }}
        onSaved={load}
      />
    );
  }

  const shown = filterSets(
    sets.map((entry) => ({ ...entry, tags: setTags(entry) })),
    query
  );

  return (
    <section className="sets-page">
      <div className="sets-toolbar">
        <label className="sets-search">
          <Search size={15} aria-hidden />
          <input value={query} placeholder="Search sets and tags" onChange={(event) => setQuery(event.target.value)} />
        </label>
        {permissions.canEdit && (
          <button type="button" className="primary-button" onClick={create}>
            <Plus size={15} aria-hidden /> New set
          </button>
        )}
      </div>

      {error && <p className="form-error">{error}</p>}

      <ul className="sets-list">
        {shown.map((entry) => {
          const custom = entry.origin === "custom";
          return (
            <li key={entry.id}>
              <button
                type="button"
                className="sets-open"
                title={custom ? "Open this set" : "Browse this read-only system catalogue"}
                onClick={() => setOpenId(entry.id)}
              >
                <strong>{entry.name}</strong>
                <span className="sets-meta">
                  {entry.origin === "system" ? "Built in" : "Custom"} · {entry.tables.length} table
                  {entry.tables.length === 1 ? "" : "s"}
                  {entry.updatedAt ? ` · updated ${entry.updatedAt.slice(0, 10)}` : ""}
                </span>
                <span className="tag-chips">
                  {entry.tags.map((tag) => (
                    <span key={tag} className="tag-chip active">
                      {tagLabel(tag, vocabulary)}
                    </span>
                  ))}
                </span>
              </button>
              {permissions.canEdit && (
                <span className="sets-actions">
                  <button type="button" className="icon-button" title="Duplicate" onClick={() => duplicate(entry)}>
                    <Copy size={15} aria-hidden />
                  </button>
                  {custom && (
                    <button type="button" className="icon-button" title="Delete" onClick={() => remove(entry)}>
                      <Trash2 size={15} aria-hidden />
                    </button>
                  )}
                </span>
              )}
            </li>
          );
        })}
      </ul>

      {!shown.length && <p className="empty-note">No sets match that search.</p>}

      <BundleTools permissions={permissions} onImported={load} />
    </section>
  );
}
