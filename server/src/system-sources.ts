import { z } from "zod";
import { config } from "./config.js";
import { refuseUnsafePaths } from "./system-bundles.js";
import {
  SYSTEM_REPO_MARKER,
  isSystemRepoEntry,
  markerSchema,
  readSystemRepoFiles,
  type SystemRepo,
  type SystemRepoMarker
} from "./system-repo.js";
import { gunzip, readTar, stripArchivePrefix } from "./system-tar.js";

/**
 * Fetching a system from somewhere else.
 *
 * This is the only place the server opens an outbound connection, and it is the
 * one part of installing that runs before anything has been validated — on bytes
 * chosen by an admin typing a repository name. So the order matters: decide
 * whether the host is allowed, cap what may be read, and only then let the
 * existing readers decide whether what arrived is a system.
 *
 * Everything after `readSystemRepoArchive` is the same code an uploaded zip goes
 * through. A downloaded system gets no more trust than one that arrived by hand.
 */

const MAX_BYTES = config.systemUploadLimitMb * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 5;

export function isAllowedSource(url: URL) {
  return url.protocol === "https:" && config.systemSourceHosts.includes(url.hostname.toLowerCase());
}

function refuseUnallowed(url: URL) {
  if (url.protocol !== "https:") throw new Error(`Systems are fetched over HTTPS only, and that is ${url.protocol}//.`);
  if (!isAllowedSource(url))
    throw new Error(
      `This server does not fetch systems from ${url.hostname}. Allowed hosts: ${config.systemSourceHosts.join(", ")}.`
    );
}

/**
 * A GET that follows redirects itself, so every hop is checked rather than only
 * the address that was typed. A redirect is the ordinary case here — codeload
 * hands off to an object store — and it is also how an allowlist is escaped if
 * the check happens once at the start.
 */
async function fetchAllowed(target: string, accept: string): Promise<Response> {
  let url = new URL(target);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    refuseUnallowed(url);
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        accept,
        "user-agent": "devils-toys",
        ...(config.githubToken && url.hostname === "api.github.com"
          ? { authorization: `Bearer ${config.githubToken}` }
          : {})
      }
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error(`${url.hostname} redirected without saying where.`);
      url = new URL(location, url);
      continue;
    }
    if (!response.ok) throw new Error(`${url.hostname} answered ${response.status} for that system.`);
    return response;
  }
  throw new Error("That download redirected too many times.");
}

/**
 * Reads a response body with a running total, so an oversized download is
 * abandoned partway rather than held in memory in full and measured afterwards.
 * `content-length` is checked first where it is offered, and never trusted alone.
 */
async function readCapped(response: Response): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) throw new Error("That download is larger than this server accepts.");
  if (!response.body) throw new Error("That download arrived empty.");

  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      throw new Error("That download is larger than this server accepts.");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** `owner/repo`, which is all of a GitHub repository this server needs to name one. */
export const REPOSITORY_PATTERN = /^[A-Za-z0-9._-]{1,100}\/[A-Za-z0-9._-]{1,100}$/;
/** A branch, tag, or commit. Refused rather than escaped, so a ref cannot build a path. */
export const REF_PATTERN = /^[A-Za-z0-9._\-/]{1,200}$/;

/**
 * The one gate every URL built from a typed-in repository goes through. A ref is
 * refused rather than escaped, because a ref that can spell `..` is a ref that
 * can name a file somewhere else on the host.
 */
function refuseUnusableSource(repository: string, ref: string) {
  if (!REPOSITORY_PATTERN.test(repository)) throw new Error(`"${repository}" is not an owner/repository name.`);
  if (!REF_PATTERN.test(ref) || ref.includes("..")) throw new Error(`"${ref}" is not a usable branch, tag, or commit.`);
}

export function sourceArchiveUrl(repository: string, ref: string) {
  refuseUnusableSource(repository, ref);
  return `https://codeload.github.com/${repository}/tar.gz/${ref}`;
}

/**
 * The marker on its own, without the archive around it.
 *
 * Asking what version a repository is offering costs one small JSON file on a
 * host the allowlist already carries, because the catalogue is fetched from it.
 * The alternative — pulling the tarball to read six lines out of it — is the
 * whole system, per system, every time an admin opens a page.
 */
export function markerUrl(repository: string, ref: string) {
  refuseUnusableSource(repository, ref);
  return `https://raw.githubusercontent.com/${repository}/${ref}/${SYSTEM_REPO_MARKER}`;
}

export interface FetchedSystem extends SystemRepo {
  source: {
    repository: string;
    ref: string;
    /** The archive's own top directory, which names the commit it was cut from. */
    revision: string;
    fetchedAt: string;
  };
}

