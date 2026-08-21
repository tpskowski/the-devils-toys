/**
 * Turning an update answer into the words a row shows.
 *
 * The server answers per system with one of seven states, and the temptation is
 * to draw each one as a badge. That is the wrong shape: six of the seven are
 * either good news or nobody's fault, and a list where every row carries a
 * coloured marker tells an admin nothing about the one row that wanted reading.
 *
 * So each state is given only what it actually needs — a clause on the line that
 * already says where the system came from, a sentence, a button, or nothing at
 * all — and `current`, the state most rows will be in, is given nothing.
 */

/** The server's own list, restated because it is a wire shape rather than shared code. */
export type SystemUpdateState = "newer" | "differs" | "current" | "pinned" | "unsourced" | "unknown" | "unreachable";

export interface SystemUpdate {
  id: string;
  name: string;
  state: SystemUpdateState;
  installedVersion: string;
  availableVersion: string;
  repository: string;
  ref: string;
  reason: string;
  /** Whether installing this release needs the administrator's acknowledgement. */
  breaking: boolean;
  /** The release's own explanation of its breaking changes. */
  releaseNotes: string[];
  /** Opaque server value that proves which release was acknowledged. */
  releaseFingerprint: string;
}

export interface SystemUpdateNotice {
  /** A clause for the line that already says where the system came from. */
  origin: string;
  /** The row's sentence about its state, empty where the honest answer is silence. */
  message: string;
  /** Whether that sentence is a failure rather than an observation. */
  warning: boolean;
  /** The button's words, empty where there is nothing worth offering. */
  action: string;
}

const quiet: SystemUpdateNotice = { origin: "", message: "", warning: false, action: "" };

/**
 * Which side of the comparison is missing, since `unknown` covers three
 * different silences and an admin can only act on the one that is theirs.
 */
function nothingToCompare(update: SystemUpdate) {
  if (!update.installedVersion && !update.availableVersion)
    return `Neither this system nor ${update.repository} declares a version, so there is nothing to compare.`;
  if (!update.installedVersion)
    return `This system declares no version, so ${update.repository}'s ${update.availableVersion} cannot be measured against it.`;
  return `${update.repository} declares no version, so there is nothing to measure ${update.installedVersion} against.`;
}

/**
 * What a row says about itself, and an undefined answer says nothing.
 *
 * That last part is decision 7 as a page rather than as a route: a check this
 * server could not run leaves every row exactly as it was without one, which is
 * a list of systems an admin can still export, retire, and delete.
 */
export function systemUpdateNotice(update: SystemUpdate | undefined): SystemUpdateNotice {
  if (!update) return quiet;
  switch (update.state) {
    case "newer":
      // No sentence: the button names the version, and a row that also wrote it
      // out in prose would be saying one thing twice.
      return { ...quiet, action: `${update.breaking ? "Review update" : "Update"} to ${update.availableVersion}` };
    case "differs":
      // Honest about what it cannot do. Reinstall is what the button does here,
      // so it is what the button says — an "update" to something that may be
      // older is a word doing work the comparison refused to do.
      return {
        ...quiet,
        message:
          `${update.repository} is offering ${update.availableVersion}, which is neither the same as` +
          ` ${update.installedVersion} nor provably later.`,
        action: update.breaking ? "Review reinstall" : "Reinstall"
      };
    case "pinned":
      return { ...quiet, origin: "pinned to a commit" };
    case "unsourced":
      return { ...quiet, origin: "nothing to update from" };
    case "unknown":
      return { ...quiet, message: nothingToCompare(update) };
    case "unreachable":
      return { ...quiet, warning: true, message: `That repository could not be read: ${update.reason}` };
    case "current":
      return quiet;
  }
}
