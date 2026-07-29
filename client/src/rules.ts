import { SYSTEM_IDS, type SystemId } from "@devils-toys/shared";
export function stripMarkdownMetadata(markdown: string) {
  const withoutBom = markdown.replace(/^\uFEFF/, "");
  const frontMatter = /^---[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(withoutBom);

  if (!frontMatter) return withoutBom;
  return withoutBom.slice(frontMatter[0].length).replace(/^(?:\r?\n)+/, "");
}

export function filterRules(markdown: string, query: string) {
  const visibleMarkdown = stripMarkdownMetadata(markdown);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return visibleMarkdown;

  return visibleMarkdown
    .split(/\n(?=#{1,3} )/)
    .filter((section) => section.toLocaleLowerCase().includes(normalizedQuery))
    .join("\n");
}

/** Splits the reference into heading-led sections, tracking where each one starts. */
function ruleSections(visibleMarkdown: string) {
  let line = 1;
  return visibleMarkdown.split(/\n(?=#{1,3} )/).map((text) => {
    const startLine = line;
    line += text.split("\n").length;
    return { text, startLine };
  });
}

function findRuleSection(markdown: string, query: string) {
  const visibleMarkdown = stripMarkdownMetadata(markdown);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return undefined;

  const sections = ruleSections(visibleMarkdown);
  const headingFor = ({ text }: { text: string }) => {
    const match = /^(?:#{1,3})\s+(.+?)\s*(?:\n|$)/.exec(text);
    return match ? headingText(match[1]).toLocaleLowerCase() : "";
  };

  return (
    sections.find((section) => headingFor(section) === normalizedQuery) ??
    sections.find((section) => headingFor(section).includes(normalizedQuery)) ??
    sections.find((section) => section.text.toLocaleLowerCase().includes(normalizedQuery))
  );
}

export function findRuleExcerpt(markdown: string, query: string) {
  return (findRuleSection(markdown, query)?.text ?? "").trim();
}

/**
 * The rendered heading id of the section `findRuleExcerpt` returns, so a preview can
 * link to the same place in the full reference. Empty when the match has no heading.
 */
export function findRuleAnchorId(markdown: string, query: string) {
  const section = findRuleSection(markdown, query);
  if (!section) return "";

  const heading = extractRuleHeadings(stripMarkdownMetadata(markdown)).find(
    (candidate) => candidate.line === section.startLine
  );
  return heading?.id ?? "";
}

export interface RuleHeading {
  level: 1 | 2 | 3;
  text: string;
  id: string;
  line: number;
}

function headingText(value: string) {
  return value
    .replace(/\s+#+\s*$/, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~]/g, "")
    .replace(/<[^>]+>/g, "")
    .trim();
}

export function headingSlug(value: string) {
  return (
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase()
      .replace(/&/g, " ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "section"
  );
}

export function extractRuleHeadings(markdown: string): RuleHeading[] {
  const duplicateCounts = new Map<string, number>();
  const headings: RuleHeading[] = [];

  markdown.split("\n").forEach((line, index) => {
    const match = /^(#{1,3})\s+(.+?)\s*$/.exec(line);
    if (!match) return;

    const text = headingText(match[2]);
    const baseId = headingSlug(text);
    const count = (duplicateCounts.get(baseId) ?? 0) + 1;
    duplicateCounts.set(baseId, count);
    headings.push({
      level: match[1].length as RuleHeading["level"],
      text,
      id: count === 1 ? baseId : `${baseId}-${count}`,
      line: index + 1
    });
  });

  return headings;
}

export function extractRuleTocHeadings(markdown: string) {
  return extractRuleHeadings(markdown).filter((heading) => heading.level <= 2);
}

/** Heading id prefix used by the standalone reference, and so by links that target it. */
export const standaloneRuleIdPrefix = "standalone-rule";

export function rulesPath(system: SystemId, roomId?: number) {
  const base = `/rules/${system}`;
  return roomId === undefined ? base : `${base}?room=${encodeURIComponent(roomId)}`;
}

export function rulesAnchorPath(system: SystemId, roomId: number | undefined, anchorId: string) {
  const base = rulesPath(system, roomId);
  return anchorId ? `${base}#${standaloneRuleIdPrefix}-${anchorId}` : base;
}

export function rulesSystemFromPath(pathname: string): SystemId | null {
  const match = /^\/rules\/([^/]+)\/?$/.exec(pathname);
  return match && SYSTEM_IDS.includes(match[1] as SystemId) ? (match[1] as SystemId) : null;
}
