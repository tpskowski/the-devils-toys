import type { MapNotation, MapNotationEvent } from "@devils-toys/shared";

export interface NotationBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface NotationPoint {
  x: number;
  y: number;
}

export interface NotationTransform {
  scale: number;
  x: number;
  y: number;
}

/** Converts a viewport pointer position into the map coordinates beneath it. */
export function notationPoint(
  clientX: number,
  clientY: number,
  bounds: NotationBounds,
  transform: NotationTransform = { scale: 1, x: 0, y: 0 }
): NotationPoint {
  const width = Math.max(1, bounds.width);
  const height = Math.max(1, bounds.height);
  const scale = Math.max(0.01, transform.scale);
  const centerX = bounds.left + width / 2;
  const centerY = bounds.top + height / 2;
  return {
    x: Math.max(0, Math.min(1, (width / 2 + (clientX - centerX - transform.x) / scale) / width)),
    y: Math.max(0, Math.min(1, (height / 2 + (clientY - centerY - transform.y) / scale) / height))
  };
}

/** Samples a stroke without retaining multiple effectively identical pointer events. */
export function appendNotationPoint(points: NotationPoint[], next: NotationPoint, minimumDistance = 0.002) {
  const last = points.at(-1);
  if (last && Math.hypot(next.x - last.x, next.y - last.y) <= minimumDistance) return false;
  points.push(next);
  return true;
}

/** Applies one incremental realtime event, optionally replacing this client's optimistic stroke. */
export function applyMapNotationEvent(
  current: MapNotation[],
  event: MapNotationEvent,
  optimisticId?: number
): MapNotation[] {
  if (event.type === "map-notation-added") {
    return [
      ...current.filter((notation) => notation.id !== optimisticId && notation.id !== event.notation.id),
      event.notation
    ];
  }
  if (event.type === "map-notation-removed") return current.filter((notation) => notation.id !== event.notationId);
  return [];
}
