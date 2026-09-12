import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import "./PortraitImage.css";

/** A cropped portrait that opens its original image without navigating away. */
export function PortraitImage({ src, alt }: { src: string; alt: string }) {
  const [open, setOpen] = useState(false);
  const closeButton = useRef<HTMLButtonElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!open) return;
    const currentDialog = dialog.current;
    const returnFocus = trigger.current;
    currentDialog?.showModal();
    closeButton.current?.focus();
    return () => {
      currentDialog?.close();
      if (returnFocus?.isConnected) returnFocus.focus();
    };
  }, [open]);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="portrait-zoom-trigger"
        onClick={() => setOpen(true)}
        aria-label={`View ${alt} full size`}
        title="View full-size portrait"
      >
        <img src={src} alt={alt} />
      </button>
      {open &&
        createPortal(
          <dialog
            ref={dialog}
            className="portrait-lightbox"
            aria-label={alt}
            onCancel={(event) => {
              event.preventDefault();
              setOpen(false);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                setOpen(false);
              }
              if (event.key === "Tab") {
                // Close is the lightbox's only focusable control.
                event.preventDefault();
                event.stopPropagation();
                closeButton.current?.focus();
              }
            }}
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                // A backdrop click would otherwise focus the dialog after this
                // state update unmounts it, overwriting the trigger focus the
                // effect cleanup restores.
                event.preventDefault();
                setOpen(false);
              }
            }}
          >
            <figure>
              <img src={src} alt={alt} />
              <figcaption>{alt}</figcaption>
              <button
                ref={closeButton}
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close full-size portrait"
              >
                <X aria-hidden="true" />
              </button>
            </figure>
          </dialog>,
          document.body
        )}
    </>
  );
}
