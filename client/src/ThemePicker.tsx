import { useEffect, useRef, type ReactNode } from "react";
import { DICE_THEMES, THEME_IDS, type ThemeId } from "@devils-toys/shared";

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
  return (
    <PalettePicker
      value={value}
      names={names}
      options={THEME_IDS}
      onChange={onChange}
      label="Theme"
      menuLabel="Themes"
      palette={(theme) => <ThemePalette theme={theme} />}
    />
  );
}

export function DiceThemePicker({
  value,
  roomTheme,
  onChange
}: {
  value: ThemeId | "room";
  roomTheme: ThemeId;
  onChange: (theme: ThemeId | "room") => void;
}) {
  const names = Object.fromEntries(THEME_IDS.map((id) => [id, DICE_THEMES[id].name])) as Record<ThemeId, string>;
  return (
    <PalettePicker
      value={value}
      names={{ room: "Match room theme", ...names }}
      options={["room", ...THEME_IDS]}
      onChange={onChange}
      label="Dice theme"
      menuLabel="Dice themes"
      palette={(theme) => {
        const set = DICE_THEMES[theme === "room" ? roomTheme : theme];
        return (
          <span className="theme-palette dice-theme-palette" aria-hidden="true">
            <span style={{ background: set.body, color: set.ink }}>{theme === "room" && "Match room theme"}</span>
            <span style={{ background: set.ink }} />
            <span style={{ background: set.accent }} />
          </span>
        );
      }}
    />
  );
}

function PalettePicker<T extends string>({
  value,
  names,
  options,
  onChange,
  label,
  menuLabel,
  palette
}: {
  value: T;
  names: Record<T, string>;
  options: readonly T[];
  onChange: (value: T) => void;
  label: string;
  menuLabel: string;
  palette: (value: T) => ReactNode;
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
      <summary aria-label={`${label}: ${names[value]}`} title={names[value]}>
        {palette(value)}
      </summary>
      <div className="theme-picker-menu" role="listbox" aria-label={menuLabel}>
        {options.map((theme) => (
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
            {palette(theme)}
          </button>
        ))}
      </div>
    </details>
  );
}
