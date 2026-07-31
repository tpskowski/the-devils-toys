import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BUILTIN_TABLE_TAGS, SYSTEM_IDS, THEME_IDS } from "@devils-toys/shared";
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
    CREATE TABLE table_sets (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      markdown TEXT NOT NULL,
      created_by INTEGER NOT NULL REFERENCES accounts(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO accounts (id, username, password_hash) VALUES (1, 'Warden', 'stored-hash');
    INSERT INTO table_sets (id, name, markdown, created_by) VALUES (1, 'Old tables', '# Tables', 1);
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

async function holdDatabaseLock(directory: string) {
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `
        import { DatabaseSync } from "node:sqlite";
        const database = new DatabaseSync(process.argv[1]);
        database.exec("BEGIN EXCLUSIVE");
        process.stdout.write("locked\\n");
        setTimeout(() => {
          database.exec("COMMIT");
          database.close();
        }, 250);
      `,
      path.join(directory, "devils-toys.sqlite")
    ],
    { stdio: ["ignore", "pipe", "pipe"] }
  );
  const exited = new Promise<number | null>((resolve) => child.once("exit", resolve));

  await new Promise<void>((resolve, reject) => {
    let errors = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      errors += chunk;
    });
    child.stdout.once("data", (chunk) => {
      if (String(chunk).includes("locked")) resolve();
      else reject(new Error(`Lock helper returned unexpected output: ${String(chunk)}`));
    });
    child.once("exit", (code) => {
      if (code !== 0) reject(new Error(`Lock helper exited with code ${code}: ${errors}`));
    });
  });

  return { exited };
}

afterEach(() => {
  for (const loaded of opened.splice(0)) loaded.db.close();
  for (const directory of directories.splice(0)) removeDataDir(directory);
});

