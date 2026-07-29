/** The path the guide answers on, so it can be opened as a page of its own. */
export const GUIDE_PATH = "/guide";

/**
 * Whether the browser was pointed straight at the guide. The editor has no
 * router — the server serves the application for any path — so the one page
 * worth linking to on its own reads the address itself.
 */
export function isGuidePath(pathname: string) {
  return /^\/guide\/?$/.test(pathname);
}

export interface GuideHeading {
  level: 2 | 3;
  text: string;
  id: string;
}

/** An anchor a heading can be reached by, derived from what it says. */
export function guideHeadingId(text: string) {
  return (
    text
      .toLocaleLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "section"
  );
}

/**
 * The contents of the guide, read from the same Markdown the page renders so
 * the rail and the headings cannot disagree. Only the two levels that carry the
 * structure are listed; the title is the page's own.
 */
export function guideHeadings(markdown: string): GuideHeading[] {
  const seen = new Map<string, number>();
  const headings: GuideHeading[] = [];
  let fenced = false;

  for (const line of markdown.split("\n")) {
    // A "###" inside a fenced example is a line of the example, not a heading.
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;

    const match = /^(#{2,3})\s+(.+?)\s*$/.exec(line);
    if (!match) continue;
    const text = match[2].replace(/\*\*|`|_/g, "").trim();
    const base = guideHeadingId(text);
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    headings.push({ level: match[1].length as 2 | 3, text, id: count === 1 ? base : `${base}-${count}` });
  }

  return headings;
}
