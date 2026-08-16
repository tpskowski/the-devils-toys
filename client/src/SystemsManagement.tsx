import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowDownToLine, Boxes, CircleAlert, Download, RotateCcw, Trash2, Upload } from "lucide-react";
import { api } from "./api";
import { parseRepositoryInput } from "./github-repository";

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
}

export function SystemsManagement({ onSystemsChanged }: { onSystemsChanged?: () => Promise<void> }) {
  const [systems, setSystems] = useState<InstalledSystem[]>();
  const [catalog, setCatalog] = useState<CatalogResponse>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const bundleInput = useRef<HTMLInputElement>(null);

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
  }, [load]);

  async function act(key: string, action: () => Promise<string>) {
    setBusy(key);
    setError("");
    setNotice("");
    try {
      setNotice(await action());
    } catch (cause) {
      setError((cause as Error).message);
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

  const importFrom = (body: Record<string, string>, key: string) =>
    act(key, async () =>
      installed(await api<InstallResult>("/api/admin/systems/import", { method: "POST", body: JSON.stringify(body) }))
    );

  function uploadBundle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = bundleInput.current?.files?.[0];
    if (!file) return setError("Choose a .devilsystem.zip to install.");
    const form = new FormData();
    form.append("bundle", file);
    void act("upload", async () => {
      const result = await api<InstallResult>("/api/admin/systems", { method: "POST", body: form });
      if (bundleInput.current) bundleInput.current.value = "";
      return installed(result);
    });
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

      <SystemCatalog
        catalog={catalog}
        busy={busy}
        onInstall={(entry) => void importFrom({ id: entry.id }, `catalog:${entry.id}`)}
      />

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

      <InstalledSystems systems={systems} busy={busy} act={act} />
    </div>
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
                    ? `Update to ${entry.version}`
                    : entry.installed
                      ? "Reinstall"
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
  busy,
  act
}: {
  systems: InstalledSystem[] | undefined;
  busy: string;
  act: (key: string, action: () => Promise<string>) => Promise<void>;
}) {
  if (!systems?.length) return null;

  return (
    <section className="inspector-section">
      <h3>
        Installed <span className="ledger-count">{systems.length}</span>
      </h3>
      <ul className="systems-installed">
        {systems.map((system) => (
          <li key={system.id} className={system.retired ? "retired" : ""}>
            <div className="systems-installed-name">
              <strong>{system.name}</strong>
              <code>{system.id}</code>
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
            </small>
            <div className="systems-actions">
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
        ))}
      </ul>
    </section>
  );
}
