import { describe, expect, it } from "vitest";
import { plainMentions, remarkWiki, wikiMentions } from "./wiki-markdown.js";
import remarkParse from "remark-parse";
import { unified } from "unified";

describe("wiki Markdown", () => {
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
