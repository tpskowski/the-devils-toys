import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { SYSTEM_ID_PATTERN, THEME_IDS } from "@devils-toys/shared";
import type { ZipEntry } from "./zip-safety.js";

/**
 * What a campaign bundle is, read off a staged directory.
 *
 * A system bundle names every file it may hold in one regular expression,
 * because a system is a fixed set of things. A campaign is whatever a GM has
 * prepared, so the shape is the other way round: **a folder's name declares what
 * its contents are**, and a zip holding nothing but `maps/*.png` is a complete,
 * valid campaign that imports without a manifest, an index, or a text editor
 * having been opened.
 *
 * Everything else decorates that. `manifest.json` says which campaign and which
 * system; an `index.json` inside a folder gives display names and ordering. Each
 * is optional, each only ever adds detail, and a malformed one is refused by name
 * rather than ignored — the failure this format must never have is the silent
 * one, where a typo drops forty maps and nothing says so.
 *
 * Nothing here touches the database or the uploads directory. A caller gets a
 * complete description of what a bundle holds, or an error naming the file that
 * is wrong with it.
 */

export const CAMPAIGN_BUNDLE_VERSION = 1;
export const CAMPAIGN_BUNDLE_APP = "devils-toys-campaign";

/** A campaign that carries only these needs no system, and imports into any room. */
export const ANY_SYSTEM = "*";

/**
 * The folders a bundle may hold, and what each one's files are.
 *
 * `index.json` is allowed in any of them and is the one file whose name is not
 * its content. A folder listed here but not yet read by this module is still
 * accepted from the archive and reported as pending — see `PENDING_FOLDERS`.
 */
const FOLDERS = {
  maps: { extensions: [".png", ".jpg", ".jpeg", ".webp"], what: "an image" },
  scenes: { extensions: [".png", ".jpg", ".jpeg", ".webp"], what: "an image" },
  references: { extensions: [".png", ".jpg", ".jpeg", ".webp", ".md"], what: "an image or Markdown" },
  audio: { extensions: [".mp3"], what: "an MP3" },
  playlists: { extensions: [".json"], what: "JSON" },
  npcs: { extensions: [".json"], what: "JSON" },
  encounters: { extensions: [".json"], what: "JSON" },
  items: { extensions: [".json"], what: "JSON" },
  hirelings: { extensions: [".png", ".jpg", ".jpeg", ".webp", ".json"], what: "JSON or a portrait" },
  assets: { extensions: [".png", ".jpg", ".jpeg", ".webp", ".json"], what: "JSON or a portrait" },
  tables: { extensions: [".json"], what: "JSON" }
} as const;

export type CampaignFolder = keyof typeof FOLDERS;

/** The four folders whose contents are files rather than descriptions of things. */
export const MEDIA_FOLDERS = ["maps", "scenes", "references", "audio"] as const;
export type MediaFolder = (typeof MEDIA_FOLDERS)[number];

/**
 * Folders this build accepts from an archive but does not yet read.
 *
 * They are reported in the count so a GM can see they were noticed and are not
 * yet acted on, which is the honest state of a feature being built in phases. As
 * each phase lands its reader, its folder leaves this list.
 */
const PENDING_FOLDERS = ["npcs", "encounters", "items", "hirelings", "assets", "tables"] as const;

/** The files a bundle may hold outside any folder. */
const ROOT_FILES = ["manifest.json", "campaign.md", "room.json", "calendar.json"] as const;

const manifestSchema = z.object({
  app: z.literal(CAMPAIGN_BUNDLE_APP),
  bundleVersion: z.number().int().positive(),
  campaignId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "a campaign id is lower-case letters, digits, and dashes"),
  name: z.string().trim().min(1).max(120),
  version: z.string().trim().max(40).default(""),
  system: z.string().refine((value) => value === ANY_SYSTEM || SYSTEM_ID_PATTERN.test(value), {
    message: `a system id, or "${ANY_SYSTEM}" for a campaign that needs none`
  }),
  exportedAt: z.string().default(""),
  licenses: z.array(z.string()).default([])
});

