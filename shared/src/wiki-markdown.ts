import type { Root, Text } from "mdast";
import type { TextDirective } from "mdast-util-directive";
import remarkDirective from "remark-directive";
import remarkParse from "remark-parse";
import { unified, type Plugin, type Processor, type Transformer } from "unified";

/** The kinds of thing a page may point at. A kind this build has not got is not a mention. */
export const WIKI_MENTION_KINDS = ["pc", "npc", "follower", "asset", "item", "page"] as const;

export type WikiMentionKind = (typeof WIKI_MENTION_KINDS)[number];

/** The small, permission-checkable part of a mention that reaches application code. */
export interface WikiMention {
  kind: WikiMentionKind;
  target: string;
  label: string;
}

/**
 * The remark node handed to both renderers. Its render metadata is deliberately
 * fixed here rather than copied from directive attributes, so author supplied
 * Markdown cannot create arbitrary HTML properties.
 */
export interface WikiMentionNode extends WikiMention {
  type: "wikiMention";
  children: [Text];
  position?: TextDirective["position"];
  data: {
    hName: "wiki-mention";
    hProperties: {
      "data-wiki-kind": WikiMentionKind;
      "data-wiki-target": string;
    };
  };
}

declare module "mdast" {
  interface PhrasingContentMap {
    wikiMention: WikiMentionNode;
  }
}

function isWikiMentionKind(value: string): value is WikiMentionKind {
  return (WIKI_MENTION_KINDS as readonly string[]).includes(value);
}

function labelFrom(children: TextDirective["children"]): string | null {
  if (!children.length) return null;
  let label = "";
  for (const child of children) {
    if (child.type !== "text") return null;
    label += child.value;
  }
  return label ? label : null;
}

function mentionFromDirective(node: TextDirective): WikiMention | null {
  if (!isWikiMentionKind(node.name)) return null;

  const targetName = node.name === "page" ? "slug" : "id";
  const attributes = node.attributes ?? {};
  const keys = Object.keys(attributes);
  const target = attributes[targetName];
  const label = labelFrom(node.children);

  // A mention has exactly one target. Everything else remains an ordinary
  // directive so no arbitrary author attribute can become a renderer property.
  if (keys.length !== 1 || keys[0] !== targetName || typeof target !== "string" || !target || !label) {
    return null;
  }

  return { kind: node.name, target, label };
}

function mentionNode(mention: WikiMention, position: TextDirective["position"]): WikiMentionNode {
  return {
    type: "wikiMention",
    ...mention,
    children: [{ type: "text", value: mention.label }],
    ...(position ? { position } : {}),
    data: {
      hName: "wiki-mention",
      hProperties: {
        "data-wiki-kind": mention.kind,
        "data-wiki-target": mention.target
      }
    }
  };
}

type TreeNode = { type?: unknown; children?: unknown };

/** Replace only parsed, bare HTML breaks. Code examples, escaped tags, and all
 * other HTML remain literal text; this never enables HTML rendering. */
export function normalizeWikiBreaks(markdown: string): string {
  const tree = unified().use(remarkParse).parse(markdown);
  const replacements: Array<{ start: number; end: number; text: string }> = [];
  function visit(node: TreeNode, parent?: TreeNode) {
    const html = node as { type?: string; value?: string; position?: Root["position"] };
    if (html.type === "html" && /^<br[ \t]*\/?[ \t]*>$/i.test(html.value?.trim() ?? "")) {
      const start = html.position?.start.offset;
      const end = html.position?.end.offset;
      if (start !== undefined && end !== undefined) {
        const block = ["root", "blockquote", "listItem"].includes(String(parent?.type));
        replacements.push({ start, end, text: block ? "" : markdown[end] === "\n" ? "  " : "  \n" });
      }
    }
    if (Array.isArray(node.children)) for (const child of node.children) visit(child, node);
  }
  visit(tree);
  for (const { start, end, text } of replacements.reverse())
    markdown = markdown.slice(0, start) + text + markdown.slice(end);
  return markdown;
}

/** An empty rich-text paragraph serializes as an extra pair of newlines.
 * Restore those paragraphs in both Wiki views without storing HTML placeholders. */
export function remarkWikiSpacing(): Plugin<[], Root> {
  return () => (tree) => {
    type SpacingNode = { type: string; children?: SpacingNode[]; position?: Root["position"] };
    function visit(node: SpacingNode) {
      if (!node.children) return;
      const children: SpacingNode[] = [];
      let previousLine = node.type === "root" ? -1 : undefined;
      for (const child of node.children) {
        const startLine = child.position?.start.line;
        if (
          ["root", "blockquote", "listItem"].includes(node.type) &&
          previousLine !== undefined &&
          startLine !== undefined
        ) {
          const blanks = Math.max(0, Math.floor((startLine - previousLine - 2) / 2));
          for (let index = 0; index < blanks; index++) children.push({ type: "paragraph", children: [] });
        }
        visit(child);
        children.push(child);
        previousLine = child.position?.end.line;
      }
      node.children = children;
    }
    visit(tree);
  };
}

