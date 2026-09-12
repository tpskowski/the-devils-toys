import { describe, expect, it } from "vitest";
import { rulesMarkdownPlugins } from "./RulesMarkdown";

describe("RulesMarkdown wiki grammar boundary", () => {
  it("leaves ordinary Markdown readers on GFM alone", () => {
    expect(rulesMarkdownPlugins(false)).toHaveLength(1);
  });

  it("only adds directive parsing for an opted-in wiki reader", () => {
    expect(rulesMarkdownPlugins(true)).toHaveLength(2);
  });
});
