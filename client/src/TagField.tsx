import { useId, useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { MAX_TAG_LENGTH, MAX_TAGS_PER_SUBJECT, normalizeTag, sameTag } from "@devils-toys/shared";

/**
 * Tags as they are read: the words, and nothing else. Drawn wherever something
 * tagged is listed rather than opened, so a row says what it is without anyone
 * having to open it.
 */
export function TagChips({ tags, of }: { tags: readonly string[]; of?: string }) {
  if (!tags.length) return null;
  return (
    <ul className="tag-chips" aria-label={of ? `Tags on ${of}` : "Tags"}>
      {tags.map((tag) => (
        <li key={tag.toLocaleLowerCase()}>{tag}</li>
      ))}
    </ul>
  );
}

/**
 * Tags as they are written.
 *
 * Each change is saved on its own — a tag added, a tag removed — because there
 * is nothing else on this control to save alongside and a sheet that saves as
 * you type should not make tags the exception. The suggestions are the room's
 * own vocabulary, which is every tag already in use in it: that is how a table
 * settles on one set of words without anyone having to publish a list.
 */
export function TagField({
  tags,
  vocabulary,
  canEdit,
  label,
  of,
  hint,
  onChange
}: {
  tags: readonly string[];
  vocabulary: readonly string[];
  canEdit: boolean;
  /** The caption above the box. Omit it where the surrounding column already says Tags. */
  label?: string;
  /** What is being tagged, for the name a screen reader reads out. */
  of?: string;
  hint?: string;
  onChange: (tags: string[]) => Promise<unknown>;
}) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const listId = useId();

  if (!canEdit) return <TagChips tags={tags} of={of} />;

  async function write(next: string[]) {
    setBusy(true);
    setError("");
    try {
      await onChange(next);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function add(value: string) {
    const tag = normalizeTag(value);
    setDraft("");
    if (!tag) return;
    if (tags.some((held) => sameTag(held, tag))) return;
    if (tags.length >= MAX_TAGS_PER_SUBJECT) {
      setError(`That is as many tags as one thing carries (${MAX_TAGS_PER_SUBJECT}).`);
      return;
    }
    await write([...tags, tag]);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      void add(event.currentTarget.value);
      return;
    }
    // Backspace on an empty box takes the last tag off, which is what every
    // other chip field does and saves a trip to its little cross.
    if (event.key === "Backspace" && !event.currentTarget.value && tags.length) {
      event.preventDefault();
      void write(tags.slice(0, -1));
    }
  }

  const unused = vocabulary.filter((tag) => !tags.some((held) => sameTag(held, tag)));

  return (
    <div className="tag-field">
      {label && <span className="tag-field-label">{label}</span>}
      <div className="tag-field-box">
        {tags.map((tag) => (
          <span className="tag-chip" key={tag.toLocaleLowerCase()}>
            {tag}
            <button
              type="button"
              disabled={busy}
              aria-label={`Remove tag ${tag}`}
              onClick={() => void write(tags.filter((held) => !sameTag(held, tag)))}
            >
              <X size={12} aria-hidden="true" />
            </button>
          </span>
        ))}
        <input
          value={draft}
          list={listId}
          disabled={busy}
          maxLength={MAX_TAG_LENGTH}
          placeholder={tags.length ? "Add a tag" : (hint ?? "Add a tag")}
          aria-label={of ? `Add a tag to ${of}` : "Add a tag"}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          onBlur={(event) => void add(event.target.value)}
        />
        <datalist id={listId}>
          {unused.map((tag) => (
            <option key={tag.toLocaleLowerCase()} value={tag} />
          ))}
        </datalist>
      </div>
      {error && <p className="form-error tag-field-error">{error}</p>}
    </div>
  );
}
