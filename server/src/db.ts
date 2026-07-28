import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { THEME_IDS } from "@devils-toys/shared";
import { config } from "./config.js";

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(path.join(config.dataDir, "uploads"), { recursive: true });
fs.mkdirSync(path.join(config.dataDir, "logs"), { recursive: true });

export const db = new DatabaseSync(path.join(config.dataDir, "devils-toys.sqlite"));
db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");

const themeCheckList = THEME_IDS.map((theme) => `'${theme}'`).join(",");
const roomsColumns = `
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    system TEXT NOT NULL CHECK(system IN ('cairn','monolith')),
    theme TEXT NOT NULL CHECK(theme IN (${themeCheckList})),
    archived INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER NOT NULL REFERENCES accounts(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP`;

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
  CREATE TABLE IF NOT EXISTS rooms (${roomsColumns}
  );
  CREATE TABLE IF NOT EXISTS memberships (
    room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK(role IN ('gm','player')),
    active_character_id INTEGER,
    PRIMARY KEY(room_id, account_id)
  );
  CREATE TABLE IF NOT EXISTS characters (
    id INTEGER PRIMARY KEY,
    system TEXT NOT NULL,
    owner_account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
    pool_room_id INTEGER REFERENCES rooms(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    sheet_json TEXT NOT NULL DEFAULT '{}',
    portrait_filename TEXT,
    portrait_stored_name TEXT,
    portrait_mime_type TEXT,
    portrait_size INTEGER,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
    created_by INTEGER NOT NULL REFERENCES accounts(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS custom_npcs (
    id INTEGER PRIMARY KEY,
    room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    created_by INTEGER NOT NULL REFERENCES accounts(id),
    name TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

function hasColumn(table: string, column: string) {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((item) => item.name === column);
}

// A theme added after a database was created is still rejected by the older CHECK
// constraint, so rebuild rooms whenever its recorded schema is missing a theme.
const roomsSchema =
  one<{ sql: string }>("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'rooms'")?.sql ?? "";
if (roomsSchema && THEME_IDS.some((theme) => !roomsSchema.includes(`'${theme}'`))) {
  db.exec("PRAGMA foreign_keys = OFF");
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`CREATE TABLE rooms_rebuilt (${roomsColumns}
    )`);
    db.exec(
      `INSERT INTO rooms_rebuilt (id, name, system, theme, archived, created_by, created_at)
       SELECT id, name, system, theme, archived, created_by, created_at FROM rooms`
    );
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
if (!hasColumn("media", "category")) db.exec("ALTER TABLE media ADD COLUMN category TEXT");
if (!hasColumn("media", "display_name")) db.exec("ALTER TABLE media ADD COLUMN display_name TEXT");
if (!hasColumn("media", "artist")) db.exec("ALTER TABLE media ADD COLUMN artist TEXT");
if (!hasColumn("media", "title")) db.exec("ALTER TABLE media ADD COLUMN title TEXT");
if (!hasColumn("media", "metadata_loaded"))
  db.exec("ALTER TABLE media ADD COLUMN metadata_loaded INTEGER NOT NULL DEFAULT 0");
if (!hasColumn("media", "visible")) {
  db.exec("ALTER TABLE media ADD COLUMN visible INTEGER NOT NULL DEFAULT 0");
  db.exec(`UPDATE media SET visible = 1
    WHERE id IN (SELECT map_id FROM room_state WHERE map_id IS NOT NULL)
       OR id IN (SELECT scene_id FROM room_state WHERE scene_id IS NOT NULL)
       OR id IN (SELECT media_id FROM revealed_references WHERE removed_at IS NULL)`);
}
if (!hasColumn("room_state", "map_id"))
  db.exec("ALTER TABLE room_state ADD COLUMN map_id INTEGER REFERENCES media(id)");
if (!hasColumn("room_state", "group_json"))
  db.exec("ALTER TABLE room_state ADD COLUMN group_json TEXT NOT NULL DEFAULT '{}'");

export function one<T>(sql: string, ...params: (string | number | bigint | null | Uint8Array)[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}

export function all<T>(sql: string, ...params: (string | number | bigint | null | Uint8Array)[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}
