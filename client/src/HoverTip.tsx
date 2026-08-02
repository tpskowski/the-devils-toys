import { useEffect, useState, type CSSProperties, type PointerEvent, type FocusEvent } from "react";
import { createPortal } from "react-dom";

/**
 * A tooltip that arrives with the pointer rather than a second later.
 *
 * The browser's own `title` cannot be hurried, and what these say — what a
 * weapon does, what one of a system's words means — is read mid-roll. It is
 * portalled and fixed, so a scrolling log or rail never clips it, and it closes
 * on any scroll rather than hanging over content that has moved.
 *
 * Returns props to spread onto whatever it describes and a node to render
 * beside it; the node is a portal, so where it sits in the tree changes nothing.
 */
export function useHoverTip(text: string | undefined) {
  const [position, setPosition] = useState<CSSProperties>();

  useEffect(() => {
    if (!position) return;
    const close = () => setPosition(undefined);
    const closeOnEscape = (event: KeyboardEvent) => event.key === "Escape" && close();
    addEventListener("scroll", close, true);
    addEventListener("resize", close);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      removeEventListener("scroll", close, true);
      removeEventListener("resize", close);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [position]);

  function show(event: PointerEvent<HTMLElement> | FocusEvent<HTMLElement>) {
    if (!text) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const width = Math.min(280, window.innerWidth - 16);
    const left = Math.min(Math.max(8, bounds.left), window.innerWidth - width - 8);
    // Below where there is room, above where there is not, so a mark at the foot
    // of the rail is still readable.
    const below = window.innerHeight - bounds.bottom > 140;
    setPosition({
      width,
      left,
      ...(below ? { top: bounds.bottom + 6 } : { bottom: window.innerHeight - bounds.top + 6 })
    });
  }

  const hide = () => setPosition(undefined);

  return {
    props: { onPointerEnter: show, onPointerLeave: hide, onFocus: show, onBlur: hide },
    node:
      position && text
        ? createPortal(
            <span className="hover-tip" role="tooltip" style={position}>
              {text}
            </span>,
            document.querySelector(".workspace") ?? document.body
          )
        : null
  };
}
