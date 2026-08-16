import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { config } from "./config.js";
import {
  SYSTEM_BUNDLE_APP,
  refuseUnsafePaths,
  systemContentFromFiles,
  type SystemBundleContent
} from "./system-bundles.js";

/**
 * A system as a repository, rather than as a zip.
 *
 * A bundle is what the application writes; a repository is what a person
 * maintains. They hold the same files — the difference is that a repository also
 * holds a README, a licence, notes, a workflow, and a `.git` directory, none of
 * which the application has any use for. So the rule here is the mirror of the
 * bundle's: a bundle *refuses* an entry it does not recognise, because an
 * unexpected file in a bundle means the bundle is wrong; a repository *ignores*
 * one, because an unexpected file in a repository is just someone's README.
 *
 * The layout:
 *
 *     devilsystem.json   the marker — what this repository is, and which system
 *     system.json        the GameSystem, as data
 *     items.json         the gear catalogue
 *     traits.json        what its weapon words mean
 *     rules/<file>.md    every file a sourceDocument names
 *     tables/<file>.json its extracted tables
 *
 * Everything else is the author's business.
 */

export const SYSTEM_REPO_MARKER = "devilsystem.json";
export const SYSTEM_REPO_VERSION = 1;

/**
 * The marker is how a directory or an archive says "I am a system" before
 * anything in it is parsed. `manifest.json` does this job for a bundle; a
 * repository needs its own because a checkout has no manifest — the manifest
 * records an export, and a repository has not been exported.
 */
export interface SystemRepoMarker {
  app: typeof SYSTEM_BUNDLE_APP;
  formatVersion: number;
  systemId: string;
  systemName: string;
  /** What the source documents say they are covered by, for the credits page. */
  licenses: string[];
}

const markerSchema = z.object({
  app: z.literal(SYSTEM_BUNDLE_APP),
  formatVersion: z.number().int().positive(),
  systemId: z.string(),
  systemName: z.string(),
  licenses: z.array(z.string())
});

/** The files a system repository carries that the application actually reads. */
const REPO_ENTRY = /^(devilsystem\.json|system\.json|items\.json|traits\.json|(rules|tables)\/[^/]+)$/;

export function isSystemRepoEntry(name: string) {
  return REPO_ENTRY.test(name);
}

const MAX_REPO_ENTRIES = 100;
const MAX_REPO_BYTES = config.systemUploadLimitMb * 1024 * 1024;

export function buildSystemRepoMarker(system: SystemBundleContent["system"]): SystemRepoMarker {
  return {
    app: SYSTEM_BUNDLE_APP,
    formatVersion: SYSTEM_REPO_VERSION,
    systemId: system.id,
    systemName: system.name,
    licenses: [...new Set(system.sourceDocuments.map((document) => document.license))]
  };
}

export interface SystemRepo extends SystemBundleContent {
  marker: SystemRepoMarker;
}

/**
 * Reads a system out of a map of the repository's files, having already dropped
 * whatever was not one of ours. Everything the bundle reader checks is checked
 * here too, because this is the same content arriving by a different road.
 */
export function readSystemRepoFiles(files: Record<string, Uint8Array>, source = "repository"): SystemRepo {
  refuseUnsafePaths(Object.keys(files), source);
  if (Object.keys(files).length > MAX_REPO_ENTRIES) throw new Error(`That ${source} has too many files.`);
  if (Object.values(files).reduce((total, file) => total + file.byteLength, 0) > MAX_REPO_BYTES)
    throw new Error(`That ${source} is larger than this server accepts.`);

  const markerFile = files[SYSTEM_REPO_MARKER];
  if (!markerFile)
    throw new Error(`That ${source} has no ${SYSTEM_REPO_MARKER}, so it is not a Devil's Toys game system.`);
  let rawMarker: unknown;
  try {
    rawMarker = JSON.parse(new TextDecoder().decode(markerFile)) as unknown;
  } catch {
    throw new Error(`The ${source}'s ${SYSTEM_REPO_MARKER} could not be read as JSON.`);
  }
  if (!rawMarker || typeof rawMarker !== "object" || (rawMarker as { app?: unknown }).app !== SYSTEM_BUNDLE_APP)
    throw new Error(`That ${source} does not declare itself a Devil's Toys game system.`);
  const parsed = markerSchema.safeParse(rawMarker);
  if (!parsed.success) throw new Error(`The ${source}'s ${SYSTEM_REPO_MARKER} is not a valid system marker.`);
  const marker = parsed.data;
  if (!(marker.formatVersion <= SYSTEM_REPO_VERSION))
    throw new Error(
      `That ${source} is written in a newer format (${marker.formatVersion}). Update this application first.`
    );

  const content = systemContentFromFiles(files, source);
  if (marker.systemId !== content.system.id)
    throw new Error(
      `The ${source}'s ${SYSTEM_REPO_MARKER} names "${marker.systemId}" but its system.json is "${content.system.id}".`
    );

  return { marker, ...content };
}

/**
 * Reads a system out of a directory on disk. Used by the offline validator, so
 * that an author checks exactly what a server would check before pushing.
 */
export function readSystemRepoDirectory(directory: string): SystemRepo {
  if (!fs.existsSync(directory)) throw new Error(`There is no directory at ${directory}.`);
  const files: Record<string, Uint8Array> = {};
  for (const name of ["devilsystem.json", "system.json", "items.json", "traits.json"]) {
    const file = path.join(directory, name);
    if (fs.existsSync(file)) files[name] = fs.readFileSync(file);
  }
  for (const folder of ["rules", "tables"]) {
    const root = path.join(directory, folder);
    if (!fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (entry.isFile()) files[`${folder}/${entry.name}`] = fs.readFileSync(path.join(root, entry.name));
    }
  }
  return readSystemRepoFiles(files, "repository");
}

/**
 * Writes a system out as a repository. Only the files the application owns are
 * touched: a README, a licence, notes, and the `.git` directory beside them all
 * survive a re-export, which is what makes this usable on a repository someone
 * is already maintaining rather than only on an empty directory.
 *
 * A rules or tables file the system no longer names is reported rather than
 * deleted — it may be a book being renamed mid-edit, and losing it silently is
 * worse than leaving it to be tidied by hand.
 */
export function writeSystemRepoDirectory(directory: string, content: SystemBundleContent) {
  const { system, items, traits, rules, tables } = content;
  fs.mkdirSync(path.join(directory, "rules"), { recursive: true });
  fs.mkdirSync(path.join(directory, "tables"), { recursive: true });

  const written: string[] = [];
  const write = (name: string, body: string) => {
    fs.writeFileSync(path.join(directory, name), body);
    written.push(name);
  };

  write(SYSTEM_REPO_MARKER, `${JSON.stringify(buildSystemRepoMarker(system), null, 2)}\n`);
  write("system.json", `${JSON.stringify(system, null, 2)}\n`);
  write("items.json", `${JSON.stringify(items, null, 2)}\n`);
  write("traits.json", `${JSON.stringify(traits, null, 2)}\n`);
  for (const [name, markdown] of Object.entries(rules)) write(`rules/${name}`, markdown);
  for (const [name, json] of Object.entries(tables)) write(`tables/${name}`, json);

  const stale: string[] = [];
  for (const folder of ["rules", "tables"]) {
    for (const entry of fs.readdirSync(path.join(directory, folder), { withFileTypes: true })) {
      const name = `${folder}/${entry.name}`;
      if (entry.isFile() && !written.includes(name)) stale.push(name);
    }
  }
  return { written, stale };
}
