import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import { z } from "zod";
import {
  SYSTEM_ID_PATTERN,
  type GameSystem,
  type SystemItemCatalog,
  type SystemTraitCatalog
} from "@devils-toys/shared";
import { gameSystemSchema } from "./system-schema.js";
import { config } from "./config.js";

/**
 * An installable system: one zip of JSON and Markdown, and nothing else.
 *
 * Everything in here is data. Nothing read from a bundle is evaluated, imported,
 * or executed — the whole reason `characterWarnings` became `warningRules` was
 * so that a system could be described rather than programmed. A bundle that
 * contained JavaScript would simply have a file nothing reads.
 *
 * The layout:
 *
 *     manifest.json      what this is, and which system
 *     system.json        the GameSystem, as data
 *     items.json         the gear catalogue
 *     traits.json        what its weapon words mean
 *     rules/<file>.md    every file a sourceDocument names
 *     tables/<file>.json its extracted tables
 */

export const SYSTEM_BUNDLE_VERSION = 1;
export const SYSTEM_BUNDLE_APP = "devils-toys-system";

export interface SystemBundleManifest {
  bundleVersion: number;
  app: typeof SYSTEM_BUNDLE_APP;
  systemId: string;
  systemName: string;
  exportedAt: string;
  /** What the source documents say they are covered by, for the credits page. */
  licenses: string[];
}

export interface SystemBundle {
  manifest: SystemBundleManifest;
  system: GameSystem;
  items: SystemItemCatalog;
  traits: SystemTraitCatalog;
  /** Markdown by the filename a source document names. */
  rules: Record<string, string>;
  /** Table set JSON by filename, unparsed — `readSetJson` validates it on read. */
  tables: Record<string, string>;
}

export interface SystemBundleContent {
  system: GameSystem;
  items: SystemItemCatalog;
  traits: SystemTraitCatalog;
  rules: Record<string, string>;
  tables: Record<string, string>;
}

const manifestSchema = z.object({
  bundleVersion: z.number().int().positive(),
  app: z.literal(SYSTEM_BUNDLE_APP),
  systemId: z.string(),
  systemName: z.string(),
  exportedAt: z.string(),
  licenses: z.array(z.string())
});

const MAX_SYSTEM_BUNDLE_ENTRIES = 100;
const MAX_SYSTEM_BUNDLE_BYTES = config.systemUploadLimitMb * 1024 * 1024;

/**
 * Five things in a system are namespaced by its id, and all five move together
 * or the result installs and then misbehaves quietly: the id, each content
 * module's id, the `provides` and `requires` that reference those ids, each
 * module's storage namespace, and every item id in the catalogue.
 *
 * Table anchors need no rewriting — `rulesMarkdown` mints them from the system
 * id at read time, so they follow on their own.
 */
export function renameSystem(content: SystemBundleContent, nextId: string, nextName?: string): SystemBundleContent {
  const previous = content.system.id;
  if (!SYSTEM_ID_PATTERN.test(nextId)) throw new Error(`"${nextId}" is not a usable system id.`);
  if (nextId === previous) return content;

  // A module id and the capability it provides are two different namespaces
  // that happen to look alike: Cairn's module provides "cairn/core" while CWN's
  // provides "without-number/core@1". Only the part naming the system moves.
  const renameReference = (value: string) =>
    value === previous || value.startsWith(`${previous}/`) ? `${nextId}${value.slice(previous.length)}` : value;
  const renameNamespace = (value: string) =>
    value === previous || value.startsWith(`${previous}.`) ? `${nextId}${value.slice(previous.length)}` : value;

  const system: GameSystem = {
    ...content.system,
    id: nextId,
    ...(nextName ? { name: nextName } : {}),
    contentModules: content.system.contentModules.map((module) => ({
      ...module,
      id: renameReference(module.id),
      storageNamespace: renameNamespace(module.storageNamespace),
      provides: module.provides.map(renameReference),
      requires: module.requires.map(renameReference),
      ...(module.conflictsWith ? { conflictsWith: module.conflictsWith.map(renameReference) } : {})
    }))
  };

  // Item ids are `<system>/<slug>`, built by `itemId`. They are stored per room
  // in `room_items`, so an unrewritten one cannot collide — but it would be a
  // lie, and `seedItemCatalog` reads the prefix to decide what is already held.
  // A hand-added entry whose id was never namespaced is left exactly as it is.
  const renameItemId = (id: string) => (id.startsWith(`${previous}/`) ? `${nextId}${id.slice(previous.length)}` : id);
  const lists: SystemItemCatalog["lists"] = Object.fromEntries(
    Object.entries(content.items.lists).map(([key, entries]) => [
      key,
      entries.map((item) => ({ ...item, id: renameItemId(item.id) }))
    ])
  );

  return {
    system,
    items: {
      ...content.items,
      system: nextId,
      lists,
      ...(content.items.retired?.length ? { retired: content.items.retired.map(renameItemId) } : {})
    },
    traits: { ...content.traits, system: nextId },
    rules: content.rules,
    tables: content.tables
  };
}

