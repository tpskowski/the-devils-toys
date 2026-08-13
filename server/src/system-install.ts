import fs from "node:fs";
import path from "node:path";
import type { GameSystem, SystemId } from "@devils-toys/shared";
import { config } from "./config.js";
import { isBuiltinSystem } from "./builtin-systems.js";
import { installedSystemRoot, systemRulesFile, systemTablesJsonFile } from "./system-content.js";
import { readItemCatalog } from "./item-catalog.js";
import { readTraitCatalog } from "./trait-catalog.js";
import { systemOrThrow } from "./systems.js";
import { gameSystemSchema } from "./system-schema.js";
import { buildSystemBundle, readSystemBundle, renameSystem, type SystemBundleContent } from "./system-bundles.js";
import { parseSetJson, readSetJson } from "./table-json.js";

/**
 * Putting a bundle on disk and taking one back off it.
 *
 * The write is staged and then renamed, so a bundle that fails halfway leaves
 * nothing behind and never half-replaces a system a room is in the middle of
 * using. Everything a bundle carries has already been validated in memory by
 * `readSystemBundle` before any of this runs.
 */

/** Reads everything a registered system is made of, ready to be bundled. */
export function systemContentFor(system: SystemId): SystemBundleContent {
  const definition = systemOrThrow(system);
  const rules: Record<string, string> = {};
  const tables: Record<string, string> = {};
  for (const source of definition.sourceDocuments) {
    rules[source.markdownFile] = fs.readFileSync(systemRulesFile(system, source.markdownFile), "utf8");
    // The corrections ledger travels with the book it corrects, since a bundle
    // that dropped it would lose the record of what was repaired and why.
    if (source.correctionsFile) {
      const file = systemRulesFile(system, source.correctionsFile);
      if (fs.existsSync(file)) rules[source.correctionsFile] = fs.readFileSync(file, "utf8");
    }
    if (source.tablesFile)
      tables[source.tablesFile] = fs.readFileSync(systemTablesJsonFile(system, source.tablesFile), "utf8");
  }
  return {
    system: definition,
    items: readItemCatalog(system),
    traits: readTraitCatalog(system),
    rules,
    tables
  };
}

export interface ExportOptions {
  /** Write the bundle under a different id, rewriting everything namespaced by the old one. */
  as?: string;
  /** A name for the renamed system, so the two are distinguishable in a picker. */
  name?: string;
}

export function exportSystemBundle(system: SystemId, options: ExportOptions = {}): Uint8Array {
  const content = systemContentFor(system);
  return buildSystemBundle(options.as ? renameSystem(content, options.as, options.name) : content);
}

export interface InstallResult {
  system: SystemId;
  name: string;
  /** True when a system of this id was already installed and has been replaced. */
  replaced: boolean;
  licenses: string[];
}

/**
 * Checks a bundle against what this server can actually do with it, beyond what
 * the schema can see on its own. Each of these is a message an author can act
 * on, which is why they are separate rather than one "invalid bundle".
 */
export function refuseUninstallableBundle(bundle: ReturnType<typeof readSystemBundle>) {
  const { system } = bundle;

  if (isBuiltinSystem(system.id))
    throw new Error(`"${system.id}" is a system this application ships. Give the bundle another id.`);

  const listKeys = system.characterSheet.lists.map((list) => list.key);
  const duplicate = listKeys.find((key, index) => listKeys.indexOf(key) !== index);
  if (duplicate) throw new Error(`The sheet declares two lists called "${duplicate}".`);

  const statblockKeys = new Set(system.npcStatblock.fields.map((field) => field.key));
  if (!statblockKeys.has(system.npcStatblock.hitPointsKey))
    throw new Error(
      `npcStatblock.hitPointsKey is "${system.npcStatblock.hitPointsKey}", which is not one of its declared fields.`
    );
  if (system.npcStatblock.armorKey && !statblockKeys.has(system.npcStatblock.armorKey))
    throw new Error(`npcStatblock.armorKey is "${system.npcStatblock.armorKey}", which is not one of its fields.`);

  // A warning rule naming a field nothing writes can never fire, which is a
  // silent failure rather than a loud one — so it is refused at the door.
  const sheetKeys = new Set([
    ...system.characterSheet.sections.flatMap((section) => section.fields.map((field) => field.key)),
    ...listKeys
  ]);
  for (const rule of system.warningRules) {
    const referenced =
      rule.kind === "list-occupancy" ? [rule.listKey] : [rule.key, ...("against" in rule ? [rule.against] : [])];
    for (const key of referenced)
      if (!sheetKeys.has(key))
        throw new Error(`A warning rule reads "${key}", which is not a field or list the sheet declares.`);
  }

  const documentIds = new Set(system.sourceDocuments.map((source) => source.id));
  for (const module of system.contentModules)
    if (!documentIds.has(module.sourceDocumentId))
      throw new Error(
        `Content module "${module.id}" names source document "${module.sourceDocumentId}", which the bundle does not have.`
      );
}

