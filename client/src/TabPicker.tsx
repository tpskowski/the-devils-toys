import { useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";

export interface TabPickerOption {
  id: string;
  label: string;
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
  onSelect
}: {
  options: readonly TabPickerOption[];
  selected?: string;
  /** Names what is being chosen, for the menu's accessible name. */
  label: string;
  /** The element the menu aligns under, where the button itself is not it. */
  anchorSelector?: string;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CSSProperties>({});
  const toggleRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
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
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
      removeEventListener("resize", closeOnViewportChange);
      removeEventListener("scroll", closeOnScroll, true);
    };
  }, [open]);

  function toggle(event: MouseEvent<HTMLElement>) {
    if (!options.length) return;
    const anchor = anchorSelector ? event.currentTarget.closest(anchorSelector) : event.currentTarget;
    const bounds = anchor?.getBoundingClientRect();
    if (!bounds) return;
    const width = Math.min(240, window.innerWidth - 16);
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
          <div ref={menuRef} className="tab-picker-menu" style={position} role="listbox" aria-label={`Choose ${label}`}>
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
                <span>{item.label}</span>
                {item.id === selected && <Check />}
              </button>
            ))}
          </div>,
          document.querySelector(".workspace") ?? document.body
        )
      : null;

  return { open, toggle, close, toggleRef, menu };
}
