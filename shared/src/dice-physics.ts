import {
  Body,
  Box,
  ContactMaterial,
  ConvexPolyhedron,
  GSSolver,
  Material,
  Plane,
  Quaternion,
  Vec3,
  World
} from "cannon-es";
import {
  diceGeometry,
  diceResultFaces,
  faceNormal,
  vUnit,
  type DiceGeometry,
  type DicePhysicsReplay,
  type PresentedDie
} from "./dice-3d.js";

export function physicalGeometry(die: PresentedDie): DiceGeometry {
  const source = die.custom?.geometry ?? diceGeometry(die.shape);
  const center = [0, 1, 2].map((axis) => source.vertices.reduce((s, v) => s + v[axis], 0) / source.vertices.length);
  const radius = Math.max(...source.vertices.map((v) => Math.hypot(...v.map((n, i) => n - center[i]))));
  return {
    faces: source.faces,
    vertices: source.vertices.map((v) => v.map((n, i) => (n - center[i]) / radius) as [number, number, number])
  };
}

/** Read the actual upper face, or the tetrahedron's upper tip. Undefined means cocked. */
export function settledDieFace(die: PresentedDie, orientation: Quaternion): number | undefined {
  return faceReader(die)(orientation);
}
function faceReader(die: PresentedDie) {
  const geometry = physicalGeometry(die);
  const tip = die.shape === 4 && !die.custom?.geometry;
  const normals = (tip ? geometry.vertices.map(vUnit) : geometry.faces.map((face) => faceNormal(geometry, face))).map(
    (normal) => new Vec3(...normal)
  );
  const faces = die.custom?.resultFaces ?? diceResultFaces(die.shape, geometry);
  const rotated = new Vec3();
  return (orientation: Quaternion): number | undefined => {
    let index = -1,
      highest = -Infinity;
    normals.forEach((normal, i) => {
      orientation.vmult(normal, rotated);
      if (rotated.z > highest) {
        highest = rotated.z;
        index = i;
      }
    });
    if (highest < 0.985) return;
    if (tip) return index;
    const outcome = faces.indexOf(index);
    return outcome < 0 ? undefined : outcome % (die.labels?.length ?? die.shape);
  };
}

export function simulateDice(
  dice: PresentedDie[],
  random: () => number
): { faces: number[]; replay: DicePhysicsReplay } {
  if (!dice.length || dice.length > 40) throw new Error("A physical throw needs 1–40 dice.");
  const radius = 0.55;
  const width = Math.max(12, Math.sqrt(dice.length) * 3.2),
    height = width * 0.72;
  const world = new World({ gravity: new Vec3(0, 0, -22), allowSleep: true });
  (world.solver as GSSolver).iterations = 16;
  world.quatNormalizeSkip = 0;
  const material = new Material("dice"),
    floorMaterial = new Material("tray"),
    wallMaterial = new Material("walls");
  world.addContactMaterial(new ContactMaterial(material, floorMaterial, { friction: 0.55, restitution: 0.38 }));
  world.addContactMaterial(new ContactMaterial(material, wallMaterial, { friction: 0.08, restitution: 0.5 }));
  world.addContactMaterial(new ContactMaterial(material, material, { friction: 0.3, restitution: 0.35 }));
  const floor = new Body({ mass: 0, material: floorMaterial, shape: new Plane() });
  world.addBody(floor);
  for (const [x, y, sx, sy] of [
    [-width / 2 - 0.25, 0, 0.25, height / 2 + 1],
    [width / 2 + 0.25, 0, 0.25, height / 2 + 1],
    [0, -height / 2 - 0.25, width / 2 + 1, 0.25],
    [0, height / 2 + 0.25, width / 2 + 1, 0.25]
  ]) {
    world.addBody(
      new Body({ mass: 0, material: wallMaterial, shape: new Box(new Vec3(sx, sy, 5)), position: new Vec3(x, y, 5) })
    );
  }
  const columns = Math.ceil(Math.sqrt(dice.length)),
    rows = Math.ceil(dice.length / columns);
  const bodies = dice.map((die, i) => {
    const geometry = physicalGeometry(die);
    const shape = new ConvexPolyhedron({
      vertices: geometry.vertices.map((v) => new Vec3(...v).scale(radius)),
      faces: geometry.faces.map((f) => [...f])
    });
    const body = new Body({
      mass: 1,
      material,
      shape,
      linearDamping: 0.18,
      angularDamping: 0.45,
      allowSleep: true,
      sleepSpeedLimit: 0.45,
      sleepTimeLimit: 0.2
    });
    body.position.set(
      -width / 2 + radius * 1.6 + (i % columns) * radius * 2.2,
      -height / 2 + ((Math.floor(i / columns) + 0.5) * height) / rows,
      1.4 + random() * 1.2
    );
    // Uniform random orientation, independent of any desired number.
    const u = random(),
      a = random() * Math.PI * 2,
      b = random() * Math.PI * 2;
    body.quaternion.set(
      Math.sqrt(1 - u) * Math.sin(a),
      Math.sqrt(1 - u) * Math.cos(a),
      Math.sqrt(u) * Math.sin(b),
      Math.sqrt(u) * Math.cos(b)
    );
    body.velocity.set(9 + random() * 6, (random() - 0.5) * 9, 1 + random() * 3);
    body.angularVelocity.set((random() - 0.5) * 28, (random() - 0.5) * 28, (random() - 0.5) * 28);
    world.addBody(body);
    return body;
  });
  const readFaces = dice.map(faceReader);
  const frames: number[][] = [];
  const record = () =>
    frames.push(
      bodies.flatMap((body) =>
        [
          body.position.x,
          body.position.y,
          body.position.z,
          body.quaternion.x,
          body.quaternion.y,
          body.quaternion.z,
          body.quaternion.w
        ].map((n) => Math.round(n * 100000) / 100000)
      )
    );
  record();
  // Natural sleep ends a throw. A cocked die receives a new physical impulse;
  // no face is rotated into place and no result is selected in advance.
  const kicks = Array(dice.length).fill(0);
  const cockedTime = Array(dice.length).fill(0);
  for (let step = 1; step <= 120 * 20; step++) {
    world.step(1 / 120);
    for (let i = 0; i < bodies.length; i++) {
      const body = bodies[i];
      const cocked = readFaces[i](body.quaternion) === undefined;
      cockedTime[i] =
        cocked && body.velocity.length() < 0.6 && body.angularVelocity.length() < 3 ? cockedTime[i] + 1 / 120 : 0;
      if (cocked && (body.sleepState === Body.SLEEPING || cockedTime[i] > 0.75) && kicks[i] < 6) {
        cockedTime[i] = 0;
        body.wakeUp();
        body.applyImpulse(
          new Vec3(
            -Math.sign(body.position.x) * (2 + random() * 2),
            -Math.sign(body.position.y) * (2 + random() * 2),
            5 + random()
          )
        );
        body.angularVelocity.set((random() - 0.5) * 22, (random() - 0.5) * 22, (random() - 0.5) * 22);
        kicks[i]++;
      }
    }
    if (step % 4 === 0) record();
    if (bodies.every((body) => body.sleepState === Body.SLEEPING)) {
      const faces = bodies.map((body, i) => readFaces[i](body.quaternion));
      if (faces.every((face): face is number => face !== undefined)) {
        if (step % 4) record();
        return { faces, replay: { width, height, radius, stepMs: 1000 / 30, frames } };
      }
      break;
    }
  }
  throw new Error("The dice did not settle on numbered faces. Please roll again.");
}
