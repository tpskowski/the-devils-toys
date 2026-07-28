import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { isExternalMarkdownHref, RulesMarkdown } from "./RulesMarkdown";
import {
  extractRuleHeadings,
  extractRuleTocHeadings,
  findRuleAnchorId,
  findRuleExcerpt,
  filterRules,
  rulesAnchorPath,
  rulesPath,
  rulesSystemFromPath,
  stripMarkdownMetadata
} from "./rules";

const rulesWithMetadata = `---
title: Monolith
author: Adam Hensley
license: CC-BY-SA 4.0
---

# Monolith

Actual rules begin here.`;

const rules = `# Core rules
Roll a save when danger is unavoidable.

## Combat
Attacks automatically hit.

### Armor
Armor reduces incoming damage.

## Advancement
Characters improve through play.`;

describe("rules reference search", () => {
  it("returns the complete reference for an empty query", () => {
    expect(filterRules(rules, "  ")).toBe(rules);
  });

  it("searches both headings and section content without case sensitivity", () => {
    expect(filterRules(rules, "DAMAGE")).toContain("### Armor");
    expect(filterRules(rules, "DAMAGE")).not.toContain("## Advancement");
    expect(filterRules(rules, "combat")).toContain("## Combat");
  });

  it("returns an empty result when no role-appropriate section matches", () => {
    expect(filterRules(rules, "secret ritual")).toBe("");
  });

  it("removes document metadata before returning or searching rules", () => {
    expect(stripMarkdownMetadata(rulesWithMetadata)).toBe("# Monolith\n\nActual rules begin here.");
    expect(filterRules(rulesWithMetadata, "")).not.toContain("title: Monolith");
    expect(filterRules(rulesWithMetadata, "Adam Hensley")).toBe("");
  });

  it("does not remove ordinary horizontal rules inside the document", () => {
    const markdown = "# Rules\n\nOpening text.\n\n---\n\nClosing text.";

    expect(stripMarkdownMetadata(markdown)).toBe(markdown);
  });

  it("returns one best-matching section for an anchored rules preview", () => {
    expect(findRuleExcerpt(rules, "Armor")).toBe("### Armor\nArmor reduces incoming damage.");
    expect(findRuleExcerpt(rules, "damage")).toBe("### Armor\nArmor reduces incoming damage.");
  });

  it("returns no preview when an anchored rules query does not match", () => {
    expect(findRuleExcerpt(rules, "spellcasting")).toBe("");
  });

  it("resolves the previewed section to the heading id the full reference renders", () => {
    expect(findRuleAnchorId(rules, "Armor")).toBe("armor");
    expect(findRuleAnchorId(rules, "damage")).toBe("armor");
    expect(findRuleAnchorId(rules, "Advancement")).toBe("advancement");
  });

  it("keeps anchors aligned with duplicate heading ids and document metadata", () => {
    const duplicated = "# Combat\nOpening.\n\n## Combat\nA later section that mentions parrying.";

    expect(findRuleAnchorId(duplicated, "parrying")).toBe("combat-2");
    expect(findRuleAnchorId(rulesWithMetadata, "Monolith")).toBe("monolith");
  });

  it("returns no anchor when nothing matches", () => {
    expect(findRuleAnchorId(rules, "spellcasting")).toBe("");
    expect(findRuleAnchorId(rules, "  ")).toBe("");
  });
});
describe("rules reference headings", () => {
  it("extracts a stable outline from the visible Markdown", () => {
    expect(extractRuleHeadings(rules)).toEqual([
      { level: 1, text: "Core rules", id: "core-rules", line: 1 },
      { level: 2, text: "Combat", id: "combat", line: 4 },
      { level: 3, text: "Armor", id: "armor", line: 7 },
      { level: 2, text: "Advancement", id: "advancement", line: 10 }
    ]);
  });

  it("normalizes formatted headings and makes duplicate ids unique", () => {
    const headings = extractRuleHeadings("# **Moves & Saves**\n## [Moves & Saves](#moves)\n### R\u00e9sum\u00e9 ###");

    expect(headings.map(({ text, id }) => ({ text, id }))).toEqual([
      { text: "Moves & Saves", id: "moves-saves" },
      { text: "Moves & Saves", id: "moves-saves-2" },
      { text: "R\u00e9sum\u00e9", id: "resume" }
    ]);
  });

  it("limits the table of contents to level-one and level-two headings", () => {
    const headings = extractRuleTocHeadings(rules);

    expect(headings.map(({ text, level }) => ({ text, level }))).toEqual([
      { text: "Core rules", level: 1 },
      { text: "Combat", level: 2 },
      { text: "Advancement", level: 2 }
    ]);
  });
});

describe("rules Markdown rendering", () => {
  it("opens external links in a new tab and keeps relative links in the current tab", () => {
    const markdown = "[External](https://example.com) [Local](/roadmap)";
    const html = renderToStaticMarkup(createElement(RulesMarkdown, { markdown, idPrefix: "rules" }));

    expect(html).toContain('href="https://example.com" target="_blank" rel="noopener noreferrer"');
    expect(html).toContain('href="/roadmap"');
    expect(html).not.toContain('href="/roadmap" target="_blank"');
    expect(isExternalMarkdownHref("https://example.com")).toBe(true);
    expect(isExternalMarkdownHref("/roadmap")).toBe(false);
  });

  it("rewrites Markdown fragments to the rendered heading id", () => {
    const markdown = "[Full credits](#credits--inspiration)\n\n# CREDITS & INSPIRATION";
    const html = renderToStaticMarkup(createElement(RulesMarkdown, { markdown, idPrefix: "standalone-rule" }));

    expect(html).toContain('href="#standalone-rule-credits-inspiration"');
    expect(html).toContain('<h1 id="standalone-rule-credits-inspiration">CREDITS &amp; INSPIRATION</h1>');
  });

  it("renders pipe tables as accessible, horizontally scrollable HTML tables", () => {
    const markdown = "| Result | Effect |\n| --- | --- |\n| 1 | Lost |\n| 2 | Safe |";
    const html = renderToStaticMarkup(createElement(RulesMarkdown, { markdown, idPrefix: "rules" }));

    expect(html).toContain('class="markdown-table-scroll"');
    expect(html).toContain('role="region"');
    expect(html).toContain("<table>");
    expect(html).toContain("<th>Result</th>");
    expect(html).toContain("<td>Lost</td>");
  });

  it("does not render YAML front matter passed directly to the rules renderer", () => {
    const html = renderToStaticMarkup(createElement(RulesMarkdown, { markdown: rulesWithMetadata, idPrefix: "rules" }));

    expect(html).not.toContain("title:");
    expect(html).not.toContain("author:");
    expect(html).toContain('<h1 id="rules-monolith">Monolith</h1>');
  });
});

describe("standalone rules routes", () => {
  it("builds per-system paths while retaining the authorizing room", () => {
    expect(rulesPath("cairn", 12)).toBe("/rules/cairn?room=12");
    expect(rulesPath("monolith")).toBe("/rules/monolith");
  });

  it("recognizes only supported standalone rules paths", () => {
    expect(rulesSystemFromPath("/rules/cairn")).toBe("cairn");
    expect(rulesSystemFromPath("/rules/monolith/")).toBe("monolith");
    expect(rulesSystemFromPath("/rules/unknown")).toBeNull();
  });

  it("appends the standalone heading fragment when an anchor is known", () => {
    expect(rulesAnchorPath("monolith", 4, "corruption")).toBe("/rules/monolith?room=4#standalone-rule-corruption");
    expect(rulesAnchorPath("cairn", 4, "")).toBe("/rules/cairn?room=4");
  });
});
