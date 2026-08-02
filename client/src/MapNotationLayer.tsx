import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Circle, Eraser, Pencil, Square, Trash2, Type, Undo2, X } from "lucide-react";
import {
  MAP_NOTATION_COLORS,
  type MapNotation,
  type MapNotationColor,
  type MapNotationEvent,
  type NewMapNotation
} from "@devils-toys/shared";
import { api } from "./api";
import {
  appendNotationPoint,
  applyMapNotationEvent,
  labelArea,
  notationArea,
  notationPoint,
  type NotationArea,
  type NotationBounds,
  type NotationTransform
} from "./map-notation";

type Tool = "draw" | "label" | "box" | "circle" | "erase";
type Point = { x: number; y: number };
type LabelDraft = { area: NotationArea; text: string; editing: boolean };

export function MapNotationLayer({
  roomId,
  mediaId,
  isGm,
  syncRevision,
  change,
  scale,
  offset
}: {
  roomId: number;
  mediaId: number;
  isGm: boolean;
  syncRevision: number;
  change?: MapNotationEvent;
  scale: number;
  offset: { x: number; y: number };
}) {
  const [notations, setNotations] = useState<MapNotation[]>([]);
  const [tool, setTool] = useState<Tool>();
  const [color, setColor] = useState<MapNotationColor>(MAP_NOTATION_COLORS[0]);
  const [fontSize, setFontSize] = useState(10);
  const [labelDraft, setLabelDraft] = useState<LabelDraft>();
  const [error, setError] = useState("");
  const gesture = useRef<
    { start: Point; points: Point[]; bounds: NotationBounds; transform: NotationTransform } | undefined
  >(undefined);
  const draftLine = useRef<SVGPolylineElement>(null);
  const draftFrame = useRef<number | undefined>(undefined);
  const cancelLabel = useRef(false);
  const nextOptimisticId = useRef(-1);
  const mutationSequence = useRef(1);
  const pendingMutations = useRef(new Map<string, number>());

  useEffect(() => {
    let cancelled = false;
    void api<{ notations: MapNotation[] }>(`/api/rooms/${roomId}/maps/${mediaId}/notations`)
      .then((result) => {
        if (!cancelled) setNotations(result.notations);
      })
      .catch((cause: Error) => {
        if (!cancelled) setError(cause.message);
      });
    return () => {
      cancelled = true;
    };
  }, [roomId, mediaId, syncRevision]);

  useEffect(() => {
    if (!change || change.mediaId !== mediaId) return;
    const optimisticId =
      change.type === "map-notation-added" && change.clientMutationId
        ? pendingMutations.current.get(change.clientMutationId)
        : undefined;
    if (change.type === "map-notation-added" && change.clientMutationId)
      pendingMutations.current.delete(change.clientMutationId);
    setNotations((current) => applyMapNotationEvent(current, change, optimisticId));
  }, [change, mediaId]);

  useEffect(
    () => () => {
      if (draftFrame.current !== undefined) cancelAnimationFrame(draftFrame.current);
    },
    []
  );

  function scheduleDraft() {
    if (draftFrame.current !== undefined) return;
    draftFrame.current = requestAnimationFrame(() => {
      draftFrame.current = undefined;
      const points = gesture.current?.points;
      if (draftLine.current && points)
        draftLine.current.setAttribute(
          "points",
          points.map((point) => `${point.x * 1000},${point.y * 1000}`).join(" ")
        );
    });
  }

  function clearDraft() {
    if (draftFrame.current !== undefined) cancelAnimationFrame(draftFrame.current);
    draftFrame.current = undefined;
    draftLine.current?.removeAttribute("points");
  }

  function finishLabel() {
    const draft = labelDraft;
    setLabelDraft(undefined);
    if (cancelLabel.current) {
      cancelLabel.current = false;
      return;
    }
    if (draft?.editing && draft.text.trim())
      add({
        kind: "label",
        color,
        x: draft.area.x,
        y: draft.area.y,
        width: draft.area.width,
        height: draft.area.height,
        text: draft.text.trim(),
        fontSize
      });
  }

  function add(notation: NewMapNotation) {
    const optimisticId = nextOptimisticId.current--;
    const mutationId = globalThis.crypto?.randomUUID?.() ?? `notation-${Date.now()}-${mutationSequence.current++}`;
    pendingMutations.current.set(mutationId, optimisticId);
    setError("");
    setNotations((current) => [...current, { id: optimisticId, ...notation } as MapNotation]);
    void api<{ notation: MapNotation }>(`/api/rooms/${roomId}/maps/${mediaId}/notations`, {
      method: "POST",
      body: JSON.stringify({ notation, clientMutationId: mutationId })
    })
      .then((result) => {
        pendingMutations.current.delete(mutationId);
        setNotations((current) =>
          applyMapNotationEvent(
            current,
            { type: "map-notation-added", mediaId, notation: result.notation, clientMutationId: mutationId },
            optimisticId
          )
        );
      })
      .catch((cause: Error) => {
        pendingMutations.current.delete(mutationId);
        setNotations((current) => current.filter((item) => item.id !== optimisticId));
        setError(cause.message);
      });
  }

  function down(event: PointerEvent<HTMLDivElement>) {
    if (!tool) return;
    event.stopPropagation();
    if (tool === "erase") {
      const id = Number((event.target as Element).closest("[data-notation-id]")?.getAttribute("data-notation-id"));
      if (id) void erase(id);
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    const transform = { scale, x: offset.x, y: offset.y };
    const start = notationPoint(event.clientX, event.clientY, bounds, transform);
    if (tool === "label") {
      // Clicking away commits the active editor through blur. It deliberately
      // does not also begin another drag in the same pointer event, which would
      // let that blur clear the new draft.
      if (labelDraft?.editing) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      gesture.current = { start, points: [start], bounds, transform };
      setLabelDraft({ area: { x: start.x, y: start.y, width: 0, height: 0 }, text: "", editing: false });
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { start, points: [start], bounds, transform };
    if (tool === "draw") scheduleDraft();
  }

  function move(event: PointerEvent<HTMLDivElement>) {
    if (!tool) return;
    event.stopPropagation();
    const current = gesture.current;
    if (!current) return;
    if (tool === "label") {
      event.preventDefault();
      const end = notationPoint(event.clientX, event.clientY, current.bounds, current.transform);
      setLabelDraft((draft) =>
        draft && !draft.editing ? { ...draft, area: notationArea(current.start, end) } : draft
      );
      return;
    }
    if (tool !== "draw") return;
    event.preventDefault();
    const native = event.nativeEvent;
    const samples = typeof native.getCoalescedEvents === "function" ? native.getCoalescedEvents() : [native];
    let changed = false;
    for (const sample of samples)
      changed =
        appendNotationPoint(
          current.points,
          notationPoint(sample.clientX, sample.clientY, current.bounds, current.transform)
        ) || changed;
    if (changed) scheduleDraft();
  }

  function up(event: PointerEvent<HTMLDivElement>) {
    if (!tool) return;
    event.stopPropagation();
    const current = gesture.current;
    gesture.current = undefined;
    clearDraft();
    if (!current) return;
    const end = notationPoint(event.clientX, event.clientY, current.bounds, current.transform);
    if (tool === "label") {
      setLabelDraft({ area: labelArea(current.start, end), text: "", editing: true });
      return;
    }
    if (tool === "draw") {
      appendNotationPoint(current.points, end);
      if (current.points.length > 1) add({ kind: "line", color, points: current.points });
    }
    if (tool === "box" || tool === "circle") {
      const { x, y, width, height } = notationArea(current.start, end);
      if (width > 0.005 && height > 0.005) add({ kind: tool, color, x, y, width, height });
    }
  }

  function cancel(event: PointerEvent<HTMLDivElement>) {
    event.stopPropagation();
    gesture.current = undefined;
    if (labelDraft && !labelDraft.editing) setLabelDraft(undefined);
    clearDraft();
  }

  async function erase(id: number) {
    setError("");
    try {
      await api(`/api/rooms/${roomId}/maps/${mediaId}/notations/${id}`, { method: "DELETE" });
      setNotations((current) => current.filter((item) => item.id !== id));
    } catch (cause) {
      setError((cause as Error).message);
    }
  }
  async function undo() {
    setError("");
    try {
      const result = await api<{ notationId: number | null }>(`/api/rooms/${roomId}/maps/${mediaId}/notations/undo`, {
        method: "POST"
      });
      if (result.notationId !== null)
        setNotations((current) => current.filter((item) => item.id !== result.notationId));
    } catch (cause) {
      setError((cause as Error).message);
    }
  }
  async function clear() {
    if (!confirm("Clear every notation from this map?")) return;
    setError("");
    try {
      await api(`/api/rooms/${roomId}/maps/${mediaId}/notations`, { method: "DELETE" });
      setNotations([]);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  const mapTransform = `translate(${offset.x}px, ${offset.y}px) scale(${scale})`;

  return (
    <>
      <div
        className={`map-notation-layer ${tool ? "active" : ""}`}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={cancel}
      >
        <svg
          className="map-notation-content"
          style={{ transform: mapTransform }}
          viewBox="0 0 1000 1000"
          preserveAspectRatio="none"
        >
          {notations.map((item) => (
            <NotationShape key={item.id} notation={item} />
          ))}
          <polyline
            ref={draftLine}
            className="map-notation-draft"
            stroke={color}
            fill="none"
            strokeWidth="4"
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
          />
        </svg>
        <div className="map-notation-labels" style={{ transform: mapTransform }}>
          {notations.map(
            (item) =>
              item.kind === "label" && (
                <span
                  key={item.id}
                  className={`map-notation-label${item.width && item.height ? " map-notation-label-box" : ""}`}
                  data-notation-id={item.id}
                  style={{
                    left: `${item.x * 100}%`,
                    top: `${item.y * 100}%`,
                    color: item.color,
                    fontSize: `${item.fontSize}px`,
                    width: item.width ? `${item.width * 100}%` : undefined,
                    minHeight: item.height ? `${item.height * 100}%` : undefined
                  }}
                >
                  {item.text}
                </span>
              )
          )}
          {labelDraft && !labelDraft.editing && (
            <div
              className="map-notation-label-draft"
              aria-hidden="true"
              style={{
                left: `${labelDraft.area.x * 100}%`,
                top: `${labelDraft.area.y * 100}%`,
                width: `${labelDraft.area.width * 100}%`,
                height: `${labelDraft.area.height * 100}%`,
                color
              }}
            />
          )}
          {labelDraft?.editing && (
            <textarea
              autoFocus
              className="map-notation-label map-notation-label-box map-notation-label-editor"
              aria-label="Map label text"
              value={labelDraft.text}
              maxLength={200}
              placeholder="Type here · Ctrl+Enter to place"
              style={{
                left: `${labelDraft.area.x * 100}%`,
                top: `${labelDraft.area.y * 100}%`,
                color,
                fontSize: `${fontSize}px`,
                width: `${labelDraft.area.width * 100}%`,
                height: `${labelDraft.area.height * 100}%`
              }}
              onPointerDown={(event) => event.stopPropagation()}
              onChange={(event) => setLabelDraft((current) => current && { ...current, text: event.target.value })}
              onBlur={finishLabel}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  event.currentTarget.blur();
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  cancelLabel.current = true;
                  event.currentTarget.blur();
                }
              }}
            />
          )}
        </div>
      </div>
      {error && (
        <p className="map-notation-error" role="alert">
          {error}
        </p>
      )}
      <div className="map-notation-toolbar" onPointerDown={(event) => event.stopPropagation()}>
        <div className="notation-colors" title="Notation color">
          {MAP_NOTATION_COLORS.map((value) => (
            <button
              key={value}
              aria-label={`Use ${value}`}
              className={color === value ? "selected" : ""}
              style={{ backgroundColor: value }}
              onClick={() => setColor(value)}
            />
          ))}
        </div>
        <ToolButton
          title="Draw"
          selected={tool === "draw"}
          onClick={() => setTool(tool === "draw" ? undefined : "draw")}
        >
          <Pencil />
        </ToolButton>
        <ToolButton
          title="Add text box"
          selected={tool === "label"}
          onClick={() => setTool(tool === "label" ? undefined : "label")}
        >
          <Type />
        </ToolButton>
        {tool === "label" && (
          <select aria-label="Label font size" value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))}>
            {[8, 10, 12, 14, 18, 22].map((size) => (
              <option key={size} value={size}>
                {size}px
              </option>
            ))}
          </select>
        )}
        <ToolButton
          title="Draw box"
          selected={tool === "box"}
          onClick={() => setTool(tool === "box" ? undefined : "box")}
        >
          <Square />
        </ToolButton>
        <ToolButton
          title="Draw circle"
          selected={tool === "circle"}
          onClick={() => setTool(tool === "circle" ? undefined : "circle")}
        >
          <Circle />
        </ToolButton>
        <ToolButton
          title="Erase notation"
          selected={tool === "erase"}
          onClick={() => setTool(tool === "erase" ? undefined : "erase")}
        >
          <Eraser />
        </ToolButton>
        <ToolButton title="Undo last notation" onClick={undo}>
          <Undo2 />
        </ToolButton>
        {isGm && (
          <ToolButton title="Clear all notation" onClick={clear}>
            <Trash2 />
          </ToolButton>
        )}
        {tool && (
          <ToolButton title="Stop notation" onClick={() => setTool(undefined)}>
            <X />
          </ToolButton>
        )}
      </div>
    </>
  );
}

