import { useState } from "react";
import { Check, X } from "lucide-react";
import type { CharacterItem } from "@devils-toys/shared";

/**
 * Fills one slot. An item can be chosen from the system's own tables or typed in
 * freely, so anything the book never priced still has a home.
 */
export function CharacterItemEditor({
  slotName,
  items,
  current,
  onCancel,
  onSubmit
}: {
  slotName: string;
  items: readonly CharacterItem[];
  current: string;
  onCancel: () => void;
  onSubmit: (value: string) => void;
}) {
  const [value, setValue] = useState(current);
  const categories = [...new Set(items.map((item) => item.category))];
  const chosen = items.find((item) => item.label === value);

  // A div, not a form: the character sheet is itself a form, and nesting one
  // inside another makes the submit escape to the outer form and navigate away.
  return (
    <div className="character-item-editor" role="group" aria-label={`Fill ${slotName}`}>
      <p className="character-item-slot">{slotName}</p>
      <label>
        From the rules
        <select
          value={chosen?.label ?? ""}
          onChange={(event) => setValue(event.target.value)}
          aria-label={`Choose an item for ${slotName}`}
        >
          <option value="">Choose an item…</option>
          {categories.map((category) => (
            <optgroup label={category} key={category}>
              {items
                .filter((item) => item.category === category)
                .map((item) => (
                  <option value={item.label} key={`${item.category}-${item.label}`}>
                    {item.label}
                    {item.cost ? ` — ${item.cost}` : ""}
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
          placeholder="Salvage, a keepsake, anything else"
          onChange={(event) => setValue(event.target.value)}
        />
      </label>
      {chosen?.detail && <p className="character-item-detail">{chosen.detail}</p>}
      {chosen?.bulky && <p className="character-item-detail">The book calls this bulky — it takes two slots.</p>}
      <div className="character-item-actions">
        <button className="primary-button" type="button" onClick={() => onSubmit(value)}>
          <Check size={16} /> {value.trim() ? "Stow" : "Empty the slot"}
        </button>
        <button type="button" onClick={onCancel}>
          <X size={16} /> Cancel
        </button>
      </div>
    </div>
  );
}
