import { ArrowDown, ArrowUp, Plus, Trash2, Wand2 } from "lucide-react";
import { SUPPORTED_DIE_SIDES, type RollTable, type TableTag, type TableTagDefinition } from "@devils-toys/shared";
import { InlineMarkdown } from "./InlineMarkdown";
import { TagPicker } from "./TagPicker";
import {
  addColumn,
  addRow,
  fillRows,
  moveRow,
  removeColumn,
  removeRow,
  setCell,
  setColumn,
  setDice,
  setNextTable,
  setRowLabel,
  tableWarnings
} from "./tables";

/**
 * One table, edited as the grid it is. Everything here changes the table in the
 * caller's hands; nothing is written to the document until the caller applies it.
 */
export function TableGrid({
  table,
  tables,
  vocabulary,
  readOnly,
  canRename,
  onChange,
  onCreateTag
}: {
  table: RollTable;
  tables: readonly RollTable[];
  vocabulary: readonly TableTagDefinition[];
  readOnly: boolean;
  canRename: boolean;
  onChange: (table: RollTable) => void;
  onCreateTag: (label: string) => Promise<TableTag>;
}) {
  const warnings = tableWarnings(table);

  return (
    <div className="table-grid">
      <div className="table-grid-meta">
        <label>
          Name
          <input
            value={table.name}
            maxLength={120}
            readOnly={readOnly || !canRename}
            onChange={(event) => onChange({ ...table, name: event.target.value })}
          />
        </label>
        <label>
          Die
          <select
            value={table.dice}
            disabled={readOnly}
            onChange={(event) => onChange(setDice(table, event.target.value))}
          >
            {SUPPORTED_DIE_SIDES.map((sides) => (
              <option key={sides} value={`d${sides}`}>
                d{sides}
              </option>
            ))}
            <option value="2d6">2d6</option>
          </select>
        </label>
        {!canRename && !readOnly && (
          <p className="empty-note">
            This heading holds several tables, so its name comes partly from the first result column.
          </p>
        )}
      </div>

      <TagPicker
        label="Tags for this table"
        selected={table.tags}
        vocabulary={vocabulary}
        readOnly={readOnly}
        onChange={(tags) => onChange({ ...table, tags })}
        onCreate={onCreateTag}
      />

      {warnings.length > 0 && (
        <ul className="table-warnings">
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}

      <div className="table-grid-scroll">
        <table className="grid">
          <thead>
            <tr>
              <th className="grid-die">{table.dice}</th>
              {table.columns.map((column, index) => (
                <th key={index}>
                  {readOnly ? (
                    <InlineMarkdown className="table-grid-readonly">{column}</InlineMarkdown>
                  ) : (
                    <>
                      <input
                        value={column}
                        aria-label={`Column ${index + 1} heading`}
                        onChange={(event) => onChange(setColumn(table, index, event.target.value))}
                      />
                      {table.columns.length > 1 && (
                        <button
                          type="button"
                          className="icon-button"
                          title="Remove this column"
                          onClick={() => onChange(removeColumn(table, index))}
                        >
                          <Trash2 size={13} aria-hidden />
                        </button>
                      )}
                    </>
                  )}
                </th>
              ))}
              <th className="grid-next">Next roll</th>
              {!readOnly && (
                <th className="grid-actions">
                  <button
                    type="button"
                    className="icon-button"
                    title="Add a column"
                    onClick={() => onChange(addColumn(table))}
                  >
                    <Plus size={14} aria-hidden />
                  </button>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, index) => (
              <tr key={index}>
                <td className="grid-die">
                  <input
                    value={row.label}
                    readOnly={readOnly}
                    aria-label={`Die value for row ${index + 1}`}
                    onChange={(event) => onChange(setRowLabel(table, index, event.target.value))}
                  />
                </td>
                {table.columns.map((_, column) => (
                  <td key={column}>
                    {readOnly ? (
                      <InlineMarkdown className="table-grid-readonly">{row.cells[column] ?? ""}</InlineMarkdown>
                    ) : (
                      <input
                        value={row.cells[column] ?? ""}
                        aria-label={`Row ${index + 1}, ${table.columns[column]}`}
                        onChange={(event) => onChange(setCell(table, index, column, event.target.value))}
                      />
                    )}
                  </td>
                ))}
                <td className="grid-next">
                  {readOnly ? (
                    <span>{tables.find((candidate) => candidate.id === row.nextTableId)?.name ?? "—"}</span>
                  ) : (
                    <select
                      value={row.nextTableId ?? ""}
                      aria-label={`Follow-up table for row ${index + 1}`}
                      onChange={(event) => onChange(setNextTable(table, index, event.target.value))}
                    >
                      <option value="">None</option>
                      {tables
                        .filter((candidate) => candidate.id !== table.id)
                        .map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>
                            {candidate.name} ({candidate.dice})
                          </option>
                        ))}
                    </select>
                  )}
                </td>
                {!readOnly && (
                  <td className="grid-actions">
                    <button
                      type="button"
                      className="icon-button"
                      title="Move up"
                      disabled={index === 0}
                      onClick={() => onChange(moveRow(table, index, -1))}
                    >
                      <ArrowUp size={13} aria-hidden />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      title="Move down"
                      disabled={index === table.rows.length - 1}
                      onClick={() => onChange(moveRow(table, index, 1))}
                    >
                      <ArrowDown size={13} aria-hidden />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      title="Delete this row"
                      onClick={() => onChange(removeRow(table, index))}
                    >
                      <Trash2 size={13} aria-hidden />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!readOnly && (
        <div className="table-grid-tools">
          <button type="button" onClick={() => onChange(addRow(table))}>
            <Plus size={14} aria-hidden /> Add row
          </button>
          <button
            type="button"
            onClick={() => onChange(fillRows(table))}
            title={`One row per value ${table.dice} can roll`}
          >
            <Wand2 size={14} aria-hidden /> Fill {table.dice}
          </button>
        </div>
      )}
    </div>
  );
}