/**
 * Reads a system out of a repository archive.
 *
 * The one difference from reading a checkout is what to do with a file that is
 * not ours: a repository holds a README, a licence, a workflow, and a `.git`
 * directory, and those are dropped here rather than refused. What is left is
 * handed to exactly the reader a directory would go through.
 */
export function readSystemRepoArchive(archive: Uint8Array, source: { repository: string; ref: string }): FetchedSystem {
  const unpacked = gunzip(archive, MAX_BYTES);
  const { prefix, entries } = stripArchivePrefix(readTar(unpacked, MAX_BYTES));

  // Checked across every entry, before anything is dropped for being none of
  // ours. A path that climbs out of the directory is not a file to quietly skip
  // — it is an archive to refuse, and it stays refused however the set of files
  // this application reads is changed later.
  refuseUnsafePaths(
    entries.map((entry) => entry.name),
    "archive"
  );

  const files: Record<string, Uint8Array> = {};
  for (const entry of entries) {
    const name = entry.name.replace(/\\/g, "/");
    if (isSystemRepoEntry(name)) files[name] = entry.bytes;
  }

  const repo = readSystemRepoFiles(files, "repository");
  return {
    ...repo,
    source: { repository: source.repository, ref: source.ref, revision: prefix, fetchedAt: new Date().toISOString() }
  };
}

/** Downloads a repository at a ref and reads the system out of it. */
export async function fetchSystemRepo(repository: string, ref: string): Promise<FetchedSystem> {
  const response = await fetchAllowed(sourceArchiveUrl(repository, ref), "application/x-gzip");
  return readSystemRepoArchive(await readCapped(response), { repository, ref });
}

/**
 * A repository's marker, cached by repository and ref.
 *
 * The same TTL as the catalogue, deliberately: both are remote answers about
 * what systems are on offer, both are read when an admin opens one page, and a
 * second dial would only be a second thing to set wrong. A failure is thrown
 * rather than cached, for the reason the catalogue's is — a repository that was
 * briefly unreachable is asked again on the next look rather than reported down
 * for the rest of the TTL.
 */
const markers = new Map<string, { at: number; marker: SystemRepoMarker }>();

export function forgetSystemMarkers() {
  markers.clear();
}

export async function fetchSystemMarker(repository: string, ref: string): Promise<SystemRepoMarker> {
  const url = markerUrl(repository, ref);
  const held = markers.get(url);
  if (held && Date.now() - held.at < config.systemCatalogTtlSeconds * 1000) return held.marker;

  const response = await fetchAllowed(url, "application/json");
  const bytes = await readCapped(response);
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new Error(`${repository} did not answer with a readable ${SYSTEM_REPO_MARKER}.`);
  }
  const result = markerSchema.safeParse(parsed);
  if (!result.success) throw new Error(`${repository}'s ${SYSTEM_REPO_MARKER} at ${ref} is not a valid system marker.`);

  markers.set(url, { at: Date.now(), marker: result.data });
  return result.data;
}

/**
 * The catalogue: a list of systems an admin may install without going looking.
 *
 * `version` is the author's own, and the only thing an update is judged by. The
 * alternative — resolving every entry's branch to a commit on every listing —
 * costs a request per system against a rate limit, to answer a question the
 * author can answer for free by writing down what they released.
 */
export const catalogEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  tagline: z.string().default(""),
  repository: z.string().regex(REPOSITORY_PATTERN),
  ref: z.string().regex(REF_PATTERN).default("main"),
  license: z.string().default(""),
  author: z.string().default(""),
  version: z.string().default(""),
  homepage: z.string().default("")
});

export const catalogSchema = z.object({
  formatVersion: z.literal(1),
  systems: z.array(catalogEntrySchema)
});

export type CatalogEntry = z.infer<typeof catalogEntrySchema>;

let cached: { at: number; systems: CatalogEntry[] } | undefined;

export function forgetCatalog() {
  cached = undefined;
}

/**
 * The catalogue, cached. A failure is thrown rather than cached, so a catalogue
 * that was briefly unreachable is asked for again on the next look — but it also
 * never half-answers: an admin gets the whole list or a message saying why not.
 */
export async function fetchCatalog(): Promise<CatalogEntry[]> {
  if (!config.systemCatalogUrl) return [];
  if (cached && Date.now() - cached.at < config.systemCatalogTtlSeconds * 1000) return cached.systems;

  const response = await fetchAllowed(config.systemCatalogUrl, "application/json");
  const bytes = await readCapped(response);
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new Error("The catalogue did not answer with JSON.");
  }
  const result = catalogSchema.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(`The catalogue is not a valid system index — ${issue.path.join(".")}: ${issue.message}`);
  }
  cached = { at: Date.now(), systems: result.data.systems };
  return cached.systems;
}
