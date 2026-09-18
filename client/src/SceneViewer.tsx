import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { ArrowUpRight, BookOpen, Focus, ImagePlus, MapPin, Minus, Plus, X } from "lucide-react";
import type { MapNotationEvent, MediaAsset } from "@devils-toys/shared";
import { mediaLabel } from "./media-label";
import { MapNotationLayer } from "./MapNotationLayer";
import { notationPoint, pointIsOnNotationPlane } from "./map-notation";
import type { MapLegend } from "./MediaModal";
import { api } from "./api";
import { RulesMarkdown, type WikiMentionTarget } from "./RulesMarkdown";
import { fitScenePlane, zoomOffsetAtPoint, type ScenePlane } from "./scene-transform";
import { AssetVisibilityControl } from "./AssetVisibilityControl";

export interface ScenePing {
  id: number;
  x: number;
  y: number;
  username: string;
  displayName: string;
}

function MapLegendPanel({
  roomId,
  legend,
  isGm,
  revision,
  onClose,
  onOpenWikiMention
}: {
  roomId: number;
  legend: MapLegend;
  isGm: boolean;
  revision: number;
  onClose: () => void;
  onOpenWikiMention?: (mention: WikiMentionTarget) => void;
}) {
  const [page, setPage] = useState<{ slug: string; title: string; markdown: string }>();
  const [mentionSummary, setMentionSummary] = useState<string>();

  useEffect(() => {
    let stopped = false;
    api<{ page: { slug: string; title: string; markdown: string } }>(
      `/api/rooms/${roomId}/wiki/pages/${encodeURIComponent(legend.slug)}`
    )
      .then((result) => {
        if (!stopped) setPage(result.page);
      })
      // A legend can be unshared while its map stays open. Close rather than
      // telling a player that a private page exists.
      .catch(() => {
        if (!stopped) onClose();
      });
    return () => {
      stopped = true;
    };
  }, [legend.slug, revision, onClose, roomId]);

  function openMention(mention: WikiMentionTarget) {
    if (mention.kind === "npc" || mention.kind === "item") {
      setMentionSummary(`${mention.kind === "npc" ? "NPC" : "Item"}: ${mention.label}`);
      return;
    }
    onOpenWikiMention?.(mention);
  }

  return (
    <aside
      id="map-legend-panel"
      className="map-legend-panel"
      role="dialog"
      aria-modal="false"
      aria-labelledby="map-legend-title"
    >
      <header>
        <div>
          <p className="eyebrow">Map legend</p>
          <h2 id="map-legend-title">{page?.title ?? legend.title}</h2>
        </div>
        <button type="button" onClick={onClose} aria-label="Close legend">
          <X size={16} />
        </button>
      </header>
      <div className="map-legend-body">
        {mentionSummary && (
          <p className="map-legend-mention" role="status">
            {mentionSummary}
          </p>
        )}
        {page ? (
          <RulesMarkdown
            markdown={page.markdown}
            idPrefix={`map-legend-${page.slug}`}
            roomId={roomId}
            isGm={isGm}
            onWikiMention={openMention}
          />
        ) : (
          <p>Opening legend…</p>
        )}
      </div>
    </aside>
  );
}

