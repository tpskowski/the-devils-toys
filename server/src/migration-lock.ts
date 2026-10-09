import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/** Serialize schema inspection and mutation across the game and table servers. */
export function withMigrationLock<T>(dataDir: string, migrate: () => T): T {
  // A separate SQLite file leaves migrations free to use their own transactions
  // and toggle foreign_keys outside them. SQLite releases this lock on a crash;
  // never unlink the file, which could let another process lock a different inode.
  const lock = new DatabaseSync(path.join(dataDir, "migration-lock.sqlite"));
  try {
    lock.exec("PRAGMA busy_timeout = 30000; BEGIN IMMEDIATE");
    return migrate();
  } finally {
    // No data is stored here. Closing rolls back the reservation on every path.
    lock.close();
  }
}
