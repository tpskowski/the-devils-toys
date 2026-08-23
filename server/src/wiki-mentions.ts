import { plainMentions, plainWikiDirectives, wikiMentions, type WikiMention } from "@devils-toys/shared";
import type { AuthAccount } from "./auth.js";
import { characterItem, characterItemsFor } from "./character-items.js";
import { findVisibleCharacter } from "./characters.js";
import { all, db, one } from "./db.js";
import { mayReadWikiFile, wikiRole } from "./wiki-permissions.js";

type MentionKind = WikiMention["kind"];

export interface ResolvedWikiMention {
  kind: MentionKind;
  characterId?: number;
  npcId?: number;
  hirelingId?: number;
  mediaId?: number;
  itemId?: string;
  roomItemId?: number;
  targetPageId?: number;
}

export interface WikiMentionable {
  kind: MentionKind;
  label: string;
  id?: number | string;
  slug?: string;
}

interface PageAccessRow {
  id: number;
  room_id: number;
  owner_account_id: number | null;
  visible: number;
}

function mentionId(mention: WikiMention) {
  const value = Number(mention.target);
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function mentionSlug(mention: WikiMention) {
  const value = String(mention.target ?? "").trim();
  return value.length > 0 && value.length <= 160 ? value : undefined;
}

function mentionItemId(mention: WikiMention) {
  const value = String(mention.target ?? "").trim();
  return value.length > 0 && value.length <= 300 ? value : undefined;
}

/**
 * Resolves a target with the same visibility rule the reader uses.  Returning
 * undefined intentionally joins "not in this room" and "not visible" so a
 * player cannot probe the room by trying directive ids.
 */
export function resolveWikiMention(
  account: AuthAccount,
  roomId: number,
  mention: WikiMention
): ResolvedWikiMention | undefined {
  const role = wikiRole(account, roomId);
  if (!role) return;

  if (mention.kind === "page") {
    const slug = mentionSlug(mention);
    if (!slug) return;
    const page = one<PageAccessRow>(
      "SELECT id, room_id, owner_account_id, visible FROM wiki_pages WHERE room_id = ? AND slug = ?",
      roomId,
      slug
    );
    return page && mayReadWikiFile(account, page) ? { kind: "page", targetPageId: page.id } : undefined;
  }

  if (mention.kind === "item") {
    const itemId = mentionItemId(mention);
    if (!itemId) return;
    const room = one<{ system: string }>("SELECT system FROM rooms WHERE id = ?", roomId);
    if (!room || !characterItem(room.system as never, itemId, roomId)) return;
    const roomItem = one<{ id: number }>("SELECT id FROM room_items WHERE room_id = ? AND item_id = ?", roomId, itemId);
    return { kind: "item", itemId, ...(roomItem ? { roomItemId: roomItem.id } : {}) };
  }

  const id = mentionId(mention);
  if (!id) return;
  switch (mention.kind) {
    case "pc": {
      const visible =
        role === "gm"
          ? one(
              `SELECT 1 FROM characters c JOIN rooms r ON r.id = ?
                WHERE c.id = ? AND c.system = r.system
                  AND (c.pool_room_id = r.id OR c.owner_account_id IN
                    (SELECT account_id FROM memberships WHERE room_id = r.id))`,
              roomId,
              id
            )
          : findVisibleCharacter(account.id, roomId, id);
      return visible ? { kind: "pc", characterId: id } : undefined;
    }
    case "npc": {
      const npc = one(
        `SELECT id FROM custom_npcs WHERE id = ? AND room_id = ? AND spawned = 0 ${role === "gm" ? "" : "AND revealed = 1"}`,
        id,
        roomId
      );
      return npc ? { kind: "npc", npcId: id } : undefined;
    }
    case "follower": {
      const follower = one("SELECT id FROM group_hirelings WHERE id = ? AND room_id = ?", id, roomId);
      return follower ? { kind: "follower", hirelingId: id } : undefined;
    }
    case "asset": {
      const asset = one(
        `SELECT id FROM media WHERE id = ? AND room_id = ? ${role === "gm" ? "" : "AND visible = 1"}`,
        id,
        roomId
      );
      return asset ? { kind: "asset", mediaId: id } : undefined;
    }
  }
}

/** Refuse an unresolvable directive before a page is committed. */
export function resolveWikiMentions(
  account: AuthAccount,
  roomId: number,
  markdown: string
): ResolvedWikiMention[] | undefined {
  const resolved: ResolvedWikiMention[] = [];
  for (const mention of wikiMentions(markdown)) {
    const target = resolveWikiMention(account, roomId, mention);
    if (!target) return;
    resolved.push(target);
  }
  return resolved;
}

function mentionKey(mention: WikiMention) {
  // The label is deliberately part of the key.  An author can keep editing a
  // directive they were previously allowed to write, but cannot turn a stale
  // target into a general-purpose, hidden-target reference with a forged label.
  return `${mention.kind}\u0000${mention.target}\u0000${mention.label}`;
}

export interface ResolvedWikiMarkdown {
  markdown: string;
  mentions: ResolvedWikiMention[];
}

/**
 * Resolves a replacement document while allowing a previously-valid target to
 * disappear or become hidden.  Such directives are reduced to their written
 * labels and dropped from the derived index.  New unresolvable directives are
 * still refused, so saves cannot be used to probe targets the author cannot
 * read.
 */
export function resolveWikiMarkdownUpdate(
  account: AuthAccount,
  roomId: number,
  markdown: string,
  previousMarkdown: string
): ResolvedWikiMarkdown | undefined {
  const previous = new Set(wikiMentions(previousMarkdown).map(mentionKey));
  const mentions: ResolvedWikiMention[] = [];
  let hasNewUnresolvableMention = false;
  const normalized = plainMentions(markdown, (mention) => {
    const resolved = resolveWikiMention(account, roomId, mention);
    if (resolved) {
      mentions.push(resolved);
      return true;
    }
    if (previous.has(mentionKey(mention))) return false;
    hasNewUnresolvableMention = true;
    return true;
  });
  return hasNewUnresolvableMention ? undefined : { markdown: normalized, mentions };
}

/** Replaces the derived index as part of the caller's page-save transaction. */
export function replaceWikiMentions(pageId: number, mentions: readonly ResolvedWikiMention[]) {
  db.prepare("DELETE FROM wiki_mentions WHERE page_id = ?").run(pageId);
  const insert = db.prepare(
    `INSERT INTO wiki_mentions
       (page_id, kind, character_id, npc_id, hireling_id, media_id, item_id, room_item_id, target_page_id, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  mentions.forEach((mention, sortOrder) =>
    insert.run(
      pageId,
      mention.kind,
      mention.characterId ?? null,
      mention.npcId ?? null,
      mention.hirelingId ?? null,
      mention.mediaId ?? null,
      mention.itemId ?? null,
      mention.roomItemId ?? null,
      mention.targetPageId ?? null,
      sortOrder
    )
  );
}

/**
 * A page is shared whole, but a target may be hidden from one particular
 * reader.  Transform it before it crosses the route boundary; the browser gets
 * only the author's label for a target it cannot resolve.
 */
export function markdownForWikiReader(account: AuthAccount, roomId: number, markdown: string) {
  return plainMentions(markdown, (mention) => Boolean(resolveWikiMention(account, roomId, mention)));
}

/** Search only prose and author-facing labels, never directive metadata. */
export function markdownForWikiSearch(markdown: string) {
  return plainWikiDirectives(markdown);
}

function likeQuery(query: string) {
  return `%${query.replace(/[%_\\]/g, "\\$&")}%`;
}

/** Targets an author may select, bounded after role-filtering rather than in the editor. */
export function wikiMentionables(account: AuthAccount, roomId: number, query: string): WikiMentionable[] {
  const role = wikiRole(account, roomId);
  if (!role) return [];
  const like = likeQuery(query);
  const limit = 80;
  const rows: WikiMentionable[] = [];

  const characters =
    role === "gm"
      ? all<{ id: number; name: string }>(
          `SELECT c.id, c.name FROM characters c JOIN rooms r ON r.id = ?
            WHERE c.system = r.system AND (c.pool_room_id = r.id OR c.owner_account_id IN
              (SELECT account_id FROM memberships WHERE room_id = r.id))
              AND c.name LIKE ? ESCAPE '\\' ORDER BY c.name COLLATE NOCASE, c.id LIMIT ?`,
          roomId,
          like,
          limit
        )
      : all<{ id: number; name: string }>(
          `SELECT c.id, c.name FROM characters c JOIN rooms r ON r.id = ?
            WHERE c.system = r.system AND c.name LIKE ? ESCAPE '\\'
            ORDER BY c.name COLLATE NOCASE, c.id LIMIT ?`,
          roomId,
          like,
          limit * 3
        ).filter((row) => Boolean(findVisibleCharacter(account.id, roomId, row.id)));
  rows.push(...characters.map((row) => ({ kind: "pc" as const, id: row.id, label: row.name })));

  rows.push(
    ...all<{ id: number; name: string }>(
      `SELECT id, name FROM custom_npcs WHERE room_id = ? AND spawned = 0 ${role === "gm" ? "" : "AND revealed = 1"}
        AND name LIKE ? ESCAPE '\\' ORDER BY name COLLATE NOCASE, id LIMIT ?`,
      roomId,
      like,
      limit
    ).map((row) => ({ kind: "npc" as const, id: row.id, label: row.name }))
  );
  rows.push(
    ...all<{ id: number; name: string }>(
      "SELECT id, name FROM group_hirelings WHERE room_id = ? AND name LIKE ? ESCAPE '\\' ORDER BY name COLLATE NOCASE, id LIMIT ?",
      roomId,
      like,
      limit
    ).map((row) => ({ kind: "follower" as const, id: row.id, label: row.name }))
  );
  rows.push(
    ...all<{ id: number; label: string }>(
      `SELECT id, COALESCE(NULLIF(display_name, ''), filename) AS label FROM media
        WHERE room_id = ? ${role === "gm" ? "" : "AND visible = 1"}
          AND COALESCE(NULLIF(display_name, ''), filename) LIKE ? ESCAPE '\\'
        ORDER BY label COLLATE NOCASE, id LIMIT ?`,
      roomId,
      like,
      limit
    ).map((row) => ({ kind: "asset" as const, id: row.id, label: row.label }))
  );
  const room = one<{ system: string }>("SELECT system FROM rooms WHERE id = ?", roomId);
  if (room) {
    const items = new Map<string, string>();
    for (const list of Object.values(characterItemsFor(room.system as never, roomId)))
      for (const item of list) items.set(item.id, item.label);
    for (const [id, label] of items)
      if (label.toLocaleLowerCase().includes(query.toLocaleLowerCase())) rows.push({ kind: "item", id, label });
  }
  rows.push(
    ...all<{ slug: string; title: string }>(
      `SELECT slug, title FROM wiki_pages WHERE room_id = ? ${role === "gm" ? "" : "AND (owner_account_id = ? OR visible = 1)"}
        AND title LIKE ? ESCAPE '\\' ORDER BY title COLLATE NOCASE, id LIMIT ?`,
      ...(role === "gm" ? [roomId, like, limit] : [roomId, account.id, like, limit])
    ).map((row) => ({ kind: "page" as const, slug: row.slug, label: row.title }))
  );
  return rows
    .sort((left, right) => left.label.localeCompare(right.label) || left.kind.localeCompare(right.kind))
    .slice(0, limit);
}
