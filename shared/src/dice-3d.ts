import type { ThemeId } from "./index.js";

export const DICE_SHAPES = [3, 4, 5, 6, 7, 8, 10, 12, 14, 16, 20, 24, 30] as const;
export type DiceShape = (typeof DICE_SHAPES)[number];
export type DiceVector = [number, number, number];
export interface DiceGeometry {
  vertices: DiceVector[];
  faces: number[][];
}
export interface CustomDie {
  id: string;
  name: string;
  shape?: DiceShape;
  geometry?: DiceGeometry;
  /** Face indices in geometry order; omitted for built-in shape templates. */
  resultFaces?: number[];
  values: number[];
}
export interface DiceAppearance {
  body: string;
  ink: string;
  accent: string;
  finish: "matte" | "satin" | "gloss";
}
export interface DicePreferences {
  enabled: boolean;
  theme: ThemeId | "room" | "custom";
  custom: DiceAppearance;
}
export const DICE_THEMES: Record<ThemeId, DiceAppearance & { name: string }> = {
  heroic: { name: "Heroic Tales", body: "#191914", ink: "#e7e3d7", accent: "#b63e2e", finish: "satin" },
  digital: { name: "Digital Future", body: "#e9f9ff", ink: "#071018", accent: "#18e1d1", finish: "gloss" },
  used: { name: "Used Universe", body: "#2d2b25", ink: "#c9c0ad", accent: "#9a4c2f", finish: "matte" },
  grim: { name: "Grim Adventure", body: "#e4e0d7", ink: "#171717", accent: "#9f2634", finish: "matte" },
  shinji: { name: "Get in the VTT Shinji", body: "#ebe6f7", ink: "#1d1a2f", accent: "#8bd450", finish: "gloss" },
  "production-type": { name: "Production Type", body: "#fbe5e5", ink: "#291d2d", accent: "#ea8532", finish: "satin" }
};
export const DEFAULT_DICE_PREFERENCES: DicePreferences = {
  enabled: true,
  theme: "room",
  custom: { body: "#191914", ink: "#e7e3d7", accent: "#b63e2e", finish: "satin" }
};
export function diceAppearance(preferences: DicePreferences, theme: ThemeId): DiceAppearance {
  const { body, ink, accent, finish } =
    preferences.theme === "custom"
      ? preferences.custom
      : DICE_THEMES[preferences.theme === "room" ? theme : preferences.theme];
  return { body, ink, accent, finish };
}
export function contrastingDiceInk(body: string) {
  const rgb = [1, 3, 5]
    .map((i) => parseInt(body.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722 > 0.179 ? "#171717" : "#f5f1e8";
}
export interface PresentedDie {
  definition: string;
  shape: DiceShape;
  face: number;
  value: number;
  kept: boolean;
  group: number;
  role?: "tens" | "units";
  labels?: number[];
  /** Validated snapshot: an in-flight throw survives system replacement. */
  custom?: CustomDie;
}
export interface DicePresentation {
  version: 1;
  id: string;
  roomId: number;
  accountId: number;
  createdAt: number;
  seed: number;
  label: string;
  total: number;
  modifier: number;
  appearance: DiceAppearance;
  dice: PresentedDie[];
}

export const vAdd = (a: DiceVector, b: DiceVector): DiceVector => a.map((v, i) => v + b[i]) as DiceVector;
export const vSub = (a: DiceVector, b: DiceVector): DiceVector => a.map((v, i) => v - b[i]) as DiceVector;
export const vScale = (a: DiceVector, n: number): DiceVector => a.map((v) => v * n) as DiceVector;
export const vDot = (a: DiceVector, b: DiceVector) => a.reduce((n, v, i) => n + v * b[i], 0);
export const vCross = (a: DiceVector, b: DiceVector): DiceVector => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0]
];
export const vUnit = (a: DiceVector) => vScale(a, 1 / Math.hypot(...a));
export function faceCenter(geometry: DiceGeometry, face: number[]): DiceVector {
  return vScale(
    face.reduce<DiceVector>((sum, i) => vAdd(sum, geometry.vertices[i]), [0, 0, 0]),
    1 / face.length
  );
}
export function faceNormal(geometry: DiceGeometry, face: number[]): DiceVector {
  return vUnit(
    vCross(
      vSub(geometry.vertices[face[1]], geometry.vertices[face[0]]),
      vSub(geometry.vertices[face[2]], geometry.vertices[face[0]])
    )
  );
}

