import { describe, expect, it } from "vitest";
import { GUIDE_PATH, guideHeadingId, guideHeadings, isGuidePath } from "./guide";

describe("opening the guide on its own", () => {
  it("recognises its own address, with or without a trailing slash", () => {
    expect(isGuidePath(GUIDE_PATH)).toBe(true);
    expect(isGuidePath("/guide/")).toBe(true);
  });

  it("leaves every other address to the editor", () => {
    for (const path of ["/", "/sets", "/guidebook", "/a/guide"]) expect(isGuidePath(path)).toBe(false);
  });
});

describe("the guide's contents", () => {
  const markdown = `# Using The Devil's Tables

Intro text.

## Sets and **tables**

## Adding a table

### Writing Markdown directly

Some prose with a \`###\` in it inline.

## Tags

\`\`\`markdown
### Rumours in the market

| d6 | Rumour |
\`\`\`

## Tags
`;

  it("lists the sections and their level, skipping the page title", () => {
    expect(guideHeadings(markdown)).toEqual([
      { level: 2, text: "Sets and tables", id: "sets-and-tables" },
      { level: 2, text: "Adding a table", id: "adding-a-table" },
      { level: 3, text: "Writing Markdown directly", id: "writing-markdown-directly" },
      { level: 2, text: "Tags", id: "tags" },
      { level: 2, text: "Tags", id: "tags-2" }
    ]);
  });

  it("ignores headings inside a fenced example, which are part of the example", () => {
    expect(guideHeadings(markdown).map((heading) => heading.text)).not.toContain("Rumours in the market");
  });

  it("gives a repeated heading an anchor of its own", () => {
    const ids = guideHeadings(markdown).map((heading) => heading.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("makes an anchor from what a heading says", () => {
    expect(guideHeadingId("Moving tables between instances")).toBe("moving-tables-between-instances");
    expect(guideHeadingId("What you can do, by account")).toBe("what-you-can-do-by-account");
    expect(guideHeadingId("!!!")).toBe("section");
  });
});
