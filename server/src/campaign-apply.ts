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
import { CampaignLedger, digestOf, digestOfFile } from "./campaign-ledger.js";
import { bundleSetMarkdown } from "./table-bundles.js";
import { parseCustomSet } from "./table-json.js";
import { knownTags, tagVocabulary } from "./table-tags.js";
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
  /** Already here from a previous import of this campaign, and unchanged since. */
  unchanged: number;
}

export interface ApplyResult {
  media: ApplyTally;
  playlists: ApplyTally;
  npcs: ApplyTally;
  encounters: ApplyTally;
  tables: ApplyTally;
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
const tally = (): ApplyTally => ({ added: 0, replaced: 0, skipped: 0, unchanged: 0 });

interface ExistingMedia {
  id: number;
  kind: string;
  filename: string;
  stored_name: string;
  display_name: string | null;
}

/**
 * A media row as this importer left it.
 *
 * `stored_name` is the whole trick: replacing a file through the media routes
 * mints a new one, so comparing it says whether the room has swapped the picture
 * without reading a single byte back off disk.
 */
const mediaState = (row: Pick<ExistingMedia, "stored_name" | "display_name">) =>
  digestOf(row.stored_name, row.display_name ?? "");

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
  /**
   * What the last import of this campaign into this room left behind. A campaign
   * this room has never taken has an empty one, and every path in it is fresh —
   * which is precisely the behaviour that existed before the ledger did.
   */
  const ledger = new CampaignLedger(roomId, campaign.manifest.campaignId);

  const existing = all<ExistingMedia>(
    "SELECT id, COALESCE(category, kind) AS kind, filename, stored_name, display_name FROM media WHERE room_id = ?",
    roomId
  );
  const held = new Map(existing.map((row) => [`${row.kind}/${row.filename}`, row]));

  /**
   * Decide everything before touching anything, so a refusal costs nothing.
   *
   * The ledger is asked first, because it knows something a name comparison
   * cannot: whether this exact file came from this campaign last time, and
   * whether the room has touched it since. Only when it has nothing to say does
   * the conflict policy get a vote.
   */
  const byId = new Map(existing.map((row) => [row.id, row]));
  const planned = campaign.media.map((entry) => {
    const mimeType = refuseUnusableFile(directory, entry);
    const source = digestOf(digestOfFile(path.join(directory, entry.path)), entry.displayName);
    const verdict = ledger.verdict("media", entry.path, source, (rowId) => {
      const row = byId.get(rowId);
      return row && mediaState(row);
    });

    if (verdict.state === "unchanged" || verdict.state === "updatable" || verdict.state === "edited") {
      const match = byId.get(verdict.rowId)!;
      const action =
        verdict.state === "unchanged"
          ? "unchanged"
          : verdict.state === "updatable"
            ? "replace"
            : options.policy === "add"
              ? "add"
              : options.policy;
      return { entry, match, action, mimeType, source };
    }

    const match = held.get(`${entry.category}/${entry.filename}`);
    const action = !match ? "add" : options.policy === "add" ? "add" : options.policy;
    return { entry, match, action, mimeType, source };
  });

  const portraitBytes = [...campaign.hirelings, ...campaign.assets]
    .filter((wearer) => wearer.portrait)
    .reduce((total, wearer) => total + fs.statSync(path.join(directory, wearer.portrait!)).size, 0);
  const incoming =
    planned
      .filter((item) => item.action !== "skip" && item.action !== "unchanged")
      .reduce((total, item) => total + item.entry.bytes, 0) + portraitBytes;
  if (storedUploadBytes() + incoming > config.uploadLimitMb * 1024 * 1024)
    throw new Error("This campaign would take the server past its upload-storage allowance.");

