import { useRef, useState } from "react";
import { Download, FileUp } from "lucide-react";
import { api, download } from "./api";

interface PreviewTable {
  name: string;
  dice: string;
  columns: string[];
  tags: string[];
  rows: { label: string; cells: string[] }[];
  rowCount: number;
}

interface Preview {
  preview: PreviewTable[];
  problems: { line: number; message: string }[];
  unknownTags: string[];
}

/**
 * Reading a CSV happens twice: once to show what was found, and again to commit
 * it. Nothing reaches the set until the GM has looked at what they are getting.
 */
export function CsvImport({ setId, onImported }: { setId: number; onImported: () => void }) {
  const [preview, setPreview] = useState<Preview>();
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);

  function body(commit: boolean) {
    const file = input.current?.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    if (commit) {
      form.append("commit", "true");
      form.append("replace", String(replace));
    }
    return form;
  }

  async function look() {
    const form = body(false);
    if (!form) return;
    setBusy(true);
    setError("");
    try {
      setPreview(await api<Preview>(`/api/table-sets/${setId}/import-csv`, { method: "POST", body: form }));
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    const form = body(true);
    if (!form) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ imported: number; droppedTags: string[] }>(`/api/table-sets/${setId}/import-csv`, {
        method: "POST",
        body: form
      });
      setPreview(undefined);
      if (input.current) input.current.value = "";
      if (result.droppedTags.length)
        setError(`Imported, but these tags do not exist here and were left off: ${result.droppedTags.join(", ")}.`);
      onImported();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="csv-import">
      <div className="csv-import-bar">
        <span className="nav-label">Import CSV</span>
        <input ref={input} type="file" accept=".csv,text/csv" onChange={look} />
        <button type="button" onClick={() => download("/api/table-templates/sample.csv", "sample.csv")}>
          <Download size={14} aria-hidden /> Sample CSV
        </button>
      </div>

      {error && <p className="form-error">{error}</p>}

      {preview && (
        <div className="csv-preview">
          {preview.problems.length > 0 && (
            <ul className="table-warnings">
              {preview.problems.map((problem) => (
                <li key={`${problem.line}-${problem.message}`}>
                  Line {problem.line}: {problem.message}
                </li>
              ))}
            </ul>
          )}
          {preview.unknownTags.length > 0 && (
            <p className="empty-note">
              These tags are not in this instance and will be left off: {preview.unknownTags.join(", ")}. Add them on
              the Tags page first if you want them kept.
            </p>
          )}

          {preview.preview.map((table) => (
            <div key={table.name} className="csv-preview-table">
              <h4>
                {table.name} <span className="nav-label">{table.dice}</span>
              </h4>
              <table className="grid">
                <thead>
                  <tr>
                    <th className="grid-die">{table.dice}</th>
                    {table.columns.map((column) => (
                      <th key={column}>{column}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((row, index) => (
                    <tr key={index}>
                      <td className="grid-die">{row.label}</td>
                      {table.columns.map((_, column) => (
                        <td key={column}>{row.cells[column] ?? ""}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {table.rowCount > table.rows.length && (
                <p className="empty-note">
                  Showing {table.rows.length} of {table.rowCount} rows.
                </p>
              )}
            </div>
          ))}

          {preview.preview.length > 0 && (
            <div className="csv-preview-actions">
              <label>
                <input type="checkbox" checked={replace} onChange={(event) => setReplace(event.target.checked)} />
                Replace everything in this set, rather than adding to it
              </label>
              <button type="button" onClick={() => setPreview(undefined)}>
                Cancel
              </button>
              <button type="button" className="primary-button" disabled={busy} onClick={commit}>
                <FileUp size={15} aria-hidden /> Import {preview.preview.length} table
                {preview.preview.length === 1 ? "" : "s"}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
