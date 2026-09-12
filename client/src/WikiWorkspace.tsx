import {
  Component,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ErrorInfo,
  type FormEvent,
  type ReactNode
} from "react";
import {
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  FilePlus2,
  FileText,
  FolderPlus,
  Pencil,
  Plus,
  Save,
  Trash2,
  X
} from "lucide-react";
import { ApiError, api } from "./api";
import { RulesMarkdown, type WikiMentionTarget } from "./RulesMarkdown";
import "./wiki.css";

const LazyWikiEditor = lazy(() => import("./WikiEditor").then((module) => ({ default: module.WikiEditor })));

interface WikiEditorHandle {
  markdown(): string;
  flush(): string;
}

class WikiEditorLoadBoundary extends Component<
  {
    children: ReactNode;
    markdown: string;
    onMarkdownChange: (markdown: string) => void;
  },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    // Milkdown is optional UI. A failed chunk or browser capability must not
    // stop a player from writing the Markdown that the server persists.
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="wiki-editor-load-fallback">
        <p className="wiki-message">The rich editor is unavailable; continue in Markdown.</p>
        <textarea
          value={this.props.markdown}
          onChange={(event) => this.props.onMarkdownChange(event.target.value)}
          placeholder="Write in Markdown…"
          aria-label="Page Markdown"
        />
      </div>
    );
  }
}

/** The wiki deliberately has its own small transport types until it becomes a
 * shared client contract. They are the public rows, not a second client store. */
export interface WikiFolder {
  id: number;
  parentId: number | null;
  name: string;
  ownerAccountId: number | null;
  sortOrder: number;
  canEdit?: boolean;
}

export interface WikiPage {
  id: number;
  slug: string;
  title: string;
  markdown: string;
  folderId: number | null;
  visible: boolean;
  sortOrder: number;
  ownerAccountId: number | null;
  revision: number;
  canEdit?: boolean;
}

interface WikiPayload {
  pages: WikiPage[];
  folders: WikiFolder[];
}

interface Draft {
  title: string;
  markdown: string;
  folderId: number | null;
  revision?: number;
  slug?: string;
  identity?: number;
}

type WikiNavigation =
  | { kind: "page"; slug: string }
  | { kind: "new"; folderId: number | null }
  | { kind: "cancel" }
  | { kind: "close" }
  | { kind: "leave"; afterDiscard: () => void };

/** A blank new-page form has nothing meaningful to discard. Existing drafts
 * are compared to the page that was loaded, so navigation never retargets a
 * save to the newly selected page. */
export function wikiDraftIsDirty(draft: Draft | undefined, page: WikiPage | undefined) {
  if (!draft) return false;
  if (!draft.slug) return Boolean(draft.title.trim() || draft.markdown);
  return draft.title !== page?.title || draft.markdown !== page?.markdown || draft.folderId !== page?.folderId;
}

/** Kept small and exported so the navigation policy has a direct regression
 * test without making the wiki's editor implementation part of it. */
export function shouldGuardWikiNavigation(draft: Draft | undefined, page: WikiPage | undefined) {
  return wikiDraftIsDirty(draft, page);
}

export function isCurrentWikiSearch(generation: number, currentGeneration: number) {
  return generation === currentGeneration;
}

function pageCanEdit(page: WikiPage, accountId: number | undefined, isGm: boolean) {
  return isGm || page.canEdit === true || (accountId !== undefined && page.ownerAccountId === accountId);
}

export function folderCanEdit(folder: WikiFolder, accountId: number | undefined, isGm: boolean) {
  return isGm || folder.canEdit === true || (accountId !== undefined && folder.ownerAccountId === accountId);
}

/** A folder cannot be moved below itself. The server remains the authority,
 * but leaving cycles out of the picker prevents a predictable failed action. */
export function folderAndDescendantIds(folders: readonly WikiFolder[], folderId: number) {
  const blocked = new Set([folderId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of folders) {
      if (folder.parentId !== null && blocked.has(folder.parentId) && !blocked.has(folder.id)) {
        blocked.add(folder.id);
        changed = true;
      }
    }
  }
  return blocked;
}

