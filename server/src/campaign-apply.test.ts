import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { zipSync } from "fflate";
import { applyCampaign, type ApplyOptions } from "./campaign-apply.js";
import { stageCampaignArchive, type StagedCampaign } from "./campaign-staging.js";
import { config } from "./config.js";
import { all, db, one } from "./db.js";
import { installToybox } from "./test-fixture.js";

installToybox();

let roomId = 0;
const ACCOUNT = 1;
const uploads = () => path.join(config.dataDir, "uploads");

beforeEach(() => {
  db.exec(
    "DELETE FROM room_playlist_tracks; DELETE FROM room_playlists; DELETE FROM media; DELETE FROM memberships; DELETE FROM rooms; DELETE FROM accounts;"
  );
  db.prepare(
    "INSERT INTO accounts (id, username, password_hash, is_admin, account_role) VALUES (?, ?, '', 1, 'admin')"
  ).run(ACCOUNT, "Admin");
  roomId = Number(
    db
      .prepare("INSERT INTO rooms (name, system, theme, created_by) VALUES ('The Tomb', 'toybox', 'grim', ?)")
      .run(ACCOUNT).lastInsertRowid
  );
});

/** A real PNG header, since the importer checks what a file actually is. */
const png = (fill = 1) => {
  const body = Buffer.alloc(64, fill);
  Buffer.from("89504e470d0a1a0a", "hex").copy(body);
  return new Uint8Array(body);
};
const mp3 = () => {
  const body = Buffer.alloc(64, 2);
  body.write("ID3");
  return new Uint8Array(body);
};
const text = (value: string) => new Uint8Array(Buffer.from(value, "utf8"));

function stage(files: Record<string, Uint8Array>): StagedCampaign {
  const archive = path.join(config.dataDir, `${Math.random().toString(36).slice(2)}.zip`);
  fs.writeFileSync(archive, zipSync(files, { level: 6 }));
  return stageCampaignArchive(archive, { roomId, accountId: ACCOUNT, archiveName: "tomb.devilcampaign.zip" });
}

const apply = (staged: StagedCampaign, options: Partial<ApplyOptions> = {}) =>
  applyCampaign(staged.directory, staged.campaign, roomId, ACCOUNT, {
    policy: "skip",
    takeRoomSettings: false,
    ...options
  });

const mediaRows = () =>
  all<{ id: number; kind: string; category: string; filename: string; display_name: string; stored_name: string }>(
    "SELECT id, kind, category, filename, display_name, stored_name FROM media WHERE room_id = ? ORDER BY id",
    roomId
  );

describe("landing a campaign's library in a room", () => {
  it("writes each file where the room's own uploads live, and a row that points at it", () => {
    const staged = stage({
      "maps/index.json": text(JSON.stringify({ files: [{ file: "the-keep.png", name: "The Keep" }] })),
      "maps/the-keep.png": png(),
      "references/letter.md": text("# A letter"),
      "audio/dirge.mp3": mp3()
    });
    const result = apply(staged);

    expect(result.media).toEqual({ added: 3, replaced: 0, skipped: 0 });
    const rows = mediaRows();
    expect(rows.map((row) => [row.category, row.filename, row.display_name])).toEqual([
      ["map", "the-keep.png", "The Keep"],
      ["reference", "letter.md", "letter"],
      ["audio", "dirge.mp3", "dirge"]
    ]);
    for (const row of rows) expect(fs.existsSync(path.join(uploads(), row.stored_name))).toBe(true);
  });

  /**
   * `kind` predates `category` and a map is stored as a scene under it. An
   * importer that wrote `kind = 'map'` would produce rows the CHECK constraint
   * refuses and the library's own queries cannot see.
   */
  it("stores a map the way the media routes store one", () => {
    apply(stage({ "maps/keep.png": png() }));
    expect(mediaRows()[0]).toMatchObject({ kind: "scene", category: "map" });
  });

  it("empties the stage of what it took", () => {
    const staged = stage({ "maps/keep.png": png() });
    apply(staged);
    expect(fs.existsSync(path.join(staged.directory, "maps", "keep.png"))).toBe(false);
  });

  it("builds the playlists over the tracks it just wrote", () => {
    const staged = stage({
      "audio/dirge.mp3": mp3(),
      "audio/march.mp3": mp3(),
      "playlists/combat.json": text(JSON.stringify({ name: "Combat", tracks: ["audio/march.mp3", "audio/dirge.mp3"] }))
    });
    apply(staged);

    const playlist = one<{ id: number; name: string }>(
      "SELECT id, name FROM room_playlists WHERE room_id = ?",
      roomId
    )!;
    expect(playlist.name).toBe("Combat");
    const tracks = all<{ filename: string }>(
      `SELECT m.filename FROM room_playlist_tracks t JOIN media m ON m.id = t.media_id
       WHERE t.playlist_id = ? ORDER BY t.sort_order`,
      playlist.id
    );
    expect(tracks.map((track) => track.filename)).toEqual(["march.mp3", "dirge.mp3"]);
  });

  it("takes the room's settings only when asked", () => {
    const room = text(JSON.stringify({ name: "The Tomb Below", musicEnabled: true }));
    apply(stage({ "room.json": room, "maps/keep.png": png() }));
    expect(one<{ name: string }>("SELECT name FROM rooms WHERE id = ?", roomId)!.name).toBe("The Tomb");

    const result = apply(stage({ "room.json": room, "maps/other.png": png() }), { takeRoomSettings: true });
    expect(
      one<{ name: string; music_enabled: number }>("SELECT name, music_enabled FROM rooms WHERE id = ?", roomId)
    ).toMatchObject({ name: "The Tomb Below", music_enabled: 1 });
    expect(result.room).toEqual(['renamed to "The Tomb Below"', "music on"]);
  });
});

