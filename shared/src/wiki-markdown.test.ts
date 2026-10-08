import { describe, expect, it } from "vitest";
import {
  normalizeWikiBreaks,
  plainMentions,
  remarkWiki,
  remarkWikiSpacing,
  remarkWikiTableBreaks,
  wikiMentions
} from "./wiki-markdown.js";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import { unified } from "unified";

describe("wiki Markdown", () => {
  it.each(["<br>", "<br />", "</br>"])("round-trips %s inside table cells without adding rows", (tag) => {
    const markdown = `| Note${tag}heading | Owner |\n| --- | --- |\n| **First${tag}Second** | Alice |`;
    expect(normalizeWikiBreaks(markdown)).toBe(markdown);
    const processor = unified().use(remarkParse).use(remarkGfm).use(remarkWikiTableBreaks()).use(remarkStringify);
    const tree = processor.runSync(processor.parse(markdown));
    expect(tree.children[0]).toMatchObject({
      type: "table",
      children: [
        {
          children: [
            { children: [{ type: "text", value: "Note" }, { type: "break" }, { type: "text", value: "heading" }] },
            expect.anything()
          ]
        },
        {
          children: [
            {
              children: [
                {
                  type: "strong",
                  children: [{ type: "text", value: "First" }, { type: "break" }, { type: "text", value: "Second" }]
                }
              ]
            },
            { children: [{ type: "text", value: "Alice" }] }
          ]
        }
      ]
    });
    const saved = processor.stringify(tree);
    expect(saved.trim().split("\n")).toHaveLength(3);
    expect(saved).toContain("**First<br />Second**");
    const withoutPositions = (value: unknown) =>
      JSON.parse(JSON.stringify(value, (key, child) => (key === "position" ? undefined : child)));
    expect(withoutPositions(processor.runSync(processor.parse(saved)))).toEqual(withoutPositions(tree));
    expect(processor.processSync("First  \nSecond").toString()).toBe("First\\\nSecond\n");
  });

  it("leaves table code, escaped breaks, and HTML with attributes literal", () => {
    const markdown = "| Note |\n| --- |\n| `</br>` \\</br> <br onclick=bad> |";
    const processor = unified().use(remarkParse).use(remarkGfm).use(remarkWikiTableBreaks());
    expect(normalizeWikiBreaks(markdown)).toBe(markdown);
    expect(processor.runSync(processor.parse(markdown))).toEqual(processor.parse(markdown));
  });

  it("replaces legacy line-break tags without changing code, escaped tags, or other HTML", () => {
    const markdown =
      "First<br>Second\n\n<br />\n\nThird\n\n`<br>` and \\<br>\n\n```html\n<br />\n```\n\n<br onclick=bad>";
    expect(normalizeWikiBreaks(markdown)).toBe(
      "First  \nSecond\n\n\n\nThird\n\n`<br>` and \\<br>\n\n```html\n<br />\n```\n\n<br onclick=bad>"
    );
    expect(normalizeWikiBreaks("First<br />\nSecond")).toBe("First  \nSecond");
  });

  it("treats legacy closing break tags as spacing without changing literal examples", () => {
    expect(normalizeWikiBreaks("First</br>Second\n\n</br>\n\nThird")).toBe("First  \nSecond\n\n\n\nThird");
    expect(normalizeWikiBreaks("First</BR>\nSecond")).toBe("First  \nSecond");
    const literal = "`</br>` and \\</br>\n\n```html\n</br>\n```\n\n</br onclick=bad>";
    expect(normalizeWikiBreaks(literal)).toBe(literal);
  });

  it("round-trips empty paragraphs as blank Markdown lines, including inside quotes", () => {
    const processor = unified().use(remarkParse).use(remarkWikiSpacing()).use(remarkStringify);
    const markdown = "\n\nFirst\n\n\n\n\n\nLast\n\n> Quote\n>\n>\n>\n> More\n";
    const tree = processor.runSync(processor.parse(markdown));
    expect(tree.children.map((node) => node.type)).toEqual([
      "paragraph",
      "paragraph",
      "paragraph",
      "paragraph",
      "paragraph",
      "blockquote"
    ]);
    expect(tree.children[0]).toMatchObject({ type: "paragraph", children: [] });
    expect(tree.children[2]).toMatchObject({ type: "paragraph", children: [] });
    expect(tree.children[3]).toMatchObject({ type: "paragraph", children: [] });
    expect(tree.children[5]).toMatchObject({
      type: "blockquote",
      children: [expect.anything(), { type: "paragraph", children: [] }, expect.anything()]
    });
    expect(processor.stringify(tree)).toBe(markdown);
  });

  it("finds valid mentions in source order", () => {
    expect(wikiMentions(":pc[Vess]{id=41} meets :page[the ledger]{slug=guild-ledger}.")).toEqual([
      { kind: "pc", target: "41", label: "Vess" },
      { kind: "page", target: "guild-ledger", label: "the ledger" }
    ]);
  });

  it("keeps permitted mentions as directives and reduces the rest to labels", () => {
    const markdown = ":pc[Vess]{id=41} owes :npc[Grushak]{id=12}.";
    expect(plainMentions(markdown, (mention) => mention.kind === "pc")).toBe(":pc[Vess]{id=41} owes Grushak.");
  });

  it("round-trips escaped brackets, braces, and newlines in labels", () => {
    const markdown = ":npc[\[Grushak\] \{the\}\nHunter]{id=12}";
    expect(plainMentions(markdown, () => true)).toBe(markdown);
  });

  it("leaves malformed and unknown directives alone", () => {
    const markdown = ":dragon[Unseen]{id=8} :npc[Grushak]{id=12 class=chip} :page[Ledger]{id=12}";
    expect(wikiMentions(markdown)).toEqual([]);
    expect(plainMentions(markdown, () => false)).toBe(markdown);
  });

  it("does not rewrite the document when every mention is resolvable", () => {
    const markdown = "**Already formatted**\n\n:page[Ledger]{slug=the-ledger}  \n\n:dragon[Unknown]{id=8}";
    expect(plainMentions(markdown, () => true)).toBe(markdown);
  });

  it("creates only whitelisted renderer properties", () => {
    const processor = unified().use(remarkParse).use(remarkWiki());
    const tree = processor.runSync(processor.parse(":npc[Grushak]{id=12 onclick=alert(1)} :npc[Safe]{id=13}"));
    const nodes = (tree.children[0] as { children: Array<Record<string, unknown>> }).children;
    expect(nodes[0]?.type).toBe("textDirective");
    expect(nodes[2]).toMatchObject({
      type: "wikiMention",
      kind: "npc",
      target: "13",
      label: "Safe",
      data: { hName: "wiki-mention", hProperties: { "data-wiki-kind": "npc", "data-wiki-target": "13" } }
    });
    expect(Object.keys((nodes[2] as { data: { hProperties: object } }).data.hProperties)).toEqual([
      "data-wiki-kind",
      "data-wiki-target"
    ]);
  });
});
