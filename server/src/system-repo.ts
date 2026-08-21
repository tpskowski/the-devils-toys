import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { config } from "./config.js";
import {
  SYSTEM_BUNDLE_APP,
  MAX_SYSTEM_RELEASE_NOTE_LENGTH,
  MAX_SYSTEM_RELEASE_NOTES,
  normalizeSystemRelease,
  refuseUnsafePaths,
  systemReleaseFields,
  type SystemRelease,
  type SystemReleaseInput,
  systemContentFromFiles,
  type SystemBundleContent
} from "./system-bundles.js";

export { normalizeSystemRelease, type SystemRelease, type SystemReleaseInput } from "./system-bundles.js";

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
/** Every newly written marker uses this format; readers still accept v1. */
export const SYSTEM_REPO_VERSION = 2;

/**
 * The marker is how a directory or an archive says "I am a system" before
 * anything in it is parsed. `manifest.json` does this job for a bundle; a
 * repository needs its own because a checkout has no manifest — the manifest
 * records an export, and a repository has not been exported.
 */
export interface SystemRepoMarker extends SystemRelease {
  app: typeof SYSTEM_BUNDLE_APP;
  formatVersion: number;
  systemId: string;
  systemName: string;
  /** What the source documents say they are covered by, for the credits page. */
  licenses: string[];
  /**
   * The author's own release version, and the only thing an update is judged by.
   *
   * Optional, and a system without one is *unversioned* rather than invalid:
   * every system installed before this field existed has none, and its rooms
   * must go on working.
   *
   * Nothing derives it from a tag, a commit, or a hash. An author who never
   * bumps it has a system that never reports an update, which is the correct
   * consequence of never releasing one.
   */
  version?: string;
}

const markerBaseSchema = z.object({
  app: z.literal(SYSTEM_BUNDLE_APP),
  formatVersion: z.number().int().positive(),
  systemId: z.string(),
  systemName: z.string(),
  licenses: z.array(z.string()),
  version: z.string().optional()
});

/** v1 must reject v2 fields rather than accepting and losing them. */
const markerV1Schema = markerBaseSchema.extend({ formatVersion: z.literal(1) }).strict();
const markerV2Schema = markerBaseSchema
  .extend({
    formatVersion: z.literal(2),
    breaking: z.boolean().optional(),
    releaseNotes: z
      .array(
        z
          .string()
          .max(MAX_SYSTEM_RELEASE_NOTE_LENGTH)
          .refine((note) => note.trim().length > 0)
          .refine((note) => !/[\u0000-\u001f\u007f]/.test(note))
      )
      .max(MAX_SYSTEM_RELEASE_NOTES)
      .optional()
  })
  .strict()
  .superRefine((marker, context) => {
    if (marker.breaking && !marker.releaseNotes?.length)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["releaseNotes"],
        message: "A breaking release needs at least one release note."
      });
  });

/**
 * The marker schema is also used by the small remote-marker reader. It returns
 * normalized release metadata so a missing v1/v2 field is never a special case
 * for the update and install routes.
 */
export const markerSchema = z.union([markerV1Schema, markerV2Schema]).transform((marker) => ({
  ...marker,
  ...normalizeSystemRelease(marker)
}));

/** The files a system repository carries that the application actually reads. */
const REPO_ENTRY = /^(devilsystem\.json|system\.json|items\.json|traits\.json|(rules|tables)\/[^/]+)$/;

export function isSystemRepoEntry(name: string) {
  return REPO_ENTRY.test(name);
}

const MAX_REPO_ENTRIES = 100;
const MAX_REPO_BYTES = config.systemUploadLimitMb * 1024 * 1024;

/**
 * `version` is passed in rather than read off the system, because a `GameSystem`
 * does not carry one — it is the repository's release, not the definition's. An
 * export hands over what the installed system was recorded as, so a system that
 * came in at 1.2.0 goes back out at 1.2.0. Nothing is written for a system that
 * declares none, so an unversioned system stays unversioned through a round trip
 * rather than picking up an empty string.
 */
export function buildSystemRepoMarker(
  system: SystemBundleContent["system"],
  release: SystemReleaseInput = {}
): SystemRepoMarker {
  return {
    app: SYSTEM_BUNDLE_APP,
    formatVersion: SYSTEM_REPO_VERSION,
    systemId: system.id,
    systemName: system.name,
    licenses: [...new Set(system.sourceDocuments.map((document) => document.license))],
    ...normalizeSystemRelease(release)
  };
}

/** The sparse JSON form an author sees when this application writes a marker. */
function markerFields(marker: SystemRepoMarker) {
  return {
    app: marker.app,
    formatVersion: marker.formatVersion,
    systemId: marker.systemId,
    systemName: marker.systemName,
    licenses: marker.licenses,
    ...systemReleaseFields(marker)
  };
}

/**
 * The version an install records against a system.
 *
 * The marker first, because that is the system's own word about itself. The
 * catalogue entry is only a fallback: it is one reader of an author's release
 * rather than the authority on it, it is written in a second place and so is the
 * likelier of the two to have gone stale, and a repository named by hand has no
 * catalogue entry at all — which is how a direct import used to record no
 * version whatsoever.
 */
export function recordedSystemVersion(marker: SystemRepoMarker, catalogVersion = ""): string {
  return recordedSystemRelease(marker, catalogVersion).version ?? "";
}

/**
 * The complete release an install records. The catalogue is a fallback only
 * for a marker that has no version; breaking status and notes are the marker's
 * own declaration and cannot be supplied by a catalogue entry.
 */
export function recordedSystemRelease(marker: SystemRepoMarker, catalogVersion = ""): SystemRelease {
  const release = normalizeSystemRelease(marker);
  return { ...release, ...(release.version ? {} : catalogVersion ? { version: catalogVersion } : {}) };
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
  const formatVersion = (rawMarker as { formatVersion?: unknown }).formatVersion;
  if (typeof formatVersion === "number" && formatVersion > SYSTEM_REPO_VERSION)
    throw new Error(`That ${source} is written in a newer format (${formatVersion}). Update this application first.`);
  const parsed = markerSchema.safeParse(rawMarker);
  if (!parsed.success) throw new Error(`The ${source}'s ${SYSTEM_REPO_MARKER} is not a valid system marker.`);
  const marker = parsed.data;

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
export function writeSystemRepoDirectory(
  directory: string,
  content: SystemBundleContent,
  release: SystemReleaseInput = {}
) {
  const { system, items, traits, rules, tables } = content;
  fs.mkdirSync(path.join(directory, "rules"), { recursive: true });
  fs.mkdirSync(path.join(directory, "tables"), { recursive: true });

  const written: string[] = [];
  const write = (name: string, body: string) => {
    fs.writeFileSync(path.join(directory, name), body);
    written.push(name);
  };

  write(SYSTEM_REPO_MARKER, `${JSON.stringify(markerFields(buildSystemRepoMarker(system, release)), null, 2)}\n`);
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