describe("database migrations", () => {
  it("waits for the other application when both open the shared database", async () => {
    const directory = dataDir();
    const lock = await holdDatabaseLock(directory);
    const loaded = await openDatabase(directory);

    expect(tableNames(loaded)).toContain("accounts");
    expect(await lock.exited).toBe(0);
  });

  it("accepts every current system in a database created by an older build", async () => {
    const directory = dataDir();
    seedLegacyDatabase(directory);
    const loaded = await openDatabase(directory);

    for (const system of SYSTEM_IDS) expect(roomsSchema(loaded)).toContain(`'${system}'`);
    for (const [index, system] of SYSTEM_IDS.entries()) {
      loaded.db
        .prepare("INSERT INTO rooms (name, system, theme, created_by) VALUES (?, ?, 'used', 1)")
        .run(`System room ${index}`, system);
    }
    expect(loaded.all<{ system: string }>("SELECT system FROM rooms WHERE id > 1").map((row) => row.system)).toEqual([
      ...SYSTEM_IDS
    ]);
  });

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

  it("adds disabled calendar storage to rooms from an older build", async () => {
    const directory = dataDir();
    seedLegacyDatabase(directory);
    const loaded = await openDatabase(directory);

    expect(
      loaded.all<{ calendar_enabled: number; calendar_json: string | null }>(
        "SELECT calendar_enabled, calendar_json FROM rooms"
      )
    ).toEqual([{ calendar_enabled: 0, calendar_json: null }]);
  });

  it("adds the room easter-egg ledger to older databases", async () => {
    const directory = dataDir();
    seedLegacyDatabase(directory);
    const loaded = await openDatabase(directory);

    expect(tableNames(loaded)).toContain("room_easter_eggs");
    loaded.db
      .prepare("INSERT INTO room_easter_eggs (room_id, egg_id) VALUES (1, 'calendar-strict-time-records')")
      .run();
    expect(loaded.all<{ room_id: number; egg_id: string }>("SELECT room_id, egg_id FROM room_easter_eggs")).toEqual([
      { room_id: 1, egg_id: "calendar-strict-time-records" }
    ]);
  });

  it("adds disabled map notation and its persistent element table to older databases", async () => {
    const directory = dataDir();
    seedLegacyDatabase(directory);
    const loaded = await openDatabase(directory);

    expect(loaded.all<{ map_notation_enabled: number }>("SELECT map_notation_enabled FROM rooms")).toEqual([
      { map_notation_enabled: 0 }
    ]);
    expect(tableNames(loaded)).toContain("map_notations");
  });

  it("adds empty tag storage to existing custom table sets", async () => {
    const directory = dataDir();
    seedLegacyDatabase(directory);
    const loaded = await openDatabase(directory);

    expect(loaded.all<{ name: string; tags_json: string }>("SELECT name, tags_json FROM table_sets")).toEqual([
      { name: "Old tables", tags_json: "[]" }
    ]);
    const tableSetColumns = loaded.all<{ name: string }>("PRAGMA table_info(table_sets)").map((column) => column.name);
    expect(tableSetColumns).toContain("tables_json");
    expect(tableSetColumns).toContain("migration_markdown");
    expect(tableSetColumns).not.toContain("markdown");
    const migratedSet = loaded.all<{ tables_json: string; migration_markdown: string }>(
      "SELECT tables_json, migration_markdown FROM table_sets WHERE id = 1"
    )[0];
    expect(JSON.parse(migratedSet.tables_json).formatVersion).toBe(1);
    expect(migratedSet.migration_markdown).toBe("# Tables");
  });

  it("seeds the tag vocabulary into a database that predates it", async () => {
    const directory = dataDir();
    seedLegacyDatabase(directory);
    const loaded = await openDatabase(directory);

    expect(
      loaded.all<{ slug: string; builtin: number }>("SELECT slug, builtin FROM table_tags ORDER BY sort_order")
    ).toEqual(BUILTIN_TABLE_TAGS.map((slug) => ({ slug, builtin: 1 })));
  });

  it("puts a tag added to the application in its declared place, after the ones already stored", async () => {
    const directory = dataDir();
    const first = await openDatabase(directory);
    // A database that predates the newest tags: only the first three, and one
    // this instance added sitting immediately after them.
    first.db.exec("DELETE FROM table_tags");
    BUILTIN_TABLE_TAGS.slice(0, 3).forEach((slug, position) =>
      first.db
        .prepare("INSERT INTO table_tags (slug, label, builtin, sort_order) VALUES (?, ?, 1, ?)")
        .run(slug, slug, position)
    );
    first.db
      .prepare("INSERT INTO table_tags (slug, label, builtin, sort_order) VALUES ('horror', 'Horror', 0, 3)")
      .run();
    first.db.close();
    opened.splice(opened.indexOf(first), 1);

    const second = await openDatabase(directory);
    const order = () =>
      second.all<{ slug: string }>("SELECT slug FROM table_tags ORDER BY sort_order, slug").map((row) => row.slug);
    // Declared order, with what the instance added kept after it rather than
    // interleaved among the tags that arrived later.
    expect(order()).toEqual([...BUILTIN_TABLE_TAGS, "horror"]);

    // Restating a position must not move anything on a later start.
    const settled = order();
    second.db.close();
    opened.splice(opened.indexOf(second), 1);
    const third = await openDatabase(directory);
    expect(
      third.all<{ slug: string }>("SELECT slug FROM table_tags ORDER BY sort_order, slug").map((r) => r.slug)
    ).toEqual(settled);
  });

  it("leaves a renamed built-in tag alone on the next start", async () => {
    const directory = dataDir();
    const first = await openDatabase(directory);
    first.db.prepare("UPDATE table_tags SET label = ? WHERE slug = 'scifi'").run("Science Fiction");
    first.db.close();
    opened.splice(opened.indexOf(first), 1);

    const second = await openDatabase(directory);
    expect(second.all<{ label: string }>("SELECT label FROM table_tags WHERE slug = 'scifi'")).toEqual([
      { label: "Science Fiction" }
    ]);
    // A tag added by the instance survives a restart, and no built-in is duplicated.
    expect(second.all<{ total: number }>("SELECT COUNT(*) AS total FROM table_tags")).toEqual([
      { total: BUILTIN_TABLE_TAGS.length }
    ]);
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
