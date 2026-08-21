import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowDownToLine, Boxes, CircleAlert, Download, RotateCcw, Trash2, Upload } from "lucide-react";
import { ApiError, api } from "./api";
import { parseRepositoryInput } from "./github-repository";
import { Modal } from "./Modal";
import { systemUpdateNotice, type SystemUpdate } from "./system-updates";

/**
 * What a server has, and what it could have.
 *
 * This application ships no game system, so a fresh server can do nothing at all
 * until someone installs one — which makes this panel the first-run screen as
 * much as an administrative one. It is written for that: the empty state says
 * what to do rather than reporting that a list is empty.
 */

export interface InstalledSystem {
  id: string;
  name: string;
  origin: "builtin" | "installed";
  retired: boolean;
  loaded: boolean;
  tagline: string;
  rooms: number;
  characters: number;
  /** The author's own release version, empty for a system that declares none. */
  version: string;
  source?: { repository: string; ref: string; revision: string; version: string; fetchedAt: string };
  installedAt: string;
  updatedAt: string;
}

interface CatalogSystem {
  id: string;
  name: string;
  tagline: string;
  repository: string;
  ref: string;
  license: string;
  author: string;
  version: string;
  homepage: string;
  installed: boolean;
  installedVersion: string;
  breaking: boolean;
  releaseNotes: string[];
  releaseFingerprint: string;
  updateAvailable: boolean;
}

interface CatalogResponse {
  configured: boolean;
  error?: string;
  systems: CatalogSystem[];
}

interface InstallResult {
  system: InstalledSystem;
  replaced: boolean;
  licenses: string[];
  /** The version an update moved away from. Absent for an install, which moved away from nothing. */
  from?: string;
}

/** The refusal which protects rooms from an unacknowledged breaking release. */
interface BreakingSystemChange {
  systemId: string;
  systemName: string;
  fromVersion: string;
  toVersion: string;
  notes: string[];
  fingerprint: string;
}

interface BreakingConfirmation {
  change: BreakingSystemChange;
  retry: (fingerprint: string) => void;
}

function breakingSystemChange(cause: unknown): BreakingSystemChange | undefined {
  if (!(cause instanceof ApiError) || cause.status !== 409 || !cause.payload || typeof cause.payload !== "object")
    return;
  const payload = cause.payload as { code?: unknown; change?: unknown };
  const change = payload.change;
  if (payload.code !== "breaking_system_change" || !change || typeof change !== "object") return;
  const candidate = change as Partial<BreakingSystemChange>;
  if (
    typeof candidate.systemId !== "string" ||
    typeof candidate.systemName !== "string" ||
    typeof candidate.fromVersion !== "string" ||
    typeof candidate.toVersion !== "string" ||
    !Array.isArray(candidate.notes) ||
    !candidate.notes.every((note) => typeof note === "string") ||
    typeof candidate.fingerprint !== "string"
  )
    return;
  return candidate as BreakingSystemChange;
}

