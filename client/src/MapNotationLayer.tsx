import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Circle, Eraser, Pencil, Square, Trash2, Type, Undo2, X } from "lucide-react";
import { MAP_NOTATION_COLORS, type MapNotation, type MapNotationColor, type NewMapNotation } from "@devils-toys/shared";
import { api } from "./api";

type Tool = "draw" | "label" | "box" | "circle" | "erase";
type Point = { x: number; y: number };

export function MapNotationLayer({
  roomId,
  mediaId,
  isGm,
  revision,
  transform
}: {
  roomId: number;
  mediaId: number;
  isGm: boolean;
  revision: number;
  transform: string;
}) {
  const [notations, setNotations] = useState<MapNotation[]>([]);
  const [tool, setTool] = useState<Tool>();
  const [color, setColor] = useState<MapNotationColor>(MAP_NOTATION_COLORS[0]);
  const [fontSize, setFontSize] = useState(18);
  const gesture = useRef<{ start: Point; points: Point[] } | undefined>(undefined);
  const svg = useRef<SVGSVGElement>(null);

  async function load() {
    const result = await api<{ notations: MapNotation[] }>(`/api/rooms/${roomId}/maps/${mediaId}/notations`);
    setNotations(result.notations);
  }
  useEffect(() => {
    load();
  }, [roomId, mediaId, revision]);

  function point(event: PointerEvent<SVGSVGElement>): Point {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height))
    };
  }

  async function add(notation: NewMapNotation) {
    const result = await api<{ notation: MapNotation }>(`/api/rooms/${roomId}/maps/${mediaId}/notations`, {
      method: "POST",
      body: JSON.stringify(notation)
    });
    setNotations((current) =>
      current.some((item) => item.id === result.notation.id) ? current : [...current, result.notation]
    );
  }

  function down(event: PointerEvent<SVGSVGElement>) {
    if (!tool) return;
    if (tool === "erase") {
      const id = Number((event.target as Element).closest("[data-notation-id]")?.getAttribute("data-notation-id"));
      if (id) void erase(id);
      return;
    }
    const start = point(event);
    if (tool === "label") {
      const text = prompt("Label text");
      if (text?.trim()) void add({ kind: "label", color, x: start.x, y: start.y, text: text.trim(), fontSize });
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { start, points: [start] };
  }

  function move(event: PointerEvent<SVGSVGElement>) {
    if (!gesture.current || tool !== "draw") return;
    const next = point(event);
    const last = gesture.current.points.at(-1)!;
    if (Math.hypot(next.x - last.x, next.y - last.y) > 0.002) gesture.current.points.push(next);
  }

  function up(event: PointerEvent<SVGSVGElement>) {
    const current = gesture.current;
    gesture.current = undefined;
    if (!current || !tool) return;
    const end = point(event);
    if (tool === "draw" && current.points.length > 1) void add({ kind: "line", color, points: current.points });
    if (tool === "box" || tool === "circle") {
      const x = Math.min(current.start.x, end.x),
        y = Math.min(current.start.y, end.y);
      const width = Math.abs(end.x - current.start.x),
        height = Math.abs(end.y - current.start.y);
      if (width > 0.005 && height > 0.005) void add({ kind: tool, color, x, y, width, height });
    }
  }

  async function erase(id: number) {
    await api(`/api/rooms/${roomId}/maps/${mediaId}/notations/${id}`, { method: "DELETE" });
    setNotations((current) => current.filter((item) => item.id !== id));
  }
  async function undo() {
    await api(`/api/rooms/${roomId}/maps/${mediaId}/notations/undo`, { method: "POST" });
    setNotations((current) => current.slice(0, -1));
  }
  async function clear() {
    if (!confirm("Clear every notation from this map?")) return;
    await api(`/api/rooms/${roomId}/maps/${mediaId}/notations`, { method: "DELETE" });
    setNotations([]);
  }

  return (
    <>
      <svg
        ref={svg}
        className={`map-notation-layer ${tool ? "active" : ""}`}
        style={{ transform }}
        viewBox="0 0 1000 1000"
        preserveAspectRatio="none"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
      >
        {notations.map((item) => (
          <NotationShape key={item.id} notation={item} />
        ))}
      </svg>
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
          title="Add label"
          selected={tool === "label"}
          onClick={() => setTool(tool === "label" ? undefined : "label")}
        >
          <Type />
        </ToolButton>
        {tool === "label" && (
          <select aria-label="Label point size" value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))}>
            {[12, 18, 24, 32, 48].map((size) => (
              <option key={size}>{size}</option>
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
  if (notation.kind === "label")
    return (
      <text
        {...common}
        x={notation.x * 1000}
        y={notation.y * 1000}
        fill={notation.color}
        stroke="none"
        fontSize={notation.fontSize * 2.2}
        paintOrder="stroke"
      >
        {notation.text}
      </text>
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