function ToolButton({
  title,
  selected,
  onClick,
  children
}: {
  title: string;
  selected?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button className={selected ? "active" : ""} title={title} aria-label={title} onClick={onClick}>
      {children}
    </button>
  );
}

function NotationShape({ notation }: { notation: MapNotation }) {
  if (notation.kind === "label") return null;
  const common = {
    "data-notation-id": notation.id,
    stroke: notation.color,
    vectorEffect: "non-scaling-stroke" as const
  };
  if (notation.kind === "line")
    return (
      <polyline
        {...common}
        points={notation.points.map((p) => `${p.x * 1000},${p.y * 1000}`).join(" ")}
        fill="none"
        strokeWidth="4"
      />
    );
  if (notation.kind === "circle")
    return (
      <ellipse
        {...common}
        cx={(notation.x + notation.width / 2) * 1000}
        cy={(notation.y + notation.height / 2) * 1000}
        rx={notation.width * 500}
        ry={notation.height * 500}
        strokeWidth="4"
        fill={notation.color}
        fillOpacity="0.22"
      />
    );
  return (
    <rect
      {...common}
      x={notation.x * 1000}
      y={notation.y * 1000}
      width={notation.width * 1000}
      height={notation.height * 1000}
      strokeWidth="4"
      fill={notation.color}
      fillOpacity="0.22"
    />
  );
}
