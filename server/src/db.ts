import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { BUILTIN_TABLE_TAGS, defaultTagLabel, serializeSet, THEME_IDS } from "@devils-toys/shared";
import { builtinSystems } from "./builtin-systems.js";
import { config } from "./config.js";

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(path.join(config.dataDir, "uploads"), { recursive: true });
fs.mkdirSync(path.join(config.dataDir, "logs"), { recursive: true });

export const db = new DatabaseSync(path.join(config.dataDir, "devils-toys.sqlite"));
// The Devil's Tables runs as its own process against this same file, so a writer
// waits its turn instead of failing the request outright.
db.exec("PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");

const themeCheckList = THEME_IDS.map((theme) => `'${theme}'`).join(",");

/**
 * Every system this server has, compiled in or installed by an admin. It exists
 * so an installed system has somewhere to be recorded, and so a room can point
 * at a row rather than at a string nothing vouches for.
 *
 * A built-in's row is upserted on every start and never deleted: rooms reference
 * it, and a build that drops a system should leave those rooms readable rather
 * than orphaned. `retired` hides a system from room creation without touching
 * the rooms already on it.
 */
const systemsColumns = `
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    origin TEXT NOT NULL CHECK(origin IN ('builtin','installed')),
    retired INTEGER NOT NULL DEFAULT 0,
    manifest_json TEXT NOT NULL DEFAULT '{}',
    installed_by INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
    installed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP`;
/**
 * `system` carries no CHECK. It used to list the compiled systems, which meant a
 * system added to the application rejected every room made on it until the table
 * had been rebuilt — and an installed system, whose id nothing can know in
 * advance, could never be listed at all. The registry validates the id on the way
 * in instead (`systemIdSchema`), which is where a system this server does not
 * have belongs: in a 400 naming it, not in a constraint violation.
 *
 * It does carry a foreign key, which is the part a CHECK could never do: it is
 * what makes deleting a system in use impossible rather than merely discouraged.
 */
const roomsColumns = `
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    system TEXT NOT NULL REFERENCES systems(id),
    theme TEXT NOT NULL CHECK(theme IN (${themeCheckList})),
    archived INTEGER NOT NULL DEFAULT 0,
    calendar_enabled INTEGER NOT NULL DEFAULT 0,
    calendar_json TEXT,
    map_notation_enabled INTEGER NOT NULL DEFAULT 0,
    music_enabled INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER NOT NULL REFERENCES accounts(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP`;

/**
 * A combatant points at whichever of the three kinds of participant it is, and
 * the CHECK is what keeps it pointing at exactly one. Declared here rather than
 * inline so the migration that rebuilt `hireling_id` into a real foreign key
 * derives its replacement table from the same text the schema does.
 */
const encounterCombatantColumns = `
    id INTEGER PRIMARY KEY,
    encounter_id INTEGER NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('character', 'hireling', 'npc')),
    character_id INTEGER REFERENCES characters(id) ON DELETE CASCADE,
    npc_id INTEGER REFERENCES custom_npcs(id) ON DELETE CASCADE,
    hireling_id INTEGER REFERENCES group_hirelings(id) ON DELETE CASCADE,
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
    zone_id INTEGER REFERENCES encounter_zones(id) ON DELETE SET NULL,
    map_x REAL,
    map_y REAL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (
      (kind = 'character' AND character_id IS NOT NULL AND npc_id IS NULL AND hireling_id IS NULL) OR
      (kind = 'npc' AND npc_id IS NOT NULL AND character_id IS NULL AND hireling_id IS NULL) OR
      (kind = 'hireling' AND hireling_id IS NOT NULL AND character_id IS NULL AND npc_id IS NULL)
    )`;

/**
 * Portrait columns, in the shape `characters` already carries them. A hireling
 * and a ship own their picture the same way a character does, rather than
 * through a side table keyed by a string nothing enforces.
 */
const portraitColumns = `
    portrait_filename TEXT,
    portrait_stored_name TEXT,
    portrait_mime_type TEXT,
    portrait_size INTEGER`;

/**
 * Declared here rather than inline so the migration that gives `system` its
 * reference to the registry derives its replacement table from the same text
 * the schema does. `system` had no constraint of any kind before this.
 */
