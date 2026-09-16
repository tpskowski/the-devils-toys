import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RulesMarkdown, rulesMarkdownPlugins } from "./RulesMarkdown";

it("renders generated table links as roll buttons only in a room", () => {
  const props = { markdown: "[Names](devils-table:toybox%2Fcore/names)", idPrefix: "rules" };
  const inRoom = renderToStaticMarkup(createElement(RulesMarkdown, { ...props, roomId: 1 }));
  expect(inRoom).toContain('class="rules-table-link"');
  expect(inRoom).toContain("Names</button>");
  const outsideRoom = renderToStaticMarkup(createElement(RulesMarkdown, props));
  expect(outsideRoom).not.toContain("rules-table-link");
  expect(outsideRoom).toContain("Names</span>");
});

describe("RulesMarkdown wiki grammar boundary", () => {
  it("leaves ordinary Markdown readers on GFM alone", () => {
    expect(rulesMarkdownPlugins(false)).toHaveLength(1);
  });

  it("only adds directive parsing for an opted-in wiki reader", () => {
    expect(rulesMarkdownPlugins(true)).toHaveLength(2);
  });
});
