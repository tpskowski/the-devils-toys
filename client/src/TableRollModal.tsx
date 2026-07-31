import { useEffect, useState } from "react";
import { Dices, X } from "lucide-react";
import type { RollTable, TableRollVisibility } from "@devils-toys/shared";
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
  const [result, setResult] = useState<{ total: number; text: string }>();
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ table: RollTable }>(
      `/api/rooms/${roomId}/rules-tables/${encodeURIComponent(setId)}/${encodeURIComponent(tableId)}`
    )
      .then((response) => setTable(response.table))
      .catch((cause: Error) => setError(cause.message));
  }, [roomId, setId, tableId]);

  async function roll(visibility: TableRollVisibility) {
    if (!table || !isGm) return;
    try {
      const response = await api<{ roll: { total: number; text: string } }>(`/api/rooms/${roomId}/tables/roll`, {
        method: "POST",
        body: JSON.stringify({ setId, tableId, visibility })
      });
      setResult(response.roll);
    } catch (cause) {
      setError((cause as Error).message);
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
          <button type="button" onClick={onClose} aria-label="Close">
            <X />
          </button>
        </header>
        {error ? (
          <p className="form-error tables-error">{error}</p>
        ) : table ? (
          <div className="tables-workspace">
            {isGm && (
              <div className="tables-toolbar">
                {(["public", "private", ...(isGm ? ["invisible"] : []), "reveal"] as TableRollVisibility[]).map(
                  (visibility) => (
                    <button
                      type="button"
                      className={`tables-roll${visibility === "public" ? "" : " tables-roll-secondary"}`}
                      key={visibility}
                      title={visibilityNotice(visibility)}
                      onClick={() => roll(visibility)}
                    >
                      <Dices aria-hidden="true" /> {visibility[0].toUpperCase() + visibility.slice(1)} {table.dice}
                    </button>
                  )
                )}
              </div>
            )}
            {result && (
              <div className="tables-result" role="status">
                <span className="tables-result-total">{result.total}</span>
                <span className="tables-result-text">
                  <InlineMarkdown>{result.text || `No entry for ${result.total}`}</InlineMarkdown>
                </span>
              </div>
            )}
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
