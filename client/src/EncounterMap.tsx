import { useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { MapPinOff } from "lucide-react";
import { api } from "./api";
import { CombatantAvatar } from "./CombatantAvatar";
import { canControlCombatant, clampMapPosition } from "./encounter-control";
import type { EncounterCombatant, EncounterRecord } from "./EncounterPage";

interface Position {
  x: number;
  y: number;
}

interface PointerDrag {
  combatant: EncounterCombatant;
  pointerId: number;
  startX: number;
  startY: number;
  moved: boolean;
}

function pointIn(element: HTMLElement | null, clientX: number, clientY: number) {
  if (!element) return;
  const box = element.getBoundingClientRect();
  if (clientX < box.left || clientX > box.right || clientY < box.top || clientY > box.bottom) return;
  return {
    x: clampMapPosition((clientX - box.left) / box.width),
    y: clampMapPosition((clientY - box.top) / box.height)
  };
}

/** A responsive, shared token layer over the encounter's chosen map. */
export function EncounterMap({
  roomId,
  encounter,
  isGm,
  viewerId,
  onChanged
}: {
  roomId: number;
  encounter: EncounterRecord;
  isGm: boolean;
  viewerId: number;
  onChanged: () => void;
}) {
  const mapRef = useRef<HTMLDivElement>(null);
  const rosterRef = useRef<HTMLElement>(null);
  const drag = useRef<PointerDrag | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [carried, setCarried] = useState<number>();
  const [dragging, setDragging] = useState<number>();
  const [preview, setPreview] = useState<{ id: number; position: Position }>();

  const canMove = (combatant: EncounterCombatant) => canControlCombatant(combatant, isGm, viewerId);

  async function place(combatant: EncounterCombatant, mapPosition: Position | null) {
    if (!canMove(combatant) || busy) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/rooms/${roomId}/encounters/${encounter.id}/combatants/${combatant.id}`, {
        method: "PATCH",
        body: JSON.stringify({ mapPosition })
      });
      onChanged();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function beginPointer(event: PointerEvent<HTMLButtonElement>, combatant: EncounterCombatant) {
    if (!canMove(combatant) || busy || event.button !== 0) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      combatant,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false
    };
    setDragging(combatant.id);
  }

  function movePointer(event: PointerEvent<HTMLButtonElement>) {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    if (Math.hypot(event.clientX - active.startX, event.clientY - active.startY) > 4) active.moved = true;
    if (!active.moved) return;
    const position = pointIn(mapRef.current, event.clientX, event.clientY);
    setPreview(position ? { id: active.combatant.id, position } : undefined);
  }

  function endPointer(event: PointerEvent<HTMLButtonElement>) {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    drag.current = undefined;
    setDragging(undefined);
    setPreview(undefined);
    if (!active.moved) {
      setCarried((current) => (current === active.combatant.id ? undefined : active.combatant.id));
      return;
    }
    const position = pointIn(mapRef.current, event.clientX, event.clientY);
    if (position) void place(active.combatant, position);
    else if (pointIn(rosterRef.current, event.clientX, event.clientY) && active.combatant.mapPosition)
      void place(active.combatant, null);
  }

  function token(combatant: EncounterCombatant, onMap: boolean) {
    const movable = canMove(combatant) && !busy;
    const position = preview?.id === combatant.id ? preview.position : combatant.mapPosition;
    const holding = carried === combatant.id || dragging === combatant.id;
    const style =
      onMap && position ? ({ left: `${position.x * 100}%`, top: `${position.y * 100}%` } as CSSProperties) : undefined;
    return (
      <button
        key={combatant.id}
        type="button"
        className={`encounter-map-token combat-side-${combatant.side === "party" ? "friendly" : "hostile"}${
          holding ? " encounter-map-token-carried" : ""
        }${movable ? " encounter-map-token-movable" : ""}`}
        style={style}
        disabled={!movable}
        aria-pressed={holding}
        title={movable ? `Move ${combatant.name}` : `${combatant.name} is controlled by someone else`}
        aria-label={movable ? `Move ${combatant.name}` : combatant.name}
        onPointerDown={(event) => beginPointer(event, combatant)}
        onPointerMove={movePointer}
        onPointerUp={endPointer}
        onPointerCancel={() => {
          drag.current = undefined;
          setDragging(undefined);
          setPreview(undefined);
        }}
        onKeyDown={(event) => {
          if (movable && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            setCarried((current) => (current === combatant.id ? undefined : combatant.id));
          }
        }}
      >
        <CombatantAvatar combatant={combatant} />
        <span>{combatant.name}</span>
      </button>
    );
  }

  const unplaced = encounter.combatants.filter((combatant) => !combatant.mapPosition);
  const placed = encounter.combatants.filter((combatant) => combatant.mapPosition || preview?.id === combatant.id);
  const carriedCombatant = encounter.combatants.find((combatant) => combatant.id === carried);

  return (
    <div className="encounter-map-layout">
      <div
        ref={mapRef}
        className={`encounter-map-stage${carriedCombatant ? " encounter-map-target" : ""}`}
        onPointerDown={(event) => {
          if (!carriedCombatant || event.button !== 0) return;
          const position = pointIn(mapRef.current, event.clientX, event.clientY);
          if (!position) return;
          setCarried(undefined);
          void place(carriedCombatant, position);
        }}
      >
        <img
          src={encounter.media!.url}
          alt={encounter.media!.displayName ?? encounter.media!.filename}
          draggable={false}
        />
        {placed.map((combatant) => token(combatant, true))}
      </div>
      <aside ref={rosterRef} className="encounter-map-roster" aria-label="Combatants not on the map">
        <div>
          <p className="eyebrow">Not on map</p>
          <small>{carriedCombatant ? "Choose a point on the map." : "Drag or select a token to place it."}</small>
        </div>
        <div className="encounter-map-roster-tokens">
          {unplaced.length ? unplaced.map((combatant) => token(combatant, false)) : <span>Everyone is placed.</span>}
        </div>
        {carriedCombatant?.mapPosition && canMove(carriedCombatant) && (
          <button
            type="button"
            className="encounter-map-remove"
            disabled={busy}
            onClick={() => {
              setCarried(undefined);
              void place(carriedCombatant, null);
            }}
          >
            <MapPinOff /> Remove from map
          </button>
        )}
      </aside>
      {error && <p className="form-error encounter-map-error">{error}</p>}
    </div>
  );
}
