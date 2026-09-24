import { describe, expect, it } from "vitest";
import { Quaternion, Vector3 } from "three";
import { DICE_SHAPES, diceGeometry, diceResultFaces, faceNormal, type PresentedDie } from "@devils-toys/shared";
import { buildDiceMotion, diceTrayExtents, DICE_TUMBLE_MS, sampleDiceMotion } from "./dice-motion";
import { landingQuaternion } from "./dice-renderer";

describe("bounded dice motion", () => {
  it("rebounds from walls, hits the floor and loses momentum before stopping", () => {
    const motion = buildDiceMotion(800, 500, 17, [new Quaternion()]);
    expect(motion.impacts.walls).toBeGreaterThanOrEqual(2);
    expect(motion.impacts.floor).toBeGreaterThanOrEqual(2);
    const xs = motion.frames.map((frame) => frame[0].x);
    expect(xs.some((x, i) => i > 0 && x < xs[i - 1] - 0.005)).toBe(true);
    expect(xs.some((x, i) => i > 0 && x > xs[i - 1] + 0.005)).toBe(true);
    const last = motion.frames.at(-1)![0],
      previous = motion.frames.at(-2)![0];
    expect(last.height).toBe(0);
    expect(Math.abs(last.x - previous.x) + Math.abs(last.y - previous.y)).toBeLessThan(0.0001);
    expect(last.rotation.angleTo(previous.rotation)).toBeLessThan(0.001);
  });

  for (const [width, height, count] of [
    [800, 500, 13],
    [390, 640, 40],
    [180, 190, 20]
  ])
    it(`keeps ${count} colliding dice inside a ${width}×${height} tray`, () => {
      const motion = buildDiceMotion(
        width,
        height,
        172,
        Array.from({ length: count }, () => new Quaternion())
      );
      expect(motion.impacts.dice).toBeGreaterThan(0);
      for (const frame of motion.frames)
        for (const pose of frame) {
          expect(Math.abs(pose.x)).toBeLessThanOrEqual(1.000001);
          expect(Math.abs(pose.y)).toBeLessThanOrEqual(1.000001);
          expect(pose.height).toBeGreaterThanOrEqual(0);
          expect(Number.isFinite(pose.rotation.lengthSq())).toBe(true);
        }
      const final = motion.frames.at(-1)!,
        extents = diceTrayExtents(width, height, motion.radius);
      for (let a = 0; a < count; a++)
        for (let b = a + 1; b < count; b++) {
          const distance = Math.hypot((final[a].x - final[b].x) * extents.x, (final[a].y - final[b].y) * extents.y);
          expect(distance).toBeGreaterThanOrEqual(motion.radius * 1.98);
        }
    });

  it("samples the same throw independently of frame rate and does not snap at the end", () => {
    const landing = new Quaternion().setFromAxisAngle(new Vector3(1, 2, 3).normalize(), 1.7);
    const a = buildDiceMotion(800, 500, 42, [landing]),
      b = buildDiceMotion(800, 500, 42, [landing]);
    for (const time of [0, 173, 1274, 2321, DICE_TUMBLE_MS, 10000])
      expect(sampleDiceMotion(a.frames, 0, time)).toEqual(sampleDiceMotion(b.frames, 0, time));
    for (let i = 1; i < a.frames.length; i++)
      expect(a.frames[i][0].rotation.angleTo(a.frames[i - 1][0].rotation)).toBeLessThan(0.4);
    expect(sampleDiceMotion(a.frames, 0, DICE_TUMBLE_MS).rotation.angleTo(landing)).toBeLessThan(1e-6);
  });

  it("preserves every numbered result throughout the change to collision-driven motion", () => {
    for (const shape of DICE_SHAPES) {
      const geometry = diceGeometry(shape),
        resultFaces = diceResultFaces(shape);
      for (let face = 0; face < shape; face++) {
        const die: PresentedDie = { definition: `d${shape}`, shape, face, value: face + 1, kept: true, group: 0 };
        const landing = landingQuaternion(die);
        const motion = buildDiceMotion(620, 480, shape * 100 + face, [landing]);
        const final = sampleDiceMotion(motion.frames, 0, DICE_TUMBLE_MS);
        const normal = new Vector3(
          ...(shape === 4 ? geometry.vertices[face] : faceNormal(geometry, geometry.faces[resultFaces[face]]))
        ).normalize();
        expect(normal.applyQuaternion(final.rotation).z).toBeCloseTo(1, 8);
      }
    }
  });
});