/** Small convex solids only. Merge coplanar triangles into ordered polygon faces. */
export function convexDiceGeometry(vertices: DiceVector[]): DiceGeometry {
  const faces = new Map<string, number[]>();
  for (let a = 0; a < vertices.length; a++)
    for (let b = a + 1; b < vertices.length; b++)
      for (let c = b + 1; c < vertices.length; c++) {
        let cross = vCross(vSub(vertices[b], vertices[a]), vSub(vertices[c], vertices[a]));
        if (Math.hypot(...cross) < 1e-7) continue;
        let normal = vUnit(cross);
        const distances = vertices.map((p) => vDot(normal, vSub(p, vertices[a])));
        if (distances.some((d) => d > 1e-6) && distances.some((d) => d < -1e-6)) continue;
        if (distances.some((d) => d > 1e-6)) normal = vScale(normal, -1);
        const ids = distances.flatMap((d, i) => (Math.abs(d) < 1e-6 ? [i] : []));
        const key = ids.join(",");
        if (faces.has(key)) continue;
        const center = vScale(
          ids.reduce<DiceVector>((sum, i) => vAdd(sum, vertices[i]), [0, 0, 0]),
          1 / ids.length
        );
        const u = vUnit(vSub(vertices[ids[0]], center)),
          v = vCross(normal, u);
        ids.sort(
          (i, j) =>
            Math.atan2(vDot(vSub(vertices[i], center), v), vDot(vSub(vertices[i], center), u)) -
            Math.atan2(vDot(vSub(vertices[j], center), v), vDot(vSub(vertices[j], center), u))
        );
        faces.set(key, ids);
      }
  return { vertices, faces: [...faces.values()] };
}
function normalized(geometry: DiceGeometry): DiceGeometry {
  const radius = Math.max(...geometry.vertices.map((v) => Math.hypot(...v)));
  return { vertices: geometry.vertices.map((v) => vScale(v, 1 / radius)), faces: geometry.faces };
}
function dual(geometry: DiceGeometry) {
  return normalized(
    convexDiceGeometry(
      geometry.faces.map((face) => {
        const normal = faceNormal(geometry, face);
        return vScale(normal, 1 / vDot(normal, geometry.vertices[face[0]]));
      })
    )
  );
}
const cache = new Map<number, DiceGeometry>();
export function diceGeometry(sides: DiceShape): DiceGeometry {
  const cached = cache.get(sides);
  if (cached) return cached;
  let vertices: DiceVector[] = [];
  let result: DiceGeometry;
  const phi = (1 + Math.sqrt(5)) / 2;
  if (sides === 4)
    vertices = [
      [1, 1, 1],
      [1, -1, -1],
      [-1, 1, -1],
      [-1, -1, 1]
    ];
  else if (sides === 6)
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) vertices.push([x, y, z]);
  else if (sides === 8)
    vertices = [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1]
    ];
  else if (sides === 20 || sides === 12 || sides === 30) {
    for (const a of [-1, 1]) for (const b of [-phi, phi]) vertices.push([0, a, b], [a, b, 0], [b, 0, a]);
  } else if ([3, 5, 7].includes(sides)) {
    // Twice as many barrel facets: opposite faces are parallel and values repeat.
    for (const z of [-0.8, 0.8])
      for (let i = 0; i < sides * 2; i++)
        vertices.push([Math.cos((i * Math.PI) / sides), Math.sin((i * Math.PI) / sides), z]);
  } else if (sides === 24 || sides === 16) {
    for (let i = 0; i < sides / 2; i++)
      vertices.push([Math.cos((i * Math.PI * 4) / sides), Math.sin((i * Math.PI * 4) / sides), 0]);
    vertices.push([0, 0, 1.25], [0, 0, -1.25]);
  } else {
    // The dual of an antiprism gives a trapezohedron with kite-shaped faces.
    const n = sides / 2;
    for (let layer = 0; layer < 2; layer++)
      for (let i = 0; i < n; i++) {
        const angle = ((i * 2 + layer) * Math.PI) / n;
        vertices.push([Math.cos(angle), Math.sin(angle), (layer ? 1 : -1) * 0.45]);
      }
  }
  result = normalized(convexDiceGeometry(vertices));
  if (sides === 12) result = dual(result);
  else if (sides === 30) {
    const edges = new Map<string, DiceVector>();
    for (const face of result.faces)
      for (let i = 0; i < face.length; i++) {
        const a = face[i],
          b = face[(i + 1) % face.length];
        edges.set([a, b].sort((x, y) => x - y).join(","), vScale(vAdd(result.vertices[a], result.vertices[b]), 0.5));
      }
    result = dual(convexDiceGeometry([...edges.values()]));
  } else if ([10, 14].includes(sides)) result = dual(result);
  cache.set(sides, result);
  return result;
}
/** Returns geometric face indices in stable outcome order; d4 reads its upper tip. */
export function diceResultFaces(sides: DiceShape, geometry = diceGeometry(sides)) {
  return geometry.faces.flatMap((face, i) => ([3, 5, 7].includes(sides) && face.length !== 4 ? [] : [i]));
}

