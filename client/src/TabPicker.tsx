import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent
} from "react";
import { createPortal } from "react-dom";
import { Check, EyeOff } from "lucide-react";

export interface TabPickerOption {
  id: string;
  label: string;
  /** A decorative micro-preview shown at the trailing edge of media options. */
  thumbnailUrl?: string;
  /** Marks media that the GM has kept from players. */
  hiddenFromPlayers?: boolean;
}

/**
 * The drop-down that hangs off an already-active tab: clicking the tab a second
 * time opens a menu of what that tab can show. The table's media tabs and the
 * rail's combat tab both use it, so the open and close rules — outside click,
 * Escape, any scroll that is not the menu's own — live here rather than twice.
 */
export function useTabPicker({
  options,
  selected,
  label,
  anchorSelector,
  menuWidth = 240,
  onSelect
}: {
  options: readonly TabPickerOption[];
  selected?: string;
  /** Names what is being chosen, for the menu's accessible name. */
  label: string;
  /** The element the menu aligns under, where the button itself is not it. */
  anchorSelector?: string;
  /** Preferred menu width before the viewport constrains it. */
  menuWidth?: number;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CSSProperties>({});
  const toggleRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const focusInitialOption = window.setTimeout(() => {
      const options = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])];
      (options.find((option) => option.getAttribute("aria-selected") === "true") ?? options[0])?.focus();
    });
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!toggleRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        toggleRef.current?.focus();
      }
    };
    const closeOnViewportChange = () => setOpen(false);
    const closeOnScroll = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    addEventListener("resize", closeOnViewportChange);
    addEventListener("scroll", closeOnScroll, true);
    return () => {
      window.clearTimeout(focusInitialOption);
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
      removeEventListener("resize", closeOnViewportChange);
      removeEventListener("scroll", closeOnScroll, true);
    };
  }, [open]);

  function moveOption(event: ReactKeyboardEvent<HTMLDivElement>) {
    const optionButtons = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])];
    if (!optionButtons.length) return;
    const current = optionButtons.indexOf(document.activeElement as HTMLButtonElement);
    let index: number | undefined;
    if (event.key === "ArrowDown") index = current < 0 ? 0 : (current + 1) % optionButtons.length;
    if (event.key === "ArrowUp")
      index = current < 0 ? optionButtons.length - 1 : (current - 1 + optionButtons.length) % optionButtons.length;
    if (event.key === "Home") index = 0;
    if (event.key === "End") index = optionButtons.length - 1;
    if (index === undefined) return;
    event.preventDefault();
    optionButtons[index]!.focus();
    onSelect(options[index]!.id);
  }

  function toggle(event: MouseEvent<HTMLElement>) {
    if (!options.length) return;
    const anchor = anchorSelector ? event.currentTarget.closest(anchorSelector) : event.currentTarget;
    const bounds = anchor?.getBoundingClientRect();
    if (!bounds) return;
    const width = Math.min(menuWidth, window.innerWidth - 16);
    setPosition({
      top: bounds.bottom + 4,
      left: Math.min(Math.max(8, bounds.left), window.innerWidth - width - 8),
      width
    });
    setOpen((current) => !current);
  }

  // The menu is fixed-positioned against the viewport, so it is portalled out of
  // whatever pane the tab sits in rather than being clipped by it.
  const menu =
    open && options.length > 0
      ? createPortal(
          <div
            ref={menuRef}
            className="tab-picker-menu"
            style={position}
            role="listbox"
            aria-label={`Choose ${label}`}
            onKeyDown={moveOption}
          >
            {options.map((item) => (
              <button
                key={item.id}
                className={item.id === selected ? "selected" : ""}
                role="option"
                aria-selected={item.id === selected}
                onClick={() => {
                  onSelect(item.id);
                  setOpen(false);
                }}
              >
                <span className="tab-picker-option-label">
                  <span className="tab-picker-option-name">{item.label}</span>
                  {item.hiddenFromPlayers && (
                    <EyeOff className="tab-picker-option-visibility" aria-label="Hidden from players" />
                  )}
                </span>
                <span className="tab-picker-option-tail" aria-hidden="true">
                  {item.id === selected && <Check />}
                  {item.thumbnailUrl && <img src={item.thumbnailUrl} alt="" loading="lazy" decoding="async" />}
                </span>
              </button>
            ))}
          </div>,
          document.querySelector(".workspace") ?? document.body
        )
      : null;

  return { open, toggle, close, toggleRef, menu };
}