/**
 * Writes a validated bundle into the data directory.
 *
 * Staged under a sibling directory and renamed into place, so an interrupted
 * install leaves the previous content untouched rather than a half-written
 * system that would fail to load on the next start.
 */
export function writeSystemBundle(bundle: ReturnType<typeof readSystemBundle>): InstallResult {
  const { system, items, traits, rules, tables } = bundle;
  const root = installedSystemRoot(system.id);
  const staging = `${root}.incoming`;
  const retired = `${root}.replaced`;

  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(path.join(staging, "rules"), { recursive: true });
  fs.mkdirSync(path.join(staging, "tables"), { recursive: true });

  try {
    fs.writeFileSync(path.join(staging, "system.json"), `${JSON.stringify(system, null, 2)}\n`);
    fs.writeFileSync(path.join(staging, "items.json"), `${JSON.stringify(items, null, 2)}\n`);
    fs.writeFileSync(path.join(staging, "traits.json"), `${JSON.stringify(traits, null, 2)}\n`);
    for (const [name, markdown] of Object.entries(rules)) fs.writeFileSync(path.join(staging, "rules", name), markdown);
    for (const [name, json] of Object.entries(tables)) fs.writeFileSync(path.join(staging, "tables", name), json);

    const replaced = fs.existsSync(root);
    if (replaced) {
      fs.rmSync(retired, { recursive: true, force: true });
      fs.renameSync(root, retired);
    }
    try {
      fs.renameSync(staging, root);
    } catch (error) {
      if (replaced && fs.existsSync(retired)) {
        try {
          fs.renameSync(retired, root);
        } catch {
          // Keep the install error: it is the failure the caller can act on.
        }
      }
      throw error;
    }
    fs.rmSync(retired, { recursive: true, force: true });
    return {
      system: system.id,
      name: system.name,
      replaced,
      licenses: [...new Set(system.sourceDocuments.map((source) => source.license))]
    };
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

/** Removes an installed system's content. A built-in has none of its own to remove. */
export function removeSystemContent(system: SystemId) {
  if (isBuiltinSystem(system)) return false;
  const root = installedSystemRoot(system);
  if (!fs.existsSync(root)) return false;
  fs.rmSync(root, { recursive: true, force: true });
  return true;
}

/** Every system whose content is on disk under the data directory. */
export function installedSystemIds(): string[] {
  const root = path.join(config.dataDir, "systems");
  if (!fs.existsSync(root)) return [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.endsWith(".replaced")) continue;
    const system = entry.name.slice(0, -".replaced".length);
    const destination = path.join(root, system);
    if (!fs.existsSync(destination)) fs.renameSync(path.join(root, entry.name), destination);
  }
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.includes("."))
    .map((entry) => entry.name);
}

/**
 * Reads an installed system's definition back off disk, through the same schema
 * an upload goes through. A file edited by hand between restarts is no more
 * trusted than one that arrived over HTTP.
 */
export function readInstalledSystem(system: SystemId): GameSystem {
  const file = path.join(installedSystemRoot(system), "system.json");
  const result = gameSystemSchema.safeParse(JSON.parse(fs.readFileSync(file, "utf8")) as unknown);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(`${file} is not a valid system — ${issue.path.join(".")}: ${issue.message}`);
  }
  return result.data as GameSystem;
}

/**
 * Confirms a system's tables parse, which `readSetJson` is the authority on.
 * Run at install time so a malformed set is a rejected upload rather than a
 * table that fails to roll at the worst moment.
 */
export function verifySystemTables(system: SystemId, definition: GameSystem, tables?: Record<string, string>) {
  for (const source of definition.sourceDocuments) {
    if (!source.tablesFile) continue;
    if (tables) {
      const table = tables[source.tablesFile];
      if (table === undefined) throw new Error(`The bundle names tables/${source.tablesFile} but does not contain it.`);
      parseSetJson(table, source.tablesFile);
    } else {
      readSetJson(system, source.tablesFile);
    }
  }
}
