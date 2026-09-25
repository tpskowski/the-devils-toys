import { describe, expect, it } from "vitest";
import { Vector3, Quaternion } from "three";
import {
  DICE_SHAPES,
  diceGeometry,
  diceResultFaces,
  faceNormal,
  invalidDiceGeometry,
  type DicePresentation
} from "@devils-toys/shared";

import { DiceInbox } from "./dice-events";

describe("numeric dice geometry and landing", () => {
  for (const sides of DICE_SHAPES)
    it(`d${sides} has a closed solid and every result lands correctly`, () => {
      const geometry = diceGeometry(sides);
      expect(invalidDiceGeometry(geometry)).toBeUndefined();
      const results = diceResultFaces(sides);
      expect(results.length).toBe([3, 5, 7].includes(sides) ? sides * 2 : sides);
      for (let face = 0; face < sides; face++) {
        const normal = new Vector3(
          ...(sides === 4 ? geometry.vertices[face] : faceNormal(geometry, geometry.faces[results[face]]))
        ).normalize();
        const orientation = new Quaternion().setFromUnitVectors(normal, new Vector3(0, 0, 1));
        expect(normal.applyQuaternion(orientation).z).toBeCloseTo(1, 8);
        // A stable floor has at least three coplanar lowest vertices.
        const heights = geometry.vertices.map((v) => new Vector3(...v).applyQuaternion(orientation).z);
        expect(heights.filter((z) => Math.abs(z - Math.min(...heights)) < 1e-5).length).toBeGreaterThanOrEqual(3);
      }
    });
  it("rejects open, inverted, duplicate and nonplanar custom meshes", () => {
    const geometry = diceGeometry(6);
    expect(invalidDiceGeometry({ ...geometry, faces: geometry.faces.slice(1) })).toBeTruthy();
    expect(invalidDiceGeometry({ ...geometry, faces: geometry.faces.map((f) => [...f].reverse()) })).toBeTruthy();
    expect(invalidDiceGeometry({ ...geometry, faces: [...geometry.faces, geometry.faces[0]] })).toBeTruthy();
    const moved = structuredClone(geometry);
    moved.vertices[0][0] += 0.2;
    expect(invalidDiceGeometry(moved)).toBeTruthy();
  });
});
it("deduplicates live HTTP/socket delivery across rooms without relying on synchronized device clocks", () => {
  const inbox = new DiceInbox(8),
    now = Date.now();
  const roll = { version: 1, id: "one", roomId: 8, createdAt: now } as DicePresentation;
  expect(inbox.accept(roll)).toBe(true);
  expect(inbox.accept(roll)).toBe(false);
  expect(inbox.accept({ ...roll, id: "two", roomId: 9 })).toBe(false);
  expect(inbox.accept({ ...roll, id: "three", createdAt: now - 3600000 })).toBe(true);
});
