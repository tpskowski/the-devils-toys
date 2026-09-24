import { Quaternion } from "three";
import type { DicePhysicsReplay } from "@devils-toys/shared";

/** Interpolate only the server's recorded rigid-body poses. Never solve an outcome here. */
export function sampleDiceMotion(replay: DicePhysicsReplay, die: number, elapsed: number) {
  const frame = Math.max(0, Math.min(replay.frames.length - 1, elapsed / replay.stepMs));
  const index = Math.floor(frame),
    fraction = frame - index,
    offset = die * 7;
  const a = replay.frames[index],
    b = replay.frames[Math.min(index + 1, replay.frames.length - 1)];
  return {
    x: a[offset] + (b[offset] - a[offset]) * fraction,
    y: a[offset + 1] + (b[offset + 1] - a[offset + 1]) * fraction,
    z: a[offset + 2] + (b[offset + 2] - a[offset + 2]) * fraction,
    rotation: new Quaternion(...(a.slice(offset + 3, offset + 7) as [number, number, number, number]))
      .normalize()
      .slerp(
        new Quaternion(...(b.slice(offset + 3, offset + 7) as [number, number, number, number])).normalize(),
        fraction
      )
  };
}
