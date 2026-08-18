import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { unzipSync, zipSync } from "fflate";
import { applyCampaign } from "./campaign-apply.js";
import { exportRoomCampaign } from "./campaign-export.js";
import { stageCampaignArchive } from "./campaign-staging.js";
import { config } from "./config.js";
import { all, db, one } from "./db.js";
import { installToybox } from "./test-fixture.js";

const toybox = installToybox();
const hpKey = toybox.npcStatblock.hitPointsKey;
const listKey = toybox.characterSheet.lists[0].key;
const enemySide = (toybox.initiative.sides ?? [])[0]?.id ?? "enemies";

const ACCOUNT = 1;

beforeEach(() => {
  db.exec(
    `DELETE FROM room_import_entries; DELETE FROM room_imports; DELETE FROM encounter_combatants;
     DELETE FROM encounter_zones; DELETE FROM encounter_sides; DELETE FROM encounters;
     DELETE FROM room_playlist_tracks; DELETE FROM room_playlists; DELETE FROM group_obligations;
     DELETE FROM group_assets; DELETE FROM group_hirelings; DELETE FROM room_retired_items;
     DELETE FROM room_items; DELETE FROM custom_npcs; DELETE FROM media; DELETE FROM table_sets;
     DELETE FROM memberships; DELETE FROM rooms; DELETE FROM accounts;`
  );
  db.prepare(
    "INSERT INTO accounts (id, username, password_hash, is_admin, account_role) VALUES (?, ?, '', 1, 'admin')"
  ).run(ACCOUNT, "Admin");
});

const makeRoom = (name: string) =>
  Number(
    db.prepare("INSERT INTO rooms (name, system, theme, created_by) VALUES (?, 'toybox', 'grim', ?)").run(name, ACCOUNT)
      .lastInsertRowid
  );

const png = (fill: number) => {
  const body = Buffer.alloc(96, fill);
  Buffer.from("89504e470d0a1a0a", "hex").copy(body);
  return new Uint8Array(body);
};
const mp3 = () => {
  const body = Buffer.alloc(96, 8);
  body.write("ID3");
  return new Uint8Array(body);
};
const bytes = (value: unknown) =>
  value instanceof Uint8Array ? value : new Uint8Array(Buffer.from(JSON.stringify(value)));

/** A campaign with one of everything the format carries. */
const source = () => ({
  "manifest.json": {
    app: "devils-toys-campaign",
    bundleVersion: 1,
    campaignId: "tomb",
    name: "Tomb of the Serpent Kings",
    version: "1.2",
    system: "toybox"
  },
  "room.json": { name: "The Tomb", theme: "grim", musicEnabled: true },
  "calendar.json": {
    year: 812,
    month: 1,
    day: 14,
    daysPerWeek: 7,
    daysPerMonth: 30,
    dayNames: ["Moonday", "Toilday"],
    monthNames: ["Frost", "Thaw", "Green"],
    segmentsPerDay: 2,
    segment: 0,
    segmentNames: ["Day", "Night"],
    events: [{ id: "fair", name: "The Serpent Fair", cadence: "holiday", day: 3, month: 1 }]
  },
  "maps/index.json": { files: [{ file: "the-keep.png", name: "The Keep" }] },
  "maps/the-keep.png": png(1),
  "maps/under-halls.png": png(2),
  "scenes/black-gate.png": png(3),
  "references/letter.md": "# A letter\n\nCome at once.\n",
  "audio/index.json": { files: [{ file: "dirge.mp3", name: "Dirge", artist: "Nobody", album: "Tomb" }] },
  "audio/dirge.mp3": mp3(),
  "playlists/combat.json": { name: "Combat", sortOrder: 0, tracks: ["audio/dirge.mp3"] },
  "npcs/lady-vane.json": { name: "Lady Vane", notes: "Not to be trusted.", statblock: { [hpKey]: 8 } },
  "npcs/serpent-priest.json": { name: "Serpent Priest", notes: "", statblock: { [hpKey]: 5 } },
  "hirelings/brann.json": {
    name: "Brann",
    sortOrder: 0,
    sheet: { trade: "Torchbearer" },
    portrait: "hirelings/brann.png"
  },
  "hirelings/brann.png": png(4),
  "assets/kestrel.json": { kind: "starship", name: "The Kestrel", sortOrder: 0, sheet: { size: "Barge" } },
  "obligations/loan.json": {
    name: "The Baron's loan",
    owedTo: "The Baron",
    amount: "500gp",
    details: "",
    sortOrder: 0
  },
  "items/index.json": {
    added: [{ listKey, name: "Serpent Blade", spec: "d8", detail: "", cost: "20gp", category: "" }]
  },
  "encounters/the-gate.json": {
    name: "The Gate",
    notes: "They are expected.",
    individualInitiative: false,
    map: "maps/the-keep.png",
    zones: ["Gatehouse", "Courtyard"],
    sides: [{ side: enemySide, initiative: 12 }],
    combatants: [
      { npc: "npcs/lady-vane.json", name: "Lady Vane", side: enemySide, zone: "Gatehouse", sortOrder: 0 },
      { npc: "npcs/serpent-priest.json", name: "Serpent Priest", side: enemySide, zone: "Courtyard", sortOrder: 1 }
    ]
  }
});

