import { HELP_GUIDES, type HelpGuideId } from "@devils-toys/shared";

/**
 * The guides have an address of their own so they open in their own tab, in the
 * same shape the standalone rules reference already uses.
 *
 *   /help                  the reader's own role's guide, its overview
 *   /help/gm               that guide's overview
 *   /help/gm/room-config   one page of it
 */
export function helpPath(guide?: HelpGuideId, page?: string) {
  if (!guide) return "/help";
  return page && page !== "overview" ? `/help/${guide}/${page}` : `/help/${guide}`;
}

export function isHelpPath(pathname: string) {
  return /^\/help(?:\/|$)/.test(pathname);
}

/**
 * The guide and page an address names. Anything unrecognised reads as absent
 * rather than as an error: a stale link should land on the guide's front page
 * rather than on a failure.
 */
export function helpTargetFromPath(pathname: string): { guide?: HelpGuideId; page?: string } {
  const [, , guide, page] = pathname.replace(/\/+$/, "").split("/");
  const known = HELP_GUIDES.find((candidate) => candidate === guide);
  if (!known) return {};
  return { guide: known, page: page ? decodeURIComponent(page) : undefined };
}

/**
 * Where a link inside the guides points. The files link each other the way they
 * sit on disk — `combat.md`, `../admin/rooms.md#anchor`, `gm/README.md` — and
 * the reader is on an address, not in a directory, so each has to be resolved
 * against the guide it was written in.
 */
export function resolveHelpHref(href: string, from: HelpGuideId): { guide: HelpGuideId; page: string; hash: string } {
  const [target, hash = ""] = href.split("#");
  const parts = target.split("/").filter((part) => part && part !== ".");

  // The table editor's guide is one document that is a whole guide, so it is
  // recognised by name rather than resolved as a path out of the guide tree.
  if (parts[parts.length - 1] === "devils-tables.md") return { guide: "tables", page: "overview", hash };

  let guide: HelpGuideId = from;
  // "../" out of a role's directory lands in the player guide, which is the root.
  if (parts[0] === "..") {
    guide = "player";
    parts.shift();
  }
  const named = HELP_GUIDES.find((candidate) => candidate === parts[0]);
  if (named) {
    guide = named;
    parts.shift();
  }
  const file = parts.pop() ?? "README.md";
  const slug = file.replace(/\.md$/i, "");
  return { guide, page: slug === "README" || !slug ? "overview" : slug, hash };
}

/**
 * A document the guides cite that lives outside them and is not a guide of its
 * own. Only the licensing notice is left: the table editor's guide became the
 * fourth guide, so links to it are navigation now rather than a raw file.
 */
const projectDocuments: Record<string, string> = { NOTICE: "notice" };

export function helpDocumentHref(href: string) {
  const file = href.split("#")[0].split("/").pop() ?? "";
  const name = projectDocuments[file.replace(/\.md$/i, "")];
  return name ? `/api/project/${name}` : undefined;
}

/**
 * The one line at the top of a guide: the application, then which guide it is.
 *
 * The table editor's guide is named after itself, and "The Devil's Toys — The
 * Devil's Tables" reads like a stutter, so a guide that already carries the
 * house name stands on its own.
 */
export function helpHeading(label: string) {
  return label.startsWith("The Devil’s") || label.startsWith("The Devil's") ? label : `The Devil’s Toys — ${label}`;
}

/** An image in the guides, which the server serves from beside them. */
export function helpImageSrc(src: string) {
  const name = src.split("/").pop() ?? "";
  return `/api/help/images/${encodeURIComponent(name)}`;
}