const charactersColumns = `
    id INTEGER PRIMARY KEY,
    system TEXT NOT NULL REFERENCES systems(id),
    owner_account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
    pool_room_id INTEGER REFERENCES rooms(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    sheet_json TEXT NOT NULL DEFAULT '{}',${portraitColumns},
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP`;

db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL COLLATE NOCASE UNIQUE,
    password_hash TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    account_role TEXT NOT NULL DEFAULT 'player' CHECK(account_role IN ('admin','gm','player')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS systems (${systemsColumns}
  );
  CREATE TABLE IF NOT EXISTS rooms (${roomsColumns}
  );
  CREATE TABLE IF NOT EXISTS memberships (
    room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK(role IN ('gm','player')),
    active_character_id INTEGER,
    PRIMARY KEY(room_id, account_id)
  );
  CREATE TABLE IF NOT EXISTS characters (${charactersColumns}
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY,
    room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    account_id INTEGER NOT NULL REFERENCES accounts(id),
    kind TEXT NOT NULL CHECK(kind IN ('chat','roll','system')),
    body TEXT NOT NULL,
    detail TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS room_easter_eggs (
    room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    egg_id TEXT NOT NULL,
    shown_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(room_id, egg_id)
  );
  CREATE TABLE IF NOT EXISTS private_rolls (
    id INTEGER PRIMARY KEY,
    room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    account_id INTEGER NOT NULL REFERENCES accounts(id),
    expression TEXT NOT NULL,
    result TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS invitations (
    id INTEGER PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    redeemed_at TEXT,
    revoked_at TEXT
  );
  CREATE TABLE IF NOT EXISTS media (
    id INTEGER PRIMARY KEY,
    room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    uploaded_by INTEGER NOT NULL REFERENCES accounts(id),
    kind TEXT NOT NULL CHECK(kind IN ('scene','reference','audio')),
    category TEXT CHECK(category IS NULL OR category IN ('map','scene','reference','audio')),
    filename TEXT NOT NULL,
    display_name TEXT,
    stored_name TEXT NOT NULL,
    artist TEXT,
    title TEXT,
    album TEXT,
    track_no INTEGER,
    metadata_loaded INTEGER NOT NULL DEFAULT 0,
    visible INTEGER NOT NULL DEFAULT 0,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS room_state (
    room_id INTEGER PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
    map_id INTEGER REFERENCES media(id) ON DELETE SET NULL,
    scene_id INTEGER REFERENCES media(id) ON DELETE SET NULL,
    audio_json TEXT NOT NULL DEFAULT '{}',
    group_json TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS map_notations (
    id INTEGER PRIMARY KEY,
    room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
    notation_json TEXT NOT NULL,
    created_by INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS revealed_references (
    room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
    removed_at TEXT,
    PRIMARY KEY(room_id, account_id, media_id)
  );
  CREATE TABLE IF NOT EXISTS table_sets (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    markdown TEXT NOT NULL,
    tags_json TEXT NOT NULL DEFAULT '[]',
    created_by INTEGER NOT NULL REFERENCES accounts(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS table_tags (
    slug TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    builtin INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS custom_npcs (
    id INTEGER PRIMARY KEY,
    room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    created_by INTEGER NOT NULL REFERENCES accounts(id),
    name TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    statblock_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS room_playlists (
    id INTEGER PRIMARY KEY,
    room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS room_playlist_tracks (
    playlist_id INTEGER NOT NULL REFERENCES room_playlists(id) ON DELETE CASCADE,
    media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(playlist_id, media_id)
  );
  CREATE INDEX IF NOT EXISTS room_playlists_room ON room_playlists (room_id, sort_order);
  CREATE TABLE IF NOT EXISTS room_items (
    id INTEGER PRIMARY KEY,
    room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL,
    list_key TEXT NOT NULL,
    item_json TEXT NOT NULL,
    created_by INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE UNIQUE INDEX IF NOT EXISTS room_items_id ON room_items (room_id, item_id);
  CREATE TABLE IF NOT EXISTS room_retired_items (
    room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL,
    retired_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(room_id, item_id)
  );
  CREATE TABLE IF NOT EXISTS group_hirelings (
    id INTEGER PRIMARY KEY,
    room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    name TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    sheet_json TEXT NOT NULL DEFAULT '{}',${portraitColumns},
    legacy_id TEXT,
    revision INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS group_assets (
    id INTEGER PRIMARY KEY,
    room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    kind TEXT NOT NULL DEFAULT 'starship',
    name TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    sheet_json TEXT NOT NULL DEFAULT '{}',${portraitColumns},
    legacy_id TEXT,
    revision INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS group_obligations (
    id INTEGER PRIMARY KEY,
    room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    name TEXT NOT NULL DEFAULT '',
    owed_to TEXT NOT NULL DEFAULT '',
    amount TEXT NOT NULL DEFAULT '',
    details TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    legacy_id TEXT,
    revision INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS group_hirelings_room ON group_hirelings (room_id, sort_order);
  CREATE INDEX IF NOT EXISTS group_assets_room ON group_assets (room_id, kind, sort_order);
  CREATE INDEX IF NOT EXISTS group_obligations_room ON group_obligations (room_id, sort_order);
  CREATE TABLE IF NOT EXISTS encounters (
    id INTEGER PRIMARY KEY,
    room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 0,
    media_id INTEGER REFERENCES media(id) ON DELETE SET NULL,
    notes TEXT NOT NULL DEFAULT '',
    individual_initiative INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER NOT NULL REFERENCES accounts(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS encounter_sides (
    encounter_id INTEGER NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
    side TEXT NOT NULL,
    initiative INTEGER,
    PRIMARY KEY (encounter_id, side)
  );
  CREATE TABLE IF NOT EXISTS encounter_zones (
    id INTEGER PRIMARY KEY,
    encounter_id INTEGER NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS encounter_combatants (${encounterCombatantColumns}
  );
  CREATE UNIQUE INDEX IF NOT EXISTS encounter_combatants_character
    ON encounter_combatants (encounter_id, character_id) WHERE character_id IS NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS encounter_combatants_hireling
    ON encounter_combatants (encounter_id, hireling_id) WHERE hireling_id IS NOT NULL;
  CREATE TABLE IF NOT EXISTS room_imports (
    id INTEGER PRIMARY KEY,
    room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    campaign_id TEXT NOT NULL,
    name TEXT NOT NULL,
    version TEXT NOT NULL DEFAULT '',
    manifest_json TEXT NOT NULL DEFAULT '{}',
    imported_by INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
    imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE UNIQUE INDEX IF NOT EXISTS room_imports_campaign ON room_imports (room_id, campaign_id);
  CREATE TABLE IF NOT EXISTS room_import_entries (
    import_id INTEGER NOT NULL REFERENCES room_imports(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    path TEXT NOT NULL,
    row_id INTEGER NOT NULL,
    source_digest TEXT NOT NULL,
    state_digest TEXT NOT NULL,
    PRIMARY KEY (import_id, kind, path)
  );
`);

/**
 * Fill the registry before anything is asked to point at it.
 *
 * A compiled system's row is written on every start, so a rename in the code
 * reaches the database and a system added to a build appears without ceremony.
 * Rows are never deleted here: a room may be on a system this build no longer
 * ships, and that room should still open.
 *
 * Any system id already recorded against a room or a character but not compiled
 * in gets a row too, retired, so that adding the foreign key below cannot fail
 * on a database whose rooms outlived their system.
 */
const upsertBuiltinSystem = db.prepare(
  `INSERT INTO systems (id, name, origin) VALUES (?, ?, 'builtin')
   ON CONFLICT(id) DO UPDATE SET name = excluded.name, origin = 'builtin', updated_at = CURRENT_TIMESTAMP`
);
for (const [id, definition] of Object.entries(builtinSystems)) upsertBuiltinSystem.run(id, definition.name);

/**
 * A system this build no longer compiles in is no longer built in.
 *
 * Databases exist that were written when Cairn, Monolith, and Cities Without
 * Number shipped inside the application, and their rows still say so. `builtin`
 * means "content lives in the repository", which for those rows is now false —
 * and `loadInstalledSystems` skips anything not marked `installed`, so the row
 * would never load however the content arrived. Its rooms would open on a system
 * that could never be restored to them.
 *
 * They are not retired here. A system with no content is already absent from the
 * choices for a new room, because the registry only offers what it could load;
 * retiring as well would mean re-installing and then remembering to restore it.
 */
const stranded = db
  .prepare(`SELECT id FROM systems WHERE origin = 'builtin'`)
  .all()
  .filter((row) => !Object.hasOwn(builtinSystems, (row as { id: string }).id)) as { id: string }[];
for (const row of stranded) {
  db.prepare("UPDATE systems SET origin = 'installed', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(row.id);
}

for (const { system } of db
  .prepare(
    `SELECT DISTINCT system FROM rooms
     UNION SELECT DISTINCT system FROM characters`
  )
  .all() as { system: string }[]) {
  db.prepare("INSERT OR IGNORE INTO systems (id, name, origin, retired) VALUES (?, ?, 'installed', 1)").run(
    system,
    system
  );
}

function hasColumn(table: string, column: string) {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((item) => item.name === column);
}

function storedSchema(table: string) {
  return one<{ sql: string }>("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?", table)?.sql ?? "";
}

function tableExists(table: string) {
  return Boolean(storedSchema(table));
}

/**
 * Rebuild `rooms` when its recorded schema is stale in any of three ways: a
 * theme added since the database was made is still rejected by the older CHECK,
 * `system` still carries a CHECK at all, or `system` does not yet point at the
 * registry.
 *
 * The system constraint is dropped rather than widened. It listed the compiled
 * systems, so every release that added one required this rebuild — and an
 * installed system could never be listed, because its id is not known until an
 * admin uploads it. What replaces it is a foreign key, which answers the
 * question the CHECK could not: whether a system may be deleted.
 *
 * Each condition is read from the stored schema, which is what makes this
 * idempotent — once the constraint is gone and the reference is there, none of
 * the three can match again.
 */
const roomsSchema =
  one<{ sql: string }>("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'rooms'")?.sql ?? "";
const roomsConstrainsSystem = /CHECK\s*\(\s*system\s+IN/i.test(roomsSchema);
const roomsReferencesSystems = /system\s+TEXT[^,]*REFERENCES\s+systems/i.test(roomsSchema);
if (
  roomsSchema &&
  (roomsConstrainsSystem || !roomsReferencesSystems || THEME_IDS.some((theme) => !roomsSchema.includes(`'${theme}'`)))
) {
  const preservedColumns = [
    "id",
    "name",
    "system",
    "theme",
    "archived",
    "calendar_enabled",
    "calendar_json",
    "map_notation_enabled",
    "music_enabled",
    "created_by",
    "created_at"
  ].filter((column) => hasColumn("rooms", column));
  db.exec("PRAGMA foreign_keys = OFF");
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`CREATE TABLE rooms_rebuilt (${roomsColumns}
    )`);
    db.exec(`INSERT INTO rooms_rebuilt (${preservedColumns.join(", ")})
             SELECT ${preservedColumns.join(", ")} FROM rooms`);
    db.exec("DROP TABLE rooms");
    db.exec("ALTER TABLE rooms_rebuilt RENAME TO rooms");
    db.exec("COMMIT");
  } catch (cause) {
    db.exec("ROLLBACK");
    throw cause;
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
}

/**
 * Give `characters.system` the same reference. It has never carried a constraint
 * of any kind, so a character could be recorded against a system that was never
 * installed and nothing would notice until its sheet failed to render.
 */
const charactersSchema = storedSchema("characters");
if (charactersSchema && !/system\s+TEXT[^,]*REFERENCES\s+systems/i.test(charactersSchema)) {
  const preservedColumns = [
    "id",
    "system",
    "owner_account_id",
    "pool_room_id",
    "name",
    "sheet_json",
    "portrait_filename",
    "portrait_stored_name",
    "portrait_mime_type",
    "portrait_size",
    "updated_at"
  ].filter((column) => hasColumn("characters", column));
  db.exec("PRAGMA foreign_keys = OFF");
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`CREATE TABLE characters_rebuilt (${charactersColumns}
    )`);
    db.exec(`INSERT INTO characters_rebuilt (${preservedColumns.join(", ")})
             SELECT ${preservedColumns.join(", ")} FROM characters`);
    db.exec("DROP TABLE characters");
    db.exec("ALTER TABLE characters_rebuilt RENAME TO characters");
    db.exec("COMMIT");
  } catch (cause) {
    db.exec("ROLLBACK");
    throw cause;
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
}

if (!hasColumn("accounts", "account_role")) {
  db.exec("ALTER TABLE accounts ADD COLUMN account_role TEXT NOT NULL DEFAULT 'player'");
  db.exec(`UPDATE accounts SET account_role = CASE
    WHEN is_admin = 1 THEN 'admin'
    WHEN EXISTS (
      SELECT 1 FROM memberships WHERE memberships.account_id = accounts.id AND memberships.role = 'gm'
    ) THEN 'gm'
    ELSE 'player'
  END`);
}

if (!hasColumn("rooms", "calendar_enabled")) {
  db.exec("ALTER TABLE rooms ADD COLUMN calendar_enabled INTEGER NOT NULL DEFAULT 0");
}
if (!hasColumn("rooms", "calendar_json")) {
  db.exec("ALTER TABLE rooms ADD COLUMN calendar_json TEXT");
}
if (!hasColumn("rooms", "map_notation_enabled")) {
  db.exec("ALTER TABLE rooms ADD COLUMN map_notation_enabled INTEGER NOT NULL DEFAULT 0");
}
if (!hasColumn("rooms", "music_enabled")) {
  db.exec("ALTER TABLE rooms ADD COLUMN music_enabled INTEGER NOT NULL DEFAULT 0");
}
if (!hasColumn("accounts", "created_by"))
  db.exec("ALTER TABLE accounts ADD COLUMN created_by INTEGER REFERENCES accounts(id) ON DELETE SET NULL");
if (!hasColumn("characters", "created_by"))
  db.exec("ALTER TABLE characters ADD COLUMN created_by INTEGER REFERENCES accounts(id) ON DELETE SET NULL");
if (!hasColumn("characters", "portrait_filename")) db.exec("ALTER TABLE characters ADD COLUMN portrait_filename TEXT");
if (!hasColumn("characters", "portrait_stored_name"))
  db.exec("ALTER TABLE characters ADD COLUMN portrait_stored_name TEXT");
if (!hasColumn("characters", "portrait_mime_type"))
  db.exec("ALTER TABLE characters ADD COLUMN portrait_mime_type TEXT");
if (!hasColumn("characters", "portrait_size")) db.exec("ALTER TABLE characters ADD COLUMN portrait_size INTEGER");
if (!hasColumn("custom_npcs", "statblock_json"))
  db.exec("ALTER TABLE custom_npcs ADD COLUMN statblock_json TEXT NOT NULL DEFAULT '{}'");
// A record cloned out of the bestiary to put something into a fight is a spawn,
// not a monster the GM wrote. It is tracked, but it does not belong in the
// bestiary beside the entries it was copied from.
if (!hasColumn("custom_npcs", "spawned"))
  db.exec("ALTER TABLE custom_npcs ADD COLUMN spawned INTEGER NOT NULL DEFAULT 0");
if (!hasColumn("media", "category")) db.exec("ALTER TABLE media ADD COLUMN category TEXT");
if (!hasColumn("media", "display_name")) db.exec("ALTER TABLE media ADD COLUMN display_name TEXT");
if (!hasColumn("media", "artist")) db.exec("ALTER TABLE media ADD COLUMN artist TEXT");
if (!hasColumn("media", "title")) db.exec("ALTER TABLE media ADD COLUMN title TEXT");
// Album and track number arrived after rooms already held music, and every one
// of those tracks is marked as read. Marking them unread sends them back
// through the tag reader once; it fills only what is missing, so an artist or a
// title the GM corrected by hand survives the second pass.
if (!hasColumn("media", "album")) {
  db.exec("ALTER TABLE media ADD COLUMN album TEXT");
  db.exec("ALTER TABLE media ADD COLUMN track_no INTEGER");
  db.exec("UPDATE media SET metadata_loaded = 0 WHERE kind = 'audio'");
}
if (!hasColumn("table_sets", "tags_json"))
  db.exec("ALTER TABLE table_sets ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]'");
// A short-lived JSON migration stored the original Markdown alongside its JSON.
// Restore that exact source where possible; JSON-only rows are serialized once
// so Markdown remains the sole active custom-table format from this point on.
if (hasColumn("table_sets", "tables_json")) {
  const hasBackup = hasColumn("table_sets", "migration_markdown");
  const oldRows = db
    .prepare(
      `SELECT id, name, tables_json, ${hasBackup ? "migration_markdown" : "NULL AS migration_markdown"}, tags_json, created_by, created_at, updated_at FROM table_sets`
    )
    .all() as {
    id: number;
    name: string;
    tables_json: string;
    migration_markdown: string | null;
    tags_json: string;
    created_by: number;
    created_at: string;
    updated_at: string;
  }[];
  db.exec("PRAGMA foreign_keys = OFF");
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`CREATE TABLE table_sets_rebuilt (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      markdown TEXT NOT NULL,
      tags_json TEXT NOT NULL DEFAULT '[]',
      created_by INTEGER NOT NULL REFERENCES accounts(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    const insert = db.prepare(
      "INSERT INTO table_sets_rebuilt (id, name, markdown, tags_json, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    for (const row of oldRows) {
      let markdown = row.migration_markdown;
      if (markdown === null) {
        const document = JSON.parse(row.tables_json) as { tables?: Parameters<typeof serializeSet>[0] };
        markdown = serializeSet(document.tables ?? [], row.name);
      }
      insert.run(row.id, row.name, markdown, row.tags_json, row.created_by, row.created_at, row.updated_at);
    }
    db.exec("DROP TABLE table_sets");
    db.exec("ALTER TABLE table_sets_rebuilt RENAME TO table_sets");
    db.exec("COMMIT");
  } catch (cause) {
    db.exec("ROLLBACK");
    throw cause;
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
}
if (!hasColumn("media", "metadata_loaded"))
  db.exec("ALTER TABLE media ADD COLUMN metadata_loaded INTEGER NOT NULL DEFAULT 0");
if (!hasColumn("media", "visible")) {
  db.exec("ALTER TABLE media ADD COLUMN visible INTEGER NOT NULL DEFAULT 0");
  db.exec(`UPDATE media SET visible = 1
    WHERE id IN (SELECT map_id FROM room_state WHERE map_id IS NOT NULL)
       OR id IN (SELECT scene_id FROM room_state WHERE scene_id IS NOT NULL)
       OR id IN (SELECT media_id FROM revealed_references WHERE removed_at IS NULL)`);
}
// What the encounter tab shows above the roster: the chosen map, or the zones
// the GM laid out. Existing encounters keep showing their image.
if (!hasColumn("encounters", "display"))
  db.exec("ALTER TABLE encounters ADD COLUMN display TEXT NOT NULL DEFAULT 'map'");
if (!hasColumn("encounter_combatants", "zone_id"))
  db.exec(
    "ALTER TABLE encounter_combatants ADD COLUMN zone_id INTEGER REFERENCES encounter_zones(id) ON DELETE SET NULL"
  );
// Coordinates are normalized against the image so a token stays in place as
// the encounter map scales from a desktop table to a phone.
if (!hasColumn("encounter_combatants", "map_x")) db.exec("ALTER TABLE encounter_combatants ADD COLUMN map_x REAL");
if (!hasColumn("encounter_combatants", "map_y")) db.exec("ALTER TABLE encounter_combatants ADD COLUMN map_y REAL");
if (!hasColumn("room_state", "map_id"))
  db.exec("ALTER TABLE room_state ADD COLUMN map_id INTEGER REFERENCES media(id)");
if (!hasColumn("room_state", "group_json"))
  db.exec("ALTER TABLE room_state ADD COLUMN group_json TEXT NOT NULL DEFAULT '{}'");

/*
 * Hirelings, ships, and obligations were array entries inside `room_state`'s
 * `group_json` blob, identified by a string the browser minted and that nothing
 * enforced. They are rows now, each with its own sheet in the shape `characters`
 * already uses. Three steps, each idempotent and each detectable from the stored
 * schema rather than from a version counter.
 */

/** One row per entry, in the order the array had them. */
function backfillGroupRows() {
  const rows = all<{ room_id: number; group_json: string }>("SELECT room_id, group_json FROM room_state");
  const record = (value: unknown) =>
    value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

  const insertHireling = db.prepare(
    `INSERT INTO group_hirelings (room_id, name, sort_order, sheet_json, legacy_id) VALUES (?, ?, ?, ?, ?)`
  );
  const insertAsset = db.prepare(
    `INSERT INTO group_assets (room_id, kind, name, sort_order, sheet_json, legacy_id) VALUES (?, 'starship', ?, ?, ?, ?)`
  );
  const insertObligation = db.prepare(
    `INSERT INTO group_obligations (room_id, name, owed_to, amount, details, sort_order, legacy_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const writeState = db.prepare("UPDATE room_state SET group_json = ? WHERE room_id = ?");

  for (const row of rows) {
    const state = record(JSON.parse(row.group_json || "{}")) ?? {};
    // Two shapes predate the arrays and are still in real databases: one ship
    // under `starship`, and the whole of a group's debt as one `groupDebt`
    // string. This is the last thing that ever has to know about either.
    const hirelings = Array.isArray(state.hirelings) ? state.hirelings : [];
    const legacyShip = record(state.starship);
    const ships = Array.isArray(state.starships)
      ? state.starships
      : legacyShip && Object.keys(legacyShip).length
        ? [{ ...legacyShip, id: "legacy-starship" }]
        : [];
    const legacyDebt = typeof state.groupDebt === "string" ? state.groupDebt.trim() : "";
    const obligations = Array.isArray(state.obligations)
      ? state.obligations
      : legacyDebt
        ? [{ id: "legacy-debt", name: "Group debt", details: legacyDebt }]
        : [];
    if (!("hirelings" in state) && !ships.length && !obligations.length && !("starship" in state)) {
      if (!("groupDebt" in state)) continue;
    }

    hirelings.forEach((entry, index) => {
      const hireling = record(entry);
      if (!hireling) return;
      const { id, name, ...sheet } = hireling;
      insertHireling.run(
        row.room_id,
        String(name ?? ""),
        index,
        JSON.stringify(sheet),
        String(id || `hireling-${index + 1}`)
      );
    });
    ships.forEach((entry, index) => {
      const ship = record(entry);
      if (!ship) return;
      const { id, name, ...sheet } = ship;
      insertAsset.run(
        row.room_id,
        String(name ?? ""),
        index,
        JSON.stringify(sheet),
        String(id || `starship-${index + 1}`)
      );
    });
    obligations.forEach((entry, index) => {
      const obligation = record(entry);
      if (!obligation) return;
      insertObligation.run(
        row.room_id,
        String(obligation.name ?? ""),
        String(obligation.owedTo ?? ""),
        String(obligation.amount ?? ""),
        String(obligation.details ?? ""),
        index,
        String(obligation.id || `obligation-${index + 1}`)
      );
    });

    // Stripping the moved keys is what makes this idempotent: a second run finds
    // nothing left to move, so it cannot duplicate a roster.
    const { hirelings: _h, starships: _s, starship: _ss, obligations: _o, groupDebt: _d, ...kept } = state;
    writeState.run(JSON.stringify(kept), row.room_id);
  }
}

// Detected by the blob still holding one of the keys. Old rows keep them until
// they are moved; a database created today has none and does no work.
const blobsToMove =
  one<{ count: number }>(
    `SELECT COUNT(*) AS count FROM room_state
      WHERE group_json LIKE '%"hirelings"%' OR group_json LIKE '%"starships"%' OR group_json LIKE '%"starship"%'
         OR group_json LIKE '%"obligations"%' OR group_json LIKE '%"groupDebt"%'`
  )?.count ?? 0;
if (blobsToMove) {
  db.exec("BEGIN IMMEDIATE");
  try {
    backfillGroupRows();
    db.exec("COMMIT");
  } catch (cause) {
    db.exec("ROLLBACK");
    throw cause;
  }
}

/**
 * Portraits move onto the rows they belong to, and the side tables go. Their
 * absence from `sqlite_master` is what says this has run.
 */
for (const [table, target, key] of [
  ["hireling_images", "group_hirelings", "hireling_id"],
  ["starship_images", "group_assets", "starship_id"]
] as const) {
  if (!tableExists(table)) continue;
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`UPDATE ${target} SET
      portrait_filename = (SELECT filename FROM ${table} i WHERE i.room_id = ${target}.room_id AND i.${key} = ${target}.legacy_id),
      portrait_stored_name = (SELECT stored_name FROM ${table} i WHERE i.room_id = ${target}.room_id AND i.${key} = ${target}.legacy_id),
      portrait_mime_type = (SELECT mime_type FROM ${table} i WHERE i.room_id = ${target}.room_id AND i.${key} = ${target}.legacy_id),
      portrait_size = (SELECT size FROM ${table} i WHERE i.room_id = ${target}.room_id AND i.${key} = ${target}.legacy_id)
      WHERE EXISTS (SELECT 1 FROM ${table} i WHERE i.room_id = ${target}.room_id AND i.${key} = ${target}.legacy_id)`);
    db.exec(`DROP TABLE ${table}`);
    db.exec("COMMIT");
  } catch (cause) {
    db.exec("ROLLBACK");
    throw cause;
  }
}

/*
 * `encounter_combatants.hireling_id` was a bare TEXT column naming a string in
 * the blob, with no foreign key and nothing to stop it outliving what it named.
 * It becomes an integer reference that cascades. Changing a column's type, its
 * CHECK, and its foreign key all at once is the rooms-style rebuild.
 */
if (
  tableExists("encounter_combatants") &&
  !storedSchema("encounter_combatants").includes("REFERENCES group_hirelings")
) {
  const preserved = [
    "id",
    "encounter_id",
    "kind",
    "character_id",
    "npc_id",
    "name",
    "side",
    "initiative",
    "acts_first_turn",
    "sort_order",
    "hp_current",
    "hp_max",
    "statblock_json",
    "conditions",
    "included",
    "zone_id",
    "map_x",
    "map_y",
    "created_at",
    "updated_at"
  ].filter((column) => hasColumn("encounter_combatants", column));
  db.exec("PRAGMA foreign_keys = OFF");
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`CREATE TABLE encounter_combatants_rebuilt (${encounterCombatantColumns}
    )`);
    // A combatant whose hireling no longer resolves is dropped rather than
    // carried across. It was already invisible: the encounter view scanned the
    // blob for its id and skipped it when nothing answered.
    db.exec(`INSERT INTO encounter_combatants_rebuilt (${preserved.join(", ")}, hireling_id)
             SELECT ${preserved.map((column) => `c.${column}`).join(", ")},
                    CASE WHEN c.kind = 'hireling' THEN (
                      SELECT h.id FROM group_hirelings h
                       JOIN encounters e ON e.id = c.encounter_id
                       WHERE h.room_id = e.room_id AND h.legacy_id = c.hireling_id
                    ) END
               FROM encounter_combatants c
              WHERE c.kind <> 'hireling' OR EXISTS (
                    SELECT 1 FROM group_hirelings h
                     JOIN encounters e ON e.id = c.encounter_id
                     WHERE h.room_id = e.room_id AND h.legacy_id = c.hireling_id)`);
    db.exec("DROP TABLE encounter_combatants");
    db.exec("ALTER TABLE encounter_combatants_rebuilt RENAME TO encounter_combatants");
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS encounter_combatants_character
               ON encounter_combatants (encounter_id, character_id) WHERE character_id IS NOT NULL`);
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS encounter_combatants_hireling
               ON encounter_combatants (encounter_id, hireling_id) WHERE hireling_id IS NOT NULL`);
    db.exec("COMMIT");
  } catch (cause) {
    db.exec("ROLLBACK");
    throw cause;
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
}

// These tables arrived with the roster migration, so only a database made
// between that change and this one lacks the counter that replaced comparing
// timestamps a second apart.
for (const table of ["group_hirelings", "group_assets", "group_obligations"])
  if (!hasColumn(table, "revision")) db.exec(`ALTER TABLE ${table} ADD COLUMN revision INTEGER NOT NULL DEFAULT 0`);

// The tag vocabulary is editable, so the tags shipped with the application are
// seeded rather than fixed. Ignoring a conflict leaves a tag that has since been
// relabelled exactly as the instance renamed it.
const seedTableTag = db.prepare(
  "INSERT OR IGNORE INTO table_tags (slug, label, builtin, sort_order) VALUES (?, ?, 1, ?)"
);
BUILTIN_TABLE_TAGS.forEach((slug, position) => seedTableTag.run(slug, defaultTagLabel(slug), position));

// A tag added to the application after a database was made would otherwise take
// its new position while the tags already there kept their old ones, leaving the
// vocabulary interleaved. Position is presentation only, so it is safe to
// restate: built-ins sit where they are declared, and anything this instance
// added keeps its own order after them.
const placeBuiltinTag = db.prepare("UPDATE table_tags SET sort_order = ? WHERE slug = ? AND sort_order <> ?");
BUILTIN_TABLE_TAGS.forEach((slug, position) => placeBuiltinTag.run(position, slug, position));
db.prepare("UPDATE table_tags SET sort_order = sort_order + ? WHERE builtin = 0 AND sort_order < ?").run(
  BUILTIN_TABLE_TAGS.length,
  BUILTIN_TABLE_TAGS.length
);

export function one<T>(sql: string, ...params: (string | number | bigint | null | Uint8Array)[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}

export function all<T>(sql: string, ...params: (string | number | bigint | null | Uint8Array)[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}