export type CampaignManifest = z.infer<typeof manifestSchema>;

const roomSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    theme: z.string().optional(),
    calendarEnabled: z.boolean().optional(),
    musicEnabled: z.boolean().optional(),
    mapNotationEnabled: z.boolean().optional()
  })
  .strict();

export type CampaignRoom = z.infer<typeof roomSchema>;

/**
 * A media folder's index. The array's order is the display order, so a GM who
 * wants their maps in the order the adventure visits them writes them that way
 * rather than renaming files `01-`, `02-`.
 */
const mediaIndexSchema = z
  .object({
    files: z
      .array(
        z
          .object({
            file: z.string().min(1),
            name: z.string().trim().max(200).optional(),
            artist: z.string().trim().max(200).optional(),
            title: z.string().trim().max(200).optional(),
            album: z.string().trim().max(200).optional()
          })
          .strict()
      )
      .max(5000)
  })
  .strict();

const playlistSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    sortOrder: z.number().int().min(0).max(9999).default(0),
    tracks: z.array(z.string().min(1)).max(2000).default([])
  })
  .strict();

export interface CampaignMedia {
  /** The path inside the bundle, which is this file's identity everywhere else. */
  path: string;
  folder: MediaFolder;
  /** What `media.category` becomes; `kind` is derived from it as `media.ts` does. */
  category: "map" | "scene" | "reference" | "audio";
  filename: string;
  displayName: string;
  sortOrder: number;
  bytes: number;
  markdown: boolean;
  /** Only ever set from an audio index; the ID3 tags win when it is not. */
  tags?: { artist?: string; title?: string; album?: string };
}

export interface CampaignPlaylist {
  path: string;
  name: string;
  sortOrder: number;
  /** Bundle paths into `audio/`, resolved against what the bundle actually holds. */
  tracks: string[];
}

export interface Campaign {
  manifest: CampaignManifest;
  /** What was assumed rather than read, so a preview can say so out loud. */
  guessed: string[];
  /** `campaign.md`, as written. */
  overview: string;
  room: CampaignRoom;
  media: CampaignMedia[];
  playlists: CampaignPlaylist[];
  /** Folders this build accepts but does not yet read, by file count. */
  pending: { folder: string; files: number }[];
  /** Things worth saying to a GM that are not worth refusing an import over. */
  warnings: string[];
}

export interface EntryLimits {
  /** The most an archive may weigh expanded, across every entry. */
  maxBytes: number;
  /** The most any one image may weigh, matching what a hand upload is held to. */
  maxImageBytes: number;
  maxAudioBytes: number;
  maxEntries: number;
}

const extensionOf = (name: string) => path.extname(name).toLowerCase();

/**
 * Whether an archive is shaped like a campaign at all, decided from its central
 * directory and before anything is expanded.
 *
 * An unknown folder is refused by name rather than skipped. A GM who wrote
 * `map/` instead of `maps/` has a bundle that would otherwise import cleanly and
 * silently contain no maps, and they would find out during a session.
 */
