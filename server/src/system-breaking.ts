import { createHash } from "node:crypto";
import type { SystemRelease } from "./system-repo.js";

/** What an administrator must review before a declared breaking release replaces another one. */
export interface BreakingSystemChange {
  systemId: string;
  systemName: string;
  fromVersion: string;
  toVersion: string;
  notes: string[];
  fingerprint: string;
}

/**
 * Binds an acknowledgement to the release words the administrator actually
 * read. A changed version, flag, or note produces a different acknowledgement,
 * so a branch moving between review and install cannot reuse a stale answer.
 */
export function systemReleaseFingerprint(systemId: string, release: SystemRelease) {
  return createHash("sha256")
    .update(JSON.stringify([systemId, release.version ?? "", release.breaking, release.releaseNotes]))
    .digest("hex");
}

/**
 * A breaking declaration matters only when it replaces a different installed
 * release. A first install has no existing rooms to preserve, and reinstalling
 * the exact release an administrator already accepted asks nothing twice.
 */
export function breakingSystemChange(
  systemId: string,
  systemName: string,
  current: SystemRelease | undefined,
  incoming: SystemRelease
): BreakingSystemChange | undefined {
  if (!current || !incoming.breaking) return undefined;
  const fingerprint = systemReleaseFingerprint(systemId, incoming);
  if (fingerprint === systemReleaseFingerprint(systemId, current)) return undefined;
  return {
    systemId,
    systemName,
    fromVersion: current.version ?? "",
    toVersion: incoming.version ?? "",
    notes: incoming.releaseNotes,
    fingerprint
  };
}

export class BreakingSystemChangeRequired extends Error {
  constructor(readonly change: BreakingSystemChange) {
    super(
      `${change.systemName} declares breaking changes that must be reviewed before it replaces the installed release.`
    );
    this.name = "BreakingSystemChangeRequired";
  }
}
