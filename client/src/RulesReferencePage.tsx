import { useEffect, useRef, useState } from "react";
import { ArrowLeft, BookOpen } from "lucide-react";
import type { RoomSummary, SystemId } from "@devils-toys/shared";
import { api } from "./api";
import { RulesMarkdown } from "./RulesMarkdown";
import { extractRuleTocHeadings, filterRules, standaloneRuleIdPrefix } from "./rules";

const systemNames: Record<SystemId, string> = {
  cairn: "Cairn",
  monolith: "Monolith",
  cwn: "Cities Without Number"
};

export function RulesReferencePage({ system }: { system: SystemId }) {
  const [room, setRoom] = useState<RoomSummary>();
  const [markdown, setMarkdown] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const rulesReading = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = `${systemNames[system]} rules · The Devil's Toys`;
    return () => {
      document.title = previousTitle;
    };
  }, [system]);

  useEffect(() => {
    let active = true;
    const requestedRoomId = Number(new URLSearchParams(window.location.search).get("room"));

    setLoading(true);
    setLoadError("");
    api<{ rooms: RoomSummary[] }>("/api/rooms")
      .then(({ rooms }) => {
        const matchingRooms = rooms.filter((candidate) => candidate.system === system);
        const selectedRoom =
          matchingRooms.find((candidate) => candidate.id === requestedRoomId) ??
          matchingRooms.find((candidate) => !candidate.archived) ??
          matchingRooms[0];
        if (!selectedRoom) throw new Error(`You do not have access to a ${systemNames[system]} room.`);
        if (active) setRoom(selectedRoom);
        return api<string>(`/api/rooms/${selectedRoom.id}/rules`);
      })
      .then((value) => {
        if (active) setMarkdown(value);
      })
      .catch((cause) => {
        if (active) setLoadError((cause as Error).message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [system]);

  const filtered = filterRules(markdown, query);
  const headings = extractRuleTocHeadings(filtered);
  const fallbackTheme = system === "cairn" ? "heroic" : "digital";

  return (
    <main className={`standalone-rules theme-${room?.theme ?? fallbackTheme}`}>
      <header className="standalone-rules-header">
        <a href="/" className="standalone-rules-back">
          <ArrowLeft size={16} />
          Tables
        </a>
        <div className="standalone-rules-title">
          <p className="eyebrow">System reference</p>
          <h1>{systemNames[system]} rules</h1>
        </div>
        <p className="standalone-rules-context">
          {room ? `${room.name} · ${room.role === "gm" ? "Game master" : "Player"}` : "Checking access…"}
        </p>
      </header>

      <section className="standalone-rules-workspace">
        <div className="rules-reference-toolbar">
          <label className="rules-reference-search">
            <BookOpen size={17} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Search ${systemNames[system]} rules…`}
              aria-label={`Search ${systemNames[system]} rules`}
              autoFocus
            />
          </label>
          <p className="modal-intro">Only sections available to your role in this room are shown.</p>
        </div>

        <div className="rules-reference-layout">
          <nav className="rules-toc" aria-label="Rules headings">
            <p className="rules-toc-label">On this page</p>
            {headings.length > 0 ? (
              headings.map((heading) => (
                <button
                  type="button"
                  className={`rules-toc-level-${heading.level}`}
                  key={`${heading.line}-${heading.id}`}
                  onClick={() =>
                    rulesReading.current
                      ?.querySelector<HTMLElement>(`#${standaloneRuleIdPrefix}-${heading.id}`)
                      ?.scrollIntoView({ behavior: "smooth", block: "start" })
                  }
                >
                  {heading.text}
                </button>
              ))
            ) : (
              <p className="rules-toc-empty">
                {loading ? "Loading headings…" : loadError ? "Rules unavailable." : "No headings to show."}
              </p>
            )}
          </nav>

          <div className="rules-reading markdown" ref={rulesReading}>
            {loading ? (
              <p className="rules-status">Loading rules…</p>
            ) : loadError ? (
              <div className="standalone-rules-error">
                <p className="form-error">Rules could not be loaded: {loadError}</p>
                <a href="/">Return to the tables or sign in</a>
              </div>
            ) : filtered ? (
              <RulesMarkdown
                markdown={filtered}
                idPrefix={standaloneRuleIdPrefix}
                roomId={room?.id}
                isGm={room?.role === "gm"}
              />
            ) : (
              <p className="rules-status">{query ? "No matching sections." : "This rules reference is empty."}</p>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
