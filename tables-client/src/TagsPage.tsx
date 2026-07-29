import { useState } from "react";
import { Check, GitMerge, Plus, Trash2 } from "lucide-react";
import { toTagSlug } from "@devils-toys/shared";
import { api } from "./api";
import { sortedVocabulary } from "./tables";
import type { TagWithUsage } from "./App";
import type { Permissions } from "./session";

/**
 * The tag vocabulary. Anyone who can author may add a tag or rename one; the
 * operations that rewrite tags inside sets somebody else wrote — re-slugging,
 * merging, retiring — are an admin's.
 */
export function TagsPage({
  permissions,
  vocabulary,
  onChanged
}: {
  permissions: Permissions;
  vocabulary: readonly TagWithUsage[];
  onChanged: () => Promise<void>;
}) {
  const [label, setLabel] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  async function run(work: () => Promise<unknown>) {
    setError("");
    try {
      await work();
      await onChanged();
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  const create = () =>
    run(async () => {
      await api("/api/table-tags", {
        method: "POST",
        body: JSON.stringify({ slug: slug || toTagSlug(label), label: label.trim() })
      });
      setLabel("");
      setSlug("");
      setSlugEdited(false);
    });

  const rename = (tag: TagWithUsage) =>
    run(async () => {
      await api(`/api/table-tags/${encodeURIComponent(tag.slug)}`, {
        method: "PATCH",
        body: JSON.stringify({ label: editing[tag.slug] })
      });
      setEditing((current) => ({ ...current, [tag.slug]: "" }));
    });

  const merge = (tag: TagWithUsage) => {
    const into = prompt(`Merge “${tag.label}” into which tag? Give its slug.`);
    if (!into) return;
    run(() =>
      api(`/api/table-tags/${encodeURIComponent(tag.slug)}/merge`, {
        method: "POST",
        body: JSON.stringify({ into: into.trim() })
      })
    );
  };

  const retire = (tag: TagWithUsage) => {
    const used = tag.usage.sets + tag.usage.tables;
    const warning = used ? ` It is used by ${tag.usage.sets} set(s) and ${tag.usage.tables} table(s).` : "";
    if (!confirm(`Retire the tag “${tag.label}”?${warning} It will be removed from everything that carries it.`))
      return;
    run(() => api(`/api/table-tags/${encodeURIComponent(tag.slug)}`, { method: "DELETE" }));
  };

  return (
    <section className="tags-page">
      {permissions.canEdit && (
        <form
          className="tags-new"
          onSubmit={(event) => {
            event.preventDefault();
            create();
          }}
        >
          <label>
            <span className="nav-label">New tag</span>
            <input
              value={label}
              maxLength={60}
              placeholder="Horror"
              onChange={(event) => {
                setLabel(event.target.value);
                if (!slugEdited) setSlug(toTagSlug(event.target.value));
              }}
            />
          </label>
          <label>
            <span className="nav-label">Slug</span>
            <input
              value={slug}
              maxLength={40}
              placeholder="horror"
              onChange={(event) => {
                setSlug(toTagSlug(event.target.value));
                setSlugEdited(true);
              }}
            />
          </label>
          <button type="submit" className="primary-button" disabled={!label.trim() || !slug}>
            <Plus size={15} aria-hidden /> Add tag
          </button>
        </form>
      )}

      {error && <p className="form-error">{error}</p>}

      <table className="tags-table">
        <thead>
          <tr>
            <th>Tag</th>
            <th>Slug</th>
            <th>Used by</th>
            {permissions.canEdit && <th className="grid-actions">Actions</th>}
          </tr>
        </thead>
        <tbody>
          {sortedVocabulary(vocabulary).map((tag) => {
            const entry = tag as TagWithUsage;
            const pending = editing[tag.slug] ?? "";
            return (
              <tr key={tag.slug}>
                <td>
                  {permissions.canEdit ? (
                    <span className="tags-rename">
                      <input
                        value={pending || tag.label}
                        maxLength={60}
                        aria-label={`Name for ${tag.slug}`}
                        onChange={(event) => setEditing((current) => ({ ...current, [tag.slug]: event.target.value }))}
                      />
                      {pending && pending !== tag.label && (
                        <button type="button" className="icon-button" title="Save name" onClick={() => rename(entry)}>
                          <Check size={15} aria-hidden />
                        </button>
                      )}
                    </span>
                  ) : (
                    tag.label
                  )}
                </td>
                <td>
                  <code>{tag.slug}</code>
                  {tag.builtin && <span className="tags-builtin">built in</span>}
                </td>
                <td className="tags-usage">
                  {entry.usage.sets} set{entry.usage.sets === 1 ? "" : "s"}, {entry.usage.tables} table
                  {entry.usage.tables === 1 ? "" : "s"}
                </td>
                {permissions.canEdit && (
                  <td className="grid-actions">
                    {permissions.canAdminister ? (
                      <>
                        <button
                          type="button"
                          className="icon-button"
                          title="Merge into another tag"
                          onClick={() => merge(entry)}
                        >
                          <GitMerge size={15} aria-hidden />
                        </button>
                        <button
                          type="button"
                          className="icon-button"
                          title={tag.builtin ? "Built-in tags cannot be retired" : "Retire this tag"}
                          disabled={tag.builtin}
                          onClick={() => retire(entry)}
                        >
                          <Trash2 size={15} aria-hidden />
                        </button>
                      </>
                    ) : (
                      <span className="empty-note">Admin only</span>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
