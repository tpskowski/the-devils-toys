import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { defaultUrlTransform } from "react-markdown";
import { remarkWiki, type WikiMentionKind } from "@devils-toys/shared";
import { extractRuleHeadings, headingSlug, stripMarkdownMetadata } from "./rules";
import { TableRollModal } from "./TableRollModal";

export interface WikiMentionTarget {
  kind: WikiMentionKind;
  target: string;
  label: string;
}

/** Rules and Library Markdown stay literal unless a wiki reader opts in. */
export function rulesMarkdownPlugins(wikiMentions: boolean) {
  return wikiMentions ? [remarkGfm, remarkWiki()] : [remarkGfm];
}

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
export function RulesMarkdown({
  markdown,
  idPrefix,
  roomId,
  isGm,
  onWikiMention,
  wikiMentions = false
}: {
  markdown: string;
  idPrefix: string;
  roomId?: number;
  isGm?: boolean;
  /** The workspace decides what it is safe and useful to open for each kind. */
  onWikiMention?: (mention: WikiMentionTarget) => void;
  /** A read-only wiki surface may render safe chips without making them actions. */
  wikiMentions?: boolean;
}) {
  const [tableLink, setTableLink] = useState<{ setId: string; tableId: string }>();
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
    <>
      <ReactMarkdown
        remarkPlugins={rulesMarkdownPlugins(Boolean(onWikiMention) || wikiMentions)}
        components={
          {
            h1: ({ node, children, ...props }: any) => (
              <h1 {...props} id={headingId(node?.position?.start.line)}>
                {children}
              </h1>
            ),
            h2: ({ node, children, ...props }: any) => (
              <h2 {...props} id={headingId(node?.position?.start.line)}>
                {children}
              </h2>
            ),
            h3: ({ node, children, ...props }: any) => (
              <h3 {...props} id={headingId(node?.position?.start.line)}>
                {children}
              </h3>
            ),
            a: ({ node: _node, href = "", children, ...props }: any) => {
              if (href.startsWith("devils-table:")) {
                const match = /^devils-table:([^/]+)\/([^/]+)$/.exec(href.slice("devils-table:".length));
                if (roomId && match) {
                  return (
                    <button
                      type="button"
                      className="rules-table-link"
                      onClick={() =>
                        setTableLink({ setId: decodeFragment(match[1]), tableId: decodeFragment(match[2]) })
                      }
                    >
                      {children}
                    </button>
                  );
                }
                return <span>{children}</span>;
              }
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
            table: ({ node: _node, children, ...props }: any) => (
              <div className="markdown-table-scroll" role="region" aria-label="Rules table" tabIndex={0}>
                <table {...props}>{children}</table>
              </div>
            ),
            // `remarkWiki` writes this name itself, after refusing every other
            // directive attribute. React Markdown's public component type only
            // lists HTML elements, hence this narrow cast for the custom element.
            "wiki-mention": ({ children, ...props }: any) => {
              const kind = String(props["data-wiki-kind"] ?? "") as WikiMentionKind;
              const target = String(props["data-wiki-target"] ?? "");
              const label = String(children ?? "");
              const mention = { kind, target, label };
              const className = `wiki-mention wiki-mention-${kind}`;
              if (!onWikiMention) return <span className={className}>{children}</span>;
              return (
                <button type="button" className={className} onClick={() => onWikiMention(mention)}>
                  {children}
                </button>
              );
            }
          } as never
        }
        urlTransform={(value) => (/^devils-table:[^/]+\/[^/]+$/.test(value) ? value : defaultUrlTransform(value))}
      >
        {visibleMarkdown}
      </ReactMarkdown>
      {tableLink && roomId !== undefined && (
        <TableRollModal
          roomId={roomId}
          setId={tableLink.setId}
          tableId={tableLink.tableId}
          isGm={Boolean(isGm)}
          onClose={() => setTableLink(undefined)}
        />
      )}
    </>
  );
}
