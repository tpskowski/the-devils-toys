import { describe, expect, it } from "vitest";
import { Quaternion, Vec3 } from "cannon-es";
import { simulateDice, settledDieFace, physicalGeometry } from "@devils-toys/shared/dice-physics";
import { DICE_SHAPES, type PresentedDie } from "@devils-toys/shared";
import { sampleDiceMotion } from "./dice-motion";

function randomSeed(seed: number) {
  return () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
}
const die = (shape: PresentedDie["shape"]): PresentedDie => ({
  definition: `d${shape}`,
  shape,
  face: 0,
  value: 1,
  kept: true,
  group: 0
});

describe("recorded rigid-body dice", () => {
  for (const shape of DICE_SHAPES)
    it(`d${shape} settles naturally and the replay agrees with its result`, () => {
      const dice = [die(shape)];
      const { faces, replay } = simulateDice(dice, randomSeed(shape * 19));
      const last = sampleDiceMotion(replay, 0, Infinity);
      const q = new Quaternion(last.rotation.x, last.rotation.y, last.rotation.z, last.rotation.w);
      expect(settledDieFace(dice[0], q)).toBe(faces[0]);
      const lowest = Math.min(
        ...physicalGeometry(dice[0]).vertices.map((v) => q.vmult(new Vec3(...v)).z * replay.radius + last.z)
      );
      expect(Math.abs(lowest)).toBeLessThan(0.02);
      expect(replay.frames.length).toBeGreaterThan(20);
    });
  it("replays the same body poses on phones, large screens, and skipped frames", () => {
    const { replay } = simulateDice([die(6), die(8)], randomSeed(97));
    const halfway = ((replay.frames.length - 1) * replay.stepMs) / 2;
    const at = sampleDiceMotion(replay, 0, halfway);
    sampleDiceMotion(replay, 0, 99999);
    expect(sampleDiceMotion(replay, 0, halfway)).toEqual(at);
    const end = sampleDiceMotion(replay, 0, Infinity);
    expect(end.rotation.length()).toBeCloseTo(1, 8);
    const final = replay.frames.at(-1)!;
    expect([end.x, end.y, end.z]).toEqual(final.slice(0, 3));
  });
  for (const shape of DICE_SHAPES)
    it(`settles a crowded d${shape} throw without forcing faces`, () => {
      const dice = Array.from({ length: 20 }, () => die(shape));
      const { faces, replay } = simulateDice(dice, randomSeed(6 * 771 + shape));
      const final = replay.frames.at(-1)!;
      dice.forEach((d, i) => {
        const q = new Quaternion(...(final.slice(i * 7 + 3, i * 7 + 7) as [number, number, number, number]));
        expect(settledDieFace(d, q)).toBe(faces[i]);
      });
    });
  it("keeps a crowded throw inside the physical walls", () => {
    const dice = Array.from({ length: 20 }, () => die(6));
    const { faces, replay } = simulateDice(dice, randomSeed(172));
    expect(faces).toHaveLength(dice.length);
    for (const frame of replay.frames)
      for (let i = 0; i < dice.length; i++) {
        expect(Math.abs(frame[i * 7])).toBeLessThan(replay.width / 2);
        expect(Math.abs(frame[i * 7 + 1])).toBeLessThan(replay.height / 2);
        expect(frame[i * 7 + 2]).toBeGreaterThan(0);
      }
  });
});