export function buildSystemBundle(content: SystemBundleContent): Uint8Array {
  const { system, items, traits, rules, tables } = content;
  const manifest: SystemBundleManifest = {
    bundleVersion: SYSTEM_BUNDLE_VERSION,
    app: SYSTEM_BUNDLE_APP,
    systemId: system.id,
    systemName: system.name,
    exportedAt: new Date().toISOString(),
    licenses: [...new Set(system.sourceDocuments.map((source) => source.license))]
  };

  const files: Record<string, Uint8Array> = {
    "manifest.json": strToU8(`${JSON.stringify(manifest, null, 2)}\n`),
    "system.json": strToU8(`${JSON.stringify(system, null, 2)}\n`),
    "items.json": strToU8(`${JSON.stringify(items, null, 2)}\n`),
    "traits.json": strToU8(`${JSON.stringify(traits, null, 2)}\n`)
  };
  for (const [name, markdown] of Object.entries(rules)) files[`rules/${name}`] = strToU8(markdown);
  for (const [name, json] of Object.entries(tables)) files[`tables/${name}`] = strToU8(json);
  return zipSync(files, { level: 6 });
}

/**
 * A path an archive may hold. Refuses anything absolute, anything reaching
 * upwards, and anything outside the four places a bundle keeps files — the
 * zip-slip check, which has to happen before a single byte is written.
 */
const ALLOWED_ENTRY = /^(manifest\.json|system\.json|items\.json|traits\.json|(rules|tables)\/[^/]+)$/;

export function refuseUnsafeEntries(names: readonly string[]) {
  for (const name of names) {
    const normalized = name.replace(/\\/g, "/");
    if (normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized) || normalized.split("/").includes(".."))
      throw new Error(`The bundle holds an entry that would write outside it: "${name}".`);
    if (normalized.endsWith("/")) continue;
    if (!ALLOWED_ENTRY.test(normalized))
      throw new Error(`The bundle holds "${name}", which is not one of the files a system bundle may carry.`);
  }
}

function readJson<T>(files: Record<string, Uint8Array>, name: string, what: string): T {
  const file = files[name];
  if (!file) throw new Error(`The bundle has no ${name}, so it is not a system bundle.`);
  try {
    return JSON.parse(strFromU8(file)) as T;
  } catch {
    throw new Error(`The bundle's ${name} could not be read as JSON, so ${what} cannot be checked.`);
  }
}

/**
 * Reads a bundle, refusing anything that is not one rather than half-installing
 * it. Nothing here touches the filesystem: a caller gets a complete, validated
 * bundle in memory or an error naming what is wrong with it.
 */
export function readSystemBundle(archive: Uint8Array): SystemBundle {
  if (archive.byteLength > MAX_SYSTEM_BUNDLE_BYTES)
    throw new Error("That system bundle is larger than this server accepts.");
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(archive);
  } catch {
    throw new Error("That file is not a readable zip archive.");
  }

  refuseUnsafeEntries(Object.keys(files));
  if (Object.keys(files).length > MAX_SYSTEM_BUNDLE_ENTRIES) throw new Error("That system bundle has too many files.");
  if (Object.values(files).reduce((total, file) => total + file.byteLength, 0) > MAX_SYSTEM_BUNDLE_BYTES)
    throw new Error("That system bundle expands beyond this server's size limit.");

  const rawManifest = readJson<unknown>(files, "manifest.json", "the bundle");
  if (!rawManifest || typeof rawManifest !== "object" || (rawManifest as { app?: unknown }).app !== SYSTEM_BUNDLE_APP)
    throw new Error("That archive was not written as a system bundle by this application.");
  const manifestResult = manifestSchema.safeParse(rawManifest);
  if (!manifestResult.success) throw new Error("The bundle's manifest.json is not a valid system bundle manifest.");
  const manifest = manifestResult.data;
  if (!(manifest.bundleVersion <= SYSTEM_BUNDLE_VERSION))
    throw new Error(
      `That bundle was written by a newer version (${manifest.bundleVersion}). Update this application first.`
    );

  const parsed = gameSystemSchema.safeParse(readJson(files, "system.json", "the system definition"));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue.path.length ? `${issue.path.join(".")}: ` : "";
    throw new Error(`The bundle's system.json is not a valid system — ${where}${issue.message}`);
  }
  const system = parsed.data as GameSystem;

  if (manifest.systemId !== system.id)
    throw new Error(`The bundle's manifest names "${manifest.systemId}" but its system.json is "${system.id}".`);

  const items = readJson<SystemItemCatalog>(files, "items.json", "the item catalogue");
  const traits = readJson<SystemTraitCatalog>(files, "traits.json", "the trait catalogue");
  if (items.system !== system.id)
    throw new Error(`The bundle's items.json belongs to "${items.system}", not to "${system.id}".`);
  if (traits.system !== system.id)
    throw new Error(`The bundle's traits.json belongs to "${traits.system}", not to "${system.id}".`);

  const rules: Record<string, string> = {};
  const tables: Record<string, string> = {};
  for (const [name, bytes] of Object.entries(files)) {
    if (name.startsWith("rules/")) rules[name.slice("rules/".length)] = strFromU8(bytes);
    if (name.startsWith("tables/")) tables[name.slice("tables/".length)] = strFromU8(bytes);
  }

  for (const source of system.sourceDocuments) {
    if (!rules[source.markdownFile])
      throw new Error(`The bundle names rules/${source.markdownFile} but does not contain it.`);
    if (source.tablesFile && !tables[source.tablesFile])
      throw new Error(`The bundle names tables/${source.tablesFile} but does not contain it.`);
  }

  return { manifest, system, items, traits, rules, tables };
}