describe("what happens to something the room already holds", () => {
  const held = () => {
    apply(stage({ "maps/keep.png": png(1) }));
    return mediaRows()[0];
  };

  it("skips it, and leaves the file that was there alone", () => {
    const before = held();
    const result = apply(stage({ "maps/keep.png": png(2) }));

    expect(result.media).toEqual({ added: 0, replaced: 0, skipped: 1 });
    expect(mediaRows()).toHaveLength(1);
    expect(mediaRows()[0].stored_name).toBe(before.stored_name);
  });

  it("replaces it in place, keeping the row and removing the file it orphaned", () => {
    const before = held();
    const result = apply(stage({ "maps/keep.png": png(2) }), { policy: "replace" });

    expect(result.media).toEqual({ added: 0, replaced: 1, skipped: 0 });
    const after = mediaRows();
    expect(after).toHaveLength(1);
    // The same row — so a playlist or an encounter pointing at it still does.
    expect(after[0].id).toBe(before.id);
    expect(after[0].stored_name).not.toBe(before.stored_name);
    expect(fs.existsSync(path.join(uploads(), before.stored_name))).toBe(false);
    expect(fs.existsSync(path.join(uploads(), after[0].stored_name))).toBe(true);
  });

  it("adds it alongside when that is what was asked for", () => {
    held();
    const result = apply(stage({ "maps/keep.png": png(2) }), { policy: "add" });

    expect(result.media).toEqual({ added: 1, replaced: 0, skipped: 0 });
    expect(mediaRows()).toHaveLength(2);
  });

  /**
   * A conflict decision about a file must not silently cost a playlist a track.
   * The skipped file resolves to the row the room already held, so the playlist
   * is complete either way.
   */
  it("still resolves a playlist track whose file was skipped", () => {
    apply(stage({ "audio/dirge.mp3": mp3() }));
    const trackId = mediaRows()[0].id;

    apply(
      stage({
        "audio/dirge.mp3": mp3(),
        "playlists/combat.json": text(JSON.stringify({ name: "Combat", tracks: ["audio/dirge.mp3"] }))
      })
    );

    const tracks = all<{ media_id: number }>("SELECT media_id FROM room_playlist_tracks");
    expect(tracks.map((track) => track.media_id)).toEqual([trackId]);
  });

  it("names a playlist conflict by name, whatever its case", () => {
    apply(
      stage({
        "audio/dirge.mp3": mp3(),
        "playlists/combat.json": text(JSON.stringify({ name: "Combat", tracks: ["audio/dirge.mp3"] }))
      })
    );
    const result = apply(
      stage({
        "audio/dirge.mp3": mp3(),
        "playlists/combat.json": text(JSON.stringify({ name: "combat", tracks: ["audio/dirge.mp3"] }))
      })
    );

    expect(result.playlists).toEqual({ added: 0, replaced: 0, skipped: 1 });
    expect(all("SELECT id FROM room_playlists WHERE room_id = ?", roomId)).toHaveLength(1);
  });
});

describe("what it refuses, and what it leaves behind when it does", () => {
  /**
   * An archive can carry anything under any name. The importer asks the same
   * question of a staged file that the upload routes ask of an uploaded one, and
   * refuses the whole import rather than storing something the room cannot show.
   */
  it("refuses a file that is not what its name says, before writing anything", () => {
    const staged = stage({ "maps/good.png": png(), "maps/liar.png": text("this is not a PNG") });

    expect(() => apply(staged)).toThrow(/"maps\/liar\.png" does not contain the image\/png its name says it does/);
    expect(mediaRows()).toEqual([]);
    // Nothing moved, so the import can be tried again with a corrected bundle.
    expect(fs.existsSync(path.join(staged.directory, "maps", "good.png"))).toBe(true);
  });

  it("refuses an import that would pass the server's allowance", () => {
    const staged = stage({ "maps/keep.png": png() });
    db.prepare(
      `INSERT INTO media (room_id, uploaded_by, kind, category, filename, stored_name, mime_type, size)
       VALUES (?, ?, 'scene', 'map', 'huge.png', 'huge-stored', 'image/png', ?)`
    ).run(roomId, ACCOUNT, config.uploadLimitMb * 1024 * 1024);

    expect(() => apply(staged)).toThrow(/past its upload-storage allowance/);
    expect(mediaRows()).toHaveLength(1);
  });

  /**
   * The rollback that matters. A failure after the files have moved must put them
   * back, or the stage is a half-emptied directory that can never be applied and
   * the GM has to upload a gigabyte a second time.
   */
  it("puts every file back when the write fails part-way", () => {
    const staged = stage({ "maps/keep.png": png(), "audio/dirge.mp3": mp3() });
    const room = one<{ id: number }>("SELECT id FROM rooms WHERE id = ?", roomId)!;

    // A room that vanishes between the plan and the write: the foreign key fails
    // the insert, which is as good a mid-write failure as any.
    db.exec("PRAGMA foreign_keys = ON");
    db.prepare("DELETE FROM rooms WHERE id = ?").run(room.id);

    const before = fs.readdirSync(uploads());
    expect(() => apply(staged)).toThrow();
    expect(fs.existsSync(path.join(staged.directory, "maps", "keep.png"))).toBe(true);
    expect(fs.existsSync(path.join(staged.directory, "audio", "dirge.mp3"))).toBe(true);
    expect(fs.readdirSync(uploads())).toEqual(before);
  });
});
