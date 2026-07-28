import type { CharacterEntry } from "@devils-toys/shared";

function asText(value: unknown) {
  return typeof value === "string" ? value : "";
}

/**
 * Reads an `entries` field from a stored sheet. Sheets written before the field
 * became a list hold a single block of text, which reads back as one untitled entry.
 */
export function readEntries(value: unknown): CharacterEntry[] {
  if (typeof value === "string") return value.trim() ? [{ title: "", text: value }] : [];
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (typeof item === "string") return item.trim() ? [{ title: "", text: item }] : [];
    if (!item || typeof item !== "object") return [];
    const { title, text } = item as Record<string, unknown>;
    return [{ title: asText(title), text: asText(text) }];
  });
}

export function appendEntry(entries: readonly CharacterEntry[]): CharacterEntry[] {
  return [...entries, { title: "", text: "" }];
}

export function updateEntry(
  entries: readonly CharacterEntry[],
  index: number,
  patch: Partial<CharacterEntry>
): CharacterEntry[] {
  return entries.map((entry, position) => (position === index ? { ...entry, ...patch } : entry));
}

export function removeEntry(entries: readonly CharacterEntry[], index: number): CharacterEntry[] {
  return entries.filter((_entry, position) => position !== index);
}

/** Falls back to the position so a still-unnamed entry is still identifiable. */
export function entryName(entry: CharacterEntry, index: number, singular: string) {
  return entry.title.trim() || `Untitled ${singular.toLocaleLowerCase()} ${index + 1}`;
}

/** "Talents" describes the group; each row needs the singular for its labels. */
export function singularLabel(label: string) {
  return /s$/i.test(label) ? label.slice(0, -1) : label;
}
