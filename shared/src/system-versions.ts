/**
 * Comparing the version a system declares with the version a repository offers.
 *
 * A system's version is its author's word — nothing here derives one from a tag,
 * a commit, or a hash — so this has to cope with whatever an author writes. The
 * rule is that a later version is claimed only when it is provably later: where
 * both sides read as dotted numbers they are compared as numbers, and where
 * either does not, the honest answer is that the two are the same string or that
 * they differ. Never `newer`.
 *
 * That matters because the alternative is a page telling an admin that 2.0 is an
 * update to 10.0, or that `1.0.0-rc1` supersedes `1.0.0`. A row saying "these
 * are not the same, reinstall if you like" is a worse-looking answer and a truer
 * one.
 *
 * It lives in `shared` because the server decides it and the client shows it,
 * and two readings of the same two strings is one reading too many.
 */

export const SYSTEM_VERSION_COMPARISONS = ["newer", "same", "differs", "unknown"] as const;

export type SystemVersionComparison = (typeof SYSTEM_VERSION_COMPARISONS)[number];

/** `1`, `2.0`, `1.10.3` — digits and dots, and nothing else at either end. */
const DOTTED_NUMERIC = /^\d+(\.\d+)*$/;

export function isDottedNumericVersion(version: string) {
  return DOTTED_NUMERIC.test(version.trim());
}

/**
 * How `available` stands to `installed`.
 *
 * - `unknown` — one side or the other declares no version, so there is nothing
 *   to compare. A system installed before versions existed is here.
 * - `newer` — both read as dotted numbers and `available` is strictly greater.
 * - `same` — numerically equal, or the identical string.
 * - `differs` — anything else, including an upstream version that is numerically
 *   *older*. Going backwards is a reinstall, not an update.
 */
export function compareSystemVersions(installed: string, available: string): SystemVersionComparison {
  const from = installed.trim();
  const to = available.trim();
  if (!from || !to) return "unknown";

  if (isDottedNumericVersion(from) && isDottedNumericVersion(to)) {
    const left = from.split(".").map(Number);
    const right = to.split(".").map(Number);
    // The shorter one is padded with zeros, so `2.0` and `2.0.0` are one version
    // written two ways rather than an update to itself.
    for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
      const a = left[index] ?? 0;
      const b = right[index] ?? 0;
      if (b > a) return "newer";
      if (b < a) return "differs";
    }
    return "same";
  }

  return from === to ? "same" : "differs";
}
