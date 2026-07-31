import { describe, expect, it } from "vitest";
import type { MapNotation } from "@devils-toys/shared";
import { appendNotationPoint, applyMapNotationEvent, labelArea, notationArea, notationPoint } from "./map-notation";

const line = (id: number): MapNotation => ({
  id,
  kind: "line",
  color: "#e53935",
  points: [
    { x: 0, y: 0 },
    { x: 1, y: 1 }
  ]
});

describe("map notation gestures", () => {
  it("normalizes and clamps pointer positions against cached bounds", () => {
    const bounds = { left: 100, top: 50, width: 400, height: 200 };
    expect(notationPoint(300, 150, bounds)).toEqual({ x: 0.5, y: 0.5 });
    expect(notationPoint(0, 500, bounds)).toEqual({ x: 0, y: 1 });
  });

  it("inverse-maps pointer positions through map zoom and pan", () => {
    const bounds = { left: 100, top: 50, width: 400, height: 200 };
    const transform = { scale: 2, x: 40, y: -20 };
    expect(notationPoint(340, 130, bounds, transform)).toEqual({ x: 0.5, y: 0.5 });
    expect(notationPoint(500, 230, bounds, transform)).toEqual({ x: 0.7, y: 0.75 });
  });

  it("samples points only after the pointer moves far enough", () => {
    const points = [{ x: 0.1, y: 0.1 }];
    expect(appendNotationPoint(points, { x: 0.101, y: 0.1 })).toBe(false);
    expect(appendNotationPoint(points, { x: 0.104, y: 0.1 })).toBe(true);
    expect(points).toHaveLength(2);
  });

  it("normalizes text boxes dragged in any direction", () => {
    const area = notationArea({ x: 0.8, y: 0.7 }, { x: 0.2, y: 0.3 });
    expect(area.x).toBe(0.2);
    expect(area.y).toBe(0.3);
    expect(area.width).toBeCloseTo(0.6);
    expect(area.height).toBeCloseTo(0.4);
  });

  it("gives a click-sized text gesture a useful box that stays on the map", () => {
    expect(labelArea({ x: 0.95, y: 0.96 }, { x: 0.95, y: 0.96 })).toEqual({
      x: 0.76,
      y: 0.9,
      width: 0.24,
      height: 0.1
    });
  });
});

describe("incremental map notation events", () => {
  it("replaces an optimistic stroke without duplicating the saved notation", () => {
    expect(
      applyMapNotationEvent(
        [line(1), line(-1)],
        { type: "map-notation-added", mediaId: 3, notation: line(2), clientMutationId: "draw-1" },
        -1
      ).map((notation) => notation.id)
    ).toEqual([1, 2]);
  });

  it("removes one notation or clears the collection", () => {
    expect(
      applyMapNotationEvent([line(1), line(2)], {
        type: "map-notation-removed",
        mediaId: 3,
        notationId: 1
      }).map((notation) => notation.id)
    ).toEqual([2]);
    expect(
      applyMapNotationEvent([line(2)], {
        type: "map-notations-cleared",
        mediaId: 3
      })
    ).toEqual([]);
  });
});