/** Validate authored meshes as a closed convex solid, with outward wound faces. */
export function invalidDiceGeometry(geometry: DiceGeometry): string | undefined {
  const { vertices, faces } = geometry;
  if (vertices.length < 4 || vertices.length > 64 || faces.length < 4 || faces.length > 64)
    return "Dice geometry needs 4–64 vertices and faces.";
  if (vertices.some((v) => v.length !== 3 || v.some((n) => !Number.isFinite(n) || Math.abs(n) > 10)))
    return "Dice vertices must be finite coordinates between -10 and 10.";
  if (new Set(vertices.map((v) => v.join(","))).size !== vertices.length) return "Dice vertices must be distinct.";
  const edges = new Map<string, number>();
  const used = new Set<number>();
  for (const face of faces) {
    if (
      face.length < 3 ||
      face.length > 32 ||
      new Set(face).size !== face.length ||
      face.some((i) => !Number.isInteger(i) || i < 0 || i >= vertices.length)
    )
      return "Invalid dice face indices.";
    const cross = vCross(vSub(vertices[face[1]], vertices[face[0]]), vSub(vertices[face[2]], vertices[face[0]]));
    if (Math.hypot(...cross) < 1e-6) return "A dice face is degenerate.";
    const normal = vUnit(cross),
      origin = vertices[face[0]];
    if (face.some((i) => Math.abs(vDot(normal, vSub(vertices[i], origin))) > 1e-5)) return "Dice faces must be planar.";
    if (vertices.some((v) => vDot(normal, vSub(v, origin)) > 1e-5))
      return "Dice faces must point outward around a convex solid.";
    if (!vertices.some((v) => vDot(normal, vSub(v, origin)) < -1e-5)) return "Dice geometry must enclose a volume.";
    for (let i = 0; i < face.length; i++) {
      const a = face[i],
        b = face[(i + 1) % face.length],
        c = face[(i + 2) % face.length];
      if (vDot(vCross(vSub(vertices[b], vertices[a]), vSub(vertices[c], vertices[b])), normal) <= 1e-7)
        return "Dice faces must be convex polygons in winding order.";
      used.add(a);
      const key = `${a},${b}`;
      if (edges.has(key)) return "Dice geometry has duplicate directed edges.";
      edges.set(key, 1);
    }
  }
  if (
    used.size !== vertices.length ||
    [...edges.keys()].some((key) => !edges.has(key.split(",").reverse().join(","))) ||
    vertices.length - edges.size / 2 + faces.length !== 2
  )
    return "Dice geometry must be a closed connected solid.";
}
