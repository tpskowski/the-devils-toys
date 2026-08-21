import { compareSystemVersions } from "@devils-toys/shared";
import { logger } from "./logger.js";
import { systemReleaseFingerprint } from "./system-breaking.js";
import { storedSystemSource, storedSystemVersion, systemRows, type SystemRow } from "./system-registry.js";
import { normalizeSystemRelease } from "./system-repo.js";
import { fetchSystemMarker, type CatalogEntry } from "./system-sources.js";

/**
 * Whether a newer version of an installed system exists.
 *
 * An admin who opens Systems expects to be told, and being told requires asking
 * — so this asks, once per system, and every answer is that system's own. One
 * repository being down is a row that says "I could not ask"; it is never the
 * whole page failing, because "there is nothing newer" and "I could not ask" are
 * different answers and collapsing them loses the six that did answer.
 *
 * Two of the seven answers are given without asking anything, which is the point
 * of giving them: a system installed from a file has no upstream, and a system
 * pinned to a commit is pinned to something immutable. Fetching either would be
 * a request whose result could only ever be the answer we already have.
 */

export const SYSTEM_UPDATE_STATES = [
  "newer",
  "differs",
  "current",
  "pinned",
  "unsourced",
  "unknown",
  "unreachable"
] as const;

export type SystemUpdateState = (typeof SYSTEM_UPDATE_STATES)[number];

export interface SystemUpdate {
  id: string;
  name: string;
  state: SystemUpdateState;
  /** What the row was installed as. Empty for a system that declares no version. */
  installedVersion: string;
  /** What the repository is offering now. Empty unless the marker was read. */
  availableVersion: string;
  /** Whether the offered release requires the GM to acknowledge breaking changes. */
  breaking: boolean;
  /** Release notes the repository supplied for the offered release. */
  releaseNotes: string[];
  /** Binds a fetched release's version and metadata to the review it requires. */
  releaseFingerprint: string;
  /** Empty for an `unsourced` system, which has no repository to name. */
  repository: string;
  ref: string;
  /** Why the check failed, and only ever set on `unreachable`. */
  reason: string;
}

/**
 * A ref that is a commit rather than a branch or a tag.
 *
 * Hex, seven characters or more, which is the honest test: nothing here can ask
 * GitHub what kind of ref it was handed without spending the request this whole
 * function exists to avoid. A branch literally named `deadbeef` would be read as
 * a commit and reported as pinned, which is a strange thing to call a branch and
 * a harmless thing to be told about one.
 */
export function isCommitRef(ref: string) {
  return /^[0-9a-f]{7,40}$/i.test(ref);
}

/**
 * The one place a pair of versions becomes an answer, so the menu and the
 * installed list cannot describe the same two strings differently.
 *
 * `newer` is a claim, and `compareSystemVersions` makes it only where it is
 * provable. Everything else it can say is passed through in the same words.
 */
export function updateStateFor(installedVersion: string, availableVersion: string): SystemUpdateState {
  const comparison = compareSystemVersions(installedVersion, availableVersion);
  if (comparison === "same") return "current";
  if (comparison === "newer") return "newer";
  if (comparison === "differs") return "differs";
  return "unknown";
}

async function updateFor(row: SystemRow): Promise<SystemUpdate> {
  const source = storedSystemSource(row);
  const answer: SystemUpdate = {
    id: row.id,
    name: row.name,
    state: "unsourced",
    installedVersion: storedSystemVersion(row),
    availableVersion: "",
    breaking: false,
    releaseNotes: [],
    releaseFingerprint: "",
    repository: source?.repository ?? "",
    ref: source?.ref ?? "",
    reason: ""
  };

  if (!source) return answer;
  // A row recorded before a ref was stored is asked about on the branch every
  // import defaults to, which is the branch it came from.
  const ref = source.ref || "main";
  if (isCommitRef(ref)) return { ...answer, ref, state: "pinned" };

  let marker;
  try {
    marker = await fetchSystemMarker(source.repository, ref);
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : "That repository could not be read.";
    logger.warn("System update check failed", { system: row.id, repository: source.repository, ref, error: reason });
    return { ...answer, ref, state: "unreachable", reason };
  }

  const release = normalizeSystemRelease(marker);
  const availableVersion = release.version ?? "";
  return {
    ...answer,
    ref,
    availableVersion,
    breaking: release.breaking,
    releaseNotes: release.releaseNotes,
    releaseFingerprint: systemReleaseFingerprint(row.id, release),
    state: updateStateFor(answer.installedVersion, availableVersion)
  };
}

/**
 * Every installed system's answer, asked for at once.
 *
 * Concurrently rather than in series: the systems are independent, and an admin
 * opening a page with five of them should wait for the slowest repository rather
 * than for all five added together.
 */
export async function systemUpdates(): Promise<SystemUpdate[]> {
  return Promise.all(systemRows().map(updateFor));
}

export interface CatalogueOffer extends CatalogEntry {
  installed: boolean;
  installedVersion: string;
  /** Release metadata from the repository marker, when that marker answered. */
  breaking: boolean;
  releaseNotes: string[];
  releaseFingerprint: string;
  /** Only meaningful where `installed`; an entry nobody has fetched is `unknown`. */
  updateState: SystemUpdateState;
  updateAvailable: boolean;
}

/**
 * The catalogue menu's entries, answered against what is actually installed.
 *
 * Two rules, and the second is why this shares a module with the check above
 * rather than living in the route:
 *
 * **The marker wins for a system that is installed.** A catalogue entry's
 * version is the author's hint for a system nobody has fetched — the menu cannot
 * read a marker for something that was never downloaded — and it is the likelier
 * of the two to have gone stale, since it is written in a second place. Where the
 * repository answered, what it says it is offering is what is offered here. The
 * entry's own version is the fallback for a repository that would not answer.
 *
 * **An update is offered only where the upstream version is provably later.** A
 * bare inequality is not a direction: it made a stale entry into a permanent
 * "Update to 1.1" that pressing the button could never clear, because the install
 * wrote the marker's version back and the two strings went on being unequal.
 */
export async function catalogueOffers(entries: CatalogEntry[]): Promise<CatalogueOffer[]> {
  const installed = new Map(systemRows().map((row) => [row.id, row]));
  const answers = new Map((await systemUpdates()).map((update) => [update.id, update]));

  return entries.map((entry) => {
    const row = installed.get(entry.id);
    const installedVersion = row ? storedSystemVersion(row) : "";
    const answer = answers.get(entry.id);
    /**
     * An empty version from a marker that answered is still the marker's
     * answer: this release is unversioned. Only an unreachable repository
     * falls back to the catalogue's hint. Using `||` here made those two cases
     * indistinguishable and could invent an update the repository itself did
     * not declare.
     */
    const version = answer && answer.state !== "unreachable" ? answer.availableVersion : entry.version;
    const breaking = answer?.breaking ?? false;
    const releaseNotes = answer?.releaseNotes ?? [];
    const releaseFingerprint = answer?.releaseFingerprint ?? "";
    const updateState = updateStateFor(installedVersion, version);
    return {
      ...entry,
      version,
      installed: Boolean(row),
      installedVersion,
      breaking,
      releaseNotes,
      releaseFingerprint,
      updateState,
      updateAvailable: Boolean(row) && updateState === "newer"
    };
  });
}