function sorted<T extends { name?: string; title?: string; sortOrder: number }>(entries: readonly T[]) {
  return [...entries].sort(
    (a, b) => a.sortOrder - b.sortOrder || (a.name ?? a.title ?? "").localeCompare(b.name ?? b.title ?? "")
  );
}

/** A role-filtered room notebook. The server decides what enters these arrays;
 * this component only gives the accessible rows a useful path and editing UI. */
export function WikiWorkspace({
  roomId,
  accountId,
  isGm,
  revision,
  embedded = false,
  onClose,
  leaveRequestRef,
  onOpenMention,
  initialSlug
}: {
  roomId: number;
  accountId?: number;
  isGm: boolean;
  revision?: number;
  embedded?: boolean;
  onClose?: () => void;
  /** An outer Library/References modal delegates actions that would unmount
   * this Wiki here, so they receive the same discard guard as standalone close. */
  leaveRequestRef?: { current: ((afterDiscard: () => void) => void) | undefined };
  /** Non-page targets belong to the surrounding room surface. */
  onOpenMention?: (mention: WikiMentionTarget) => void;
  /** A mention outside the Library can open a specific page directly. */
  initialSlug?: string;
}) {
  const [wiki, setWiki] = useState<WikiPayload>();
  const [selectedSlug, setSelectedSlug] = useState<string>();
  const [page, setPage] = useState<WikiPage>();
  const [draft, setDraft] = useState<Draft>();
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<WikiPage[]>();
  const [openFolders, setOpenFolders] = useState<Set<number>>(new Set());
  const [folderParent, setFolderParent] = useState<number | null>(null);
  const [folderName, setFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [renamingFolder, setRenamingFolder] = useState<number>();
  const [renameValue, setRenameValue] = useState("");
  const [renameParent, setRenameParent] = useState<number | null>(null);
  const [conflict, setConflict] = useState<{ current: WikiPage; ours: Draft }>();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [mentionSummary, setMentionSummary] = useState<string>();
  const [pendingNavigation, setPendingNavigation] = useState<WikiNavigation>();
  const editorRef = useRef<WikiEditorHandle | undefined>(undefined);
  const searchGeneration = useRef(0);
  const modalRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const pendingNavigationRef = useRef<WikiNavigation | undefined>(undefined);
  const draftIdentity = useRef(0);
  pendingNavigationRef.current = pendingNavigation;

  const setEditorHandle = useCallback((handle: WikiEditorHandle | undefined) => {
    editorRef.current = handle;
  }, []);

  const setDraftMarkdown = useCallback((markdown: string) => {
    setDraft((current) => (current ? { ...current, markdown } : current));
  }, []);

  const load = useCallback(async () => {
    const result = await api<WikiPayload>(`/api/rooms/${roomId}/wiki`);
    setWiki(result);
    setOpenFolders((current) => (current.size ? current : new Set(result.folders.map((folder) => folder.id))));
  }, [roomId]);

  useEffect(() => {
    load().catch((cause) => setError((cause as Error).message));
  }, [load, revision]);

  useEffect(() => {
    if (!initialSlug) return;
    requestNavigation({ kind: "page", slug: initialSlug });
    // `initialSlug` is an outside navigation request, rather than state to
    // mirror: changing it must not silently replace a draft either.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSlug]);

  useEffect(() => {
    // A websocket refresh must never replace unsaved writing. A save that lost
    // its revision race already carries the current page in `conflict`.
    if (!selectedSlug || draft || conflict) return;
    let stopped = false;
    api<{ page: WikiPage }>(`/api/rooms/${roomId}/wiki/pages/${encodeURIComponent(selectedSlug)}`)
      .then((result) => {
        if (!stopped) {
          setPage(result.page);
          setDraft(undefined);
          setConflict(undefined);
        }
      })
      .catch((cause) => {
        if (stopped) return;
        setPage(undefined);
        setDraft(undefined);
        setError((cause as Error).message);
      });
    return () => {
      stopped = true;
    };
  }, [roomId, selectedSlug, revision, draft, conflict]);

  useEffect(() => {
    const needle = query.trim();
    const generation = ++searchGeneration.current;
    if (!needle) {
      setSearchResults(undefined);
      return;
    }
    const controller = new AbortController();
    // While the debounced request is in flight, local filtering is a more
    // honest representation of the text in the input than old remote results.
    setSearchResults(undefined);
    const timer = window.setTimeout(() => {
      api<{ pages: WikiPage[] }>(`/api/rooms/${roomId}/wiki/search?q=${encodeURIComponent(needle)}`, {
        signal: controller.signal
      })
        .then((result) => {
          if (isCurrentWikiSearch(generation, searchGeneration.current)) setSearchResults(result.pages);
        })
        .catch((cause) => {
          if (isCurrentWikiSearch(generation, searchGeneration.current) && (cause as Error).name !== "AbortError") {
            setSearchResults(undefined);
          }
        });
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, roomId]);

  const shownPages = useMemo(() => {
    if (!wiki) return [];
    if (searchResults) return searchResults;
    const needle = query.trim().toLocaleLowerCase();
    return needle
      ? wiki.pages.filter((candidate) => `${candidate.title} ${candidate.slug}`.toLocaleLowerCase().includes(needle))
      : wiki.pages;
  }, [query, searchResults, wiki]);

  const pagesFor = useCallback(
    (folderId: number | null) => sorted(shownPages.filter((candidate) => candidate.folderId === folderId)),
    [shownPages]
  );
  const foldersFor = useCallback(
    (parentId: number | null) => sorted((wiki?.folders ?? []).filter((folder) => folder.parentId === parentId)),
    [wiki]
  );

  function applyNavigation(navigation: WikiNavigation) {
    setPendingNavigation(undefined);
    setError("");
    switch (navigation.kind) {
      case "page":
        setDraft(undefined);
        setConflict(undefined);
        setSelectedSlug(navigation.slug);
        return;
      case "new":
        setSelectedSlug(undefined);
        setPage(undefined);
        setConflict(undefined);
        setDraft({ title: "", markdown: "", folderId: navigation.folderId, identity: ++draftIdentity.current });
        return;
      case "cancel":
        setDraft(undefined);
        setConflict(undefined);
        if (!page) setSelectedSlug(undefined);
        return;
      case "close":
        onClose?.();
        return;
      case "leave":
        navigation.afterDiscard();
        return;
    }
  }

  function requestNavigation(navigation: WikiNavigation) {
    const flushedMarkdown = editorRef.current?.flush();
    const currentDraft = flushedMarkdown !== undefined && draft ? { ...draft, markdown: flushedMarkdown } : draft;
    if (currentDraft !== draft) setDraft(currentDraft);
    if (shouldGuardWikiNavigation(currentDraft, page)) {
      setPendingNavigation(navigation);
      return;
    }
    applyNavigation(navigation);
  }

  useEffect(() => {
    if (!leaveRequestRef) return;
    leaveRequestRef.current = (afterDiscard) => requestNavigation({ kind: "leave", afterDiscard });
    return () => {
      leaveRequestRef.current = undefined;
    };
  });

  function choose(slug: string) {
    requestNavigation({ kind: "page", slug });
  }

  function openMention(mention: WikiMentionTarget) {
    if (mention.kind === "page") {
      choose(mention.target);
      return;
    }
    // NPC and item mentions deliberately have no detail payload. A small,
    // labelled acknowledgement is useful without inviting a browser-side fetch
    // for information the reader may not have permission to see.
    if (mention.kind === "npc" || mention.kind === "item") {
      setMentionSummary(`${mention.kind === "npc" ? "NPC" : "Item"}: ${mention.label}`);
      return;
    }
    if (onOpenMention) {
      onOpenMention(mention);
      return;
    }
    setMentionSummary(`${mention.kind}: ${mention.label}`);
  }

  function newPage(folderId: number | null = null) {
    requestNavigation({ kind: "new", folderId });
  }

  const requestNavigationRef = useRef(requestNavigation);
  requestNavigationRef.current = requestNavigation;

  useEffect(() => {
    if (embedded) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const focusTimer = window.setTimeout(() => closeButtonRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (pendingNavigationRef.current) setPendingNavigation(undefined);
        else requestNavigationRef.current({ kind: "close" });
        return;
      }
      if (event.key !== "Tab") return;
      const focusScope = pendingNavigationRef.current
        ? modalRef.current?.querySelector<HTMLElement>(".wiki-discard-draft")
        : modalRef.current;
      const focusable = focusScope?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
  }, [embedded]);

  async function act(label: string, action: () => Promise<void>) {
    setBusy(label);
    setError("");
    try {
      await action();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function savePage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    const submittedDraft = { ...draft, markdown: editorRef.current?.flush() ?? draft.markdown };
    const title = submittedDraft.title.trim();
    if (!title) {
      setError("Give this page a title.");
      return;
    }
    setBusy("Saving…");
    setError("");
    try {
      const response = submittedDraft.slug
        ? await api<{ page: WikiPage }>(`/api/rooms/${roomId}/wiki/pages/${encodeURIComponent(submittedDraft.slug)}`, {
            method: "PUT",
            body: JSON.stringify({
              title,
              markdown: submittedDraft.markdown,
              folderId: submittedDraft.folderId,
              revision: submittedDraft.revision
            })
          })
        : await api<{ page: WikiPage }>(`/api/rooms/${roomId}/wiki/pages`, {
            method: "POST",
            body: JSON.stringify({ title, markdown: submittedDraft.markdown, folderId: submittedDraft.folderId })
          });
      setPage(response.page);
      setSelectedSlug(response.page.slug);
      setDraft(undefined);
      setConflict(undefined);
      await load();
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        const payload = cause.payload as { page?: WikiPage; current?: WikiPage };
        const current = payload.page ?? payload.current;
        if (current) setConflict({ current, ours: submittedDraft });
        else setError(cause.message);
      } else setError((cause as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function setVisible(candidate: WikiPage, visible: boolean) {
    await act(visible ? "Sharing…" : "Making private…", async () => {
      await api(`/api/rooms/${roomId}/wiki/pages/${encodeURIComponent(candidate.slug)}/reveal`, {
        method: "POST",
        body: JSON.stringify({ visible })
      });
      setPage((current) => (current ? { ...current, visible } : current));
      await load();
    });
  }

  async function removePage(candidate: WikiPage) {
    if (!window.confirm(`Delete “${candidate.title}”? This cannot be undone.`)) return;
    await act("Deleting…", async () => {
      await api(`/api/rooms/${roomId}/wiki/pages/${encodeURIComponent(candidate.slug)}`, { method: "DELETE" });
      setPage(undefined);
      setSelectedSlug(undefined);
      await load();
    });
  }

  async function createFolder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = folderName.trim();
    if (!name) return;
    await act("Creating folder…", async () => {
      await api(`/api/rooms/${roomId}/wiki/folders`, {
        method: "POST",
        body: JSON.stringify({ name, parentId: folderParent })
      });
      setFolderName("");
      setCreatingFolder(false);
      await load();
    });
  }

  async function renameFolder(folder: WikiFolder) {
    const name = renameValue.trim();
    if (!name || (name === folder.name && renameParent === folder.parentId)) {
      setRenamingFolder(undefined);
      return;
    }
    await act("Renaming folder…", async () => {
      await api(`/api/rooms/${roomId}/wiki/folders/${folder.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name, parentId: renameParent })
      });
      setRenamingFolder(undefined);
      await load();
    });
  }

  async function removeFolder(folder: WikiFolder) {
    if (!window.confirm(`Delete the empty folder “${folder.name}”?`)) return;
    await act("Deleting folder…", async () => {
      await api(`/api/rooms/${roomId}/wiki/folders/${folder.id}`, { method: "DELETE" });
      await load();
    });
  }

  function FolderTree({ parentId, depth = 0 }: { parentId: number | null; depth?: number }) {
    return (
      <>
        {pagesFor(parentId).map((candidate) => (
          <button
            key={candidate.slug}
            type="button"
            className={`wiki-tree-page${selectedSlug === candidate.slug ? " is-current" : ""}`}
            aria-current={selectedSlug === candidate.slug ? "page" : undefined}
            style={{ paddingInlineStart: `${14 + depth * 15}px` }}
            onClick={() => choose(candidate.slug)}
          >
            <FileText size={14} /> <span>{candidate.title}</span>
            {candidate.visible && <Eye size={12} aria-label="Shared" />}
          </button>
        ))}
        {foldersFor(parentId).map((folder) => {
          const open = openFolders.has(folder.id);
          const editable = folderCanEdit(folder, accountId, isGm);
          const moveBlocked = folderAndDescendantIds(wiki?.folders ?? [], folder.id);
          return (
            <div className="wiki-folder" key={folder.id}>
              <div className="wiki-folder-row" style={{ paddingInlineStart: `${7 + depth * 15}px` }}>
                <button
                  type="button"
                  className="wiki-folder-toggle"
                  aria-expanded={open}
                  aria-label={`${open ? "Collapse" : "Expand"} ${folder.name}`}
                  onClick={() =>
                    setOpenFolders((current) => {
                      const next = new Set(current);
                      if (next.has(folder.id)) next.delete(folder.id);
                      else next.add(folder.id);
                      return next;
                    })
                  }
                >
                  {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
                {renamingFolder === folder.id ? (
                  <form
                    className="wiki-folder-rename"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void renameFolder(folder);
                    }}
                  >
                    <input autoFocus value={renameValue} onChange={(event) => setRenameValue(event.target.value)} />
                    <select
                      value={renameParent ?? ""}
                      onChange={(event) => setRenameParent(event.target.value ? Number(event.target.value) : null)}
                      aria-label={`Move ${folder.name} into`}
                    >
                      <option value="">At the root</option>
                      {(wiki?.folders ?? [])
                        .filter(
                          (candidate) => !moveBlocked.has(candidate.id) && folderCanEdit(candidate, accountId, isGm)
                        )
                        .map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>
                            {candidate.name}
                          </option>
                        ))}
                    </select>
                  </form>
                ) : editable ? (
                  <button
                    type="button"
                    className="wiki-folder-name"
                    onClick={() => newPage(folder.id)}
                    title={`Create a page in ${folder.name}`}
                  >
                    {folder.name}
                  </button>
                ) : (
                  <span className="wiki-folder-name wiki-folder-name-readonly" title={`${folder.name} (read-only)`}>
                    {folder.name}
                  </span>
                )}
                {editable && renamingFolder !== folder.id && (
                  <span className="wiki-folder-actions">
                    <button
                      type="button"
                      onClick={() => newPage(folder.id)}
                      title="New page here"
                      aria-label={`New page in ${folder.name}`}
                    >
                      <FilePlus2 size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRenamingFolder(folder.id);
                        setRenameValue(folder.name);
                        setRenameParent(folder.parentId);
                      }}
                      title="Rename or move folder"
                      aria-label={`Rename or move ${folder.name}`}
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => void removeFolder(folder)}
                      title="Delete empty folder"
                      aria-label={`Delete ${folder.name}`}
                    >
                      <Trash2 size={12} />
                    </button>
                  </span>
                )}
              </div>
              {open && <FolderTree parentId={folder.id} depth={depth + 1} />}
            </div>
          );
        })}
      </>
    );
  }

  const selectedCanEdit = page ? pageCanEdit(page, accountId, isGm) : false;
  const body = (
    <div className={`wiki-workspace${embedded ? " wiki-embedded" : ""}`}>
      <aside className="wiki-nav" aria-label="Wiki pages">
        <div className="wiki-nav-actions">
          <button type="button" onClick={() => newPage()} disabled={Boolean(busy)}>
            <Plus size={15} /> New page
          </button>
          <button
            type="button"
            onClick={() => {
              setFolderParent(null);
              setFolderName("");
              setCreatingFolder(true);
            }}
            disabled={Boolean(busy)}
            title="New folder"
          >
            <FolderPlus size={15} />
          </button>
        </div>
        <input
          className="wiki-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search pages"
          aria-label="Search pages"
        />
        {creatingFolder && (
          <form className="wiki-folder-create" onSubmit={(event) => void createFolder(event)}>
            <input
              autoFocus
              value={folderName}
              onChange={(event) => setFolderName(event.target.value)}
              placeholder="Folder name"
            />
            <select
              value={folderParent ?? ""}
              onChange={(event) => setFolderParent(event.target.value ? Number(event.target.value) : null)}
              aria-label="Parent folder"
            >
              <option value="">At the root</option>
              {(wiki?.folders ?? [])
                .filter((folder) => folderCanEdit(folder, accountId, isGm))
                .map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.name}
                  </option>
                ))}
            </select>
            <button type="submit">Create</button>
            <button
              type="button"
              onClick={() => {
                setFolderName("");
                setCreatingFolder(false);
              }}
              aria-label="Cancel folder"
            >
              <X size={14} />
            </button>
          </form>
        )}
        <div className="wiki-tree">
          {!wiki ? (
            <p role="status" aria-live="polite">
              {error || "Loading pages…"}
            </p>
          ) : shownPages.length || wiki.folders.length ? (
            <FolderTree parentId={null} />
          ) : (
            <p>Your notebook is empty. Start a page.</p>
          )}
        </div>
      </aside>
      <section className="wiki-page">
        {error && (
          <p className="wiki-message wiki-error" role="alert" aria-live="assertive">
            {error}
          </p>
        )}
        {busy && (
          <p className="wiki-message" role="status" aria-live="polite">
            {busy}
          </p>
        )}
        {pendingNavigation && (
          <aside
            className="wiki-discard-draft"
            role="alertdialog"
            aria-labelledby="wiki-discard-title"
            aria-describedby="wiki-discard-description"
          >
            <h2 id="wiki-discard-title">Discard unsaved changes?</h2>
            <p id="wiki-discard-description">Your draft has changes that have not been saved.</p>
            <div>
              <button type="button" onClick={() => setPendingNavigation(undefined)} autoFocus>
                Keep editing
              </button>
              <button type="button" className="wiki-danger" onClick={() => applyNavigation(pendingNavigation)}>
                Discard draft
              </button>
            </div>
          </aside>
        )}
        {mentionSummary && (
          <aside className="wiki-mention-summary" role="status">
            <span>{mentionSummary}</span>
            <button type="button" onClick={() => setMentionSummary(undefined)} aria-label="Dismiss mention">
              <X size={14} />
            </button>
          </aside>
        )}
        {conflict ? (
          <div className="wiki-conflict" role="alert">
            <h2>Someone saved this page first</h2>
            <p>
              Review both versions before choosing. Keeping your draft does not save it; you can edit it and save
              against the newer revision.
            </p>
            <div className="wiki-conflict-versions">
              <section>
                <h3>Current page</h3>
                <p>{conflict.current.title}</p>
                <textarea value={conflict.current.markdown} readOnly aria-label="Current page Markdown" />
              </section>
              <section>
                <h3>Your draft</h3>
                <p>{conflict.ours.title}</p>
                <textarea value={conflict.ours.markdown} readOnly aria-label="Your draft Markdown" />
              </section>
            </div>
            <div>
              <button
                type="button"
                onClick={() => {
                  setPage(conflict.current);
                  setDraft(undefined);
                  setConflict(undefined);
                }}
              >
                Use current page
              </button>
              <button
                type="button"
                onClick={() => {
                  setDraft({ ...conflict.ours, revision: conflict.current.revision });
                  setConflict(undefined);
                }}
              >
                Keep my draft
              </button>
            </div>
          </div>
        ) : draft ? (
          <form className="wiki-editor" onSubmit={(event) => void savePage(event)}>
            <header>
              <input
                value={draft.title}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                placeholder="Page title"
                aria-label="Page title"
                autoFocus
              />
              <select
                value={draft.folderId ?? ""}
                onChange={(event) =>
                  setDraft({ ...draft, folderId: event.target.value ? Number(event.target.value) : null })
                }
                aria-label="Folder"
              >
                <option value="">At the root</option>
                {(wiki?.folders ?? [])
                  .filter((folder) => folderCanEdit(folder, accountId, isGm))
                  .map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {folder.name}
                    </option>
                  ))}
              </select>
            </header>
            <WikiEditorLoadBoundary
              key={draft.slug ?? `new-${draft.identity ?? 0}`}
              markdown={draft.markdown}
              onMarkdownChange={setDraftMarkdown}
            >
              <Suspense fallback={<p className="wiki-message">Opening rich editor…</p>}>
                <LazyWikiEditor
                  roomId={roomId}
                  markdown={draft.markdown}
                  onMarkdownChange={setDraftMarkdown}
                  onReady={setEditorHandle}
                />
              </Suspense>
            </WikiEditorLoadBoundary>
            <footer>
              <button type="submit" className="primary-button" disabled={Boolean(busy)}>
                <Save size={15} /> Save
              </button>
              <button type="button" onClick={() => requestNavigation({ kind: "cancel" })}>
                Cancel
              </button>
            </footer>
          </form>
        ) : page ? (
          <article className="wiki-reader">
            <header>
              <div>
                <p className="wiki-kicker">{page.visible ? "Shared with the room" : "Private notebook"}</p>
                <h2>{page.title}</h2>
              </div>
              <div className="wiki-page-actions">
                {selectedCanEdit && (
                  <button
                    type="button"
                    onClick={() =>
                      setDraft({
                        title: page.title,
                        markdown: page.markdown,
                        folderId: page.folderId,
                        revision: page.revision,
                        slug: page.slug
                      })
                    }
                  >
                    <Pencil size={14} /> Edit
                  </button>
                )}
                {isGm && (
                  <button type="button" onClick={() => void setVisible(page, !page.visible)}>
                    {page.visible ? <EyeOff size={14} /> : <Eye size={14} />}
                    {page.visible ? "Unshare" : "Share"}
                  </button>
                )}
                {selectedCanEdit && (
                  <button
                    type="button"
                    className="wiki-danger"
                    onClick={() => void removePage(page)}
                    title="Delete page"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </header>
            <div className="wiki-markdown">
              <RulesMarkdown
                markdown={page.markdown}
                idPrefix={`wiki-${page.slug}`}
                roomId={roomId}
                isGm={isGm}
                onWikiMention={openMention}
              />
            </div>
          </article>
        ) : (
          <div className="wiki-empty">
            <FileText size={26} />
            <h2>Pick a page or begin one</h2>
            <p>Private pages are yours to write. The GM can share a finished page with the table.</p>
            <button type="button" className="primary-button" onClick={() => newPage()}>
              <FilePlus2 size={16} /> New page
            </button>
          </div>
        )}
      </section>
    </div>
  );

  if (embedded) return body;
  return (
    <div
      className="modal-scrim wiki-modal-scrim"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestNavigation({ kind: "close" });
      }}
    >
      <section ref={modalRef} className="modal wiki-modal" role="dialog" aria-modal="true" aria-label="Wiki">
        <header className="wiki-modal-header">
          <div>
            <p className="eyebrow">Room notebook</p>
            <h2>Wiki</h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={() => requestNavigation({ kind: "close" })}
            aria-label="Close wiki"
          >
            <X />
          </button>
        </header>
        {body}
      </section>
    </div>
  );
}
