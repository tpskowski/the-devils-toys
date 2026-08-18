import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { groupAssetDefinitions } from "@devils-toys/shared";
import { config } from "./config.js";
import { db, all, one } from "./db.js";
import { isMp3File } from "./audio.js";
import { imageSignatureMatches, isUtf8Markdown } from "./media.js";
import { validateStatblock } from "./npcs.js";
import { nextSortOrder } from "./group-rows.js";
import { readRoomItem, writeRoomItem, retireForRoom } from "./room-items.js";
import { readItemCatalog } from "./item-catalog.js";
import { systemOrThrow } from "./systems.js";
import { storedUploadBytes } from "./upload-usage.js";
import type { Campaign, CampaignMedia } from "./campaign-bundles.js";

/**
 * Landing a staged campaign in a room.
 *
 * Everything slow already happened. The archive was expanded at staging, so this
 * is renames and inserts: a gigabyte of maps costs the same number of syscalls as
 * a megabyte of them, because the bytes are already on the same filesystem and
 * only their directory entry changes. That is what makes the commit instant and
 * its rollback cheap, and it is why nothing here needs to report progress.
 *
 * The order is the one `media.ts` already trusts, for the same reason: files
 * first, then the rows that point at them, in one transaction. A stray file is
 * recoverable and a row pointing at a missing one is not, so a failure walks the
 * renames back and leaves the stage exactly as it found it — able to be tried
 * again rather than gone.
 */

/** What to do about something the room already holds. One choice for the import. */
export type ConflictPolicy = "skip" | "replace" | "add";

export interface ApplyOptions {
  policy: ConflictPolicy;
  /** Whether `room.json`'s name, theme, and switches are taken. Off unless asked for. */
  takeRoomSettings: boolean;
}

export interface ApplyTally {
  added: number;
  replaced: number;
  skipped: number;
}

export interface ApplyResult {
  media: ApplyTally;
  playlists: ApplyTally;
  npcs: ApplyTally;
  items: ApplyTally;
  group: ApplyTally;
  /** Which room settings were taken, for the confirmation to name them. */
  room: string[];
  bytes: number;
  /** Said out loud rather than swallowed: what was in the bundle and could not land. */
  skipped: string[];
}

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".md": "text/markdown",
  ".mp3": "audio/mpeg"
};

const uploadsDir = () => path.join(config.dataDir, "uploads");
const tally = (): ApplyTally => ({ added: 0, replaced: 0, skipped: 0 });

interface ExistingMedia {
  id: number;
  kind: string;
  filename: string;
  stored_name: string;
}

/**
 * Whether a staged file is what its extension says it is.
 *
 * The same three checks a hand upload passes, asked of the file on disk. An
 * archive can carry anything under any name, and this application stores images,
 * Markdown, and MP3s — so a `.png` that is not one is refused here rather than
 * served to a room later.
 */
function refuseUnusableFile(directory: string, entry: CampaignMedia) {
  const file = path.join(directory, entry.path);
  const mimeType = MIME[path.extname(entry.filename).toLowerCase()];
  if (!mimeType) throw new Error(`The campaign's "${entry.path}" is not a kind of file this application stores.`);

  const usable =
    mimeType === "text/markdown"
      ? isUtf8Markdown(file)
      : mimeType === "audio/mpeg"
        ? isMp3File(file)
        : imageSignatureMatches(file, mimeType);
  if (!usable)
    throw new Error(`The campaign's "${entry.path}" does not contain the ${mimeType} its name says it does.`);
  return mimeType;
}

/**
 * Moves a staged file into the uploads directory under a name of this server's
 * choosing.
 *
 * A rename rather than a copy: both live under the data directory, so this is a
 * directory operation whatever the file weighs. `EXDEV` is the one case it cannot
 * be — a data directory spanning a mount point — and there it falls back to the
 * copy it was avoiding.
 */
function moveIntoUploads(from: string, extension: string) {
  const storedName = `${crypto.randomUUID()}${extension}`;
  const to = path.join(uploadsDir(), storedName);
  try {
    fs.renameSync(from, to);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "EXDEV") throw cause;
    fs.copyFileSync(from, to);
    fs.rmSync(from, { force: true });
  }
  return { storedName, from, to };
}

