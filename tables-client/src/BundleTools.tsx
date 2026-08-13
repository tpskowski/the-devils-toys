import { useRef, useState } from "react";
import { Download, PackageOpen, Upload } from "lucide-react";
import { api, download } from "./api";
import type { Permissions } from "./session";

type ImportStatus = "new" | "identical" | "conflict";
type Action = "create" | "overwrite" | "skip";

interface BundlePreview {
  sets: { name: string; tags: string[]; status: ImportStatus; tables: number }[];
  newTags: { slug: string; label: string }[];
}

const defaultAction: Record<ImportStatus, Action> = {
  new: "create",
  identical: "skip",
  conflict: "create"
};

const statusNote: Record<ImportStatus, string> = {
  new: "not here yet",
  identical: "already here, unchanged",
  conflict: "a set of this name exists, with different tables"
};

/** Moving sets between copies of the application, as one zip archive. */
export function BundleTools({ permissions, onImported }: { permissions: Permissions; onImported: () => void }) {
  const [preview, setPreview] = useState<BundlePreview>();
  const [actions, setActions] = useState<Record<string, Action>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const input = useRef<HTMLInputElement>(null);

  async function look() {
    const file = input.current?.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    setBusy(true);
    setError("");
    setDone("");
    try {
      const result = await api<BundlePreview>("/api/table-import", { method: "POST", body: form });
      setPreview(result);
      setActions(Object.fromEntries(result.sets.map((set) => [set.name, defaultAction[set.status]])));
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    const file = input.current?.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    form.append("commit", "true");
    form.append("actions", JSON.stringify(actions));
    setBusy(true);
    setError("");
    try {
      const result = await api<{ created: number; overwritten: number; skipped: number; tagsCreated: number }>(
        "/api/table-import",
        { method: "POST", body: form }
      );
      setPreview(undefined);
      if (input.current) input.current.value = "";
      setDone(
        `Imported: ${result.created} added, ${result.overwritten} replaced, ${result.skipped} skipped, ` +
          `${result.tagsCreated} tag${result.tagsCreated === 1 ? "" : "s"} created.`
      );
      onImported();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="bundle-tools">
      <div className="bundle-bar">
        <button type="button" onClick={() => download("/api/table-export", "devils-tables.zip")}>
          <PackageOpen size={15} aria-hidden /> Export all custom sets
        </button>
        {permissions.canAdminister && (
          <button
            type="button"
            title="JSON for raw/tables, plus a CLI importer that previews and confirms changes"
            onClick={() => {
              setError("");
              download("/api/table-repo-export", "devils-tables-repository.zip").catch((cause: Error) =>
                setError(cause.message)
              );
            }}
          >
            <Download size={15} aria-hidden /> Export for repository
          </button>
        )}
        {permissions.canEdit && (
          <label className="bundle-upload">
            <Upload size={15} aria-hidden /> Import a bundle
            <input ref={input} type="file" accept=".zip,application/zip" onChange={look} />
          </label>
        )}
      </div>

      {error && <p className="form-error">{error}</p>}
      {done && <p className="empty-note">{done}</p>}

      {preview && (
        <div className="bundle-preview">
          {preview.newTags.length > 0 && (
            <p className="empty-note">
              New tags this bundle brings: {preview.newTags.map((tag) => tag.label).join(", ")}.
            </p>
          )}
          <table className="tags-table">
            <thead>
              <tr>
                <th>Set</th>
                <th>Tables</th>
                <th>Here already?</th>
                <th>What to do</th>
              </tr>
            </thead>
            <tbody>
              {preview.sets.map((set) => (
                <tr key={set.name}>
                  <td>{set.name}</td>
                  <td>{set.tables}</td>
                  <td className="tags-usage">{statusNote[set.status]}</td>
                  <td>
                    <select
                      value={actions[set.name] ?? "create"}
                      aria-label={`What to do with ${set.name}`}
                      onChange={(event) =>
                        setActions((current) => ({ ...current, [set.name]: event.target.value as Action }))
                      }
                    >
                      <option value="create">Add as a new set</option>
                      <option value="overwrite" disabled={set.status === "new"}>
                        Replace the one here
                      </option>
                      <option value="skip">Skip</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="csv-preview-actions">
            <button type="button" onClick={() => setPreview(undefined)}>
              Cancel
            </button>
            <button type="button" className="primary-button" disabled={busy} onClick={commit}>
              Import
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
