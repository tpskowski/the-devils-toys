import { WIKI_MENTION_KINDS, type WikiMentionKind } from "@devils-toys/shared";
import type { TextDirective } from "mdast-util-directive";
import remarkDirective from "remark-directive";
import remarkParse from "remark-parse";
import { unified } from "unified";

/** A directive in source order, retaining its source span for lossless rewrites. */
export interface CampaignWikiDirective {
  kind: WikiMentionKind;
  label: string;
  target: string;
  source: string;
  start: number;
  end: number;
}

type TreeNode = { type?: unknown; children?: unknown };

function isKind(value: string): value is WikiMentionKind {
  return (WIKI_MENTION_KINDS as readonly string[]).includes(value);
}

function labelFrom(children: TextDirective["children"]): string | undefined {
  if (!children.length) return;
  let label = "";
  for (const child of children) {
    if (child.type !== "text") return;
    label += (child as { value: string }).value;
  }
  return label || undefined;
}

/**
 * Finds only well-formed portable or on-disk mentions. Remark supplies the
 * offsets, so a rewrite changes the target attribute without reserializing a
 * label containing escaped brackets, braces, or line breaks.
 */
export function campaignWikiDirectives(markdown: string, attribute: "id" | "slug" | "path") {
  const found: CampaignWikiDirective[] = [];
  const processor = unified().use(remarkParse).use(remarkDirective);
  const tree = processor.runSync(processor.parse(markdown));
  const visit = (node: TreeNode) => {
    if (!Array.isArray(node.children)) return;
    for (const child of node.children) {
      if (!child || typeof child !== "object") continue;
      const directive = child as TextDirective;
      const attributes = directive.attributes ?? {};
      const start = directive.position?.start.offset;
      const end = directive.position?.end.offset;
      const label = directive.type === "textDirective" ? labelFrom(directive.children) : undefined;
      const target = attributes[attribute];
      if (
        directive.type === "textDirective" &&
        isKind(directive.name) &&
        Object.keys(attributes).length === 1 &&
        typeof target === "string" &&
        target &&
        label &&
        start !== undefined &&
        end !== undefined
      )
        found.push({ kind: directive.name, label, target, source: markdown.slice(start, end), start, end });
      else visit(directive as TreeNode);
    }
  };
  visit(tree as TreeNode);
  return found;
}

/** Replaces recognized directives from the end of the document to retain offsets. */
export function rewriteCampaignWikiDirectives(
  markdown: string,
  attribute: "id" | "slug" | "path",
  rewrite: (directive: CampaignWikiDirective) => string
) {
  let rewritten = markdown;
  for (const directive of campaignWikiDirectives(markdown, attribute).sort((left, right) => right.start - left.start))
    rewritten = `${rewritten.slice(0, directive.start)}${rewrite(directive)}${rewritten.slice(directive.end)}`;
  return rewritten;
}

/**
 * Serializes the only attribute a portable directive may have.  Do not splice a
 * value into source: quoted directive attributes have entity escaping rules and
 * an unquoted path containing whitespace becomes several attributes.
 */
export function withCampaignWikiDirectiveTarget(
  directive: CampaignWikiDirective,
  attribute: "id" | "slug" | "path",
  target: string
) {
  const safeUnquoted = /^[^\t\n\r "'<=>`}]+$/;
  const quoted = (value: string) => {
    if (safeUnquoted.test(value)) return value;
    const quote = value.split('"').length <= value.split("'").length ? '"' : "'";
    const escaped = value.replace(/&/g, "&amp;").replaceAll(quote, quote === '"' ? "&#x22;" : "&#x27;");
    return `${quote}${escaped}${quote}`;
  };
  // `source` was parsed as a one-attribute text directive immediately before
  // this call. Find its unescaped label close rather than assuming labels are
  // simple text: their original escapes remain lossless.
  let close = -1;
  let escaped = false;
  for (let index = directive.source.indexOf("[") + 1; index < directive.source.length; index += 1) {
    const character = directive.source[index]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === "]") {
      close = index;
      break;
    }
  }
  if (close < 0 || directive.source[close + 1] !== "{")
    throw new Error("A campaign wiki directive could not be re-serialized.");
  return `${directive.source.slice(0, close + 2)}${attribute}=${quoted(target)}}`;
}
