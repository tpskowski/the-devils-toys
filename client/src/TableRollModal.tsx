import { useEffect, useRef, useState } from "react";
import { Dices, X } from "lucide-react";
import type { RollTable, TableRollResult, TableRollVisibility } from "@devils-toys/shared";
import { api } from "./api";
import { InlineMarkdown } from "./InlineMarkdown";
import { visibilityNotice } from "./tables";

export function TableRollModal({
  roomId,
  setId,
  tableId,
  isGm,
  onClose
}: {
  roomId: number;
  setId: string;
  tableId: string;
  isGm: boolean;
  onClose: () => void;
}) {
  const [table, setTable] = useState<RollTable>();
  const [results, setResults] = useState<TableRollResult[]>([]);
  const [error, setError] = useState("");
  const [rollError, setRollError] = useState("");
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    api<{ table: RollTable }>(
      `/api/rooms/${roomId}/rules-tables/${encodeURIComponent(setId)}/${encodeURIComponent(tableId)}`
    )
      .then((response) => setTable(response.table))
      .catch((cause: Error) => setError(cause.message));
  }, [roomId, setId, tableId]);

  useEffect(() => {
    closeButton.current?.focus();
    const close = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    addEventListener("keydown", close);
    return () => removeEventListener("keydown", close);
  }, [onClose]);

  async function roll(visibility: TableRollVisibility) {
    if (!table || !isGm) return;
    setRollError("");
    try {
      const response = await api<{ roll: TableRollResult; followUps: TableRollResult[] }>(
        `/api/rooms/${roomId}/tables/roll`,
        {
          method: "POST",
          body: JSON.stringify({ setId, tableId, visibility })
        }
      );
      setResults([response.roll, ...response.followUps]);
    } catch (cause) {
      setRollError((cause as Error).message);
    }
  }

  return (
    <div
      className="modal-scrim"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section className="modal modal-wide tables-modal" role="dialog" aria-modal="true" aria-label="Rules table">
        <header>
          <p className="eyebrow">Rules table</p>
          <h2>{table?.name ?? "Loading table…"}</h2>
          <button ref={closeButton} type="button" onClick={onClose} aria-label="Close">
            <X />
          </button>
        </header>
        {error ? (
          <p className="form-error tables-error">{error}</p>
        ) : table ? (
          <div className="tables-workspace">
            {isGm && (
              <div className="tables-toolbar">
                {(["public", "private", "invisible", "reveal"] as TableRollVisibility[]).map((visibility) => (
                  <button
                    type="button"
                    className={`tables-roll${visibility === "public" ? "" : " tables-roll-secondary"}`}
                    key={visibility}
                    title={visibilityNotice(visibility)}
                    onClick={() => roll(visibility)}
                  >
                    <Dices aria-hidden="true" /> {visibility[0].toUpperCase() + visibility.slice(1)} {table.dice}
                  </button>
                ))}
              </div>
            )}
            {results.length > 0 && (
              <div className="tables-results" role="status">
                {results.map((result, index) => (
                  <div className="tables-result" key={`${result.tableId}-${index}`}>
                    <span className="tables-result-step">{index + 1}</span>
                    <span className="tables-result-total">{result.total}</span>
                    <span>
                      <span className="tables-result-text">
                        <InlineMarkdown>{result.text || `No entry for ${result.total}`}</InlineMarkdown>
                      </span>
                      <small>{result.tableName}</small>
                    </span>
                  </div>
                ))}
              </div>
            )}
            {rollError && <p className="form-error tables-error">{rollError}</p>}
            <div className="tables-detail">
              <small>{table.section}</small>
              <div className="tables-grid-scroll">
                <table className="tables-grid">
                  <thead>
                    <tr>
                      <th>{table.dice}</th>
                      {table.columns.map((column) => (
                        <th key={column}>
                          <InlineMarkdown>{column}</InlineMarkdown>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {table.rows.map((row) => (
                      <tr key={row.label}>
                        <th scope="row">{row.label}</th>
                        {row.cells.map((cell, index) => (
                          <td key={index}>
                            <InlineMarkdown>{cell}</InlineMarkdown>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : (
          <p className="loading">Loading…</p>
        )}
      </section>
    </div>
  );
}
