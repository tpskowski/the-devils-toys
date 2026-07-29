import { useState, type FormEvent } from "react";
import { Check, Plus, X } from "lucide-react";
import { tagLabel, toTagSlug, type TableTag, type TableTagDefinition } from "@devils-toys/shared";
import { toggleTag } from "./tables";

/** The tag chips used wherever tags are assigned, to a set or to one table. */
export function TagPicker({
  selected,
  vocabulary,
  readOnly,
  onChange,
  onCreate,
  label
}: {
  selected: readonly TableTag[];
  vocabulary: readonly TableTagDefinition[];
  readOnly?: boolean;
  onChange?: (tags: TableTag[]) => void;
  onCreate?: (label: string) => Promise<TableTag>;
  label: string;
}) {
  const [adding, setAdding] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  async function create(event: FormEvent) {
    event.preventDefault();
    const cleanLabel = newLabel.trim();
    if (!cleanLabel || !toTagSlug(cleanLabel) || !onCreate) return;

    setCreating(true);
    setError("");
    try {
      const slug = await onCreate(cleanLabel);
      if (!selected.includes(slug)) onChange?.([...selected, slug]);
      setNewLabel("");
      setAdding(false);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setCreating(false);
    }
  }

  if (readOnly) {
    if (!selected.length) return <span className="tags-empty">No tags</span>;
    return (
      <span className="tag-chips" aria-label={label}>
        {selected.map((tag) => (
          <span key={tag} className="tag-chip active">
            {tagLabel(tag, vocabulary)}
          </span>
        ))}
      </span>
    );
  }

  return (
    <fieldset className="tag-chips">
      <legend className="nav-label">{label}</legend>
      {vocabulary.length ? (
        vocabulary.map(({ slug }) => (
          <button
            type="button"
            key={slug}
            className={`tag-chip${selected.includes(slug) ? " active" : ""}`}
            aria-pressed={selected.includes(slug)}
            onClick={() => onChange?.(toggleTag(selected, slug))}
          >
            {tagLabel(slug, vocabulary)}
          </button>
        ))
      ) : (
        <span className="tags-empty">No tags yet.</span>
      )}
      {onCreate &&
        (adding ? (
          <form className="tag-create" onSubmit={create}>
            <input
              autoFocus
              value={newLabel}
              maxLength={60}
              placeholder="New tag name"
              aria-label={`New tag for ${label}`}
              onChange={(event) => setNewLabel(event.target.value)}
            />
            <button
              type="submit"
              className="icon-button"
              title="Create and select tag"
              disabled={creating || !newLabel.trim() || !toTagSlug(newLabel)}
            >
              <Check size={14} aria-hidden />
            </button>
            <button
              type="button"
              className="icon-button"
              title="Cancel"
              disabled={creating}
              onClick={() => {
                setAdding(false);
                setNewLabel("");
                setError("");
              }}
            >
              <X size={14} aria-hidden />
            </button>
          </form>
        ) : (
          <button type="button" className="tag-create-toggle" onClick={() => setAdding(true)}>
            <Plus size={13} aria-hidden /> New tag
          </button>
        ))}
      {error && (
        <span className="tag-create-error" role="alert">
          {error}
        </span>
      )}
    </fieldset>
  );
}
