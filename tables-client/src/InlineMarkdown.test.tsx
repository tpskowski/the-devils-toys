import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InlineMarkdown } from "./InlineMarkdown";

describe("InlineMarkdown", () => {
  it("renders inline Markdown formatting without activating raw HTML", () => {
    const html = renderToStaticMarkup(
      createElement(InlineMarkdown, { children: "**bold** *emphasis* ~~removed~~ `code` <script>x</script>" })
    );

    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>emphasis</em>");
    expect(html).toContain("<del>removed</del>");
    expect(html).toContain("<code>code</code>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt;");
  });
});