function transformMentions(node: TreeNode): void {
  if (!Array.isArray(node.children)) return;

  for (let index = 0; index < node.children.length; index += 1) {
    const child = node.children[index];
    if (!child || typeof child !== "object") continue;
    const directive = child as TextDirective;
    const mention = directive.type === "textDirective" ? mentionFromDirective(directive) : null;
    if (mention) node.children[index] = mentionNode(mention, directive.position);
    else transformMentions(child as TreeNode);
  }
}

function visitMentions(node: TreeNode, visit: (mention: WikiMentionNode) => void): void {
  if (!Array.isArray(node.children)) return;
  for (const child of node.children) {
    if (!child || typeof child !== "object") continue;
    const candidate = child as TreeNode;
    if (candidate.type === "wikiMention") visit(candidate as WikiMentionNode);
    else visitMentions(candidate, visit);
  }
}

function directiveText(node: TreeNode): string {
  if (typeof (node as { value?: unknown }).value === "string") return (node as { value: string }).value;
  if (!Array.isArray(node.children)) return "";
  return node.children
    .filter((child): child is TreeNode => Boolean(child) && typeof child === "object")
    .map(directiveText)
    .join("");
}

/**
 * Reduces every Markdown directive to its reader-facing text. This is broader
 * than `plainMentions`: malformed and unknown directives are not live wiki
 * mentions, but their attribute syntax is still implementation metadata and
 * must not enter a search index.
 */
export function plainWikiDirectives(markdown: string): string {
  const replacements: Array<{ start: number; end: number; label: string }> = [];
  const visit = (node: TreeNode): void => {
    const isDirective =
      node.type === "wikiMention" ||
      node.type === "textDirective" ||
      node.type === "leafDirective" ||
      node.type === "containerDirective";
    if (isDirective) {
      const position = node as { position?: TextDirective["position"] };
      const start = position.position?.start.offset;
      const end = position.position?.end.offset;
      if (start !== undefined && end !== undefined) replacements.push({ start, end, label: directiveText(node) });
      return;
    }
    if (!Array.isArray(node.children)) return;
    for (const child of node.children) if (child && typeof child === "object") visit(child as TreeNode);
  };
  visit(parsedWiki(markdown));

  let result = markdown;
  for (const replacement of replacements.sort((left, right) => right.start - left.start))
    result = `${result.slice(0, replacement.start)}${replacement.label}${result.slice(replacement.end)}`;
  return result;
}

/**
 * A remark plugin that enables text directives and changes only valid wiki
 * directives into safe, renderer-ready `wikiMention` nodes. Pass `remarkWiki()`
 * as one entry in react-markdown's `remarkPlugins` or Milkdown's `$remark` list.
 */
export function remarkWiki(): Plugin<[], Root> {
  return function wikiRemarkPlugin(this: Processor): Transformer<Root> {
    remarkDirective.call(this);
    return (tree) => transformMentions(tree);
  };
}

function parsedWiki(markdown: string): Root {
  const processor = unified().use(remarkParse).use(remarkWiki());
  return processor.runSync(processor.parse(markdown));
}

/** Every mention a document holds, in source order, with its kind and target. */
export function wikiMentions(markdown: string): WikiMention[] {
  const mentions: WikiMention[] = [];
  visitMentions(parsedWiki(markdown), (mention) => {
    mentions.push({ kind: mention.kind, target: mention.target, label: mention.label });
  });
  return mentions;
}

/** The document with the mentions this reader may not resolve reduced to their labels. */
export function plainMentions(markdown: string, keep: (mention: WikiMention) => boolean): string {
  const replacements: Array<{ start: number; end: number; label: string }> = [];
  visitMentions(parsedWiki(markdown), (mention) => {
    if (keep(mention)) return;
    const start = mention.position?.start.offset;
    const end = mention.position?.end.offset;
    // Remark gives source offsets for parsed directives. If it cannot, leaving
    // the original source untouched is safer than guessing at a replacement.
    if (start !== undefined && end !== undefined) replacements.push({ start, end, label: mention.label });
  });

  if (!replacements.length) return markdown;

  let result = markdown;
  for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
    result = `${result.slice(0, replacement.start)}${replacement.label}${result.slice(replacement.end)}`;
  }
  return result;
}