export function SystemsManagement({ onSystemsChanged }: { onSystemsChanged?: () => Promise<void> }) {
  const [systems, setSystems] = useState<InstalledSystem[]>();
  const [catalog, setCatalog] = useState<CatalogResponse>();
  const [updates, setUpdates] = useState<Map<string, SystemUpdate>>(new Map());
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  /** A refused update belongs on the row whose button was pressed, keyed by id. */
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [breakingConfirmation, setBreakingConfirmation] = useState<BreakingConfirmation>();
  const bundleInput = useRef<HTMLInputElement>(null);

  /**
   * Asked for separately from the list, because it is a request per system to a
   * repository that may be slow or gone. The list is this server's own answer
   * and should not wait behind somebody else's; a check that fails entirely
   * leaves every row exactly as it would be without one.
   */
  const loadUpdates = useCallback(async () => {
    const answers = await api<{ systems: SystemUpdate[] }>("/api/admin/systems/updates").catch(() => ({ systems: [] }));
    setUpdates(new Map(answers.systems.map((update) => [update.id, update])));
  }, []);

  const load = useCallback(async () => {
    const [installed, menu] = await Promise.all([
      api<{ systems: InstalledSystem[] }>("/api/admin/systems"),
      // A catalogue this server cannot reach must not stop it listing what it
      // already has, so the menu's failure is caught and shown beside the list.
      api<CatalogResponse>("/api/admin/systems/catalog").catch((cause: Error): CatalogResponse => ({
        configured: true,
        error: cause.message,
        systems: []
      }))
    ]);
    setSystems(installed.systems);
    setCatalog(menu);
  }, []);

  useEffect(() => {
    load().catch((cause) => setError((cause as Error).message));
    void loadUpdates();
  }, [load, loadUpdates]);

  async function act(
    key: string,
    action: () => Promise<string>,
    onFailure?: (message: string) => void,
    onBreaking?: (change: BreakingSystemChange) => void
  ) {
    setBusy(key);
    setError("");
    setNotice("");
    try {
      setNotice(await action());
    } catch (cause) {
      const change = breakingSystemChange(cause);
      if (change && onBreaking) onBreaking(change);
      else {
        const message = (cause as Error).message;
        if (onFailure) onFailure(message);
        else setError(message);
      }
    } finally {
      /**
       * Reloaded whether the action worked or not. A refusal here is usually the
       * server saying the world is not what this page thinks — "still in use by
       * 1 room" against a row reading "0 rooms" is the panel arguing with its own
       * error message, and the server is the one that is right.
       */
      await load().catch(() => undefined);
      /**
       * And the rest of the application with it. Which systems exist is read
       * once at start, so without this an admin installs a system and is still
       * told, by the room they immediately try to make, that there are none.
       */
      await onSystemsChanged?.().catch(() => undefined);
      // Not waited for: the states fill in behind a list that is already right.
      void loadUpdates();
      setBusy("");
    }
  }

  /** One sentence for an install, however it arrived and whatever it replaced. */
  function installed(result: InstallResult) {
    const licence = result.licenses.filter(Boolean).join(", ");
    return `${result.system.name} ${result.replaced ? "replaced the version that was installed" : "is installed"}${
      licence ? `, under ${licence}` : ""
    }.`;
  }

  function importFrom(
    body: Record<string, string>,
    key: string,
    onFailure?: (message: string) => void,
    knownChange?: BreakingSystemChange
  ) {
    const run = (acknowledgeBreaking?: string) =>
      void act(
        key,
        async () =>
          installed(
            await api<InstallResult>("/api/admin/systems/import", {
              method: "POST",
              body: JSON.stringify(acknowledgeBreaking ? { ...body, acknowledgeBreaking } : body)
            })
          ),
        onFailure,
        (change) => setBreakingConfirmation({ change, retry: run })
      );
    if (knownChange) setBreakingConfirmation({ change: knownChange, retry: run });
    else run();
  }

  function installCatalog(entry: CatalogSystem) {
    const knownChange =
      entry.installed && entry.breaking && entry.releaseFingerprint
        ? {
            systemId: entry.id,
            systemName: entry.name,
            fromVersion: entry.installedVersion,
            toVersion: entry.version,
            notes: entry.releaseNotes,
            fingerprint: entry.releaseFingerprint
          }
        : undefined;
    importFrom({ id: entry.id }, `catalog:${entry.id}`, undefined, knownChange);
  }

  /**
   * Updating is installing, from the source already recorded against the row —
   * which is why the server does it on the import path, atomically and through
   * every check a bundle goes through. An update that would drop a sheet field
   * in use is refused and the running system is untouched.
   *
   * It has a route of its own so the server's record names the version it moved
   * from, and so the row does not have to restate its own source back at a
   * server that already holds it. The refusal is the row's own answer rather
   * than the panel's, because it is the row's button that asked the question.
   */
  function updateSystem(system: InstalledSystem) {
    if (!system.source) return;
    setRowErrors((held) => ({ ...held, [system.id]: "" }));
    const run = (acknowledgeBreaking?: string) =>
      void act(
        `update:${system.id}`,
        async () => {
          const result = await api<InstallResult>(`/api/admin/systems/${encodeURIComponent(system.id)}/update`, {
            method: "POST",
            body: acknowledgeBreaking ? JSON.stringify({ acknowledgeBreaking }) : undefined
          });
          // An update knows what it moved away from, which an install never
          // does — so it says so rather than falling back to "is installed".
          const to = result.system.version;
          if (result.from && to && result.from !== to)
            return `${result.system.name} updated from ${result.from} to ${to}.`;
          return installed(result);
        },
        (message) => setRowErrors((held) => ({ ...held, [system.id]: message })),
        (change) => setBreakingConfirmation({ change, retry: run })
      );
    const answer = updates.get(system.id);
    if (answer?.breaking && answer.releaseFingerprint)
      setBreakingConfirmation({
        change: {
          systemId: answer.id,
          systemName: answer.name,
          fromVersion: answer.installedVersion,
          toVersion: answer.availableVersion,
          notes: answer.releaseNotes,
          fingerprint: answer.releaseFingerprint
        },
        retry: run
      });
    else run();
  }

  function uploadBundle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = bundleInput.current?.files?.[0];
    if (!file) return setError("Choose a .devilsystem.zip to install.");
    const run = (acknowledgeBreaking?: string) => {
      const form = new FormData();
      form.append("bundle", file);
      if (acknowledgeBreaking) form.append("acknowledgeBreaking", acknowledgeBreaking);
      void act(
        "upload",
        async () => {
          const result = await api<InstallResult>("/api/admin/systems", { method: "POST", body: form });
          if (bundleInput.current) bundleInput.current.value = "";
          return installed(result);
        },
        undefined,
        (change) => setBreakingConfirmation({ change, retry: run })
      );
    };
    run();
  }

  function importByRepository(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const typed = String(values.get("repository") ?? "");
    const parsed = parseRepositoryInput(typed);
    if (!parsed) {
      return setError(
        typed.trim()
          ? `"${typed.trim()}" is not a GitHub repository. Paste its address, or write it as owner/repository.`
          : "Name the repository to install from, or paste its address."
      );
    }
    // A ref typed into the second box is a deliberate choice and outranks one
    // that merely came along with a pasted address.
    const ref = String(values.get("ref") ?? "").trim() || parsed.ref || "main";
    void importFrom({ repository: parsed.repository, ref }, "repository");
  }

  return (
    <div className="systems-management">
      {(error || notice) && (
        <p className={`management-message ${error ? "error" : "success"}`} role={error ? "alert" : "status"}>
          {error || notice}
        </p>
      )}

      {systems && systems.length === 0 && (
        <div className="systems-empty">
          <Boxes size={22} />
          <div>
            <strong>This server has no game system yet.</strong>
            <p>
              The Devil's Toys is a virtual tabletop; a game system is installed into it. Until one is, there is nothing
              for a room to be played on. Install one below.
            </p>
          </div>
        </div>
      )}

      <SystemCatalog catalog={catalog} busy={busy} onInstall={installCatalog} />

      <section className="inspector-section">
        <h3>Install from a repository</h3>
        <p>
          Any repository this server is allowed to reach, whether or not it is in the catalogue. This is how a system is
          installed while it is still being written. Paste the repository&rsquo;s address — a link to a tag or a commit
          installs that one.
        </p>
        <form className="systems-source-form" onSubmit={importByRepository}>
          <label>
            Repository
            <input
              name="repository"
              placeholder="https://github.com/owner/devils-toys-example"
              autoComplete="off"
              required
            />
          </label>
          <label>
            Branch, tag, or commit
            <input name="ref" placeholder="main — or taken from the address" autoComplete="off" />
          </label>
          <button className="primary-button compact" disabled={Boolean(busy)}>
            <ArrowDownToLine size={16} /> {busy === "repository" ? "Fetching…" : "Install"}
          </button>
        </form>
      </section>

      <section className="inspector-section">
        <h3>Install from a file</h3>
        <p>A bundle exported from this or another server, for a system that is not in a repository at all.</p>
        <form className="systems-source-form" onSubmit={uploadBundle}>
          <label>
            Bundle
            <input ref={bundleInput} type="file" name="bundle" accept=".zip,application/zip" />
          </label>
          <button className="primary-button compact" disabled={Boolean(busy)}>
            <Upload size={16} /> {busy === "upload" ? "Installing…" : "Install"}
          </button>
        </form>
      </section>

      <InstalledSystems
        systems={systems}
        updates={updates}
        rowErrors={rowErrors}
        busy={busy}
        act={act}
        onUpdate={updateSystem}
      />
      {breakingConfirmation && (
        <BreakingSystemDialog
          change={breakingConfirmation.change}
          busy={Boolean(busy)}
          onCancel={() => setBreakingConfirmation(undefined)}
          onConfirm={() => {
            const confirmation = breakingConfirmation;
            setBreakingConfirmation(undefined);
            confirmation.retry(confirmation.change.fingerprint);
          }}
        />
      )}
    </div>
  );
}

