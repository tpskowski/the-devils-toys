import { useEffect, useRef } from "react";
import { THEME_IDS, type ThemeId } from "@devils-toys/shared";

export function ThemePalette({ theme }: { theme: ThemeId }) {
  return (
    <span className={`theme-palette theme-${theme}`} aria-hidden="true">
      <span className="theme-palette-main" />
      <span className="theme-palette-accent" />
      <span className="theme-palette-hostile" />
      <span className="theme-palette-text" />
      <span className="theme-palette-friendly" />
    </span>
  );
}

export function ThemePicker({
  value,
  names,
  onChange
}: {
  value: ThemeId;
  names: Record<ThemeId, string>;
  onChange: (theme: ThemeId) => void;
}) {
  const picker = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    function closeOnPointerDown(event: PointerEvent) {
      if (picker.current?.open && event.target instanceof Node && !picker.current.contains(event.target)) {
        picker.current.open = false;
      }
    }
    document.addEventListener("pointerdown", closeOnPointerDown);
    return () => document.removeEventListener("pointerdown", closeOnPointerDown);
  }, []);

  return (
    <details
      ref={picker}
      className="theme-picker"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !picker.current?.open) return;
        event.preventDefault();
        event.stopPropagation();
        picker.current.open = false;
        picker.current.querySelector("summary")?.focus();
      }}
    >
      <summary aria-label={`Theme: ${names[value]}`} title={names[value]}>
        <ThemePalette theme={value} />
      </summary>
      <div className="theme-picker-menu" role="listbox" aria-label="Themes">
        {THEME_IDS.map((theme) => (
          <button
            type="button"
            role="option"
            aria-label={names[theme]}
            aria-selected={theme === value}
            title={names[theme]}
            key={theme}
            className={`theme-picker-option ${theme === value ? "selected" : ""}`}
            onClick={() => {
              onChange(theme);
              if (picker.current) {
                picker.current.open = false;
                picker.current.querySelector("summary")?.focus();
              }
            }}
          >
            <ThemePalette theme={theme} />
          </button>
        ))}
      </div>
    </details>
  );
}
