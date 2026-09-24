import { Quaternion, Vector3 } from "three";

export const DICE_TUMBLE_MS = 2600;
const STEP = 1 / 120;
const STEPS = Math.round(DICE_TUMBLE_MS / 1000 / STEP);

interface Body {
  x: number;
  y: number;
  height: number;
  vx: number;
  vy: number;
  vz: number;
  spin: Vector3;
  rotation: Quaternion;
}
export interface DicePose {
  /** Center coordinates relative to the usable tray extents, from -1 to 1. */
  x: number;
  y: number;
  /** Height above the floor, in die radii. */
  height: number;
  rotation: Quaternion;
}
export function diceTrayExtents(width: number, height: number, radius: number) {
  // Leave room for the mesh and its projected height under the tilted camera.
  return { x: Math.max(0, width / 2 - radius * 1.4 - 8), y: Math.max(0, height / 2 - radius * 1.8 - 8) };
}
function seeded(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A bounded, fixed-step presentation simulation. Round collision envelopes keep
 * arbitrary imported meshes inexpensive; actual mesh support sets floor contact
 * in the renderer. This never generates or changes a game result.
 *
 * Simulate angular motion first, then solve the INITIAL orientations backwards
 * from the requested landings. Faces stay fixed and the entire throw is smooth:
 * no last-second steering, face swapping, or retries until a number comes up.
 */
export function buildDiceMotion(width: number, height: number, seed: number, landings: Quaternion[]) {
  const count = landings.length;
  const columns = Math.max(1, Math.ceil(Math.sqrt((count * width) / Math.max(height, 1))));
  const rows = Math.max(1, Math.ceil(count / columns));
  const radius = Math.max(3, Math.min(44, (width - 24) / (columns * 3), (height - 40) / (rows * 3.4)));
  const bounds = diceTrayExtents(width, height, radius);
  const random = seeded(seed);
  const bodies: Body[] = landings.map((_end, i) => ({
    x: -bounds.x + (((i % columns) + 0.5) / columns) * bounds.x * 1.45,
    y: -bounds.y + ((Math.floor(i / columns) + 0.5) / rows) * bounds.y * 2,
    height: radius * (0.4 + random() * 0.8),
    vx: Math.max(120, bounds.x * 2) * (1.8 + random() * 0.5),
    vy: Math.max(100, bounds.y * 2) * (random() > 0.5 ? 1 : -1) * (0.65 + random() * 0.45),
    vz: radius * (2 + random() * 2),
    spin: new Vector3(9 + random() * 9, -12 + random() * 24, -8 + random() * 16),
    rotation: new Quaternion()
  }));
  const frames: DicePose[][] = [];
  const impacts = { walls: 0, floor: 0, dice: 0 };
  const record = () =>
    frames.push(
      bodies.map((body) => ({
        x: bounds.x ? body.x / bounds.x : 0,
        y: bounds.y ? body.y / bounds.y : 0,
        height: body.height / radius,
        rotation: body.rotation.clone()
      }))
    );
  const wall = (body: Body) => {
    for (const [position, velocity, limit] of [
      ["x", "vx", bounds.x],
      ["y", "vy", bounds.y]
    ] as const) {
      if (Math.abs(body[position]) <= limit) continue;
      const sign = Math.sign(body[position]);
      body[position] = sign * limit;
      if (body[velocity] * sign <= 0) continue;
      body[velocity] *= -0.82;
      body.spin.z += sign * Math.min(2, Math.abs(body[velocity]) / (radius * 10));
      impacts.walls++;
    }
  };
  record();
  for (let step = 1; step <= STEPS; step++) {
    const time = step * STEP;
    // An energetic first second, followed by a short loss of momentum.
    const slowing = Math.max(0, (time - 1) / 1.6);
    const drag = Math.exp(-(0.3 + 18 * slowing * slowing) * STEP);
    const spinDrag = Math.exp(-(0.5 + 18 * slowing * slowing) * STEP);
    for (const body of bodies) {
      body.vx *= drag;
      body.vy *= drag;
      body.vz -= radius * 48 * STEP;
      body.x += body.vx * STEP;
      body.y += body.vy * STEP;
      body.height += body.vz * STEP;
      if (body.height < 0) {
        body.height = 0;
        if (body.vz < -radius * 1.4) {
          body.vz *= -0.5;
          body.spin.multiplyScalar(0.88);
          impacts.floor++;
        } else body.vz = 0;
      }
      wall(body);
    }
    // Equal-mass collision impulses and positional separation. Multiple passes
    // also resolve crowded throws without allowing dice to pass through walls.
    for (let pass = 0; pass < 3; pass++) {
      for (let a = 0; a < count; a++)
        for (let b = a + 1; b < count; b++) {
          const left = bodies[a],
            right = bodies[b];
          if (Math.abs(left.height - right.height) > radius * 1.5) continue;
          const dx = right.x - left.x,
            dy = right.y - left.y;
          const distance = Math.hypot(dx, dy);
          if (distance >= radius * 2) continue;
          const nx = distance > 1e-6 ? dx / distance : 1;
          const ny = distance > 1e-6 ? dy / distance : 0;
          const correction = (radius * 2 - distance) / 2;
          left.x -= nx * correction;
          left.y -= ny * correction;
          right.x += nx * correction;
          right.y += ny * correction;
          const approach = (right.vx - left.vx) * nx + (right.vy - left.vy) * ny;
          if (approach < 0) {
            const impulse = -approach * 0.85;
            left.vx -= impulse * nx;
            left.vy -= impulse * ny;
            right.vx += impulse * nx;
            right.vy += impulse * ny;
            const tumble = Math.min(2, impulse / (radius * 8));
            left.spin.z -= tumble;
            right.spin.z += tumble;
            impacts.dice++;
          }
        }
      bodies.forEach(wall);
    }
    for (const body of bodies) {
      body.spin.multiplyScalar(spinDrag);
      const speed = body.spin.length();
      if (speed > 1e-6)
        body.rotation
          .premultiply(new Quaternion().setFromAxisAngle(body.spin.clone().divideScalar(speed), speed * STEP))
          .normalize();
    }
    record();
  }
  for (let die = 0; die < count; die++) {
    const initial = frames[STEPS][die].rotation.clone().invert().multiply(landings[die]);
    for (const frame of frames) frame[die].rotation.multiply(initial).normalize();
  }
  return { frames, radius, impacts };
}

/** Sample the same recorded path at any refresh rate, including dropped frames. */
export function sampleDiceMotion(frames: DicePose[][], die: number, elapsed: number): DicePose {
  const frame = Math.max(0, Math.min(frames.length - 1, elapsed / (STEP * 1000)));
  const index = Math.floor(frame),
    fraction = frame - index;
  const a = frames[index][die],
    b = frames[Math.min(index + 1, frames.length - 1)][die];
  return {
    x: a.x + (b.x - a.x) * fraction,
    y: a.y + (b.y - a.y) * fraction,
    height: a.height + (b.height - a.height) * fraction,
    rotation: a.rotation.clone().slerp(b.rotation, fraction)
  };
}
