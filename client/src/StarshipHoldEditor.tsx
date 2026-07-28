import { useState } from "react";
import { Check, X } from "lucide-react";
import type { StarshipPart } from "@devils-toys/shared";

/**
 * Fills one hold. A part can be chosen from the system's own parts list or typed
 * in freely, and either can be marked bulky so it claims the next hold too.
 */
export function HoldEditor({
  slotName,
  parts,
  current,
  error,
  onCancel,
  onSubmit
}: {
  slotName: string;
  parts: readonly StarshipPart[];
  current: string;
  error: string;
  onCancel: () => void;
  onSubmit: (value: string, bulky: boolean) => void;
}) {
  const [value, setValue] = useState(current);
  const [bulky, setBulky] = useState(false);
  const categories = [...new Set(parts.map((part) => part.category))];
  const chosen = parts.find((part) => part.label === value);

  return (
    <form
      className="starship-hold-editor"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(value, bulky);
      }}
    >
      <p className="panel-kicker">{slotName}</p>
      <label>
        Ship part
        <select
          value={chosen?.label ?? ""}
          onChange={(event) => {
            const part = parts.find((entry) => entry.label === event.target.value);
            setValue(part?.label ?? "");
            setBulky(Boolean(part?.bulky));
          }}
        >
          <option value="">Choose a part…</option>
          {categories.map((category) => (
            <optgroup label={category} key={category}>
              {parts
                .filter((part) => part.category === category)
                .map((part) => (
                  <option value={part.label} key={`${part.category}-${part.label}`}>
                    {part.label}
                    {part.cost ? ` — ${part.cost === "Free" ? "free" : `${part.cost}C`}` : ""}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </label>
      <label>
        Or type your own
        <input
          value={value}
          placeholder="Cargo, salvage, anything else"
          onChange={(event) => setValue(event.target.value)}
        />
      </label>
      <label className="starship-hold-bulky">
        <input type="checkbox" checked={bulky} onChange={(event) => setBulky(event.target.checked)} />
        Bulky — takes this hold and the next
      </label>
      {chosen?.detail && <p className="starship-hold-detail">{chosen.detail}</p>}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="starship-hold-actions">
        <button className="primary-button" type="submit">
          <Check size={16} /> {value.trim() ? "Install" : "Empty the hold"}
        </button>
        <button type="button" onClick={onCancel}>
          <X size={16} /> Cancel
        </button>
      </div>
    </form>
  );
}
