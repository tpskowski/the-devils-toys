import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it } from "vitest";
import { withMigrationLock } from "./migration-lock.js";

const directories: string[] = [];
type MigrationProcess = {
  child: ReturnType<typeof spawn>;
  messages: string[];
  exited: Promise<{ code: number | null; errors: string }>;
  release: () => void;
};
const children: MigrationProcess[] = [];
function dataDir() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "devils-startup-"));
  directories.push(directory);
  return directory;
}

/** Pause a real migration after its column check, before its ALTER TABLE. */
function startMigration(directory: string, name: string): MigrationProcess {
  const release = path.join(directory, `${name}.release`);
  const messages: string[] = [];
  let errors = "";
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "--eval",
      `
        import fs from "node:fs";
        import { DatabaseSync } from "node:sqlite";
        const exec = DatabaseSync.prototype.exec;
        let starting = true;
        DatabaseSync.prototype.exec = function(sql) {
          if (starting && sql.includes("busy_timeout")) {
            starting = false;
            process.send("starting");
          }
          return exec.call(this, sql);
        };
        const prepare = DatabaseSync.prototype.prepare;
        let paused = false;
        DatabaseSync.prototype.prepare = function(sql) {
          const statement = prepare.call(this, sql);
          if (sql === "PRAGMA table_info(accounts)") {
            const all = statement.all.bind(statement);
            statement.all = (...args) => {
              const rows = all(...args);
              if (!paused && !rows.some(row => row.name === "created_by")) {
                paused = true;
                process.send("checked-missing-column");
                const wait = new Int32Array(new SharedArrayBuffer(4));
                while (!fs.existsSync(process.argv[1])) Atomics.wait(wait, 0, 0, 10);
              }
              return rows;
            };
          }
          return statement;
        };
        const { db } = await import(process.argv[2]);
        db.close();
        process.disconnect();
      `,
      release,
      new URL("./db.ts", import.meta.url).href
    ],
    { env: { ...process.env, DEVILS_TOYS_DATA_DIR: directory }, stdio: ["ignore", "ignore", "pipe", "ipc"] }
  );
  child.on("message", (message) => messages.push(String(message)));
  child.stderr!.setEncoding("utf8").on("data", (chunk) => {
    errors += chunk;
  });
  const exited = new Promise<{ code: number | null; errors: string }>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, errors }));
  });
  const processState = { child, messages, exited, release: () => fs.writeFileSync(release, "") };
  children.push(processState);
  return processState;
}

afterEach(async () => {
  for (const { child } of children) if (child.exitCode === null) child.kill();
  await Promise.all(children.splice(0).map(({ exited }) => exited));
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

it.each([false, true])(
  "serializes simultaneous startup before checking columns (existing=%s)",
  async (existing) => {
    const directory = dataDir();
    if (existing) {
      const legacy = new DatabaseSync(path.join(directory, "devils-toys.sqlite"));
      legacy.exec(`CREATE TABLE accounts (
      id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
      is_admin INTEGER NOT NULL DEFAULT 0, account_role TEXT NOT NULL DEFAULT 'player',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    ); INSERT INTO accounts (id, username, password_hash, is_admin, account_role)
       VALUES (1, 'Owner', 'preserved-hash', 1, 'admin');`);
      legacy.close();
    }
    const first = startMigration(directory, "first");
    await expect.poll(() => first.messages).toContain("checked-missing-column");
    const second = startMigration(directory, "second");
    await expect.poll(() => second.messages).toContain("starting");
    // The second process has reached database initialization. Give it a chance to
    // expose an unprotected read while the first deliberately holds that gap open.
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(second.messages).not.toContain("checked-missing-column");
    first.release();
    expect(await first.exited).toEqual({ code: 0, errors: expect.any(String) });
    expect(await second.exited).toEqual({ code: 0, errors: expect.any(String) });

    const result = new DatabaseSync(path.join(directory, "devils-toys.sqlite"));
    try {
      expect(
        result
          .prepare("PRAGMA table_info(accounts)")
          .all()
          .filter((row) => row.name === "created_by")
      ).toHaveLength(1);
      expect(result.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
      expect(result.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      if (existing)
        expect(result.prepare("SELECT username, password_hash FROM accounts WHERE id=1").get()).toEqual({
          username: "Owner",
          password_hash: "preserved-hash"
        });
    } finally {
      result.close();
    }
  },
  15000
);

it("allows another startup after a process exits while holding the migration lock", async () => {
  const directory = dataDir();
  const first = startMigration(directory, "first");
  await expect.poll(() => first.messages).toContain("checked-missing-column");
  const second = startMigration(directory, "second");
  second.release();
  await expect.poll(() => second.messages).toContain("starting");
  first.child.kill();
  await first.exited;
  expect(await second.exited).toEqual({ code: 0, errors: expect.any(String) });
}, 15000);

it("releases the migration lock when initialization throws", () => {
  const directory = dataDir();
  expect(() =>
    withMigrationLock(directory, () => {
      throw new Error("failed migration");
    })
  ).toThrow("failed migration");
  const probe = new DatabaseSync(path.join(directory, "migration-lock.sqlite"));
  try {
    expect(() => probe.exec("PRAGMA busy_timeout=0; BEGIN IMMEDIATE; ROLLBACK")).not.toThrow();
  } finally {
    probe.close();
  }
});
