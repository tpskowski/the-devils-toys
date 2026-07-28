import { useEffect, useRef, useState, type PointerEvent } from "react";
import { ArrowUpRight, Focus, ImagePlus, MapPin, Minus, Plus } from "lucide-react";
import type { MediaAsset } from "@devils-toys/shared";
import { mediaLabel } from "./media-label";

export interface ScenePing {
  id: number;
  x: number;
  y: number;
  username: string;
  displayName: string;
}

export function SceneViewer({
  scene,
  label = "Scene",
  isGm,
  pings,
  onManage,
  onPing
}: {
  scene: MediaAsset | null;
  label?: "Map" | "Scene";
  isGm: boolean;
  pings: ScenePing[];
  onManage: () => void;
  onPing: (x: number, y: number) => void;
}) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [pingMode, setPingMode] = useState(false);
  const viewer = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const drag = useRef<{ x: number; y: number; originX: number; originY: number } | undefined>(undefined);

  useEffect(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, [scene?.id]);

  function zoom(next: number) {
    const bounded = Math.min(4, Math.max(1, next));
    setScale(bounded);
    if (bounded === 1) setOffset({ x: 0, y: 0 });
  }

  function wheelZoom(event: globalThis.WheelEvent, currentViewer: HTMLDivElement) {
    const target = event.target;
    const currentImage = image.current;
    if (
      event.deltaY === 0 ||
      (target instanceof Element && target.closest(".scene-toolbar")) ||
      !currentImage?.naturalWidth
    )
      return;

    const bounds = currentViewer.getBoundingClientRect();
    const fit = Math.min(bounds.width / currentImage.naturalWidth, bounds.height / currentImage.naturalHeight);
    const renderedWidth = currentImage.naturalWidth * fit * scale;
    const renderedHeight = currentImage.naturalHeight * fit * scale;
    const centerX = bounds.left + bounds.width / 2 + offset.x;
    const centerY = bounds.top + bounds.height / 2 + offset.y;
    const overImage =
      event.clientX >= centerX - renderedWidth / 2 &&
      event.clientX <= centerX + renderedWidth / 2 &&
      event.clientY >= centerY - renderedHeight / 2 &&
      event.clientY <= centerY + renderedHeight / 2;
    if (!overImage) return;

    event.preventDefault();
    event.stopPropagation();
    zoom(scale + (event.deltaY < 0 ? 0.25 : -0.25));
  }

  useEffect(() => {
    const currentViewer = viewer.current;
    if (!currentViewer) return;
    const handleWheel = (event: globalThis.WheelEvent) => wheelZoom(event, currentViewer);
    currentViewer.addEventListener("wheel", handleWheel, { passive: false });
    return () => currentViewer.removeEventListener("wheel", handleWheel);
  }, [scene?.id, scale, offset.x, offset.y]);

  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (pingMode || scale === 1) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, originX: offset.x, originY: offset.y };
  }

  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    setOffset({
      x: drag.current.originX + event.clientX - drag.current.x,
      y: drag.current.originY + event.clientY - drag.current.y
    });
  }

  function pointerUp(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current && pingMode) {
      const bounds = event.currentTarget.getBoundingClientRect();
      onPing((event.clientX - bounds.left) / bounds.width, (event.clientY - bounds.top) / bounds.height);
      setPingMode(false);
    }
    drag.current = undefined;
  }

  if (!scene)
    return (
      <div className="scene-empty">
        <div className="scene-art" aria-hidden="true">
          <div className="horizon" />
          <div className="moon">
            <span />
          </div>
          <div className="path-line one" />
          <div className="path-line two" />
          <div className="path-line three" />
        </div>
        <div className="scene-copy">
          <p className="eyebrow">Current {label}</p>
          <h2>The table is waiting.</h2>
          <p>{isGm ? `Set a ${label} when the table is ready.` : `The GM has not revealed a ${label} yet.`}</p>
          {isGm && (
            <button className="scene-manage" onClick={onManage}>
              <ImagePlus /> Open Library
            </button>
          )}
        </div>
      </div>
    );

  return (
    <div
      ref={viewer}
      className={`scene-viewer ${pingMode ? "is-pinging" : ""} ${scale > 1 ? "is-zoomed" : ""}`}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
    >
      <img
        ref={image}
        src={scene.url}
        alt={mediaLabel(scene)}
        draggable={false}
        style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}
      />
      <div className="scene-pings" aria-live="polite">
        {pings.map((ping) => (
          <span key={ping.id} style={{ left: `${ping.x * 100}%`, top: `${ping.y * 100}%` }}>
            <i />
            <small>{ping.displayName}</small>
          </span>
        ))}
      </div>
      <div
        className="scene-toolbar"
        onPointerDown={(event) => event.stopPropagation()}
        onPointerMove={(event) => event.stopPropagation()}
        onPointerUp={(event) => event.stopPropagation()}
      >
        <button onClick={() => zoom(scale - 0.5)} disabled={scale === 1} title="Zoom out">
          <Minus />
        </button>
        <button onClick={() => zoom(1)} title="Fit Scene">
          <Focus />
        </button>
        <button onClick={() => zoom(scale + 0.5)} disabled={scale === 4} title="Zoom in">
          <Plus />
        </button>
        <button
          className={pingMode ? "active" : ""}
          onClick={() => setPingMode((current) => !current)}
          title="Ping Scene"
        >
          <MapPin />
        </button>
        <a
          href={scene.url}
          target="_blank"
          rel="noreferrer"
          aria-label={`Open ${mediaLabel(scene)} in a new tab`}
          title="Open in a new tab"
        >
          <ArrowUpRight />
        </a>
      </div>
    </div>
  );
}
