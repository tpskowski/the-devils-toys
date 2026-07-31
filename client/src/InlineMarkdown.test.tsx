import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InlineMarkdown } from "./InlineMarkdown";

describe("InlineMarkdown", () => {
  it("renders inline Markdown formatting", () => {
    const html = renderToStaticMarkup(
      createElement(InlineMarkdown, {
        children: "**bold** *emphasis* ~~removed~~ `code` [rules](https://example.com)"
      })
    );

    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>emphasis</em>");
    expect(html).toContain("<del>removed</del>");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain('target="_blank"');
  });

  it("does not activate raw HTML or block formatting", () => {
    const html = renderToStaticMarkup(
      createElement(InlineMarkdown, { children: "# Heading\n\n<script>alert(1)</script>" })
    );

    expect(html).not.toContain("<h1>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});
