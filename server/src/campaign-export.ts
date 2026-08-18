import fs from "node:fs";
import path from "node:path";
import { zipSync, strToU8, type Zippable } from "fflate";
import { config } from "./config.js";
import { all, one } from "./db.js";
import { CAMPAIGN_BUNDLE_APP, CAMPAIGN_BUNDLE_VERSION, type MediaFolder } from "./campaign-bundles.js";
import { isRoomItemId, roomItemRows, retiredIds } from "./room-items.js";
import { parseRollTables } from "@devils-toys/shared";

/**
 * A room, written back out as a campaign.
 *
 * This is the format's documentation and its acceptance test at once: a room
 * exported and imported into an empty one produces the same room, which is the
 * only check that keeps the reader and the writer describing the same thing. An
 * author opens an export to learn the layout, the way a system's author opens
 * `npm run systems:export`.
 *
 * What leaves is what a campaign is — prepared material. Characters, chat, the
 * active encounter, and what is on screen stay behind, per the exclusion the
 * whole design rests on.
 */

const uploadsDir = () => path.join(config.dataDir, "uploads");

/** Already-compressed bytes go in stored; text is worth deflating. */
const STORE = { level: 0 } as const;
const DEFLATE = { level: 6 } as const;

/**
 * A filename from a display name, deduplicated.
 *
 * Two maps called "The Keep" export as `the-keep.png` and `the-keep-2.png`
 * rather than one overwriting the other — the same arrangement `table-bundles.ts`
 * uses, for the same reason.
 */
function slugger() {
  const taken = new Set<string>();
  return (name: string, extension = "") => {
    const base =
      name
        .toLocaleLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "untitled";
    let slug = base;
    for (let suffix = 2; taken.has(slug + extension); suffix += 1) slug = `${base}-${suffix}`;
    taken.add(slug + extension);
    return slug + extension;
  };
}

const json = (value: unknown): [Uint8Array, typeof DEFLATE] => [
  strToU8(`${JSON.stringify(value, null, 2)}\n`),
  DEFLATE
];

function parseJson(value: string | null | undefined): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

interface MediaRow {
  id: number;
  kind: string;
  filename: string;
  display_name: string | null;
  stored_name: string;
  mime_type: string;
  artist: string | null;
  title: string | null;
  album: string | null;
}

const FOLDER: Record<string, MediaFolder> = {
  map: "maps",
  scene: "scenes",
  reference: "references",
  audio: "audio"
};

/** A room's own portrait columns, in the shape both group tables carry them. */
interface PortraitColumns {
  portrait_filename: string | null;
  portrait_stored_name: string | null;
  portrait_mime_type: string | null;
}

export interface ExportedCampaign {
  archive: Uint8Array;
  /** What the file should be called, from the room's name. */
  filename: string;
}