function importInto(roomId: number, files: Record<string, unknown>) {
  const archive = path.join(config.dataDir, `${Math.random().toString(36).slice(2)}.zip`);
  fs.writeFileSync(
    archive,
    zipSync(Object.fromEntries(Object.entries(files).map(([name, body]) => [name, bytes(body)])), { level: 6 })
  );
  const staged = stageCampaignArchive(archive, { roomId, accountId: ACCOUNT, archiveName: "tomb.devilcampaign.zip" });
  return applyCampaign(staged.directory, staged.campaign, roomId, ACCOUNT, {
    policy: "skip",
    takeRoomSettings: true
  });
}

/** Everything about a room a campaign is supposed to carry, in a comparable shape. */
function projection(roomId: number) {
  const media = all<{ id: number; kind: string; display_name: string; stored_name: string; size: number }>(
    `SELECT id, COALESCE(category, kind) AS kind, display_name, stored_name, size FROM media
     WHERE room_id = ? ORDER BY COALESCE(category, kind), display_name`,
    roomId
  );
  const digestOfStored = (stored: string) =>
    fs.readFileSync(path.join(config.dataDir, "uploads", stored)).toString("base64");

  return {
    room: one(
      "SELECT name, theme, calendar_enabled, calendar_json, music_enabled, map_notation_enabled FROM rooms WHERE id = ?",
      roomId
    ),
    // Compared by contents, not by stored name: the importer mints a new UUID
    // every time, and it must — two rooms sharing a file would share a delete.
    media: media.map((row) => [row.kind, row.display_name, row.size, digestOfStored(row.stored_name)]),
    playlists: all(
      `SELECT p.name, p.sort_order, m.display_name AS track FROM room_playlists p
         LEFT JOIN room_playlist_tracks t ON t.playlist_id = p.id
         LEFT JOIN media m ON m.id = t.media_id
       WHERE p.room_id = ? ORDER BY p.sort_order, p.name, t.sort_order`,
      roomId
    ),
    npcs: all("SELECT name, notes, statblock_json FROM custom_npcs WHERE room_id = ? ORDER BY name", roomId),
    hirelings: all(
      "SELECT name, sort_order, sheet_json, portrait_filename, portrait_size FROM group_hirelings WHERE room_id = ? ORDER BY sort_order, name",
      roomId
    ),
    assets: all(
      "SELECT kind, name, sort_order, sheet_json FROM group_assets WHERE room_id = ? ORDER BY sort_order, name",
      roomId
    ),
    obligations: all(
      "SELECT name, owed_to, amount, details FROM group_obligations WHERE room_id = ? ORDER BY sort_order, name",
      roomId
    ),
    // The room id is minted into every room item id, and must be: it names the
    // room that holds it. Comparing the raw JSON would be comparing the room
    // numbers rather than the gear.
    items: all<{ list_key: string; item_json: string }>(
      "SELECT list_key, item_json FROM room_items WHERE room_id = ? ORDER BY item_id",
      roomId
    ).map((row) => ({ list_key: row.list_key, item: row.item_json.replace(/room:[0-9]+:/g, "room:*:") })),
    retired: all("SELECT item_id FROM room_retired_items WHERE room_id = ? ORDER BY item_id", roomId),
    encounters: all(
      "SELECT name, notes, active, individual_initiative FROM encounters WHERE room_id = ? ORDER BY name",
      roomId
    ),
    zones: all(
      `SELECT z.name, z.sort_order FROM encounter_zones z JOIN encounters e ON e.id = z.encounter_id
       WHERE e.room_id = ? ORDER BY e.name, z.sort_order`,
      roomId
    ),
    sides: all(
      `SELECT s.side, s.initiative FROM encounter_sides s JOIN encounters e ON e.id = s.encounter_id
       WHERE e.room_id = ? ORDER BY e.name, s.side`,
      roomId
    ),
    combatants: all(
      `SELECT c.kind, c.name, c.side, c.sort_order, c.hp_current, c.hp_max, c.statblock_json, z.name AS zone
       FROM encounter_combatants c
         JOIN encounters e ON e.id = c.encounter_id
         LEFT JOIN encounter_zones z ON z.id = c.zone_id
       WHERE e.room_id = ? ORDER BY e.name, c.sort_order`,
      roomId
    ),
    /** The map an encounter points at, by what it is called rather than by its id. */
    encounterMaps: all(
      `SELECT e.name, m.display_name AS map FROM encounters e LEFT JOIN media m ON m.id = e.media_id
       WHERE e.room_id = ? ORDER BY e.name`,
      roomId
    )
  };
}

