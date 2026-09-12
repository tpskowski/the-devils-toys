import { describe, expect, it } from "vitest";
import { fitScenePlane, zoomOffsetAtPoint } from "./scene-transform";

describe("scene geometry", () => {
  it("finds the actual letterboxed image rectangle", () => {
    expect(fitScenePlane(1000, 600, 1000, 1000)).toEqual({ left: 200, top: 0, width: 600, height: 600 });
    expect(fitScenePlane(600, 1000, 1600, 900)).toEqual({ left: 0, top: 331.25, width: 600, height: 337.5 });
  });

  it("keeps the map point beneath the cursor fixed while zooming", () => {
    expect(zoomOffsetAtPoint({ x: 0, y: 0 }, 1, 2, { x: 750, y: 200 }, { x: 500, y: 300 })).toEqual({
      x: -250,
      y: 100
    });
    expect(zoomOffsetAtPoint({ x: -250, y: 100 }, 2, 1, { x: 750, y: 200 }, { x: 500, y: 300 })).toEqual({
      x: 0,
      y: 0
    });
  });
});
