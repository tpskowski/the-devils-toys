import { useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { extractRuleHeadings, headingSlug, stripMarkdownMetadata } from "./rules";

function decodeFragment(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function isExternalMarkdownHref(href: string) {
  if (!/^(?:https?:)?\/\//i.test(href)) return false;
  if (typeof window === "undefined") return true;

  try {
    return new URL(href, window.location.href).origin !== window.location.origin;
  } catch {
    return false;
  }
}
export function RulesMarkdown({ markdown, idPrefix }: { markdown: string; idPrefix: string }) {
  const visibleMarkdown = stripMarkdownMetadata(markdown);
  const headingIds = new globalThis.Map(
    extractRuleHeadings(visibleMarkdown).map((heading) => [heading.line, heading.id])
  );
  const headingId = (line: number | undefined) => {
    const id = line ? headingIds.get(line) : undefined;
    return id ? `${idPrefix}-${id}` : undefined;
  };

  useEffect(() => {
    const targetId = decodeFragment(window.location.hash.slice(1));
    if (!targetId.startsWith(`${idPrefix}-`)) return;

    const target = document.getElementById(targetId);
    if (!target) return;

    target.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "start"
    });
  }, [idPrefix, visibleMarkdown]);

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ node, children, ...props }) => (
          <h1 {...props} id={headingId(node?.position?.start.line)}>
            {children}
          </h1>
        ),
        h2: ({ node, children, ...props }) => (
          <h2 {...props} id={headingId(node?.position?.start.line)}>
            {children}
          </h2>
        ),
        h3: ({ node, children, ...props }) => (
          <h3 {...props} id={headingId(node?.position?.start.line)}>
            {children}
          </h3>
        ),
        a: ({ node: _node, href = "", children, ...props }) => {
          if (href.startsWith("#")) {
            const targetId = `${idPrefix}-${headingSlug(decodeFragment(href.slice(1)))}`;
            return (
              <a
                {...props}
                href={`#${targetId}`}
                onClick={(event) => {
                  const target = document.getElementById(targetId);
                  if (!target) return;
                  event.preventDefault();
                  target.scrollIntoView({
                    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
                    block: "start"
                  });
                  window.history.replaceState(null, "", `#${targetId}`);
                }}
              >
                {children}
              </a>
            );
          }

          return (
            <a
              {...props}
              href={href}
              {...(isExternalMarkdownHref(href) ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            >
              {children}
            </a>
          );
        },
        table: ({ node: _node, children, ...props }) => (
          <div className="markdown-table-scroll" role="region" aria-label="Rules table" tabIndex={0}>
            <table {...props}>{children}</table>
          </div>
        )
      }}
    >
      {visibleMarkdown}
    </ReactMarkdown>
  );
}