describe("a room exported and imported again", () => {
  it("produces the same room", () => {
    const first = makeRoom("Source");
    importInto(first, source());
    const before = projection(first);

    const exported = exportRoomCampaign(first);
    const second = makeRoom("Empty");
    const archive = path.join(config.dataDir, "exported.zip");
    fs.writeFileSync(archive, Buffer.from(exported.archive));
    const staged = stageCampaignArchive(archive, {
      roomId: second,
      accountId: ACCOUNT,
      archiveName: exported.filename
    });
    applyCampaign(staged.directory, staged.campaign, second, ACCOUNT, { policy: "skip", takeRoomSettings: true });

    expect(projection(second)).toEqual(before);
  });

  it("names the archive after the room, and lays it out where the format says", () => {
    const roomId = makeRoom("Tomb of the Serpent Kings");
    // room.json renames it on the way in, so the export is named for what the
    // room is called now rather than what it was called when it was made.
    importInto(roomId, source());
    const exported = exportRoomCampaign(roomId);

    expect(exported.filename).toBe("the-tomb.devilcampaign.zip");
    const names = Object.keys(unzipSync(exported.archive)).sort();
    expect(names).toEqual([
      "assets/the-kestrel.json",
      "audio/dirge.mp3",
      "audio/index.json",
      "calendar.json",
      "encounters/the-gate.json",
      "hirelings/brann.json",
      "hirelings/brann.png",
      "items/index.json",
      "manifest.json",
      "maps/index.json",
      "maps/the-keep.png",
      "maps/under-halls.png",
      "npcs/lady-vane.json",
      "npcs/serpent-priest.json",
      "obligations/the-baron-s-loan.json",
      "playlists/combat.json",
      "references/index.json",
      "references/letter.md",
      "room.json",
      "scenes/black-gate.png",
      "scenes/index.json"
    ]);
  });

  /**
   * Two things with one name must not become one thing. `slugFor` is what keeps
   * the second from overwriting the first, and this is the case that proves it.
   */
  it("gives two things of the same name two filenames", () => {
    const roomId = makeRoom("Source");
    importInto(roomId, {
      "maps/index.json": {
        files: [
          { file: "a.png", name: "The Keep" },
          { file: "b.png", name: "The Keep" }
        ]
      },
      "maps/a.png": png(1),
      "maps/b.png": png(2)
    });

    const names = Object.keys(unzipSync(exportRoomCampaign(roomId).archive)).sort();
    expect(names).toContain("maps/the-keep.png");
    expect(names).toContain("maps/the-keep-2.png");
  });

  /**
   * Already-compressed bytes go in stored. Deflating a PNG spends the CPU of the
   * whole export to save nothing, which is the trade the plan argues against.
   */
  it("stores images and music rather than deflating them", () => {
    const roomId = makeRoom("Source");
    importInto(roomId, { "maps/keep.png": png(1), "audio/dirge.mp3": mp3(), "references/letter.md": "# A letter" });
    const archive = Buffer.from(exportRoomCampaign(roomId).archive);

    // The compression method sits at offset 8 of each local file header: 0 is
    // stored, 8 is deflate.
    const methods = new Map<string, number>();
    for (let at = 0; at + 30 <= archive.length; at += 1) {
      if (archive.readUInt32LE(at) !== 0x04034b50) continue;
      const nameLength = archive.readUInt16LE(at + 26);
      methods.set(archive.subarray(at + 30, at + 30 + nameLength).toString("utf8"), archive.readUInt16LE(at + 8));
    }

    expect(methods.get("maps/keep.png")).toBe(0);
    expect(methods.get("audio/dirge.mp3")).toBe(0);
    expect(methods.get("references/letter.md")).toBe(8);
    expect(methods.get("manifest.json")).toBe(8);
  });

  it("leaves out what a campaign does not carry", () => {
    const roomId = makeRoom("Source");
    importInto(roomId, source());
    // A character in the room's own encounter, and an active fight.
    db.exec("UPDATE encounters SET active = 1");

    const files = unzipSync(exportRoomCampaign(roomId).archive);
    const encounter = JSON.parse(Buffer.from(files["encounters/the-gate.json"]).toString("utf8"));
    expect(encounter).not.toHaveProperty("active");
    expect(Object.keys(files).some((name) => /characters|messages|rolls/.test(name))).toBe(false);
  });
});

