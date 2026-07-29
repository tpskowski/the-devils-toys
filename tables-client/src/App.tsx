import { useCallback, useEffect, useState } from "react";
import { BookOpen, Library, LogOut, Tags } from "lucide-react";
import {
  THEME_IDS,
  toTagSlug,
  type Account,
  type TableTag,
  type TableTagDefinition,
  type ThemeId
} from "@devils-toys/shared";
import { api } from "./api";
import { SignIn } from "./SignIn";
import { SetsPage } from "./SetsPage";
import { TagsPage } from "./TagsPage";
import { GuidePage } from "./GuidePage";
import { isGuidePath } from "./guide";
import { permissionsFor, roleNotice, storedTheme, storeTheme } from "./session";

type View = "sets" | "tags" | "guide";

/** A tag with how widely it is used, which the vocabulary page needs. */
export type TagWithUsage = TableTagDefinition & { usage: { sets: number; tables: number } };

export function App() {
  const [account, setAccount] = useState<Account>();
  const [checked, setChecked] = useState(false);
  // The guide has an address of its own so it can be opened in its own tab.
  const standaloneGuide = isGuidePath(window.location.pathname);
  const [view, setView] = useState<View>(standaloneGuide ? "guide" : "sets");
  const [theme, setTheme] = useState<ThemeId>(storedTheme);
  const [vocabulary, setVocabulary] = useState<TagWithUsage[]>([]);
  const [error, setError] = useState("");

  const permissions = permissionsFor(account);

  const loadVocabulary = useCallback(async () => {
    const result = await api<{ tags: TagWithUsage[] }>("/api/table-tags");
    setVocabulary(result.tags);
  }, []);

  const createTag = useCallback(async (label: string): Promise<TableTag> => {
    const cleanLabel = label.trim();
    const result = await api<{ tag: TableTagDefinition }>("/api/table-tags", {
      method: "POST",
      body: JSON.stringify({ slug: toTagSlug(cleanLabel), label: cleanLabel })
    });
    setVocabulary((current) =>
      [...current, { ...result.tag, usage: { sets: 0, tables: 0 } }].sort(
        (left, right) => left.sortOrder - right.sortOrder
      )
    );
    return result.tag.slug;
  }, []);

  useEffect(() => {
    api<{ account: Account }>("/api/me")
      .then((result) => setAccount(result.account))
      .catch(() => setAccount(undefined))
      .finally(() => setChecked(true));
  }, []);

  useEffect(() => {
    if (!account) return;
    loadVocabulary().catch((cause: Error) => setError(cause.message));
  }, [account, loadVocabulary]);

  useEffect(() => storeTheme(theme), [theme]);

  function showTags() {
    setView("tags");
    loadVocabulary().catch((cause: Error) => setError(cause.message));
  }

  async function signOut() {
    await api("/api/logout", { method: "POST" }).catch(() => undefined);
    setAccount(undefined);
    setVocabulary([]);
  }

  if (!checked) return <main className="loading">Loading…</main>;
  if (!account) return <SignIn onSignedIn={setAccount} />;

  const notice = roleNotice(account);

  return (
    <div className={`tables-app theme-${theme}`}>
      <header className="tables-header">
        <h1>
          <Library size={18} aria-hidden /> The Devil&rsquo;s Tables
        </h1>
        <nav aria-label="Sections">
          <button type="button" className={view === "sets" ? "active" : ""} onClick={() => setView("sets")}>
            <Library size={15} aria-hidden /> Table sets
          </button>
          <button type="button" className={view === "tags" ? "active" : ""} onClick={showTags}>
            <Tags size={15} aria-hidden /> Tags
          </button>
          <button type="button" className={view === "guide" ? "active" : ""} onClick={() => setView("guide")}>
            <BookOpen size={15} aria-hidden /> Guide
          </button>
        </nav>
        <div className="tables-account">
          <label className="tables-theme">
            <span className="nav-label">Theme</span>
            <select value={theme} onChange={(event) => setTheme(event.target.value as ThemeId)}>
              {THEME_IDS.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
          </label>
          <span className="tables-whoami">
            {account.username}
            <span className={`tables-role role-${account.role}`}>{account.role}</span>
          </span>
          <button type="button" onClick={signOut} title="Sign out">
            <LogOut size={15} aria-hidden /> Sign out
          </button>
        </div>
      </header>

      {notice && <p className="tables-notice">{notice}</p>}
      {error && <p className="form-error">{error}</p>}

      {view === "guide" && <GuidePage standalone={standaloneGuide} />}
      {view === "sets" && <SetsPage permissions={permissions} vocabulary={vocabulary} onCreateTag={createTag} />}
      {view === "tags" && <TagsPage permissions={permissions} vocabulary={vocabulary} onChanged={loadVocabulary} />}
    </div>
  );
}
