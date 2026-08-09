import { useCallback, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { LifeBuoy, Search } from "lucide-react";
import { HELP_GUIDES, helpGuideForRole, type HelpGuideId, type HelpPayload } from "@devils-toys/shared";
import { api } from "./api";
import { helpDocumentHref, helpHeading, helpImageSrc, helpPath, helpTargetFromPath, resolveHelpHref } from "./help";
import { headingSlug } from "./rules";
import { isExternalMarkdownHref } from "./RulesMarkdown";
import "./help.css";

const idPrefix = "help";

/** The line a search term is on, for the snippet under a menu entry. */
function firstHit(markdown: string, needle: string) {
  const line = markdown
    .split("\n")
    .map((text) => text.trim())
    .find((text) => text && !text.startsWith("![") && text.toLocaleLowerCase().includes(needle));
  if (!line) return "";
  const at = line.toLocaleLowerCase().indexOf(needle);
  const from = Math.max(0, at - 30);
  return `${from ? "…" : ""}${line.slice(from, from + 110).replace(/^#+\s*/, "")}${line.length > from + 110 ? "…" : ""}`;
}

export function HelpPage() {
  const [payload, setPayload] = useState<HelpPayload>();
  const [signedOut, setSignedOut] = useState(false);
  const [error, setError] = useState("");
  const [target, setTarget] = useState(() => helpTargetFromPath(window.location.pathname));
  const [query, setQuery] = useState("");

  useEffect(() => {
    api<HelpPayload>("/api/help")
      .then(setPayload)
      .catch((cause) => {
        const message = (cause as Error).message;
        if (message === "Sign in required.") setSignedOut(true);
        else setError(message);
      });
  }, []);

  // No guide in the address means the reader's own role picks one.
  const guideId: HelpGuideId = target.guide ?? (payload ? helpGuideForRole(payload.viewerRole) : "player");
  const guide = payload?.guides.find((entry) => entry.id === guideId);
  const pageSlug = target.page ?? "overview";
  const page = guide?.pages.find((entry) => entry.slug === pageSlug) ?? guide?.pages[0];

  const go = useCallback((nextGuide: HelpGuideId, nextPage = "overview", hash = "") => {
    setTarget({ guide: nextGuide, page: nextPage });
    window.history.pushState(null, "", `${helpPath(nextGuide, nextPage)}${hash ? `#${idPrefix}-${hash}` : ""}`);
    if (!hash) window.scrollTo({ top: 0 });
  }, []);

  // The browser's own back button, so a guide read across several pages behaves
  // like anything else with addresses.
  useEffect(() => {
    const onPop = () => setTarget(helpTargetFromPath(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    document.title = guide ? `${page?.title ?? guide.label} · Help` : "Help · The Devil's Toys";
  }, [guide, page]);

  const needle = query.trim().toLocaleLowerCase();
  const menu = useMemo(() => {
    const pages = guide?.pages ?? [];
    if (!needle) return pages.map((entry) => ({ entry, hit: "" }));
    return pages
      .filter((entry) => `${entry.title} ${entry.markdown}`.toLocaleLowerCase().includes(needle))
      .map((entry) => ({ entry, hit: firstHit(entry.markdown, needle) }));
  }, [guide, needle]);

  // A search is across one guide, so say when another has answers too.
  const elsewhere = useMemo(() => {
    if (!needle || !payload) return [];
    return payload.guides
      .filter((entry) => entry.id !== guideId)
      .map((entry) => ({
        guide: entry,
        count: entry.pages.filter((item) => `${item.title} ${item.markdown}`.toLocaleLowerCase().includes(needle))
          .length
      }))
      .filter((entry) => entry.count > 0);
  }, [needle, payload, guideId]);

  if (signedOut)
    return (
      <main className="help-page theme-heroic">
        <div className="help-empty">
          <h1>Help</h1>
          <p>Sign in to The Devil’s Toys first, then open this page again.</p>
          <a className="help-back" href="/">
            Go to The Devil’s Toys
          </a>
        </div>
      </main>
    );

  return (
    <main className="help-page theme-heroic">
      <header className="help-header">
        <h1>
          <LifeBuoy size={22} aria-hidden="true" />
          {helpHeading(guide?.label ?? "Help")}
        </h1>
      </header>

      <section className="help-workspace">
        <div className="help-toolbar">
          {/*
            The guide sits beside the search rather than up in the header,
            because the two are read together: which guide, and what in it.
          */}
          <label
            className="help-guide-picker"
            title="Every guide is here whichever role you hold; the one matching yours opened first."
          >
            <span>Guide</span>
            <select value={guideId} onChange={(event) => go(event.target.value as HelpGuideId)}>
              {(payload?.guides ?? HELP_GUIDES.map((id) => ({ id, label: id }))).map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>
          <label className="help-search">
            <Search size={16} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Search the ${guide?.label ?? "guide"}…`}
              aria-label="Search this guide"
            />
          </label>
        </div>

        <div className="help-layout">
          <nav className="help-menu" aria-label="Guide pages">
            <p className="help-menu-label">{needle ? `Pages mentioning “${query.trim()}”` : "Pages"}</p>
            {menu.map(({ entry, hit }) => (
              <button
                key={entry.slug}
                type="button"
                className={entry.slug === page?.slug ? "is-current" : ""}
                onClick={() => go(guideId, entry.slug)}
              >
                <span>{entry.title}</span>
                {hit && <small>{hit}</small>}
              </button>
            ))}
            {menu.length === 0 && <p className="help-menu-empty">Nothing in this guide matches.</p>}
            {elsewhere.length > 0 && (
              <div className="help-elsewhere">
                <p className="help-menu-label">Also in</p>
                {elsewhere.map(({ guide: other, count }) => (
                  <button key={other.id} type="button" onClick={() => go(other.id)}>
                    <span>{other.label}</span>
                    <small>
                      {count} page{count === 1 ? "" : "s"}
                    </small>
                  </button>
                ))}
              </div>
            )}
          </nav>

          <article className="help-reading markdown">
            {error && <p className="form-error">{error}</p>}
            {!payload && !error && <p className="help-status">Loading the guide…</p>}
            {page && <HelpMarkdown markdown={page.markdown} guide={guideId} onNavigate={go} />}
          </article>
        </div>
      </section>
    </main>
  );
}

/**
 * The guide's Markdown as a page rather than as a file. Three things are
 * rewritten: an image, which lives beside the sources rather than at a web
 * address; a link to another page, which is navigation within this tab; and a
 * heading, which gets an id so a fragment can reach it.
 */
function HelpMarkdown({
  markdown,
  guide,
  onNavigate
}: {
  markdown: string;
  guide: HelpGuideId;
  onNavigate: (guide: HelpGuideId, page: string, hash?: string) => void;
}) {
  const heading = (children: React.ReactNode) => {
    const text = typeof children === "string" ? children : String(children);
    return `${idPrefix}-${headingSlug(text)}`;
  };

  useEffect(() => {
    const wanted = window.location.hash.slice(1);
    if (!wanted.startsWith(`${idPrefix}-`)) return;
    document.getElementById(wanted)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [markdown]);

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ node: _node, children, ...props }) => (
          <h1 {...props} id={heading(children)}>
            {children}
          </h1>
        ),
        h2: ({ node: _node, children, ...props }) => (
          <h2 {...props} id={heading(children)}>
            {children}
          </h2>
        ),
        h3: ({ node: _node, children, ...props }) => (
          <h3 {...props} id={heading(children)}>
            {children}
          </h3>
        ),
        // Not lazy: a screenshot has no width until it loads, so it renders a
        // couple of pixels tall, never comes into view, and never loads.
        img: ({ node: _node, src = "", alt = "", ...props }) => (
          <img {...props} src={helpImageSrc(String(src))} alt={alt} />
        ),
        a: ({ node: _node, href = "", children, ...props }) => {
          if (isExternalMarkdownHref(href))
            return (
              <a {...props} href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            );
          if (href.startsWith("#")) {
            const id = `${idPrefix}-${headingSlug(decodeURIComponent(href.slice(1)))}`;
            return (
              <a
                {...props}
                href={`#${id}`}
                onClick={(event) => {
                  const element = document.getElementById(id);
                  if (!element) return;
                  event.preventDefault();
                  element.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
              >
                {children}
              </a>
            );
          }
          if (!href.endsWith(".md") && !href.includes(".md#")) return <span {...props}>{children}</span>;
          const projectDocument = helpDocumentHref(href);
          if (projectDocument)
            return (
              <a {...props} href={projectDocument} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            );
          const to = resolveHelpHref(href, guide);
          return (
            <a
              {...props}
              href={helpPath(to.guide, to.page)}
              onClick={(event) => {
                event.preventDefault();
                onNavigate(to.guide, to.page, to.hash);
              }}
            >
              {children}
            </a>
          );
        },
        table: ({ node: _node, children, ...props }) => (
          <div className="markdown-table-scroll" role="region" aria-label="Table" tabIndex={0}>
            <table {...props}>{children}</table>
          </div>
        )
      }}
    >
      {markdown}
    </ReactMarkdown>
  );
}