export function refuseUnacceptableEntries(entries: readonly ZipEntry[], limits: EntryLimits, source = "campaign") {
  if (!entries.length) throw new Error(`The ${source} is empty.`);
  if (entries.length > limits.maxEntries)
    throw new Error(`The ${source} holds ${entries.length} files, and at most ${limits.maxEntries} may be imported.`);

  let declared = 0;
  for (const entry of entries) {
    const [head, ...rest] = entry.name.split("/");
    declared += entry.uncompressedSize;

    if (!rest.length) {
      if (!(ROOT_FILES as readonly string[]).includes(head))
        throw new Error(
          `The ${source} holds "${entry.name}". A file outside a folder must be one of ${ROOT_FILES.join(", ")}.`
        );
      continue;
    }

    const folder = FOLDERS[head as CampaignFolder];
    if (!folder)
      throw new Error(
        `The ${source} holds a "${head}" folder, which is not one a campaign may carry. ` +
          `The folders are ${Object.keys(FOLDERS).join(", ")}.`
      );
    if (rest.length > 1)
      throw new Error(`The ${source}'s "${entry.name}" is nested; a campaign's folders hold files directly.`);

    const file = rest[0];
    const extension = extensionOf(file);
    if (file !== "index.json" && !(folder.extensions as readonly string[]).includes(extension))
      throw new Error(`The ${source}'s "${entry.name}" is not ${folder.what}, which is what "${head}" holds.`);

    const cap = extension === ".mp3" ? limits.maxAudioBytes : limits.maxImageBytes;
    if (extension !== ".json" && extension !== ".md" && entry.uncompressedSize > cap)
      throw new Error(
        `The ${source}'s "${entry.name}" is ${Math.ceil(entry.uncompressedSize / (1024 * 1024))} MB, ` +
          `and one file may be at most ${Math.floor(cap / (1024 * 1024))} MB.`
      );
  }

  if (declared > limits.maxBytes)
    throw new Error(
      `The ${source} expands to ${Math.ceil(declared / (1024 * 1024))} MB, ` +
        `and at most ${Math.floor(limits.maxBytes / (1024 * 1024))} MB may be imported at once.`
    );
  return declared;
}

/**
 * Generic over the schema rather than over its result, because a schema with a
 * `.default()` has two types — what it accepts and what it produces — and naming
 * only the result makes TypeScript pick the accepting one, leaving every
 * defaulted field optional at the call site.
 */
function readJsonFile<S extends z.ZodTypeAny>(
  directory: string,
  relative: string,
  schema: S,
  what: string
): z.infer<S> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(path.join(directory, relative), "utf8"));
  } catch {
    throw new Error(`The campaign's ${relative} could not be read as JSON, so ${what} cannot be checked.`);
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue.path.length ? `${issue.path.join(".")}: ` : "";
    throw new Error(`The campaign's ${relative} is not valid — ${where}${issue.message}`);
  }
  return result.data;
}

const exists = (directory: string, relative: string) => fs.existsSync(path.join(directory, relative));

/** Files in a folder, sorted, with `index.json` kept apart because it is not content. */
function folderFiles(directory: string, folder: string) {
  const root = path.join(directory, folder);
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name !== "index.json")
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

/**
 * A name for a file nothing named. The extension goes, separators become spaces,
 * and nothing else is done to it — `the-keep.png` becomes "the keep" rather than
 * a guess at capitalisation that would be wrong for "the TOMB of the serpent
 * kings" as often as it was right.
 */
export function displayNameFromFile(file: string) {
  return (
    file
      .replace(/\.[^.]+$/, "")
      .replace(/[-_]+/g, " ")
      .trim() || file
  );
}

const CATEGORY: Record<MediaFolder, CampaignMedia["category"]> = {
  maps: "map",
  scenes: "scene",
  references: "reference",
  audio: "audio"
};

function readMediaFolder(directory: string, folder: MediaFolder, warnings: string[]): CampaignMedia[] {
  const files = folderFiles(directory, folder);
  const index = exists(directory, `${folder}/index.json`)
    ? readJsonFile(directory, `${folder}/index.json`, mediaIndexSchema, `the ${folder} listing`)
    : { files: [] };

  const listed = new Map(index.files.map((entry) => [entry.file, entry]));
  for (const entry of index.files)
    if (!files.includes(entry.file))
      throw new Error(`The campaign's ${folder}/index.json names "${entry.file}", which the folder does not hold.`);

  // Indexed files first, in the order the index gave them, then whatever else the
  // folder holds. A GM who orders half their maps gets those in that order rather
  // than an error about the other half.
  const ordered = [...index.files.map((entry) => entry.file), ...files.filter((file) => !listed.has(file))];

  return ordered.map((file, sortOrder) => {
    const entry = listed.get(file);
    const markdown = extensionOf(file) === ".md";
    if (markdown && folder !== "references")
      warnings.push(`${folder}/${file} is Markdown, which only References may be.`);
    return {
      path: `${folder}/${file}`,
      folder,
      category: CATEGORY[folder],
      filename: file,
      displayName: entry?.name?.trim() || displayNameFromFile(file),
      sortOrder,
      bytes: fs.statSync(path.join(directory, folder, file)).size,
      markdown,
      ...(entry && (entry.artist || entry.title || entry.album)
        ? { tags: { artist: entry.artist, title: entry.title, album: entry.album } }
        : {})
    };
  });
}