/**
 * Writes a staged campaign into a room.
 *
 * Media first, then the playlists over it, because a playlist names tracks by
 * their path in the bundle and those paths have to have become row ids by the
 * time it is read. A file the policy skipped still resolves — to the row the room
 * already held — so a playlist keeps its third track rather than losing it to a
 * conflict decision made about something else.
 */
export function applyCampaign(
  directory: string,
  campaign: Campaign,
  roomId: number,
  accountId: number,
  options: ApplyOptions
): ApplyResult {
  const existing = all<ExistingMedia>(
    "SELECT id, COALESCE(category, kind) AS kind, filename, stored_name FROM media WHERE room_id = ?",
    roomId
  );
  const held = new Map(existing.map((row) => [`${row.kind}/${row.filename}`, row]));

  // Decide everything before touching anything, so a refusal costs nothing.
  const planned = campaign.media.map((entry) => {
    const match = held.get(`${entry.category}/${entry.filename}`);
    const action = !match ? "add" : options.policy === "add" ? "add" : options.policy;
    return { entry, match, action, mimeType: action === "skip" ? "" : refuseUnusableFile(directory, entry) };
  });

  const portraitBytes = [...campaign.hirelings, ...campaign.assets]
    .filter((wearer) => wearer.portrait)
    .reduce((total, wearer) => total + fs.statSync(path.join(directory, wearer.portrait!)).size, 0);
  const incoming =
    planned.filter((item) => item.action !== "skip").reduce((total, item) => total + item.entry.bytes, 0) +
    portraitBytes;
  if (storedUploadBytes() + incoming > config.uploadLimitMb * 1024 * 1024)
    throw new Error("This campaign would take the server past its upload-storage allowance.");

  const moved: { from: string; to: string }[] = [];
  /** Files a replacement orphans. Removed after the commit, since a rollback needs them. */
  const superseded: string[] = [];
  const mediaIds = new Map<string, number>();
  const media = tally();
  const playlists = tally();
  const npcs = tally();
  const items = tally();
  const group = tally();
  const room: string[] = [];
  const skipped: string[] = [];
  /** Portraits, moved beside the media so a failure walks all of them back together. */
  const portraits = new Map<string, { storedName: string; mimeType: string; bytes: number }>();
  const system = one<{ system: string }>("SELECT system FROM rooms WHERE id = ?", roomId)?.system ?? "";

  try {
    for (const item of planned) {
      if (item.action === "skip") {
        mediaIds.set(item.entry.path, item.match!.id);
        media.skipped += 1;
        continue;
      }
      const move = moveIntoUploads(
        path.join(directory, item.entry.path),
        path.extname(item.entry.filename).toLowerCase()
      );
      moved.push(move);
      (item as { storedName?: string }).storedName = move.storedName;
    }

    for (const wearer of [...campaign.hirelings, ...campaign.assets]) {
      if (!wearer.portrait) continue;
      const from = path.join(directory, wearer.portrait);
      const mimeType = MIME[path.extname(wearer.portrait).toLowerCase()] ?? "";
      if (!mimeType.startsWith("image/") || !imageSignatureMatches(from, mimeType))
        throw new Error(`The campaign's "${wearer.portrait}" is not an image this application stores.`);
      const bytes = fs.statSync(from).size;
      const move = moveIntoUploads(from, path.extname(wearer.portrait).toLowerCase());
      moved.push(move);
      portraits.set(wearer.path, { storedName: move.storedName, mimeType, bytes });
    }

    db.exec("BEGIN IMMEDIATE");
    try {
      for (const item of planned) {
        if (item.action === "skip") continue;
        const { entry } = item;
        const storedName = (item as { storedName?: string }).storedName!;
        // `kind` predates `category`, and a map is stored as a scene under it —
        // the same shape `media.ts` writes, so one reader serves both.
        const kind = entry.category === "map" ? "scene" : entry.category;

        if (item.action === "replace") {
          superseded.push(item.match!.stored_name);
          db.prepare(
            `UPDATE media SET stored_name = ?, mime_type = ?, size = ?, display_name = ?, metadata_loaded = 0
             WHERE id = ?`
          ).run(storedName, item.mimeType, entry.bytes, entry.displayName, item.match!.id);
          mediaIds.set(entry.path, item.match!.id);
          media.replaced += 1;
          continue;
        }

        const result = db
          .prepare(
            `INSERT INTO media
               (room_id, uploaded_by, kind, category, filename, display_name, stored_name,
                artist, title, album, metadata_loaded, mime_type, size)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
          )
          .run(
            roomId,
            accountId,
            kind,
            entry.category,
            entry.filename,
            entry.displayName,
            storedName,
            entry.tags?.artist ?? null,
            entry.tags?.title ?? null,
            entry.tags?.album ?? null,
            item.mimeType,
            entry.bytes
          );
        mediaIds.set(entry.path, Number(result.lastInsertRowid));
        media.added += 1;
      }

      applyPlaylists(campaign, roomId, mediaIds, options.policy, playlists);
      applyNpcs(campaign, roomId, accountId, system, options.policy, npcs, skipped);
      applyItems(campaign, roomId, accountId, system, items, skipped);
      applyGroup(campaign, roomId, system, group, skipped, portraits);
      if (options.takeRoomSettings) room.push(...applyRoomSettings(campaign, roomId));
      db.exec("COMMIT");
    } catch (cause) {
      db.exec("ROLLBACK");
      throw cause;
    }
  } catch (cause) {
    // Put every file back where the stage had it, so the import can be tried
    // again rather than having to be uploaded again.
    for (const move of moved) {
      try {
        fs.renameSync(move.to, move.from);
      } catch {
        // A file that cannot be returned is a stray in uploads/, which is
        // recoverable; the error being thrown is what the caller has to act on.
      }
    }
    throw cause;
  }

  for (const stored of superseded) {
    if (path.basename(stored) !== stored) continue;
    try {
      fs.rmSync(path.join(uploadsDir(), stored), { force: true });
    } catch {
      // The row already points at the new file; an undeletable old one is litter.
    }
  }

  return { media, playlists, npcs, items, group, room, bytes: incoming, skipped };
}

function applyPlaylists(
  campaign: Campaign,
  roomId: number,
  mediaIds: Map<string, number>,
  policy: ConflictPolicy,
  counts: ApplyTally
) {
  if (!campaign.playlists.length) return;
  const existing = new Map(
    all<{ id: number; name: string }>("SELECT id, name FROM room_playlists WHERE room_id = ?", roomId).map((row) => [
      row.name.toLocaleLowerCase(),
      row.id
    ])
  );
  // Imported playlists land after the room's own, keeping their order among themselves.
  const nextOrder =
    all<{ next: number }>(
      "SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM room_playlists WHERE room_id = ?",
      roomId
    )[0]?.next ?? 0;

  for (const playlist of campaign.playlists) {
    const match = existing.get(playlist.name.toLocaleLowerCase());
    if (match && policy === "skip") {
      counts.skipped += 1;
      continue;
    }

    let playlistId: number;
    if (match && policy === "replace") {
      db.prepare("UPDATE room_playlists SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(match);
      db.prepare("DELETE FROM room_playlist_tracks WHERE playlist_id = ?").run(match);
      playlistId = match;
      counts.replaced += 1;
    } else {
      playlistId = Number(
        db
          .prepare("INSERT INTO room_playlists (room_id, name, sort_order) VALUES (?, ?, ?)")
          .run(roomId, playlist.name, nextOrder + playlist.sortOrder).lastInsertRowid
      );
      counts.added += 1;
    }

    let order = 0;
    for (const track of playlist.tracks) {
      const mediaId = mediaIds.get(track);
      // A track whose file was not imported cannot be in the playlist. The reader
      // already refused a track naming a file the bundle lacks, so this is only
      // reachable for one the policy left out, and dropping it is the honest
      // outcome rather than a row pointing at nothing.
      if (!mediaId) continue;
      db.prepare("INSERT OR IGNORE INTO room_playlist_tracks (playlist_id, media_id, sort_order) VALUES (?, ?, ?)").run(
        playlistId,
        mediaId,
        order
      );
      order += 1;
    }
  }
}

/**
 * The room's cast.
 *
 * A statblock is checked against the system the **room** runs, not the one the
 * bundle claims — a campaign may be system-agnostic, and a field this system does
 * not declare is one nothing would ever render. The NPC still lands; the field is
 * dropped and said out loud, because an NPC with an unknown field is mostly right
 * and refusing the whole import over it would be worse than saying so.
 */
function applyNpcs(
  campaign: Campaign,
  roomId: number,
  accountId: number,
  system: string,
  policy: ConflictPolicy,
  counts: ApplyTally,
  skipped: string[]
) {
  if (!campaign.npcs.length) return;
  const existing = new Map(
    all<{ id: number; name: string }>("SELECT id, name FROM custom_npcs WHERE room_id = ?", roomId).map((row) => [
      row.name.toLocaleLowerCase(),
      row.id
    ])
  );

  for (const npc of campaign.npcs) {
    const match = existing.get(npc.name.toLocaleLowerCase());
    if (match && policy === "skip") {
      counts.skipped += 1;
      continue;
    }

    let statblock = npc.statblock;
    const complaint = validateStatblock(system, statblock);
    if (complaint) {
      const declared = new Set(systemOrThrow(system).npcStatblock.fields.map((field) => field.key));
      statblock = Object.fromEntries(Object.entries(statblock).filter(([key]) => declared.has(key)));
      skipped.push(`${npc.path}: ${complaint} The rest of the NPC was imported.`);
    }

    if (match && policy === "replace") {
      db.prepare(
        "UPDATE custom_npcs SET notes = ?, statblock_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
      ).run(npc.notes, JSON.stringify(statblock), match);
      counts.replaced += 1;
      continue;
    }
    db.prepare("INSERT INTO custom_npcs (room_id, created_by, name, notes, statblock_json) VALUES (?, ?, ?, ?, ?)").run(
      roomId,
      accountId,
      npc.name,
      npc.notes,
      JSON.stringify(statblock)
    );
    counts.added += 1;
  }
}

/**
 * The room's own additions to its system's gear, and what it takes out.
 *
 * Added items go through `readRoomItem`, which is what the Items panel writes
 * through: an imported weapon is classified a weapon by the same reading a
 * hand-typed one gets, rather than by a looser second one kept for bundles. Ids
 * are minted against this room, since `room:<roomId>:<slug>` names the room that
 * holds it and a carried-over id would be a lie.
 *
 * Retired ids are the one thing that travels verbatim, because they name the
 * system's items rather than the room's — and one this system has never heard of
 * is reported rather than written, since it is the loudest sign a bundle was
 * built for a different game.
 */
function applyItems(
  campaign: Campaign,
  roomId: number,
  accountId: number,
  system: string,
  counts: ApplyTally,
  skipped: string[]
) {
  const { added, retired } = campaign.items;
  if (!added.length && !retired.length) return;
  const definition = systemOrThrow(system);
  const lists = new Set(definition.characterSheet.lists.map((list) => list.key));
  const held = new Set(
    Object.values(readItemCatalog(system).lists).flatMap((entries) => entries.map((item) => item.id))
  );

  for (const input of added) {
    if (!lists.has(input.listKey)) {
      skipped.push(`"${input.name}" belongs to a list called "${input.listKey}", which this system has not got.`);
      counts.skipped += 1;
      continue;
    }
    writeRoomItem(roomId, accountId, input.listKey, readRoomItem(system, roomId, input));
    counts.added += 1;
  }

  for (const id of retired) {
    if (!held.has(id)) {
      skipped.push(`The campaign retires "${id}", which this system's catalogue has not got.`);
      counts.skipped += 1;
      continue;
    }
    retireForRoom(roomId, id);
    counts.replaced += 1;
  }
}

/**
 * Hirelings, shared property, and what the party owes.
 *
 * Each is gated on the system declaring it: a system with no hireling sheet has
 * nowhere to put a hireling, and writing rows the room can never show would be a
 * silent loss. The refusal is per kind and named, so a campaign that carries a
 * starship into a system without one still lands everything else.
 */
function applyGroup(
  campaign: Campaign,
  roomId: number,
  system: string,
  counts: ApplyTally,
  skipped: string[],
  portraits: Map<string, { storedName: string; mimeType: string; bytes: number }>
) {
  /** The four columns a portrait is, in the shape `characters` already carries them. */
  const wearing = (
    row: number | bigint,
    table: "group_hirelings" | "group_assets",
    wearer: string,
    filename?: string
  ) => {
    const portrait = portraits.get(wearer);
    if (!portrait) return;
    db.prepare(
      `UPDATE ${table} SET portrait_filename = ?, portrait_stored_name = ?, portrait_mime_type = ?, portrait_size = ?
       WHERE id = ?`
    ).run(path.basename(filename ?? ""), portrait.storedName, portrait.mimeType, portrait.bytes, Number(row));
  };

  const { groupPage } = systemOrThrow(system);

  for (const hireling of campaign.hirelings) {
    if (!groupPage?.hirelings) {
      skipped.push(`${hireling.path}: this system has no hirelings.`);
      counts.skipped += 1;
      continue;
    }
    const row = db
      .prepare("INSERT INTO group_hirelings (room_id, name, sort_order, sheet_json) VALUES (?, ?, ?, ?)")
      .run(roomId, hireling.name, nextSortOrder("group_hirelings", roomId), JSON.stringify(hireling.sheet));
    wearing(row.lastInsertRowid, "group_hirelings", hireling.path, hireling.portrait);
    counts.added += 1;
  }

  const kinds = new Set(groupAssetDefinitions(groupPage).map((asset) => asset.kind));
  for (const asset of campaign.assets) {
    if (!kinds.has(asset.kind)) {
      skipped.push(`${asset.path}: this system has no shared property of the kind "${asset.kind}".`);
      counts.skipped += 1;
      continue;
    }
    const row = db
      .prepare("INSERT INTO group_assets (room_id, kind, name, sort_order, sheet_json) VALUES (?, ?, ?, ?, ?)")
      .run(roomId, asset.kind, asset.name, nextSortOrder("group_assets", roomId), JSON.stringify(asset.sheet));
    wearing(row.lastInsertRowid, "group_assets", asset.path, asset.portrait);
    counts.added += 1;
  }

  for (const obligation of campaign.obligations) {
    db.prepare(
      "INSERT INTO group_obligations (room_id, name, owed_to, amount, details, sort_order) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(
      roomId,
      obligation.name,
      obligation.owedTo,
      obligation.amount,
      obligation.details,
      nextSortOrder("group_obligations", roomId)
    );
    counts.added += 1;
  }
}

/**
 * `room.json`, applied only when asked for.
 *
 * Renaming a running room and changing its theme out from under the people in it
 * is startling, so this is opt-in and off by default. It is on by default in
 * exactly one place — making a room from a bundle — where there is no running
 * room to startle.
 */
function applyRoomSettings(campaign: Campaign, roomId: number) {
  const taken: string[] = [];
  const set = (column: string, value: string | number, label: string) => {
    db.prepare(`UPDATE rooms SET ${column} = ? WHERE id = ?`).run(value, roomId);
    taken.push(label);
  };

  const { room } = campaign;
  // The calendar is a room setting in every sense: it is one column beside the
  // switch that shows it, and taking a campaign's dates without being asked would
  // move a running game's clock.
  if (campaign.calendar) {
    db.prepare("UPDATE rooms SET calendar_json = ?, calendar_enabled = 1 WHERE id = ?").run(
      JSON.stringify(campaign.calendar),
      roomId
    );
    taken.push("calendar taken from the campaign");
  }
  if (room.name) set("name", room.name, `renamed to "${room.name}"`);
  if (room.theme) set("theme", room.theme, `theme set to ${room.theme}`);
  if (room.calendarEnabled !== undefined)
    set("calendar_enabled", room.calendarEnabled ? 1 : 0, `calendar ${room.calendarEnabled ? "on" : "off"}`);
  if (room.musicEnabled !== undefined)
    set("music_enabled", room.musicEnabled ? 1 : 0, `music ${room.musicEnabled ? "on" : "off"}`);
  if (room.mapNotationEnabled !== undefined)
    set(
      "map_notation_enabled",
      room.mapNotationEnabled ? 1 : 0,
      `map notation ${room.mapNotationEnabled ? "on" : "off"}`
    );
  return taken;
}
