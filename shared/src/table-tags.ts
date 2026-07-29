import type { TableTag, TableTagDefinition } from "./index.js";

/**
 * What a slug is called before anyone renames it. Most tags read well enough as
 * their own slug; "scifi" is the one that does not.
 */
export function defaultTagLabel(tag: TableTag) {
  if (tag === "scifi") return "Sci-fi";
  return tag
    .split("-")
    .filter(Boolean)
    .map((word) => `${word[0].toLocaleUpperCase()}${word.slice(1)}`)
    .join(" ");
}

/** What to show for a tag, preferring the name the instance gave it. */
export function tagLabel(tag: TableTag, vocabulary: readonly TableTagDefinition[] = []) {
  return vocabulary.find((entry) => entry.slug === tag)?.label ?? defaultTagLabel(tag);
}

/** Turns typed-in text into a usable slug, so a GM never has to write one by hand. */
export function toTagSlug(value: string) {
  return value
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Tags in vocabulary order and without repeats, for stable display and storage. */
export function orderTags(tags: Iterable<TableTag>, vocabulary: readonly TableTagDefinition[]): TableTag[] {
  const wanted = new Set(tags);
  return vocabulary.filter((entry) => wanted.has(entry.slug)).map((entry) => entry.slug);
}
