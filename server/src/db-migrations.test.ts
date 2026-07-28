import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { THEME_IDS } from "@devils-toys/shared";
import { removeDataDir } from "./test-setup.js";

// The themes that shipped before `shinji` was added. A database created by that
// build carries their CHECK constraint and cannot store any newer theme.
const legacyThemes = ["heroic", "digital", "used", "grim"];

interface LoadedDatabase {
  db: DatabaseSync;
  all: <T>(sql: string, ...params: (string | number)[]) => T[];
}

const opened: LoadedDatabase[] = [];
const directories: string[] = [];

function dataDir() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "devils-toys-migration-"));
  directories.push(directory);
  return directory;
}

/** Writes a database with the pre-`shinji` rooms schema and one room in use. */
function seedLegacyDatabase(directory: string) {
  const legacy = new DatabaseSync(path.join(directory, "devils-toys.sqlite"));
  legacy.exec(`
    CREATE TABLE accounts (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL COLLATE NOCASE UNIQUE,
      password_hash TEXT NOT NULL,
      is_admin INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE rooms (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      system TEXT NOT NULL CHECK(system IN ('cairn','monolith')),
      theme TEXT NOT NULL CHECK(theme IN (${legacyThemes.map((theme) => `'${theme}'`).join(",")})),
      archived INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER NOT NULL REFERENCES accounts(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE memberships (
      room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('gm','player')),
      active_character_id INTEGER,
      PRIMARY KEY(room_id, account_id)
    );
    CREATE TABLE room_state (
      room_id INTEGER PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
      map_id INTEGER,
      scene_id INTEGER,
      audio_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO accounts (id, username, password_hash) VALUES (1, 'Warden', 'stored-hash');
    INSERT INTO rooms (id, name, system, theme, archived, created_by)
      VALUES (1, 'Old Table', 'cairn', 'used', 1, 1);
    INSERT INTO memberships (room_id, account_id, role) VALUES (1, 1, 'gm');
    INSERT INTO room_state (room_id, audio_json) VALUES (1, '{"trackId":null}');
  `);
  legacy.close();
}

/** Applies the real schema and migrations to `directory`, as a server start would. */
async function openDatabase(directory: string) {
  process.env.DEVILS_TOYS_DATA_DIR = directory;
  vi.resetModules();
  const loaded = (await import("./db.js")) as unknown as LoadedDatabase;
  opened.push(loaded);
  return loaded;
}

function roomsSchema(loaded: LoadedDatabase) {
  return loaded.all<{ sql: string }>("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'rooms'")[0].sql;
}

function tableNames(loaded: LoadedDatabase) {
  return loaded.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'").map((row) => row.name);
}

afterEach(() => {
  for (const loaded of opened.splice(0)) loaded.db.close();
  for (const directory of directories.splice(0)) removeDataDir(directory);
});

describe("rooms theme migration", () => {
  it("accepts every current theme in a database created by an older build", async () => {
    const directory = dataDir();
    seedLegacyDatabase(directory);
    const loaded = await openDatabase(directory);

    for (const theme of THEME_IDS) expect(roomsSchema(loaded)).toContain(`'${theme}'`);
    for (const [index, theme] of THEME_IDS.entries()) {
      loaded.db
        .prepare("INSERT INTO rooms (name, system, theme, created_by) VALUES (?, 'cairn', ?, 1)")
        .run(`Room ${index}`, theme);
    }
    expect(loaded.all<{ theme: string }>("SELECT theme FROM rooms WHERE id > 1").map((row) => row.theme)).toEqual([
      ...THEME_IDS
    ]);
  });

  it("keeps existing rooms, their child rows, and referential integrity", async () => {
    const directory = dataDir();
    seedLegacyDatabase(directory);
    const loaded = await openDatabase(directory);

    expect(roomsSchema(loaded)).toContain(`'${THEME_IDS[THEME_IDS.length - 1]}'`);
    expect(loaded.all("SELECT id, name, system, theme, archived, created_by FROM rooms")).toEqual([
      { id: 1, name: "Old Table", system: "cairn", theme: "used", archived: 1, created_by: 1 }
    ]);
    expect(loaded.all("SELECT room_id, account_id, role FROM memberships")).toEqual([
      { room_id: 1, account_id: 1, role: "gm" }
    ]);
    expect(loaded.all("PRAGMA foreign_key_check")).toEqual([]);
    expect(loaded.all<{ integrity_check: string }>("PRAGMA integrity_check")).toEqual([{ integrity_check: "ok" }]);
    expect(
      loaded
        .all<{ table: string; from: string }>("PRAGMA foreign_key_list(memberships)")
        .some((key) => key.table === "rooms" && key.from === "room_id")
    ).toBe(true);
  });

  it("adds persistent group data to an existing room-state table", async () => {
    const directory = dataDir();
    seedLegacyDatabase(directory);
    const loaded = await openDatabase(directory);

    expect(
      loaded.all<{ group_json: string; audio_json: string }>("SELECT group_json, audio_json FROM room_state")
    ).toEqual([{ group_json: "{}", audio_json: '{"trackId":null}' }]);
  });

  it("leaves no rebuild table behind and rebuilds only once", async () => {
    const directory = dataDir();
    seedLegacyDatabase(directory);
    const first = await openDatabase(directory);
    expect(tableNames(first)).not.toContain("rooms_rebuilt");
    const schemaAfterRebuild = roomsSchema(first);
    first.db.close();
    opened.splice(opened.indexOf(first), 1);

    // A second start finds a current CHECK constraint and must not touch rooms.
    const second = await openDatabase(directory);
    expect(tableNames(second)).not.toContain("rooms_rebuilt");
    expect(roomsSchema(second)).toBe(schemaAfterRebuild);
    expect(second.all("SELECT id FROM rooms")).toEqual([{ id: 1 }]);
  });

  it("still rejects a theme the application does not ship", async () => {
    const directory = dataDir();
    seedLegacyDatabase(directory);
    const loaded = await openDatabase(directory);

    expect(() =>
      loaded.db
        .prepare("INSERT INTO rooms (name, system, theme, created_by) VALUES ('Bad', 'cairn', ?, 1)")
        .run("evangelion")
    ).toThrow(/CHECK constraint failed/);
  });

  it("creates a new database with the full theme list", async () => {
    const loaded = await openDatabase(dataDir());

    for (const theme of THEME_IDS) expect(roomsSchema(loaded)).toContain(`'${theme}'`);
    expect(tableNames(loaded)).toEqual(expect.arrayContaining(["accounts", "rooms", "memberships", "messages"]));
  });
});
