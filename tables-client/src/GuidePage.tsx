import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "./api";
import { GUIDE_PATH, guideHeadingId, guideHeadings } from "./guide";

/** The words a heading is made of, so its anchor matches the one in the rail. */
function textOf(children: ReactNode): string {
  if (typeof children === "string" || typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(textOf).join("");
  if (children && typeof children === "object" && "props" in children) {
    return textOf((children as { props: { children?: ReactNode } }).props.children);
  }
  return "";
}

/**
 * The written guide, read from `devils-tables.md` in the repository rather than
 * restated here, so the page and the file cannot drift apart.
 */
export function GuidePage({ standalone = false }: { standalone?: boolean }) {
  const [markdown, setMarkdown] = useState("");
  const [error, setError] = useState("");
  const reading = useRef<HTMLElement>(null);

  const headings = useMemo(() => guideHeadings(markdown), [markdown]);

  useEffect(() => {
    api<string>("/api/guide")
      .then(setMarkdown)
      .catch((cause: Error) => setError(cause.message));
  }, []);

  function jumpTo(id: string) {
    reading.current?.querySelector<HTMLElement>(`#${CSS.escape(id)}`)?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }

  // Repeated headings take a numbered anchor, so the rendered heading has to be
  // counted the same way the rail counts them rather than slugged on its own.
  const used = new Map<string, number>();
  function anchor(children: ReactNode) {
    const base = guideHeadingId(textOf(children));
    const count = (used.get(base) ?? 0) + 1;
    used.set(base, count);
    return count === 1 ? base : `${base}-${count}`;
  }

  if (error) return <p className="form-error">{error}</p>;

  return (
    <section className="guide-page">
      <nav className="guide-toc" aria-label="Guide contents">
        <p className="nav-label">On this page</p>
        {headings.length ? (
          headings.map((heading) => (
            <button
              type="button"
              key={heading.id}
              className={`guide-toc-level-${heading.level}`}
              onClick={() => jumpTo(heading.id)}
            >
              {heading.text}
            </button>
          ))
        ) : (
          <p className="empty-note">Loading…</p>
        )}
        {!standalone && (
          <a className="guide-open" href={GUIDE_PATH} target="_blank" rel="noreferrer">
            Open in a new tab <ArrowUpRight size={15} aria-hidden />
          </a>
        )}
      </nav>

      <article className="guide-body" ref={reading}>
        {markdown ? (
          <Markdown
            remarkPlugins={[remarkGfm]}
            components={{
              h2: ({ children }) => <h2 id={anchor(children)}>{children}</h2>,
              h3: ({ children }) => <h3 id={anchor(children)}>{children}</h3>
            }}
          >
            {markdown}
          </Markdown>
        ) : (
          <p className="empty-note">Loading…</p>
        )}
      </article>
    </section>
  );
}