export function SceneViewer({
  scene,
  roomId,
  label = "Scene",
  isGm,
  pings,
  onManage,
  onPing,
  mapNotation,
  legend,
  legendRevision = 0,
  onOpenWikiMention,
  active = false,
  onMediaChanged
}: {
  scene: MediaAsset | null;
  roomId: number;
  label?: "Map" | "Scene" | "Reference";
  isGm: boolean;
  pings: ScenePing[];
  onManage: () => void;
  onPing?: (x: number, y: number) => void;
  mapNotation?: { roomId: number; syncRevision: number; change?: MapNotationEvent };
  /** Present only where this reader is allowed to fetch the linked wiki page. */
  legend?: MapLegend | null;
  legendRevision?: number;
  onOpenWikiMention?: (mention: WikiMentionTarget) => void;
  active?: boolean;
  onMediaChanged?: () => Promise<void>;
}) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [pingMode, setPingMode] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const [plane, setPlane] = useState<ScenePlane>();
  const viewer = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const drag = useRef<{ x: number; y: number; originX: number; originY: number } | undefined>(undefined);

  useEffect(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
    setPlane(undefined);
  }, [scene?.id]);
  useEffect(() => setLegendOpen(false), [scene?.id, legend?.slug]);
  const closeLegend = useCallback(() => setLegendOpen(false), []);
  useEffect(() => {
    if (!legendOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeLegend();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [closeLegend, legendOpen]);

  const refreshPlane = useCallback(() => {
    const currentViewer = viewer.current;
    const currentImage = image.current;
    if (!currentViewer || !currentImage?.naturalWidth) return;
    setPlane(
      fitScenePlane(
        currentViewer.clientWidth,
        currentViewer.clientHeight,
        currentImage.naturalWidth,
        currentImage.naturalHeight
      )
    );
  }, []);

  useEffect(() => {
    const currentViewer = viewer.current;
    if (!currentViewer) return;
    refreshPlane();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", refreshPlane);
      return () => window.removeEventListener("resize", refreshPlane);
    }
    const observer = new ResizeObserver(refreshPlane);
    observer.observe(currentViewer);
    return () => observer.disconnect();
  }, [refreshPlane, scene?.id]);

  function zoom(next: number, point?: { x: number; y: number }) {
    const bounded = Math.min(4, Math.max(1, next));
    const currentViewer = viewer.current;
    if (currentViewer && bounded !== scale) {
      const center = { x: currentViewer.clientWidth / 2, y: currentViewer.clientHeight / 2 };
      setOffset((current) => zoomOffsetAtPoint(current, scale, bounded, point ?? center, center));
    }
    setScale(bounded);
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
    const fitted =
      plane ?? fitScenePlane(bounds.width, bounds.height, currentImage.naturalWidth, currentImage.naturalHeight);
    const imageBounds = {
      left: bounds.left + fitted.left,
      top: bounds.top + fitted.top,
      width: fitted.width,
      height: fitted.height
    };
    if (!pointIsOnNotationPlane(event.clientX, event.clientY, imageBounds, { scale, ...offset })) return;

    event.preventDefault();
    event.stopPropagation();
    zoom(scale + (event.deltaY < 0 ? 0.25 : -0.25), {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top
    });
  }

  useEffect(() => {
    const currentViewer = viewer.current;
    if (!currentViewer) return;
    const handleWheel = (event: globalThis.WheelEvent) => wheelZoom(event, currentViewer);
    currentViewer.addEventListener("wheel", handleWheel, { passive: false });
    return () => currentViewer.removeEventListener("wheel", handleWheel);
  }, [scene?.id, scale, offset.x, offset.y, plane]);

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
      const viewerBounds = event.currentTarget.getBoundingClientRect();
      if (!plane) return;
      const bounds = {
        left: viewerBounds.left + plane.left,
        top: viewerBounds.top + plane.top,
        width: plane.width,
        height: plane.height
      };
      if (!pointIsOnNotationPlane(event.clientX, event.clientY, bounds, { scale, ...offset })) return;
      const point = notationPoint(event.clientX, event.clientY, bounds, { scale, ...offset });
      onPing?.(point.x, point.y);
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
        onLoad={refreshPlane}
        style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}
      />
      {plane && (
        <div
          className="scene-pings"
          aria-live="polite"
          style={{
            left: plane.left,
            top: plane.top,
            width: plane.width,
            height: plane.height,
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`
          }}
        >
          {pings.map((ping) => (
            <span key={ping.id} style={{ left: `${ping.x * 100}%`, top: `${ping.y * 100}%` }}>
              <i />
              <small>{ping.displayName}</small>
            </span>
          ))}
        </div>
      )}
      {mapNotation && plane && (
        <MapNotationLayer
          roomId={mapNotation.roomId}
          mediaId={scene.id}
          isGm={isGm}
          syncRevision={mapNotation.syncRevision}
          change={mapNotation.change}
          scale={scale}
          offset={offset}
          mapBounds={plane}
        />
      )}
      <div
        className="scene-toolbar"
        onPointerDown={(event) => event.stopPropagation()}
        onPointerMove={(event) => event.stopPropagation()}
        onPointerUp={(event) => event.stopPropagation()}
      >
        <button onClick={() => zoom(scale - 0.5)} disabled={scale === 1} title="Zoom out">
          <Minus />
        </button>
        <button onClick={() => zoom(1)} title={`Fit ${label}`}>
          <Focus />
        </button>
        <button onClick={() => zoom(scale + 0.5)} disabled={scale === 4} title="Zoom in">
          <Plus />
        </button>
        {onPing && (
          <button
            className={pingMode ? "active" : ""}
            onClick={() => setPingMode((current) => !current)}
            title={`Ping ${label}`}
          >
            <MapPin />
          </button>
        )}
        {label === "Map" && legend && (
          <button
            type="button"
            className={legendOpen ? "active" : ""}
            onClick={() => setLegendOpen((current) => !current)}
            title={`Open ${legend.title}`}
            aria-label={`Open map legend: ${legend.title}`}
            aria-pressed={legendOpen}
            aria-controls="map-legend-panel"
          >
            <BookOpen />
          </button>
        )}
        {isGm && onMediaChanged && (
          <AssetVisibilityControl key={scene.id} asset={scene} active={active} onChanged={onMediaChanged} />
        )}
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
      {label === "Map" && legendOpen && legend && (
        <MapLegendPanel
          roomId={roomId}
          legend={legend}
          isGm={isGm}
          revision={legendRevision}
          onClose={closeLegend}
          onOpenWikiMention={onOpenWikiMention}
        />
      )}
    </div>
  );
}
