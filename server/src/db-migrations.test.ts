import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BUILTIN_TABLE_TAGS, THEME_IDS } from "@devils-toys/shared";
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

/** The `system` column as each earlier build declared it. */
const legacySystemColumns = {
  /** Before installable systems: a CHECK listing the compiled systems. */
  checked: "system TEXT NOT NULL CHECK(system IN ('cairn','monolith'))",
  /** After the CHECK was dropped but before the registry existed. */
  unconstrained: "system TEXT NOT NULL"
} as const;

/**
 * Writes a database with the pre-`shinji` rooms schema and one room in use.
 *
 * Both the theme list and the `system` column are overridable so a test can
 * isolate one condition of the rooms rebuild. With current themes and an
 * unconstrained `system`, only the missing reference to the registry can
 * trigger it — which is the database a build between dropping the CHECK and
 * adding the registry would have left.
 */
function seedLegacyDatabase(
  directory: string,
  themes: readonly string[] = legacyThemes,
  systemColumn: string = legacySystemColumns.checked
) {
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
      ${systemColumn},
      theme TEXT NOT NULL CHECK(theme IN (${themes.map((theme) => `'${theme}'`).join(",")})),
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
    -- Characters as every earlier build declared them, with system a bare TEXT
    -- carrying no constraint of any kind. Present in the seed so the migration
    -- that gives it a reference has something to migrate; created fresh it
    -- would simply be right, and the migration would never run.
    CREATE TABLE characters (
      id INTEGER PRIMARY KEY,
      system TEXT NOT NULL,
      owner_account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
      pool_room_id INTEGER REFERENCES rooms(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      sheet_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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

function seedJsonTableSetDatabase(directory: string) {
  seedLegacyDatabase(directory);
  const legacy = new DatabaseSync(path.join(directory, "devils-toys.sqlite"));
  legacy.exec("PRAGMA foreign_keys = OFF");
  legacy.exec(`
    CREATE TABLE table_sets_json (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      tables_json TEXT NOT NULL,
      migration_markdown TEXT,
      tags_json TEXT NOT NULL DEFAULT '[]',
      created_by INTEGER NOT NULL REFERENCES accounts(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO table_sets_json
      (id, name, tables_json, migration_markdown, tags_json, created_by, created_at, updated_at)
    SELECT id, name, '{"formatVersion":1,"tables":[]}', markdown, '[]', created_by, created_at, updated_at
      FROM table_sets;
    DROP TABLE table_sets;
    ALTER TABLE table_sets_json RENAME TO table_sets;
  `);
  legacy.close();
}

function seedFeatureFlagDatabase(directory: string) {
  seedLegacyDatabase(directory);
  const legacy = new DatabaseSync(path.join(directory, "devils-toys.sqlite"));
  legacy.exec(`
    ALTER TABLE rooms ADD COLUMN calendar_enabled INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE rooms ADD COLUMN calendar_json TEXT;
    ALTER TABLE rooms ADD COLUMN map_notation_enabled INTEGER NOT NULL DEFAULT 0;
    UPDATE rooms
      SET calendar_enabled = 1,
          calendar_json = '{"year":7}',
          map_notation_enabled = 1;
  `);
  legacy.close();
}

/** A room whose music predates the album columns and is already marked as read. */
function seedPreAlbumMusicDatabase(directory: string) {
  seedLegacyDatabase(directory);
  const legacy = new DatabaseSync(path.join(directory, "devils-toys.sqlite"));
  legacy.exec(`
    CREATE TABLE media (
      id INTEGER PRIMARY KEY,
      room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      uploaded_by INTEGER NOT NULL REFERENCES accounts(id),
      kind TEXT NOT NULL CHECK(kind IN ('scene','reference','audio')),
      category TEXT,
      filename TEXT NOT NULL,
      display_name TEXT,
      stored_name TEXT NOT NULL,
      artist TEXT,
      title TEXT,
      metadata_loaded INTEGER NOT NULL DEFAULT 0,
      visible INTEGER NOT NULL DEFAULT 0,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO media (id, room_id, uploaded_by, kind, filename, stored_name, artist, title,
                       metadata_loaded, mime_type, size)
      VALUES (1, 1, 1, 'audio', 'dirge.mp3', 'a.mp3', 'The Wake', 'Dirge', 1, 'audio/mpeg', 10);
    INSERT INTO media (id, room_id, uploaded_by, kind, category, filename, stored_name, metadata_loaded,
                       visible, mime_type, size)
      VALUES (2, 1, 1, 'scene', 'map', 'harbour.png', 'b.png', 1, 1, 'image/png', 20);
  `);
  legacy.close();
}

function seedEncounterPlacementDatabase(directory: string) {
  seedLegacyDatabase(directory);
  const legacy = new DatabaseSync(path.join(directory, "devils-toys.sqlite"));
  legacy.exec(`
    CREATE TABLE encounters (
      id INTEGER PRIMARY KEY,
      room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 0,
      media_id INTEGER,
      notes TEXT NOT NULL DEFAULT '',
      individual_initiative INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER NOT NULL REFERENCES accounts(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE encounter_combatants (
      id INTEGER PRIMARY KEY,
      encounter_id INTEGER NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      character_id INTEGER,
      npc_id INTEGER,
      hireling_id TEXT,
      name TEXT NOT NULL,
      side TEXT NOT NULL DEFAULT 'enemies',
      initiative INTEGER,
      acts_first_turn INTEGER,
      sort_order INTEGER NOT NULL DEFAULT 0,
      hp_current INTEGER,
      hp_max INTEGER,
      statblock_json TEXT NOT NULL DEFAULT '{}',
      conditions TEXT NOT NULL DEFAULT '',
      included INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    ALTER TABLE room_state ADD COLUMN group_json TEXT NOT NULL DEFAULT '{}';
    UPDATE room_state SET group_json = '{"hirelings":[{"id":"old-hireling","name":"Old hireling"}]}' WHERE room_id = 1;
    INSERT INTO encounters (id, room_id, name, created_by) VALUES (1, 1, 'Old encounter', 1);
    INSERT INTO encounter_combatants (id, encounter_id, kind, hireling_id, name)
      VALUES (1, 1, 'hireling', 'old-hireling', 'Old hireling');
  `);
  legacy.close();
}

/**
 * A database from before hirelings, ships, and obligations became rows: the
 * whole roster inside `room_state.group_json`, portraits in side tables keyed by
 * the blob's string ids, and combatants pointing at those strings.
 *
 * Room 1 carries the array shapes; room 2 carries the two older ones that are
 * still in real databases — a single `starship` object and a `groupDebt` string.
 */
function seedGroupBlobDatabase(directory: string) {
  seedLegacyDatabase(directory);
  const legacy = new DatabaseSync(path.join(directory, "devils-toys.sqlite"));
  legacy.exec("PRAGMA foreign_keys = OFF");
  const groupOne = JSON.stringify({
    creed: "Owe nothing",
    hirelings: [
      { id: "hire-a", name: "Vetch", hp: 4, weapons: ["Shiv"] },
      { name: "Nameless", hp: 2 },
      { id: "hire-c", name: "Orsk", hp: 7 }
    ],
    starships: [{ id: "ship-a", name: "Desdemona", size: "frigate" }],
    obligations: [{ id: "debt-a", name: "The Guild", owedTo: "Mother Kell", amount: "10k", details: "Due at thaw" }]
  });
  const groupTwo = JSON.stringify({ starship: { name: "Old Bird", size: "cutter" }, groupDebt: "  Two favours  " });
  legacy.exec(`
    INSERT INTO rooms (id, name, system, theme, archived, created_by)
      VALUES (2, 'Second Table', 'monolith', 'grim', 0, 1);
    INSERT INTO room_state (room_id, audio_json) VALUES (2, '{}');
    ALTER TABLE room_state ADD COLUMN group_json TEXT NOT NULL DEFAULT '{}';
    UPDATE room_state SET group_json = '${groupOne.replace(/'/g, "''")}' WHERE room_id = 1;
    UPDATE room_state SET group_json = '${groupTwo.replace(/'/g, "''")}' WHERE room_id = 2;

    CREATE TABLE hireling_images (
      room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      hireling_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(room_id, hireling_id)
    );
    CREATE TABLE starship_images (
      room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      starship_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(room_id, starship_id)
    );
    INSERT INTO hireling_images (room_id, hireling_id, filename, stored_name, mime_type, size)
      VALUES (1, 'hire-c', 'orsk.png', 'stored-orsk.png', 'image/png', 4096);
    INSERT INTO starship_images (room_id, starship_id, filename, stored_name, mime_type, size)
      VALUES (1, 'ship-a', 'desdemona.png', 'stored-ship.png', 'image/png', 8192);

    CREATE TABLE encounters (
      id INTEGER PRIMARY KEY,
      room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 0,
      media_id INTEGER,
      notes TEXT NOT NULL DEFAULT '',
      individual_initiative INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER NOT NULL REFERENCES accounts(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE encounter_combatants (
      id INTEGER PRIMARY KEY,
      encounter_id INTEGER NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('character', 'hireling', 'npc')),
      character_id INTEGER,
      npc_id INTEGER,
      hireling_id TEXT,
      name TEXT NOT NULL,
      side TEXT NOT NULL DEFAULT 'enemies',
      initiative INTEGER,
      acts_first_turn INTEGER,
      sort_order INTEGER NOT NULL DEFAULT 0,
      hp_current INTEGER,
      hp_max INTEGER,
      statblock_json TEXT NOT NULL DEFAULT '{}',
      conditions TEXT NOT NULL DEFAULT '',
      included INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK (
        (kind = 'character' AND character_id IS NOT NULL AND npc_id IS NULL AND hireling_id IS NULL) OR
        (kind = 'npc' AND npc_id IS NOT NULL AND character_id IS NULL AND hireling_id IS NULL) OR
        (kind = 'hireling' AND hireling_id IS NOT NULL AND character_id IS NULL AND npc_id IS NULL)
      )
    );
    INSERT INTO encounters (id, room_id, name, created_by) VALUES (7, 1, 'The ambush', 1);
    INSERT INTO encounter_combatants (id, encounter_id, kind, hireling_id, name, hp_current)
      VALUES (1, 7, 'hireling', 'hire-a', 'Vetch', 3);
    -- Its hireling was deleted from the blob long ago; the encounter view has
    -- been skipping it ever since.
    INSERT INTO encounter_combatants (id, encounter_id, kind, hireling_id, name)
      VALUES (2, 7, 'hireling', 'ghost', 'Someone who left');
    -- The positional fallback: an entry with no id of its own was addressed as
    -- "hireling-2" by its place in the array.
    INSERT INTO encounter_combatants (id, encounter_id, kind, hireling_id, name)
      VALUES (3, 7, 'hireling', 'hireling-2', 'Nameless');
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

function storedSchemaFor(loaded: LoadedDatabase, table: string) {
  return loaded.all<{ sql: string }>("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?", table)[0].sql;
}

function roomsSchema(loaded: LoadedDatabase) {
  return storedSchemaFor(loaded, "rooms");
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

  // Seeded with the current themes so the theme half of the rebuild predicate is
  // already satisfied. Only the system CHECK is stale, so these two fail if the
  // system half is removed — which the theme migration would otherwise mask.
  it("drops the system constraint from a database whose themes are already current", async () => {
    const directory = dataDir();
    seedLegacyDatabase(directory, THEME_IDS);
    const loaded = await openDatabase(directory);

    expect(roomsSchema(loaded)).not.toMatch(/CHECK\s*\(\s*system\s+IN/i);
  });

  it("accepts a system id this build has never heard of, once it is registered", async () => {
    const directory = dataDir();
    seedLegacyDatabase(directory, THEME_IDS);
    const loaded = await openDatabase(directory);

    // What an installed system is, from the database's point of view: an id no
    // compiled list contains. The old CHECK could never have allowed it; the
    // registry row is what does.
    loaded.db
      .prepare("INSERT INTO systems (id, name, origin) VALUES ('toybox-2', 'Toybox (installed)', 'installed')")
      .run();
    loaded.db
      .prepare("INSERT INTO rooms (name, system, theme, created_by) VALUES ('Installed', 'toybox-2', 'used', 1)")
      .run();
    expect(loaded.all<{ system: string }>("SELECT system FROM rooms WHERE name = 'Installed'")).toEqual([
      { system: "toybox-2" }
    ]);
  });

  // Seeded with current themes and an already-unconstrained `system`, so neither
  // the theme condition nor the CHECK condition can fire. Only the missing
  // reference to the registry can trigger the rebuild, which is what these two
  // are testing — and they fail when that condition is removed.
  it("points an unconstrained system column at the registry", async () => {
    const directory = dataDir();
    seedLegacyDatabase(directory, THEME_IDS, legacySystemColumns.unconstrained);
    const loaded = await openDatabase(directory);

    expect(roomsSchema(loaded)).toMatch(/system\s+TEXT[^,]*REFERENCES\s+systems/i);
  });

  it("refuses a room on a system nothing has registered", async () => {
    const directory = dataDir();
    seedLegacyDatabase(directory, THEME_IDS, legacySystemColumns.unconstrained);
    const loaded = await openDatabase(directory);

    // The reference is what the dropped CHECK could not do: it makes deleting a
    // system in use impossible, rather than merely discouraged.
    expect(() =>
      loaded.db
        .prepare("INSERT INTO rooms (name, system, theme, created_by) VALUES ('Nowhere', 'no-such-system', 'used', 1)")
        .run()
    ).toThrow(/FOREIGN KEY/i);
  });

  it("gives characters the same reference, which they never had at all", async () => {
    const directory = dataDir();
    seedLegacyDatabase(directory, THEME_IDS, legacySystemColumns.unconstrained);
    const loaded = await openDatabase(directory);

    expect(storedSchemaFor(loaded, "characters")).toMatch(/system\s+TEXT[^,]*REFERENCES\s+systems/i);
    expect(() =>
      loaded.db.prepare("INSERT INTO characters (system, name) VALUES ('no-such-system', 'Nobody')").run()
    ).toThrow(/FOREIGN KEY/i);
  });

  it("keeps a room's system on hand for one this build does not ship", async () => {
    const directory = dataDir();
    seedLegacyDatabase(directory, THEME_IDS);

    // A room on a system this build has never had — which is what a database
    // outliving a system looks like, and the case that would otherwise make
    // adding the foreign key fail. Written past the older build's own CHECK,
    // since that build would have listed the system it then shipped.
    const seeded = new DatabaseSync(path.join(directory, "devils-toys.sqlite"));
    seeded.exec("PRAGMA ignore_check_constraints = ON");
    seeded
      .prepare("INSERT INTO rooms (name, system, theme, created_by) VALUES ('Orphan', 'retired-system', 'used', 1)")
      .run();
    seeded.close();

    const loaded = await openDatabase(directory);
    const registered = loaded.all<{ id: string; origin: string; retired: number }>(
      "SELECT id, origin, retired FROM systems ORDER BY id"
    );
    // Kept, and retired: the room still opens, and nobody can start another.
    expect(registered).toContainEqual({ id: "retired-system", origin: "installed", retired: 1 });
    expect(loaded.all<{ name: string }>("SELECT name FROM rooms WHERE system = 'retired-system'")).toEqual([
      { name: "Orphan" }
    ]);
  });

  /**
   * The case a real database hit. Cairn, Monolith, and Cities Without Number
   * shipped inside the application once, so a database written then holds rows
   * marked `builtin` — and `loadInstalledSystems` skips anything not marked
   * `installed`. Left alone, those rooms could never be given their system back
   * however it was installed, because the row would never be loaded.
   */
  it("stops calling a system built in once this build stops shipping it", async () => {
    const directory = dataDir();
    seedLegacyDatabase(directory, THEME_IDS);

    // Opened once for the current schema, then written back into the state a
    // build that still shipped Cairn would have left: its row marked `builtin`,
    // with a room on it. That is a real database, not an invented one.
    const first = await openDatabase(directory);
    first.db.prepare("UPDATE systems SET origin = 'builtin', retired = 0 WHERE id = 'cairn'").run();

    const loaded = await openDatabase(directory);
    const row = loaded.all<{ id: string; origin: string; retired: number }>(
      "SELECT id, origin, retired FROM systems WHERE id = 'cairn'"
    );
    // Installed, so `loadInstalledSystems` will load it once its content is
    // there — and not retired, so nothing has to be un-retired by hand after
    // re-installing it.
    expect(row).toEqual([{ id: "cairn", origin: "installed", retired: 0 }]);
    expect(loaded.all<{ name: string }>("SELECT name FROM rooms WHERE system = 'cairn'")).toEqual([
      { name: "Old Table" }
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

  // Seeded with a character in it, because a column added to an empty table
  // proves nothing about the rows already there. `seedLegacyDatabase` writes
  // `characters` as every earlier build declared it, with no draft column of any
  // kind, so this fails outright if the migration goes.
  it("gives an existing character somewhere to keep a half-built one", async () => {
    const directory = dataDir();
    seedLegacyDatabase(directory, THEME_IDS, legacySystemColumns.unconstrained);
    const legacy = new DatabaseSync(path.join(directory, "devils-toys.sqlite"));
    legacy.exec("INSERT INTO characters (id, system, name, sheet_json) VALUES (1, 'cairn', 'Ivo', '{\"hp\":3}')");
    legacy.close();
    const loaded = await openDatabase(directory);

    expect(
      loaded.all<{ name: string; sheet_json: string; creation_json: string | null }>(
        "SELECT name, sheet_json, creation_json FROM characters"
      )
    ).toEqual([{ name: "Ivo", sheet_json: '{"hp":3}', creation_json: null }]);

    // Nullable, and NULL is both "never started" and "finished": a character
    // that has been built carries no record of having been.
    loaded.db.prepare("UPDATE characters SET creation_json = ? WHERE id = 1").run('{"system":"cairn","steps":{}}');
    expect(loaded.all<{ creation_json: string }>("SELECT creation_json FROM characters")[0].creation_json).toBe(
      '{"system":"cairn","steps":{}}'
    );
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

  it("adds responsive map positions without losing existing encounter combatants", async () => {
    const directory = dataDir();
    seedEncounterPlacementDatabase(directory);
    const loaded = await openDatabase(directory);

    const columns = loaded.all<{ name: string }>("PRAGMA table_info(encounter_combatants)").map(({ name }) => name);
    expect(columns).toContain("map_x");
    expect(columns).toContain("map_y");
    expect(
      loaded.all<{ name: string; map_x: number | null; map_y: number | null }>(
        "SELECT name, map_x, map_y FROM encounter_combatants"
      )
    ).toEqual([{ name: "Old hireling", map_x: null, map_y: null }]);
  });

  it("preserves existing room features while adding disabled music playback", async () => {
    const directory = dataDir();
    seedFeatureFlagDatabase(directory);
    const loaded = await openDatabase(directory);

    expect(
      loaded.all<{
        calendar_enabled: number;
        calendar_json: string | null;
        map_notation_enabled: number;
        music_enabled: number;
      }>("SELECT calendar_enabled, calendar_json, map_notation_enabled, music_enabled FROM rooms")
    ).toEqual([
      {
        calendar_enabled: 1,
        calendar_json: '{"year":7}',
        map_notation_enabled: 1,
        music_enabled: 0
      }
    ]);
  });

  it("sends existing music back through the tag reader once, for its album", async () => {
    const directory = dataDir();
    seedPreAlbumMusicDatabase(directory);
    const loaded = await openDatabase(directory);

    const columns = loaded.all<{ name: string }>("PRAGMA table_info(media)").map((column) => column.name);
    expect(columns).toContain("album");
    expect(columns).toContain("track_no");
    // The track is unread again so the album can be filled in; the artist and
    // title it already carries are untouched, and the image is left alone.
    expect(
      loaded.all<{ id: number; artist: string | null; title: string | null; metadata_loaded: number }>(
        "SELECT id, artist, title, metadata_loaded FROM media ORDER BY id"
      )
    ).toEqual([
      { id: 1, artist: "The Wake", title: "Dirge", metadata_loaded: 0 },
      { id: 2, artist: null, title: null, metadata_loaded: 1 }
    ]);
  });

  it("adds empty tag storage to existing custom table sets", async () => {
    const directory = dataDir();
    seedLegacyDatabase(directory);
    const loaded = await openDatabase(directory);

    expect(loaded.all<{ name: string; tags_json: string }>("SELECT name, tags_json FROM table_sets")).toEqual([
      { name: "Old tables", tags_json: "[]" }
    ]);
    const tableSetColumns = loaded.all<{ name: string }>("PRAGMA table_info(table_sets)").map((column) => column.name);
    expect(tableSetColumns).toContain("markdown");
    expect(tableSetColumns).not.toContain("tables_json");
    expect(loaded.all<{ markdown: string }>("SELECT markdown FROM table_sets WHERE id = 1")[0].markdown).toBe(
      "# Tables"
    );
  });

  it("restores the exact Markdown backup from the short-lived JSON custom-set schema", async () => {
    const directory = dataDir();
    seedJsonTableSetDatabase(directory);
    const loaded = await openDatabase(directory);

    const columns = loaded.all<{ name: string }>("PRAGMA table_info(table_sets)").map((column) => column.name);
    expect(columns).toContain("markdown");
    expect(columns).not.toContain("tables_json");
    expect(loaded.all<{ markdown: string }>("SELECT markdown FROM table_sets WHERE id = 1")).toEqual([
      { markdown: "# Tables" }
    ]);
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

describe("moving the group roster out of its blob", () => {
  interface HirelingRow {
    id: number;
    room_id: number;
    name: string;
    sort_order: number;
    sheet_json: string;
    legacy_id: string | null;
    portrait_stored_name: string | null;
    portrait_size: number | null;
  }

  it("turns each array entry into a row, in the order the array had them", async () => {
    const directory = dataDir();
    seedGroupBlobDatabase(directory);
    const loaded = await openDatabase(directory);

    const hirelings = loaded.all<HirelingRow>("SELECT * FROM group_hirelings WHERE room_id = 1 ORDER BY sort_order");
    expect(hirelings.map((row) => row.name)).toEqual(["Vetch", "Nameless", "Orsk"]);
    expect(hirelings.map((row) => row.legacy_id)).toEqual(["hire-a", "hireling-2", "hire-c"]);
    expect(hirelings.map((row) => row.sort_order)).toEqual([0, 1, 2]);
    // The rest of the entry becomes the row's own sheet, in the shape a
    // character's already is.
    expect(JSON.parse(hirelings[0].sheet_json)).toEqual({ hp: 4, weapons: ["Shiv"] });
  });

  it("moves the two older shapes real databases still hold", async () => {
    const directory = dataDir();
    seedGroupBlobDatabase(directory);
    const loaded = await openDatabase(directory);

    const ships = loaded.all<{ name: string; legacy_id: string; kind: string; sheet_json: string }>(
      "SELECT * FROM group_assets WHERE room_id = 2"
    );
    expect(ships).toHaveLength(1);
    expect(ships[0]).toMatchObject({ name: "Old Bird", legacy_id: "legacy-starship", kind: "starship" });
    expect(JSON.parse(ships[0].sheet_json)).toEqual({ size: "cutter" });

    const debts = loaded.all<{ name: string; details: string }>("SELECT * FROM group_obligations WHERE room_id = 2");
    expect(debts).toEqual([expect.objectContaining({ name: "Group debt", details: "Two favours" })]);
  });

  it("keeps the group's own fields in the blob and takes the moved keys out", async () => {
    const directory = dataDir();
    seedGroupBlobDatabase(directory);
    const loaded = await openDatabase(directory);

    const kept = JSON.parse(
      loaded.all<{ group_json: string }>("SELECT group_json FROM room_state WHERE room_id = 1")[0].group_json
    );
    expect(kept).toEqual({ creed: "Owe nothing" });
  });

  it("folds the portrait tables onto their rows and drops them", async () => {
    const directory = dataDir();
    seedGroupBlobDatabase(directory);
    const loaded = await openDatabase(directory);

    expect(tableNames(loaded)).not.toContain("hireling_images");
    expect(tableNames(loaded)).not.toContain("starship_images");
    expect(
      loaded.all<HirelingRow>("SELECT * FROM group_hirelings WHERE room_id = 1 AND legacy_id = 'hire-c'")[0]
    ).toMatchObject({ portrait_stored_name: "stored-orsk.png", portrait_size: 4096 });
    expect(
      loaded.all<{ portrait_stored_name: string | null }>("SELECT * FROM group_assets WHERE legacy_id = 'ship-a'")[0]
        .portrait_stored_name
    ).toBe("stored-ship.png");
    // A hireling that never had one is left with none rather than blanked.
    expect(
      loaded.all<HirelingRow>("SELECT * FROM group_hirelings WHERE legacy_id = 'hire-a'")[0].portrait_stored_name
    ).toBeNull();
  });

  it("rebuilds combatants onto a real foreign key, dropping the ones that resolve to nothing", async () => {
    const directory = dataDir();
    seedGroupBlobDatabase(directory);
    const loaded = await openDatabase(directory);

    const schema = loaded.all<{ sql: string }>(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'encounter_combatants'"
    )[0].sql;
    expect(schema).toContain("hireling_id INTEGER REFERENCES group_hirelings(id) ON DELETE CASCADE");

    const combatants = loaded.all<{ id: number; name: string; hireling_id: number | null; hp_current: number | null }>(
      "SELECT id, name, hireling_id, hp_current FROM encounter_combatants ORDER BY id"
    );
    expect(combatants.map((row) => row.name)).toEqual(["Vetch", "Nameless"]);
    expect(combatants[0].hp_current).toBe(3);
    const vetch = loaded.all<HirelingRow>("SELECT * FROM group_hirelings WHERE legacy_id = 'hire-a'")[0];
    expect(combatants[0].hireling_id).toBe(vetch.id);
    // The positional id resolved to the same row its place named.
    const nameless = loaded.all<HirelingRow>("SELECT * FROM group_hirelings WHERE legacy_id = 'hireling-2'")[0];
    expect(combatants[1].hireling_id).toBe(nameless.id);
  });

  it("keeps both partial unique indexes after the rebuild", async () => {
    const directory = dataDir();
    seedGroupBlobDatabase(directory);
    const loaded = await openDatabase(directory);

    const indexes = loaded
      .all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'index'")
      .map((row) => row.name);
    expect(indexes).toEqual(
      expect.arrayContaining(["encounter_combatants_character", "encounter_combatants_hireling"])
    );
  });

  it("deletes a hireling's combatants with it, which nothing enforced before", async () => {
    const directory = dataDir();
    seedGroupBlobDatabase(directory);
    const loaded = await openDatabase(directory);

    const vetch = loaded.all<HirelingRow>("SELECT * FROM group_hirelings WHERE legacy_id = 'hire-a'")[0];
    loaded.db.prepare("DELETE FROM group_hirelings WHERE id = ?").run(vetch.id);
    expect(loaded.all("SELECT id FROM encounter_combatants WHERE name = 'Vetch'")).toEqual([]);
  });

  it("changes nothing when it runs a second time", async () => {
    const directory = dataDir();
    seedGroupBlobDatabase(directory);
    const first = await openDatabase(directory);
    const snapshot = (loaded: LoadedDatabase) =>
      JSON.stringify({
        hirelings: loaded.all("SELECT * FROM group_hirelings ORDER BY id"),
        assets: loaded.all("SELECT * FROM group_assets ORDER BY id"),
        obligations: loaded.all("SELECT * FROM group_obligations ORDER BY id"),
        combatants: loaded.all("SELECT * FROM encounter_combatants ORDER BY id"),
        state: loaded.all("SELECT room_id, group_json FROM room_state ORDER BY room_id")
      });
    const before = snapshot(first);
    first.db.close();
    opened.splice(opened.indexOf(first), 1);

    const second = await openDatabase(directory);
    expect(snapshot(second)).toBe(before);
    expect(tableNames(second)).not.toContain("encounter_combatants_rebuilt");
  });

  it("creates a new database with the rows and none of the retired tables", async () => {
    const loaded = await openDatabase(dataDir());

    expect(tableNames(loaded)).toEqual(
      expect.arrayContaining(["group_hirelings", "group_assets", "group_obligations"])
    );
    expect(tableNames(loaded)).not.toContain("hireling_images");
    expect(tableNames(loaded)).not.toContain("starship_images");
  });
});
