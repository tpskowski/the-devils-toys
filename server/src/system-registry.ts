import type { SystemId } from "@devils-toys/shared";
import { all, db, one } from "./db.js";
import { isBuiltinSystem } from "./builtin-systems.js";
import { logger } from "./logger.js";
import { forgetInstalledCatalogs } from "./character-items.js";
import { forgetSetJson } from "./table-json.js";
import { forgetStarshipParts } from "./starship-parts.js";
import { forgetLinkedRules, hasSystem, registerSystem, unregisterSystem } from "./systems.js";
import { forgetSystemTables } from "./table-sets.js";
import { installedSystemIds, readInstalledSystem, verifySystemTables } from "./system-install.js";

/**
 * The database's account of what this server has, and the bridge between it and
 * the in-memory registry that every request reads.
 *
 * The row is the record; the registry is the working copy. They are brought into
 * step on start and again on every install, so a system added a minute ago is
 * usable without a restart — which matters more than it sounds, because an admin
 * who has to restart to finish installing will restart at the wrong moment.
 */

export interface SystemRow {
  id: string;
  name: string;
  origin: "builtin" | "installed";
  retired: number;
  manifest_json: string;
  installed_by: number | null;
  installed_at: string;
  updated_at: string;
}

export function systemRows(): SystemRow[] {
  return all<SystemRow>("SELECT * FROM systems ORDER BY origin, id");
}

export function systemRow(system: SystemId) {
  return one<SystemRow>("SELECT * FROM systems WHERE id = ?", system);
}

/** How many rooms and characters would be orphaned by removing a system. */
export function systemUsage(system: SystemId) {
  return {
    rooms: one<{ count: number }>("SELECT COUNT(*) AS count FROM rooms WHERE system = ?", system)?.count ?? 0,
    characters: one<{ count: number }>("SELECT COUNT(*) AS count FROM characters WHERE system = ?", system)?.count ?? 0
  };
}

export function roomNamesOn(system: SystemId, limit = 5) {
  return all<{ name: string }>("SELECT name FROM rooms WHERE system = ? ORDER BY name LIMIT ?", system, limit).map(
    (row) => row.name
  );
}

/**
 * Drops everything remembered about a system's content. Four caches assume a
 * system's files cannot change, which was true while every system was compiled
 * in and is not any more.
 */
export function forgetSystemContent(system: SystemId) {
  forgetSetJson(system);
  forgetStarshipParts(system);
  forgetLinkedRules(system);
  forgetSystemTables(system);
  forgetInstalledCatalogs(system);
}

/** Puts an installed system into the working registry, replacing what was there. */
export function loadInstalledSystem(system: SystemId) {
  const definition = readInstalledSystem(system);
  if (definition.id !== system) throw new Error(`${system}/system.json calls itself "${definition.id}".`);
  // Do this before touching caches or the registry: a malformed replacement
  // must leave the currently loaded definition usable.
  verifySystemTables(system, definition);
  forgetSystemContent(system);
  registerSystem(definition);
  return definition;
}

/**
 * Registers every installed system on start.
 *
 * A system whose content will not load is logged and left out rather than
 * stopping the server: one bad bundle should not take down a host running three
 * good ones, and its rooms are still readable because the registry row remains.
 */
export function loadInstalledSystems() {
  const onDisk = new Set(installedSystemIds());
  for (const row of systemRows()) {
    if (row.origin !== "installed") continue;
    if (!onDisk.has(row.id)) {
      logger.warn("System recorded but not on disk", { system: row.id });
      continue;
    }
    try {
      loadInstalledSystem(row.id);
    } catch (cause) {
      logger.error("Installed system could not be loaded", {
        system: row.id,
        error: cause instanceof Error ? cause.message : String(cause)
      });
    }
  }
  // Content with no row is content an interrupted install left behind, or a
  // directory dropped in by hand. Neither is a system this server offers.
  for (const id of onDisk) if (!systemRow(id)) logger.warn("System content has no registry row", { system: id });
}

/**
 * Brings a second process's registry up to date with the database.
 *
 * The Devil's Tables runs on its own port against the same database and builds
 * its registry once, at start. That was harmless while every system was compiled
 * in — both processes had the same three, always. Now that an admin installs one
 * into a running server, the editor would go on listing what it had at start
 * until someone restarted it.
 *
 * The check is a count and the latest timestamp, so the common case costs one
 * cheap query and the reload only happens when the registry has actually moved.
 */
let registrySignature = "";

export function refreshInstalledSystems() {
  const row = one<{ count: number; latest: string | null }>(
    "SELECT COUNT(*) AS count, MAX(updated_at) AS latest FROM systems"
  );
  const signature = `${row?.count ?? 0}:${row?.latest ?? ""}`;
  if (signature === registrySignature) return false;
  registrySignature = signature;
  loadInstalledSystems();
  return true;
}

export function recordInstalledSystem(input: { id: string; name: string; manifest: unknown; installedBy: number }) {
  db.prepare(
    `INSERT INTO systems (id, name, origin, retired, manifest_json, installed_by)
     VALUES (?, ?, 'installed', 0, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       -- Also the origin. A row left over from when this system shipped inside
       -- the application still says 'builtin', and installing over it without
       -- correcting that would work until the next restart and then stop:
       -- 'loadInstalledSystems' only loads what is marked installed.
       origin = 'installed',
       manifest_json = excluded.manifest_json,
       installed_by = excluded.installed_by,
       updated_at = CURRENT_TIMESTAMP`
  ).run(input.id, input.name, JSON.stringify(input.manifest), input.installedBy);
}

export function setSystemRetired(system: SystemId, retired: boolean) {
  db.prepare("UPDATE systems SET retired = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(
    retired ? 1 : 0,
    system
  );
}

export function deleteSystemRow(system: SystemId) {
  db.prepare("DELETE FROM systems WHERE id = ?").run(system);
}

/**
 * The systems a new room may be created on: everything registered and not
 * retired. A retired system keeps working for the rooms already on it, which is
 * the whole difference between retiring one and deleting it.
 */
export function offeredSystemIds(): SystemId[] {
  return systemRows()
    .filter((row) => !row.retired && hasSystem(row.id))
    .map((row) => row.id);
}

export function isSystemOffered(system: SystemId) {
  const row = systemRow(system);
  return Boolean(row && !row.retired && hasSystem(system));
}

/** Takes an installed system back out of the working registry. */
export function unloadSystem(system: SystemId) {
  if (isBuiltinSystem(system)) return false;
  forgetSystemContent(system);
  return unregisterSystem(system);
}
