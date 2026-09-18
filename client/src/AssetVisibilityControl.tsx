import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Eye, EyeOff } from "lucide-react";
import type { MediaAsset } from "@devils-toys/shared";
import { api } from "./api";
import { mediaLabel } from "./media-label";

export function assetVisibilityActions(asset: Pick<MediaAsset, "kind" | "visible">, active: boolean) {
  const actions: { label: string; action: "hide" | "reveal" | "activate" }[] = [
    asset.visible ? { label: "Hide", action: "hide" } : { label: "Reveal", action: "reveal" }
  ];
  if ((asset.kind === "map" || asset.kind === "scene") && !active)
    actions.push({ label: asset.visible ? "Make active" : "Reveal and make active", action: "activate" });
  return actions;
}

export function AssetVisibilityControl({
  asset,
  active = false,
  onChanged
}: {
  asset: MediaAsset;
  active?: boolean;
  onChanged: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!open) return;
    const element = dialog.current;
    const button = trigger.current;
    element?.showModal();
    return () => {
      element?.close();
      if (button?.isConnected) button.focus();
    };
  }, [open]);

  async function act(action: "hide" | "reveal" | "activate") {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (action === "activate") {
        // The existing GM route reveals and activates together in one transaction.
        await api(`/api/rooms/${asset.roomId}/${asset.kind}`, {
          method: "PATCH",
          body: JSON.stringify({ mediaId: asset.id })
        });
      } else {
        await api(`/api/rooms/${asset.roomId}/media/${asset.id}/visibility`, {
          method: "PATCH",
          body: JSON.stringify({ visible: action === "reveal" })
        });
      }
      await onChanged();
      setOpen(false);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const status = asset.visible ? "Revealed to players" : "Hidden from players";
  return (
    <>
      <button
        ref={trigger}
        type="button"
        title={`${status} — change visibility`}
        aria-label={`${mediaLabel(asset)}: ${status}. Change visibility`}
        aria-haspopup="dialog"
        onClick={() => {
          setError("");
          setOpen(true);
        }}
      >
        {asset.visible ? <Eye /> : <EyeOff />}
      </button>
      {open &&
        createPortal(
          <dialog
            ref={dialog}
            className="asset-visibility-dialog"
            aria-label={`Visibility: ${mediaLabel(asset)}`}
            onPointerDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
            onCancel={(event) => {
              event.preventDefault();
              if (!busy) setOpen(false);
            }}
          >
            <h2>{mediaLabel(asset)}</h2>
            <p>
              {status}
              {active ? " · Currently active" : ""}
            </p>
            {error && <p role="alert">{error}</p>}
            <div className="asset-visibility-actions">
              {assetVisibilityActions(asset, active).map(({ label, action }) => (
                <button key={action} type="button" disabled={busy} onClick={() => act(action)}>
                  {label}
                </button>
              ))}
              <button type="button" disabled={busy} onClick={() => setOpen(false)}>
                Cancel
              </button>
            </div>
          </dialog>,
          trigger.current?.closest(".workspace") ?? document.body
        )}
    </>
  );
}