/**
 * Playlists, resolved against the audio the bundle actually holds.
 *
 * A track naming a file that is not there is refused rather than dropped: a
 * playlist that quietly loses its third track is a bug a GM finds mid-session,
 * and the bundle is wrong in a way its author can fix in ten seconds.
 */
function readPlaylists(directory: string, audio: readonly CampaignMedia[]): CampaignPlaylist[] {
  const known = new Set(audio.map((track) => track.path));
  return folderFiles(directory, "playlists")
    .map((file) => {
      const relative = `playlists/${file}`;
      const playlist = readJsonFile(directory, relative, playlistSchema, "the playlist");
      for (const track of playlist.tracks)
        if (!known.has(track))
          throw new Error(`The campaign's ${relative} names "${track}", which the bundle does not contain.`);
      return { path: relative, name: playlist.name, sortOrder: playlist.sortOrder, tracks: playlist.tracks };
    })
    .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name));
}

export interface ReadOptions {
  /** Names a campaign whose bundle carries no manifest — the uploaded filename, less its suffixes. */
  fallbackName?: string;
}

/**
 * Everything a staged bundle holds, checked against itself.
 *
 * A missing `manifest.json` is not an error. A GM who dragged four folders
 * together has a campaign; it is named after the file it arrived in, it declares
 * no system, and the preview says both of those were assumed rather than read.
 */
export function readCampaign(directory: string, options: ReadOptions = {}): Campaign {
  const guessed: string[] = [];
  const warnings: string[] = [];

  let manifest: CampaignManifest;
  if (exists(directory, "manifest.json")) {
    manifest = readJsonFile(directory, "manifest.json", manifestSchema, "the campaign");
    if (manifest.bundleVersion > CAMPAIGN_BUNDLE_VERSION)
      throw new Error(
        `That campaign was written by a newer version (${manifest.bundleVersion}). Update this application first.`
      );
  } else {
    const name = options.fallbackName?.trim() || "Untitled campaign";
    manifest = {
      app: CAMPAIGN_BUNDLE_APP,
      bundleVersion: CAMPAIGN_BUNDLE_VERSION,
      campaignId:
        name
          .toLocaleLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 64) || "campaign",
      name,
      version: "",
      system: ANY_SYSTEM,
      exportedAt: "",
      licenses: []
    };
    guessed.push(`This bundle carries no manifest.json, so it is called "${name}" after the file it arrived in.`);
    guessed.push("It names no game system, so it is treated as one that needs none.");
  }

  const room = exists(directory, "room.json") ? readJsonFile(directory, "room.json", roomSchema, "the room") : {};
  if (room.theme && !(THEME_IDS as readonly string[]).includes(room.theme)) {
    warnings.push(
      `room.json names the theme "${room.theme}", which this server does not have. The room keeps its own.`
    );
    delete room.theme;
  }

  const media = MEDIA_FOLDERS.flatMap((folder) => readMediaFolder(directory, folder, warnings));
  const playlists = readPlaylists(
    directory,
    media.filter((entry) => entry.folder === "audio")
  );

  const pending = PENDING_FOLDERS.map((folder) => ({ folder, files: folderFiles(directory, folder).length })).filter(
    (entry) => entry.files > 0
  );
  for (const entry of pending)
    warnings.push(
      `${entry.folder}/ holds ${entry.files} file${entry.files === 1 ? "" : "s"}, which this build does not import yet.`
    );

  return {
    manifest,
    guessed,
    overview: exists(directory, "campaign.md") ? fs.readFileSync(path.join(directory, "campaign.md"), "utf8") : "",
    room,
    media,
    playlists,
    pending,
    warnings
  };
}