export function exportRoomCampaign(roomId: number): ExportedCampaign {
  const room = one<{
    name: string;
    system: string;
    theme: string;
    calendar_enabled: number;
    calendar_json: string | null;
    music_enabled: number;
    map_notation_enabled: number;
  }>(
    `SELECT name, system, theme, calendar_enabled, calendar_json, music_enabled, map_notation_enabled
     FROM rooms WHERE id = ?`,
    roomId
  );
  if (!room) throw new Error("Room not found.");

  const files: Zippable = {};
  const campaignId =
    room.name
      .toLocaleLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "campaign";

  files["manifest.json"] = json({
    app: CAMPAIGN_BUNDLE_APP,
    bundleVersion: CAMPAIGN_BUNDLE_VERSION,
    campaignId,
    name: room.name,
    version: "",
    system: room.system,
    exportedAt: new Date().toISOString(),
    licenses: []
  });

  files["room.json"] = json({
    name: room.name,
    theme: room.theme,
    calendarEnabled: Boolean(room.calendar_enabled),
    musicEnabled: Boolean(room.music_enabled),
    mapNotationEnabled: Boolean(room.map_notation_enabled)
  });

  if (room.calendar_json) files["calendar.json"] = json(JSON.parse(room.calendar_json));

  /* ---- the library ------------------------------------------------------- */

  const mediaPaths = new Map<number, string>();
  const indexes: Record<string, { file: string; name?: string; artist?: string; title?: string; album?: string }[]> =
    {};
  const slugFor = slugger();

  for (const row of all<MediaRow>(
    `SELECT id, COALESCE(category, kind) AS kind, filename, display_name, stored_name, mime_type, artist, title, album
     FROM media WHERE room_id = ? ORDER BY id`,
    roomId
  )) {
    const folder = FOLDER[row.kind];
    const stored = path.join(uploadsDir(), row.stored_name);
    // A row whose file has gone is left out rather than exported as a name with
    // nothing behind it, which the reader would refuse on the way back in.
    if (!folder || path.basename(row.stored_name) !== row.stored_name || !fs.existsSync(stored)) continue;

    const name = (row.display_name ?? "").trim() || row.filename.replace(/\.[^.]+$/, "");
    const file = slugFor(name, path.extname(row.filename).toLowerCase() || path.extname(row.stored_name));
    const relative = `${folder}/${file}`;
    // Stored rather than deflated: a PNG or an MP3 is already compressed, and
    // spending the whole export's CPU to save nothing is the wrong trade.
    files[relative] = [new Uint8Array(fs.readFileSync(stored)), row.mime_type === "text/markdown" ? DEFLATE : STORE];
    mediaPaths.set(row.id, relative);

    (indexes[folder] ??= []).push({
      file,
      name,
      ...(row.artist ? { artist: row.artist } : {}),
      ...(row.title ? { title: row.title } : {}),
      ...(row.album ? { album: row.album } : {})
    });
  }
  for (const [folder, entries] of Object.entries(indexes)) files[`${folder}/index.json`] = json({ files: entries });

  /* ---- playlists --------------------------------------------------------- */

  const playlistSlug = slugger();
  for (const playlist of all<{ id: number; name: string; sort_order: number }>(
    "SELECT id, name, sort_order FROM room_playlists WHERE room_id = ? ORDER BY sort_order, id",
    roomId
  )) {
    const tracks = all<{ media_id: number }>(
      "SELECT media_id FROM room_playlist_tracks WHERE playlist_id = ? ORDER BY sort_order",
      playlist.id
    )
      .map((track) => mediaPaths.get(track.media_id))
      .filter((track): track is string => Boolean(track));
    files[`playlists/${playlistSlug(playlist.name, ".json")}`] = json({
      name: playlist.name,
      sortOrder: playlist.sort_order,
      tracks
    });
  }

  /* ---- the cast ---------------------------------------------------------- */

  const npcPaths = new Map<number, string>();
  const npcSlug = slugger();
  for (const npc of all<{ id: number; name: string; notes: string; statblock_json: string }>(
    "SELECT id, name, notes, statblock_json FROM custom_npcs WHERE room_id = ? ORDER BY id",
    roomId
  )) {
    const relative = `npcs/${npcSlug(npc.name, ".json")}`;
    files[relative] = json({ name: npc.name, notes: npc.notes, statblock: parseJson(npc.statblock_json) });
    npcPaths.set(npc.id, relative);
  }

  /* ---- the party --------------------------------------------------------- */

  const hirelingPaths = new Map<number, string>();
  const portrait = (folder: string, row: PortraitColumns, base: string) => {
    if (!row.portrait_stored_name || path.basename(row.portrait_stored_name) !== row.portrait_stored_name) return;
    const stored = path.join(uploadsDir(), row.portrait_stored_name);
    if (!fs.existsSync(stored)) return;
    const relative = `${folder}/${base}${path.extname(row.portrait_filename ?? row.portrait_stored_name) || ".png"}`;
    files[relative] = [new Uint8Array(fs.readFileSync(stored)), STORE];
    return relative;
  };

  const hirelingSlug = slugger();
  for (const row of all<{ id: number; name: string; sort_order: number; sheet_json: string } & PortraitColumns>(
    `SELECT id, name, sort_order, sheet_json, portrait_filename, portrait_stored_name, portrait_mime_type
     FROM group_hirelings WHERE room_id = ? ORDER BY sort_order, id`,
    roomId
  )) {
    const base = hirelingSlug(row.name || "hireling");
    const relative = `hirelings/${base}.json`;
    const picture = portrait("hirelings", row, base);
    files[relative] = json({
      name: row.name,
      sortOrder: row.sort_order,
      sheet: parseJson(row.sheet_json),
      ...(picture ? { portrait: picture } : {})
    });
    hirelingPaths.set(row.id, relative);
  }

  const assetSlug = slugger();
  for (const row of all<
    { id: number; kind: string; name: string; sort_order: number; sheet_json: string } & PortraitColumns
  >(
    `SELECT id, kind, name, sort_order, sheet_json, portrait_filename, portrait_stored_name, portrait_mime_type
     FROM group_assets WHERE room_id = ? ORDER BY sort_order, id`,
    roomId
  )) {
    const base = assetSlug(row.name || row.kind);
    const picture = portrait("assets", row, base);
    files[`assets/${base}.json`] = json({
      kind: row.kind,
      name: row.name,
      sortOrder: row.sort_order,
      sheet: parseJson(row.sheet_json),
      ...(picture ? { portrait: picture } : {})
    });
  }

  const obligationSlug = slugger();
  for (const row of all<{
    name: string;
    owed_to: string;
    amount: string;
    details: string;
    sort_order: number;
  }>(
    "SELECT name, owed_to, amount, details, sort_order FROM group_obligations WHERE room_id = ? ORDER BY sort_order, id",
    roomId
  ))
    files[`obligations/${obligationSlug(row.name || "obligation", ".json")}`] = json({
      name: row.name,
      owedTo: row.owed_to,
      amount: row.amount,
      details: row.details,
      sortOrder: row.sort_order
    });

  /* ---- encounters -------------------------------------------------------- */

  const encounterSlug = slugger();
  for (const encounter of all<{
    id: number;
    name: string;
    notes: string;
    media_id: number | null;
    individual_initiative: number;
  }>("SELECT id, name, notes, media_id, individual_initiative FROM encounters WHERE room_id = ? ORDER BY id", roomId)) {
    const zones = all<{ id: number; name: string }>(
      "SELECT id, name FROM encounter_zones WHERE encounter_id = ? ORDER BY sort_order, id",
      encounter.id
    );
    const zoneNames = new Map(zones.map((zone) => [zone.id, zone.name]));

    const combatants = all<{
      kind: string;
      npc_id: number | null;
      hireling_id: number | null;
      name: string;
      side: string;
      sort_order: number;
      zone_id: number | null;
    }>(
      `SELECT kind, npc_id, hireling_id, name, side, sort_order, zone_id
       FROM encounter_combatants WHERE encounter_id = ? ORDER BY sort_order, id`,
      encounter.id
    )
      // A character is a person, and people do not travel. The rest of the fight
      // exports intact rather than the encounter being dropped over one of them.
      .filter((combatant) => combatant.kind !== "character")
      .map((combatant) => {
        const source = combatant.npc_id ? npcPaths.get(combatant.npc_id) : hirelingPaths.get(combatant.hireling_id!);
        if (!source) return undefined;
        return {
          ...(combatant.npc_id ? { npc: source } : { hireling: source }),
          name: combatant.name,
          side: combatant.side,
          ...(combatant.zone_id && zoneNames.has(combatant.zone_id) ? { zone: zoneNames.get(combatant.zone_id) } : {}),
          sortOrder: combatant.sort_order
        };
      })
      .filter((combatant): combatant is NonNullable<typeof combatant> => Boolean(combatant));

    files[`encounters/${encounterSlug(encounter.name, ".json")}`] = json({
      name: encounter.name,
      notes: encounter.notes,
      individualInitiative: Boolean(encounter.individual_initiative),
      ...(encounter.media_id && mediaPaths.has(encounter.media_id) ? { map: mediaPaths.get(encounter.media_id) } : {}),
      zones: zones.map((zone) => zone.name),
      sides: all<{ side: string; initiative: number | null }>(
        "SELECT side, initiative FROM encounter_sides WHERE encounter_id = ? ORDER BY rowid",
        encounter.id
      ).map((side) => ({ side: side.side, initiative: side.initiative })),
      combatants
    });
  }

  /* ---- gear -------------------------------------------------------------- */

  const added = roomItemRows(roomId)
    .map((row) => ({ listKey: row.list_key, item: parseJson(row.item_json) as Record<string, string> }))
    .filter((entry) => typeof entry.item.name === "string")
    .map(({ listKey, item }) => ({
      listKey,
      name: item.name,
      spec: item.spec ?? "",
      detail: item.detail ?? "",
      cost: item.cost ?? "",
      category: item.category ?? ""
    }));
  // Only the system's own ids: a room item id names this room, and retiring one
  // elsewhere would be meaningless.
  const retired = retiredIds(roomId).filter((id) => !isRoomItemId(id));
  if (added.length || retired.length) files["items/index.json"] = json({ added, retired });

  /* ---- tables ------------------------------------------------------------ */

  /**
   * Only the sets this room imported, which the ledger is the record of.
   * `table_sets` is server-wide, and exporting a server's whole catalogue because
   * one room was exported would be a surprise nobody asked for.
   */
  const setIds = all<{ row_id: number }>(
    `SELECT e.row_id FROM room_import_entries e
       JOIN room_imports i ON i.id = e.import_id
     WHERE i.room_id = ? AND e.kind = 'tables'`,
    roomId
  ).map((row) => row.row_id);
  if (setIds.length) {
    const tableSlug = slugger();
    for (const id of setIds) {
      const set = one<{ name: string; markdown: string; tags_json: string }>(
        "SELECT name, markdown, tags_json FROM table_sets WHERE id = ?",
        id
      );
      if (!set) continue;
      const tables = parseRollTables(set.markdown).map((table) => ({
        id: table.id,
        name: table.name,
        section: table.section,
        category: table.category,
        dice: table.dice,
        columns: [...table.columns],
        tags: [...table.tags],
        rows: table.rows.map((row) => ({
          label: row.label,
          min: row.min,
          max: row.max,
          cells: [...row.cells],
          ...(row.nextTableId ? { nextTableId: row.nextTableId } : {})
        }))
      }));
      // A set whose Markdown holds no rollable table would be refused on the way
      // back in, so it is left out rather than exported as something unreadable.
      if (!tables.length) continue;
      files[`tables/${tableSlug(set.name, ".json")}`] = json({
        formatVersion: 1,
        setName: set.name,
        tags: JSON.parse(set.tags_json || "[]"),
        tables
      });
    }
  }

  return {
    archive: zipSync(files),
    filename: `${campaignId}.devilcampaign.zip`
  };
}
