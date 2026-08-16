import fs from "node:fs";
import type { GameSystem } from "@devils-toys/shared";
import { db } from "./db.js";
import { readSystemRepoDirectory } from "./system-repo.js";
import { writeSystemBundle } from "./system-install.js";
import { installedSystemRoot } from "./system-content.js";
import { hasSystem, registerSystem } from "./systems.js";
import { projectFile } from "./paths.js";

/**
 * The system the test suite runs on.
 *
 * This repository ships no game system, so its tests cannot borrow one. `toybox`
 * is a system written for exactly this: small enough to read in a minute, and
 * complete enough that a room, a character, a rolled table, a gear catalogue,
 * and a parsed statblock all have something real behind them.
 *
 * It is installed rather than injected. A test that wants a system gets one the
 * way a server gets one — unpacked below the data directory and registered —
 * which means the install path is exercised by every test that needs a system
 * rather than only by the tests that are about installing.
 */

export const TOYBOX = "toybox";

export const toyboxRepo = () => projectFile("fixtures", "toybox");

/**
 * Installs the fixture into this test file's data directory, registers it, and
 * records it in the registry table so a room may reference it — `rooms.system`
 * is a foreign key, so a test that inserts a room needs the row to exist first.
 *
 * Idempotent, so a `beforeAll` in a file whose helpers also call it is fine.
 */
export function installToybox(): GameSystem {
  const repo = readSystemRepoDirectory(toyboxRepo());
  if (!hasSystem(repo.system.id) || !fs.existsSync(installedSystemRoot(repo.system.id))) {
    writeSystemBundle(repo);
    registerSystem(repo.system);
  }
  db.prepare(
    `INSERT INTO systems (id, name, origin, retired, manifest_json)
     VALUES (?, ?, 'installed', 0, '{}')
     ON CONFLICT(id) DO NOTHING`
  ).run(repo.system.id, repo.system.name);
  return repo.system;
}

/** The fixture's definition, without installing its content. */
export function toyboxDefinition(): GameSystem {
  return readSystemRepoDirectory(toyboxRepo()).system;
}
