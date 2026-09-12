import { describe, expect, it } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import { remarkWiki } from "@devils-toys/shared";
import { WIKI_EDITOR_DEBOUNCE_MS, wikiMentionQuery, wikiMentionSource } from "./WikiEditor";
import { folderAndDescendantIds, folderCanEdit, isCurrentWikiSearch, shouldGuardWikiNavigation } from "./WikiWorkspace";

describe("wiki editor persistence", () => {
  it("settles local Markdown changes before handing them to the explicit save form", () => {
    expect(WIKI_EDITOR_DEBOUNCE_MS).toBeGreaterThan(0);
    expect(WIKI_EDITOR_DEBOUNCE_MS).toBeLessThanOrEqual(500);
  });
});

describe("wiki mention atom", () => {
  it("loads a directive as the shared wikiMention node and writes its directive shape back", () => {
    const processor = unified().use(remarkParse).use(remarkWiki());
    const tree = processor.runSync(processor.parse(":npc[Known Broker]{id=12}"));
    const node = (
      tree.children[0] as { children: Array<{ type: string; kind?: string; target?: string; label?: string }> }
    ).children[0];
    expect(node).toMatchObject({ type: "wikiMention", kind: "npc", target: "12", label: "Known Broker" });
    expect(wikiMentionSource("npc", String(node.target), String(node.label))).toEqual({
      name: "npc",
      attributes: { id: "12" },
      children: [{ type: "text", value: "Known Broker" }]
    });
  });
});

describe("wiki mention picker", () => {
  it("only offers the final @ query at a text-block cursor", () => {
    expect(wikiMentionQuery("Talk to @gru")).toBe("gru");
    expect(wikiMentionQuery("@Vess")).toBe("Vess");
    expect(wikiMentionQuery("Two @marks here")).toBeUndefined();
    expect(wikiMentionQuery("email@example.com")).toBeUndefined();
  });
});

describe("wiki folder move choices", () => {
  it("excludes a folder and every nested child as a move destination", () => {
    const blocked = folderAndDescendantIds(
      [
        { id: 1, parentId: null, name: "Lore", ownerAccountId: 1, sortOrder: 0 },
        { id: 2, parentId: 1, name: "Places", ownerAccountId: 1, sortOrder: 0 },
        { id: 3, parentId: 2, name: "Undercroft", ownerAccountId: 1, sortOrder: 0 },
        { id: 4, parentId: null, name: "Session notes", ownerAccountId: 1, sortOrder: 1 }
      ],
      1
    );

    expect([...blocked]).toEqual([1, 2, 3]);
    expect(blocked.has(4)).toBe(false);
  });

  it("does not offer write actions for a visible ancestor another player owns", () => {
    const visibleAncestor = { id: 8, parentId: null, name: "GM Lore", ownerAccountId: 1, sortOrder: 0 };
    expect(folderCanEdit(visibleAncestor, 2, false)).toBe(false);
    expect(folderCanEdit(visibleAncestor, 1, false)).toBe(true);
    expect(folderCanEdit(visibleAncestor, 2, true)).toBe(true);
  });
});

describe("wiki draft navigation", () => {
  const page = {
    id: 7,
    slug: "old-page",
    title: "Old page",
    markdown: "Saved text",
    folderId: 3,
    visible: false,
    sortOrder: 0,
    ownerAccountId: 1,
    revision: 4
  };

  it("guards any navigation away from changed existing and new drafts", () => {
    expect(
      shouldGuardWikiNavigation(
        { title: "Edited page", markdown: "Saved text", folderId: 3, revision: 4, slug: "old-page" },
        page
      )
    ).toBe(true);
    expect(shouldGuardWikiNavigation({ title: "", markdown: "", folderId: 3 }, undefined)).toBe(false);
    expect(shouldGuardWikiNavigation({ title: "Unfiled thought", markdown: "", folderId: 3 }, undefined)).toBe(true);
  });

  it("allows an unchanged edit to switch pages without a needless prompt", () => {
    expect(
      shouldGuardWikiNavigation(
        {
          title: page.title,
          markdown: page.markdown,
          folderId: page.folderId,
          revision: page.revision,
          slug: page.slug
        },
        page
      )
    ).toBe(false);
  });
});

describe("wiki search responses", () => {
  it("only accepts a result from the active search generation", () => {
    expect(isCurrentWikiSearch(12, 12)).toBe(true);
    expect(isCurrentWikiSearch(11, 12)).toBe(false);
  });
});