describe("a room made out of a campaign", () => {
  /**
   * The create-from-bundle path has no room to preview against — everything in a
   * room made this second is new — so it is one act: read the bundle, make the
   * room it describes, import into it. These exercise the writer half through
   * `applyCampaign` with `takeRoomSettings` on, which is what that route does.
   */
  it("takes its name, theme, and switches from the bundle without being asked", () => {
    const roomId = makeRoom("Untitled");
    importInto(roomId, source());

    expect(
      one<{ name: string; theme: string; music_enabled: number; calendar_enabled: number }>(
        "SELECT name, theme, music_enabled, calendar_enabled FROM rooms WHERE id = ?",
        roomId
      )
    ).toMatchObject({ name: "The Tomb", theme: "grim", music_enabled: 1, calendar_enabled: 1 });
  });

  it("lands everything the bundle carries in one go", () => {
    const roomId = makeRoom("Untitled");
    const result = importInto(roomId, source());

    // Five media rows: two maps, a scene, a handout, a track. The hireling's
    // portrait is a column on their row rather than a sixth entry in the library.
    expect(result.media.added).toBe(5);
    expect(result.npcs.added).toBe(2);
    expect(result.encounters.added).toBe(1);
    expect(result.group.added).toBe(3);
    expect(result.items.added).toBe(1);
    expect(result.skipped).toEqual([]);
  });
});
