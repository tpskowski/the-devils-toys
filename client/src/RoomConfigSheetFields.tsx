import type { CharacterFieldDefinition, CharacterSheetDefinition } from "@devils-toys/shared";

/**
 * A roster row's sheet, drawn from whatever the system declares. Room Config is
 * for setting a hireling or a ship up rather than playing it, so this is the
 * plain form: every field the definition names, in the sections it names them
 * in, and nothing else.
 *
 * The Group tab keeps the parts of a sheet that belong to play — the weapon
 * selector, the hold editor, the rules links beside a field. Those are live
 * tools, and duplicating them here would mean two implementations of rules that
 * only one of them enforces.
 */
export function RoomConfigSheetFields({
  definition,
  sheet,
  disabled,
  omit = [],
  onChange
}: {
  definition: CharacterSheetDefinition;
  sheet: Record<string, unknown>;
  disabled?: boolean;
  /**
   * Fields the row owns rather than its sheet. A hireling sheet declares a name
   * field, and the row has a name of its own; drawing both would put two boxes
   * called Name on one form, disagreeing with each other.
   */
  omit?: readonly string[];
  onChange: (key: string, value: unknown) => void;
}) {
  return (
    <>
      {definition.sections.map((section) => {
        const fields = section.fields.filter((field) => !omit.includes(field.key));
        if (!fields.length) return null;
        return (
          <section key={section.id} className="rc-sheet-section">
            <h4>{section.label}</h4>
            <div className="rc-field-grid">
              {fields.map((field) => (
                <Field key={field.key} field={field} value={sheet[field.key]} disabled={disabled} onChange={onChange} />
              ))}
            </div>
          </section>
        );
      })}
      {definition.lists.map((list) => (
        <section key={list.key} className="rc-sheet-section">
          <h4>{list.label}</h4>
          <ol className="rc-slot-list">
            {list.slots.map((slotLabel, index) => {
              const held = Array.isArray(sheet[list.key]) ? (sheet[list.key] as unknown[]) : [];
              return (
                <li key={index}>
                  <span className="rc-ordinal">{slotLabel || index + 1}</span>
                  <input
                    value={String(held[index] ?? "")}
                    disabled={disabled}
                    aria-label={`${list.label} ${slotLabel || index + 1}`}
                    onChange={(event) => {
                      const next = [...held];
                      next[index] = event.target.value;
                      onChange(list.key, next);
                    }}
                  />
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </>
  );
}

function Field({
  field,
  value,
  disabled,
  onChange
}: {
  field: CharacterFieldDefinition;
  value: unknown;
  disabled?: boolean;
  onChange: (key: string, value: unknown) => void;
}) {
  if (field.kind === "checkbox")
    return (
      <label className="rc-checkbox">
        <input
          type="checkbox"
          checked={Boolean(value)}
          disabled={disabled}
          onChange={(event) => onChange(field.key, event.target.checked)}
        />
        <span>{field.label}</span>
      </label>
    );

  if (field.kind === "textarea")
    return (
      <label className="rc-wide-field">
        <span>{field.label}</span>
        <textarea
          rows={4}
          value={String(value ?? "")}
          disabled={disabled}
          placeholder={field.placeholder}
          onChange={(event) => onChange(field.key, event.target.value)}
        />
      </label>
    );

  // `entries` and `vices` are structured fields the character sheet edits with
  // dialogs of their own. Rather than half-render them, the panel says where
  // they are edited — a blank box that silently drops what is in them would be
  // worse than an honest gap.
  if (field.kind === "entries" || field.kind === "vices")
    return (
      <label className="rc-wide-field">
        <span>{field.label}</span>
        <p className="room-config-muted">Edited on the sheet itself, in the room.</p>
      </label>
    );

  return (
    <label>
      <span>{field.label}</span>
      <input
        value={String(value ?? "")}
        disabled={disabled}
        inputMode={field.kind === "number" ? "numeric" : "text"}
        placeholder={field.placeholder}
        onChange={(event) =>
          onChange(
            field.key,
            field.kind === "number" && event.target.value.trim() !== "" && Number.isFinite(Number(event.target.value))
              ? Number(event.target.value)
              : event.target.value
          )
        }
      />
    </label>
  );
}
