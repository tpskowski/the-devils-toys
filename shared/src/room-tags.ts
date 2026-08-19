/**
 * Tags: words a table puts on the things in its game so it can find them again.
 *
 * They are arbitrary on purpose. Unlike the table editor's vocabulary — which is
 * a curated list an admin maintains, so that two sets can be browsed together —
 * these belong to one room and are whatever the people in it type. A room's
 * vocabulary is therefore not a list to be maintained but a reading of the tags
 * already in use.
 *
 * A room only has them when its system says so, which is an optional rule and
 * not a setting of its own: see `system-rules.ts`.
 */

/**
 * What can carry tags. Each is a row the application already owns, so a tag has
 * something with a real id to hang on and disappears with it.
 */
export const TAG_SUBJECTS = ["character", "npc", "hireling", "scene"] as const;

export type TagSubject = (typeof TAG_SUBJECTS)[number];

export function isTagSubject(value: string): value is TagSubject {
  return (TAG_SUBJECTS as readonly string[]).includes(value);
}

/** Long enough for a phrase, short enough to stay a label rather than a note. */
export const MAX_TAG_LENGTH = 32;

/** Past this many a list stops being a way of finding anything. A warning, not a wall, in the panel. */
export const MAX_TAGS_PER_SUBJECT = 20;

/**
 * A tag as it will be stored: the words as typed, with the spacing tidied and
 * the length capped. Case is kept — a proper noun is a good tag and "Vex" reads
 * better than "vex" — and matching ignores it everywhere instead.
 */
export function normalizeTag(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_TAG_LENGTH).trim();
}

/** Two tags are the same tag when only their case or spacing differs. */
export function sameTag(one: string, other: string): boolean {
  return normalizeTag(one).toLocaleLowerCase() === normalizeTag(other).toLocaleLowerCase();
}

/**
 * A subject's tags as they will be written: tidied, emptied of blanks, without
 * repeats, and capped. The first spelling of a repeated tag wins, so a tag typed
 * again in another case does not rewrite the one already there.
 */
export function normalizeTags(values: readonly string[]): string[] {
  const kept: string[] = [];
  for (const value of values) {
    const tag = normalizeTag(value);
    if (!tag || kept.some((held) => sameTag(held, tag))) continue;
    kept.push(tag);
    if (kept.length === MAX_TAGS_PER_SUBJECT) break;
  }
  return kept;
}

/** Tags a subject carries, keyed by the subject's own id. */
export type SubjectTags = Record<string, string[]>;

export interface RoomTags {
  /** False for a room whose system has no tags rule, or has it switched off. */
  enabled: boolean;
  tags: Record<TagSubject, SubjectTags>;
  /**
   * Every tag in use in the room, alphabetically and case-insensitively, in the
   * spelling it was first given. It is what the editor suggests from, so a table
   * settles on one vocabulary without anyone having to publish it.
   */
  vocabulary: string[];
}

export function emptyRoomTags(enabled = false): RoomTags {
  return {
    enabled,
    tags: { character: {}, npc: {}, hireling: {}, scene: {} },
    vocabulary: []
  };
}

/** What one subject carries, or nothing. Ids arrive as JSON keys, so numbers are spelled out. */
export function tagsFor(room: RoomTags, subject: TagSubject, id: number | string): string[] {
  return room.tags[subject]?.[String(id)] ?? [];
}

/** The vocabulary reading, from every tag given: alphabetical, case-insensitive, no repeats. */
export function tagVocabulary(tags: Iterable<string>): string[] {
  const kept: string[] = [];
  for (const value of tags) {
    const tag = normalizeTag(value);
    if (tag && !kept.some((held) => sameTag(held, tag))) kept.push(tag);
  }
  return kept.sort((one, other) => one.toLocaleLowerCase().localeCompare(other.toLocaleLowerCase()));
}

/**
 * Whether a search matches one of these tags. Used to let the panels that
 * already have a search box find by tag without gaining a second box.
 */
export function tagsMatch(tags: readonly string[], query: string): boolean {
  const wanted = query.trim().toLocaleLowerCase();
  if (!wanted) return false;
  return tags.some((tag) => tag.toLocaleLowerCase().includes(wanted));
}