function releaseVersion(version: string) {
  return version || "No version declared";
}

function BreakingSystemDialog({
  change,
  busy,
  onCancel,
  onConfirm
}: {
  change: BreakingSystemChange;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal title={`Replace ${change.systemName}?`} onClose={onCancel}>
      <div className="systems-breaking-dialog">
        <p className="modal-intro">
          This release makes breaking changes. Replacing {change.systemName} moves it from{" "}
          {releaseVersion(change.fromVersion)}
          {" to "}
          {releaseVersion(change.toVersion)}. Existing rooms keep their system, but review these changes before
          continuing.
        </p>
        {change.notes.length > 0 ? (
          <ul aria-label="Breaking release notes">
            {change.notes.map((note, index) => (
              <li key={`${index}:${note}`}>{note}</li>
            ))}
          </ul>
        ) : (
          <p className="systems-note">The release did not include details of its breaking changes.</p>
        )}
        <div className="systems-breaking-actions">
          <button type="button" className="secondary-button" onClick={onCancel} disabled={busy} autoFocus>
            Cancel
          </button>
          <button type="button" className="danger-button" onClick={onConfirm} disabled={busy}>
            Replace system
          </button>
        </div>
      </div>
    </Modal>
  );
}

function SystemCatalog({
  catalog,
  busy,
  onInstall
}: {
  catalog: CatalogResponse | undefined;
  busy: string;
  onInstall: (entry: CatalogSystem) => void;
}) {
  if (!catalog) return null;

  if (!catalog.configured) {
    return (
      <section className="inspector-section">
        <h3>Catalogue</h3>
        <p>
          This server has no system catalogue configured, so there is no menu to choose from. Set{" "}
          <code>DEVILS_TOYS_SYSTEM_CATALOG_URL</code> to offer one, or install from a repository below.
        </p>
      </section>
    );
  }

  return (
    <section className="inspector-section">
      <h3>Catalogue</h3>
      {catalog.error ? (
        <p className="systems-catalog-error">
          <CircleAlert size={16} /> The catalogue could not be read: {catalog.error}
        </p>
      ) : catalog.systems.length === 0 ? (
        <p>The catalogue is reachable and lists nothing.</p>
      ) : (
        <ul className="systems-catalog">
          {catalog.systems.map((entry) => (
            <li key={entry.id}>
              <div className="systems-catalog-name">
                <strong>{entry.name}</strong>
                {entry.version && <span className="systems-version">{entry.version}</span>}
                {entry.installed && entry.breaking && <span className="systems-flag broken">Breaking release</span>}
              </div>
              {entry.tagline && <p>{entry.tagline}</p>}
              <small>
                {[entry.author, entry.license, entry.repository].filter(Boolean).join(" · ")}
                {entry.ref && entry.ref !== "main" ? ` @ ${entry.ref}` : ""}
              </small>
              <button
                className={entry.installed && !entry.updateAvailable ? "secondary-button" : "primary-button compact"}
                onClick={() => onInstall(entry)}
                disabled={Boolean(busy)}
              >
                <ArrowDownToLine size={16} />{" "}
                {busy === `catalog:${entry.id}`
                  ? "Fetching…"
                  : entry.updateAvailable
                    ? `${entry.breaking ? "Review update" : "Update"} to ${entry.version}`
                    : entry.installed
                      ? entry.breaking
                        ? "Review reinstall"
                        : "Reinstall"
                      : "Install"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function InstalledSystems({
  systems,
  updates,
  rowErrors,
  busy,
  act,
  onUpdate
}: {
  systems: InstalledSystem[] | undefined;
  updates: Map<string, SystemUpdate>;
  rowErrors: Record<string, string>;
  busy: string;
  act: (key: string, action: () => Promise<string>) => Promise<void>;
  onUpdate: (system: InstalledSystem) => void;
}) {
  if (!systems?.length) return null;

  return (
    <section className="inspector-section">
      <h3>
        Installed <span className="ledger-count">{systems.length}</span>
      </h3>
      <ul className="systems-installed">
        {systems.map((system) => {
          const answer = updates.get(system.id);
          const update = systemUpdateNotice(answer);
          const refused = rowErrors[system.id];
          return (
            <li key={system.id} className={system.retired ? "retired" : ""}>
              <div className="systems-installed-name">
                <strong>{system.name}</strong>
                <code>{system.id}</code>
                {/* A version is the author's word, and a system that never gave
                  one says so: a blank here would read as a page that failed to
                  fetch something rather than as a system that declares none. */}
                {system.version ? (
                  <span className="systems-version">{system.version}</span>
                ) : (
                  <span className="systems-version none">No version declared</span>
                )}
                {answer?.breaking && update.action && <span className="systems-flag broken">Breaking release</span>}
                {system.retired && <span className="systems-flag">Retired</span>}
                {/* A row whose definition will not load: its rooms still open on
                  what they hold, and it can be replaced or removed. */}
                {!system.loaded && <span className="systems-flag broken">Will not load</span>}
              </div>
              {system.tagline && <p>{system.tagline}</p>}
              <small>
                {system.rooms} room{system.rooms === 1 ? "" : "s"} · {system.characters} character
                {system.characters === 1 ? "" : "s"}
                {system.source ? ` · ${system.source.repository}@${system.source.ref}` : " · installed from a file"}
                {update.origin ? ` · ${update.origin}` : ""}
              </small>
              {update.message && (
                <p className={`systems-note${update.warning ? " warn" : ""}`}>
                  {update.warning && <CircleAlert size={14} />}
                  {update.message}
                </p>
              )}
              {refused && (
                <p className="systems-note warn" role="alert">
                  <CircleAlert size={14} />
                  {refused}
                </p>
              )}
              <div className="systems-actions">
                {update.action && (
                  <button
                    // Drawn as the offer it is only where something is actually
                    // on offer. A reinstall is a choice an admin may want and
                    // not one the page should be pressing on them.
                    className={answer?.state === "newer" ? "primary-button compact" : "secondary-button"}
                    disabled={Boolean(busy)}
                    onClick={() => onUpdate(system)}
                  >
                    <ArrowDownToLine size={16} /> {busy === `update:${system.id}` ? "Fetching…" : update.action}
                  </button>
                )}
                <a className="secondary-button" href={`/api/admin/systems/${system.id}/export`}>
                  <Download size={16} /> Export
                </a>
                {system.retired ? (
                  <button
                    className="secondary-button"
                    disabled={Boolean(busy)}
                    onClick={() =>
                      void act(`restore:${system.id}`, async () => {
                        await api(`/api/admin/systems/${system.id}/restore`, { method: "POST" });
                        return `${system.name} is offered for new rooms again.`;
                      })
                    }
                  >
                    <RotateCcw size={16} /> Restore
                  </button>
                ) : (
                  <button
                    className="secondary-button"
                    disabled={Boolean(busy)}
                    onClick={() =>
                      void act(`retire:${system.id}`, async () => {
                        await api(`/api/admin/systems/${system.id}/retire`, { method: "POST" });
                        return `${system.name} is retired. Its rooms keep working; no new room may choose it.`;
                      })
                    }
                  >
                    Retire
                  </button>
                )}
                <button
                  className="danger-button"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    void act(`delete:${system.id}`, async () => {
                      await api(`/api/admin/systems/${system.id}`, { method: "DELETE" });
                      return `${system.name} and its content have been removed.`;
                    })
                  }
                >
                  <Trash2 size={16} /> Delete
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