  const moved: { from: string; to: string }[] = [];
  /** Files a replacement orphans. Removed after the commit, since a rollback needs them. */
  const superseded: string[] = [];
  const mediaIds = new Map<string, number>();
  const media = tally();
  const playlists = tally();
  const npcs = tally();
  const encounters = tally();
  const tables = tally();
  const items = tally();
  /** Bundle path to the row it became, which is what an encounter resolves through. */
  const npcIds = new Map<string, number>();
  const hirelingIds = new Map<string, number>();
  const group = tally();
  const room: string[] = [];
  const skipped: string[] = [];
  /** Portraits, moved beside the media so a failure walks all of them back together. */
  const portraits = new Map<string, { storedName: string; mimeType: string; bytes: number }>();
  const system = one<{ system: string }>("SELECT system FROM rooms WHERE id = ?", roomId)?.system ?? "";

  try {
    for (const item of planned) {
      if (item.action === "skip" || item.action === "unchanged") {
        mediaIds.set(item.entry.path, item.match!.id);
        if (item.action === "unchanged") {
          media.unchanged += 1;
          ledger.record("media", item.entry.path, item.match!.id, item.source, mediaState(item.match!));
        } else media.skipped += 1;
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
        if (item.action === "skip" || item.action === "unchanged") continue;
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
          ledger.record(
            "media",
            entry.path,
            item.match!.id,
            item.source,
            mediaState({ stored_name: storedName, display_name: entry.displayName })
          );
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
        ledger.record(
          "media",
          entry.path,
          Number(result.lastInsertRowid),
          item.source,
          mediaState({ stored_name: storedName, display_name: entry.displayName })
        );
        media.added += 1;
      }

      applyPlaylists(campaign, roomId, mediaIds, options.policy, playlists, ledger);
      applyNpcs(campaign, roomId, accountId, system, options.policy, npcs, skipped, npcIds, ledger);
      applyItems(campaign, roomId, accountId, system, items, skipped);
      applyGroup(campaign, roomId, system, group, skipped, portraits, hirelingIds, ledger);
      applyEncounters(campaign, roomId, accountId, system, mediaIds, npcIds, hirelingIds, encounters, skipped);
      applyTables(campaign, accountId, options.policy, tables, skipped);
      if (options.takeRoomSettings) room.push(...applyRoomSettings(campaign, roomId));
      ledger.commit({
        name: campaign.manifest.name,
        version: campaign.manifest.version,
        manifest: campaign.manifest,
        accountId
      });
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

  return { media, playlists, npcs, encounters, tables, items, group, room, bytes: incoming, skipped };
}

function applyPlaylists(
  campaign: Campaign,
  roomId: number,
  mediaIds: Map<string, number>,
  policy: ConflictPolicy,
  counts: ApplyTally,
  ledger: CampaignLedger
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

  const playlistState = (id: number) => {
    const row = one<{ name: string }>("SELECT name FROM room_playlists WHERE id = ?", id);
    if (!row) return undefined;
    const tracks = all<{ media_id: number }>(
      "SELECT media_id FROM room_playlist_tracks WHERE playlist_id = ? ORDER BY sort_order",
      id
    );
    return digestOf(row.name, tracks.map((track) => track.media_id).join(","));
  };

  for (const playlist of campaign.playlists) {
    const source = digestOf(playlist.name, playlist.tracks.join(","));
    const verdict = ledger.verdict("playlists", playlist.path, source, playlistState);
    if (verdict.state === "unchanged") {
      ledger.record("playlists", playlist.path, verdict.rowId, source, playlistState(verdict.rowId)!);
      counts.unchanged += 1;
      continue;
    }

    const match = verdict.state === "updatable" ? verdict.rowId : existing.get(playlist.name.toLocaleLowerCase());
    const effective = verdict.state === "updatable" ? "replace" : policy;
    if (match && effective === "skip") {
      counts.skipped += 1;
      continue;
    }

    let playlistId: number;
    if (match && effective === "replace") {
      db.prepare("UPDATE room_playlists SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(
        playlist.name,
        match
      );
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
    ledger.record("playlists", playlist.path, playlistId, source, playlistState(playlistId)!);
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
  skipped: string[],
  npcIds: Map<string, number>,
  ledger: CampaignLedger
) {
  if (!campaign.npcs.length) return;
  const rows = all<{ id: number; name: string; notes: string; statblock_json: string }>(
    "SELECT id, name, notes, statblock_json FROM custom_npcs WHERE room_id = ?",
    roomId
  );
  const existing = new Map(rows.map((row) => [row.name.toLocaleLowerCase(), row.id]));
  const byId = new Map(rows.map((row) => [row.id, row]));
  const npcState = (row: { name: string; notes: string; statblock_json: string }) =>
    digestOf(row.name, row.notes, row.statblock_json);

  for (const npc of campaign.npcs) {
    const source = digestOf(npc.name, npc.notes, JSON.stringify(npc.statblock));
    const verdict = ledger.verdict("npcs", npc.path, source, (rowId) => {
      const row = byId.get(rowId);
      return row && npcState(row);
    });
    if (verdict.state === "unchanged") {
      npcIds.set(npc.path, verdict.rowId);
      ledger.record("npcs", npc.path, verdict.rowId, source, npcState(byId.get(verdict.rowId)!));
      counts.unchanged += 1;
      continue;
    }

    // A row this campaign made and the room has not touched is this campaign's to
    // correct, whatever the policy says about things it did not make.
    const match = verdict.state === "updatable" ? verdict.rowId : existing.get(npc.name.toLocaleLowerCase());
    const effective = verdict.state === "updatable" ? "replace" : policy;
    if (match && effective === "skip") {
      // Resolves to the row the room already held, so an encounter naming this
      // NPC still finds one rather than losing a combatant to a decision that
      // was about something else.
      npcIds.set(npc.path, match);
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

    if (match && effective === "replace") {
      db.prepare(
        "UPDATE custom_npcs SET name = ?, notes = ?, statblock_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
      ).run(npc.name, npc.notes, JSON.stringify(statblock), match);
      npcIds.set(npc.path, match);
      ledger.record(
        "npcs",
        npc.path,
        match,
        source,
        npcState({ name: npc.name, notes: npc.notes, statblock_json: JSON.stringify(statblock) })
      );
      counts.replaced += 1;
      continue;
    }
    const row = db
      .prepare("INSERT INTO custom_npcs (room_id, created_by, name, notes, statblock_json) VALUES (?, ?, ?, ?, ?)")
      .run(roomId, accountId, npc.name, npc.notes, JSON.stringify(statblock));
    npcIds.set(npc.path, Number(row.lastInsertRowid));
    ledger.record(
      "npcs",
      npc.path,
      Number(row.lastInsertRowid),
      source,
      npcState({ name: npc.name, notes: npc.notes, statblock_json: JSON.stringify(statblock) })
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
  portraits: Map<string, { storedName: string; mimeType: string; bytes: number }>,
  hirelingIds: Map<string, number>,
  ledger: CampaignLedger
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

  /**
   * Hirelings, ships, and debts have no identity of their own — nothing about a
   * hireling says which hireling it is, which is why the preview counts them as
   * additions. The ledger is what gives them one: the bundle path. Without it a
   * second import of the same campaign lays down a second Brann, and a third
   * lays down a third.
   */
  const rowState = (table: string, id: number) => {
    const row = one<{ name: string; sheet_json?: string; owed_to?: string; amount?: string; details?: string }>(
      `SELECT * FROM ${table} WHERE id = ?`,
      id
    );
    return row && digestOf(row.name, row.sheet_json ?? "", row.owed_to ?? "", row.amount ?? "", row.details ?? "");
  };

  for (const hireling of campaign.hirelings) {
    if (!groupPage?.hirelings) {
      skipped.push(`${hireling.path}: this system has no hirelings.`);
      counts.skipped += 1;
      continue;
    }
    const source = digestOf(hireling.name, JSON.stringify(hireling.sheet), hireling.portrait ?? "");
    const verdict = ledger.verdict("hirelings", hireling.path, source, (id) => rowState("group_hirelings", id));
    if (verdict.state === "unchanged" || verdict.state === "edited") {
      // Untouched needs nothing; edited belongs to whoever edited it.
      hirelingIds.set(hireling.path, verdict.rowId);
      const state = rowState("group_hirelings", verdict.rowId)!;
      ledger.record("hirelings", hireling.path, verdict.rowId, verdict.state === "unchanged" ? source : "", state);
      if (verdict.state === "unchanged") counts.unchanged += 1;
      else counts.skipped += 1;
      continue;
    }

    const id =
      verdict.state === "updatable"
        ? (db
            .prepare("UPDATE group_hirelings SET name = ?, sheet_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
            .run(hireling.name, JSON.stringify(hireling.sheet), verdict.rowId),
          verdict.rowId)
        : Number(
            db
              .prepare("INSERT INTO group_hirelings (room_id, name, sort_order, sheet_json) VALUES (?, ?, ?, ?)")
              .run(roomId, hireling.name, nextSortOrder("group_hirelings", roomId), JSON.stringify(hireling.sheet))
              .lastInsertRowid
          );
    wearing(id, "group_hirelings", hireling.path, hireling.portrait);
    hirelingIds.set(hireling.path, id);
    ledger.record("hirelings", hireling.path, id, source, rowState("group_hirelings", id)!);
    if (verdict.state === "updatable") counts.replaced += 1;
    else counts.added += 1;
  }

  const kinds = new Set(groupAssetDefinitions(groupPage).map((asset) => asset.kind));
  for (const asset of campaign.assets) {
    if (!kinds.has(asset.kind)) {
      skipped.push(`${asset.path}: this system has no shared property of the kind "${asset.kind}".`);
      counts.skipped += 1;
      continue;
    }
    const source = digestOf(asset.kind, asset.name, JSON.stringify(asset.sheet), asset.portrait ?? "");
    const verdict = ledger.verdict("assets", asset.path, source, (id) => rowState("group_assets", id));
    if (verdict.state === "unchanged" || verdict.state === "edited") {
      const state = rowState("group_assets", verdict.rowId)!;
      ledger.record("assets", asset.path, verdict.rowId, verdict.state === "unchanged" ? source : "", state);
      if (verdict.state === "unchanged") counts.unchanged += 1;
      else counts.skipped += 1;
      continue;
    }

    const id =
      verdict.state === "updatable"
        ? (db
            .prepare("UPDATE group_assets SET name = ?, sheet_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
            .run(asset.name, JSON.stringify(asset.sheet), verdict.rowId),
          verdict.rowId)
        : Number(
            db
              .prepare("INSERT INTO group_assets (room_id, kind, name, sort_order, sheet_json) VALUES (?, ?, ?, ?, ?)")
              .run(roomId, asset.kind, asset.name, nextSortOrder("group_assets", roomId), JSON.stringify(asset.sheet))
              .lastInsertRowid
          );
    wearing(id, "group_assets", asset.path, asset.portrait);
    ledger.record("assets", asset.path, id, source, rowState("group_assets", id)!);
    if (verdict.state === "updatable") counts.replaced += 1;
    else counts.added += 1;
  }

  for (const obligation of campaign.obligations) {
    const source = digestOf(obligation.name, obligation.owedTo, obligation.amount, obligation.details);
    const verdict = ledger.verdict("obligations", obligation.path, source, (id) => rowState("group_obligations", id));
    if (verdict.state === "unchanged" || verdict.state === "edited") {
      const state = rowState("group_obligations", verdict.rowId)!;
      ledger.record("obligations", obligation.path, verdict.rowId, verdict.state === "unchanged" ? source : "", state);
      if (verdict.state === "unchanged") counts.unchanged += 1;
      else counts.skipped += 1;
      continue;
    }

    const id =
      verdict.state === "updatable"
        ? (db
            .prepare(
              `UPDATE group_obligations SET name = ?, owed_to = ?, amount = ?, details = ?, updated_at = CURRENT_TIMESTAMP
               WHERE id = ?`
            )
            .run(obligation.name, obligation.owedTo, obligation.amount, obligation.details, verdict.rowId),
          verdict.rowId)
        : Number(
            db
              .prepare(
                `INSERT INTO group_obligations (room_id, name, owed_to, amount, details, sort_order)
                 VALUES (?, ?, ?, ?, ?, ?)`
              )
              .run(
                roomId,
                obligation.name,
                obligation.owedTo,
                obligation.amount,
                obligation.details,
                nextSortOrder("group_obligations", roomId)
              ).lastInsertRowid
          );
    ledger.record("obligations", obligation.path, id, source, rowState("group_obligations", id)!);
    if (verdict.state === "updatable") counts.replaced += 1;
    else counts.added += 1;
  }
}

/**
 * The fights a campaign comes with.
 *
 * The last kind, and the only one that points at three others: a map, its NPCs,
 * and the party's hirelings. Every one of those arrives as a bundle path and
 * leaves as a row id, resolved through the maps the earlier writers filled in —
 * which is why this runs after them and not beside them.
 *
 * An imported encounter is always **prepared, never running**. `active` stays 0:
 * a bundle landing mid-session must not put a fight on everybody's screen, and
 * starting one is a GM's own act.
 */
function applyEncounters(
  campaign: Campaign,
  roomId: number,
  accountId: number,
  system: string,
  mediaIds: Map<string, number>,
  npcIds: Map<string, number>,
  hirelingIds: Map<string, number>,
  counts: ApplyTally,
  skipped: string[]
) {
  if (!campaign.encounters.length) return;
  const definition = systemOrThrow(system);
  const declaredSides = new Set((definition.initiative.sides ?? []).map((side) => side.id));
  const hitPointsKey = definition.npcStatblock.hitPointsKey;
  const held = new Set(
    all<{ name: string }>("SELECT name FROM encounters WHERE room_id = ?", roomId).map((row) =>
      row.name.toLocaleLowerCase()
    )
  );

  for (const encounter of campaign.encounters) {
    if (held.has(encounter.name.toLocaleLowerCase())) {
      // Encounters are never replaced. One in progress has hit points, initiative,
      // and positions on it that a re-import has no way to know about, and losing
      // those mid-fight would be the worst thing this importer could do.
      skipped.push(`${encounter.path}: this room already has an encounter called "${encounter.name}".`);
      counts.skipped += 1;
      continue;
    }
    if (encounter.individualInitiative && !definition.initiative.allowIndividualVariant) {
      skipped.push(`${encounter.path}: this system has no individual initiative.`);
      counts.skipped += 1;
      continue;
    }

    const encounterId = Number(
      db
        .prepare(
          `INSERT INTO encounters (room_id, name, media_id, notes, individual_initiative, active, created_by)
           VALUES (?, ?, ?, ?, ?, 0, ?)`
        )
        .run(
          roomId,
          encounter.name,
          encounter.map ? (mediaIds.get(encounter.map) ?? null) : null,
          encounter.notes,
          encounter.individualInitiative ? 1 : 0,
          accountId
        ).lastInsertRowid
    );

    // Every side the system declares, so the tracker has the rows it expects,
    // with the campaign's initiative written onto the ones it named.
    const stated = new Map(encounter.sides.map((side) => [side.side, side.initiative]));
    for (const side of definition.initiative.sides ?? [])
      db.prepare("INSERT INTO encounter_sides (encounter_id, side, initiative) VALUES (?, ?, ?)").run(
        encounterId,
        side.id,
        stated.get(side.id) ?? null
      );
    for (const side of stated.keys())
      if (!declaredSides.has(side)) skipped.push(`${encounter.path}: this system has no side called "${side}".`);

    const zoneIds = new Map<string, number>();
    encounter.zones.forEach((zone, order) => {
      zoneIds.set(
        zone,
        Number(
          db
            .prepare("INSERT INTO encounter_zones (encounter_id, name, sort_order) VALUES (?, ?, ?)")
            .run(encounterId, zone, order).lastInsertRowid
        )
      );
    });

    for (const combatant of encounter.combatants) {
      const npcId = combatant.npc ? npcIds.get(combatant.npc) : undefined;
      const hirelingId = combatant.hireling ? hirelingIds.get(combatant.hireling) : undefined;
      // The reader refused a path the bundle does not hold, so this is only
      // reachable for one an earlier writer left out — a hireling this system
      // cannot have, say. Dropping the combatant is honest; a row pointing at
      // nothing is not, and the CHECK constraint would refuse it anyway.
      if (!npcId && !hirelingId) {
        skipped.push(
          `${encounter.path}: "${combatant.npc ?? combatant.hireling}" was not imported, so it is not in the fight.`
        );
        continue;
      }

      const side = combatant.side ?? (npcId ? "enemies" : "party");
      if (!declaredSides.has(side)) {
        skipped.push(`${encounter.path}: this system has no side called "${side}".`);
        continue;
      }

      const snapshot = npcId
        ? statblockOf(one<{ statblock_json: string }>("SELECT statblock_json FROM custom_npcs WHERE id = ?", npcId))
        : {};
      // From the key the system declares rather than a hardcoded "hp", so a
      // system that calls it something else still arrives with its hit points.
      const hp = typeof snapshot[hitPointsKey] === "number" ? Number(snapshot[hitPointsKey]) : null;
      const name = combatant.name ?? nameOf(npcId, hirelingId) ?? "Combatant";

      db.prepare(
        `INSERT INTO encounter_combatants
           (encounter_id, kind, npc_id, hireling_id, name, side, sort_order, hp_current, hp_max, statblock_json, zone_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        encounterId,
        npcId ? "npc" : "hireling",
        npcId ?? null,
        hirelingId ?? null,
        name,
        side,
        combatant.sortOrder,
        hp,
        hp,
        JSON.stringify(snapshot),
        combatant.zone ? (zoneIds.get(combatant.zone) ?? null) : null
      );
    }
    counts.added += 1;
  }
}

function statblockOf(row: { statblock_json: string } | undefined): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(row?.statblock_json ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function nameOf(npcId?: number, hirelingId?: number) {
  if (npcId) return one<{ name: string }>("SELECT name FROM custom_npcs WHERE id = ?", npcId)?.name;
  if (hirelingId) return one<{ name: string }>("SELECT name FROM group_hirelings WHERE id = ?", hirelingId)?.name;
  return undefined;
}

/**
 * A campaign's random tables, which are the one thing here that is not the room's.
 *
 * `table_sets` has no room: a set added by anybody is readable by every room on
 * the server, and there is no room-scoped alternative to write to. So an imported
 * set is named for the campaign it came from — "Tomb of the Serpent Kings —
 * Rumours" — and the preview says plainly where it lands, which is the honest way
 * to do a thing that reaches past the room a GM was configuring.
 *
 * Tags are validated against this instance's own vocabulary, which is what
 * `parseCustomSet` does and what the editor's own routes do. An unknown slug is
 * refused rather than dropped, per the standing rule — but the refusal costs that
 * set rather than the whole campaign, because a tag this server has not heard of
 * says nothing about the forty maps in the same bundle.
 */
function applyTables(
  campaign: Campaign,
  accountId: number,
  policy: ConflictPolicy,
  counts: ApplyTally,
  skipped: string[]
) {
  if (!campaign.tables.length) return;
  const vocabulary = tagVocabulary();
  const held = new Map(
    all<{ id: number; name: string }>("SELECT id, name FROM table_sets").map((row) => [
      row.name.toLocaleLowerCase(),
      row.id
    ])
  );

  for (const set of campaign.tables) {
    const name = `${campaign.manifest.name} — ${set.name}`;
    const match = held.get(name.toLocaleLowerCase());
    if (match && policy === "skip") {
      counts.skipped += 1;
      continue;
    }

    let markdown: string;
    let tags: string[];
    try {
      const document = parseCustomSet(set.json, name, vocabulary);
      markdown = bundleSetMarkdown({ name, markdown: "", document, tags: [] });
      tags = knownTags(set.tags, vocabulary);
    } catch (cause) {
      skipped.push(`${set.path}: ${cause instanceof Error ? cause.message : "the table set could not be read."}`);
      counts.skipped += 1;
      continue;
    }

    if (match && policy === "replace") {
      db.prepare("UPDATE table_sets SET markdown = ?, tags_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(
        markdown,
        JSON.stringify(tags),
        match
      );
      counts.replaced += 1;
      continue;
    }
    db.prepare("INSERT INTO table_sets (name, markdown, tags_json, created_by) VALUES (?, ?, ?, ?)").run(
      name,
      markdown,
      JSON.stringify(tags),
      accountId
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
