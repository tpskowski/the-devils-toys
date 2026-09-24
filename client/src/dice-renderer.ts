import * as THREE from "three";
import {
  diceGeometry,
  diceResultFaces,
  faceCenter,
  faceNormal,
  vUnit,
  type DiceAppearance,
  type DiceGeometry,
  type DicePresentation,
  type DiceVector,
  type PresentedDie
} from "@devils-toys/shared";

const vector = (v: DiceVector) => new THREE.Vector3(...v);
function geometryFor(die: PresentedDie): DiceGeometry {
  const source = die.custom?.geometry ?? diceGeometry(die.shape);
  const center = source.vertices
    .reduce((sum, p) => sum.add(vector(p)), new THREE.Vector3())
    .multiplyScalar(1 / source.vertices.length);
  const radius = Math.max(...source.vertices.map((p) => vector(p).distanceTo(center)));
  return {
    faces: source.faces,
    vertices: source.vertices.map(
      (p) =>
        vector(p)
          .sub(center)
          .multiplyScalar(1 / radius)
          .toArray() as DiceVector
    )
  };
}
export function landingQuaternion(die: PresentedDie, geometry = geometryFor(die)) {
  const tip = die.shape === 4 && !die.custom?.geometry;
  const resultFaces = die.custom?.resultFaces ?? diceResultFaces(die.shape, geometry);
  const normal = vector(
    tip ? vUnit(geometry.vertices[die.face]) : faceNormal(geometry, geometry.faces[resultFaces[die.face]])
  );
  const orientation = new THREE.Quaternion().setFromUnitVectors(normal, new THREE.Vector3(0, 0, 1));
  if (!tip) {
    const face = geometry.faces[resultFaces[die.face]];
    const edge = vector(geometry.vertices[face[1]])
      .sub(vector(geometry.vertices[face[0]]))
      .normalize()
      .applyQuaternion(orientation);
    orientation.premultiply(
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.atan2(edge.y, edge.x))
    );
  }
  return orientation;
}

function labelTexture(value: number, ink: string, tens: boolean) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d")!;
  context.fillStyle = ink;
  context.textAlign = "center";
  context.textBaseline = "middle";
  const label = tens ? String(value).padStart(2, "0") : String(value);
  context.font = `600 ${label.length > 2 ? 94 : label.length > 1 ? 126 : 162}px Inter, sans-serif`;
  context.fillText(label, 128, 132);
  if (value === 6 || value === 9) {
    context.fillRect(98, 211, 60, 7);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}
interface DieObject {
  object: THREE.Group;
  shadow: THREE.Mesh;
  geometry: DiceGeometry;
  end: THREE.Quaternion;
  axis: THREE.Vector3;
  spin: number;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  size: number;
  kept: boolean;
}
function buildDie(die: PresentedDie, appearance: DiceAppearance): THREE.Group {
  const geometry = geometryFor(die),
    group = new THREE.Group();
  const positions: number[] = [];
  for (const face of geometry.faces)
    for (let i = 1; i < face.length - 1; i++)
      for (const index of [face[0], face[i], face[i + 1]]) positions.push(...geometry.vertices[index]);
  const solid = new THREE.BufferGeometry();
  solid.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  solid.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({
    color: appearance.body,
    roughness: appearance.finish === "matte" ? 0.82 : appearance.finish === "gloss" ? 0.22 : 0.48,
    metalness: 0.08,
    flatShading: true
  });
  group.add(new THREE.Mesh(solid, material));
  const edgeMaterial = new THREE.LineBasicMaterial({ color: appearance.accent, transparent: true, opacity: 0.48 });
  group.add(new THREE.LineSegments(new THREE.EdgesGeometry(solid, 8), edgeMaterial));
  const results = die.custom?.resultFaces ?? diceResultFaces(die.shape, geometry);
  const values = die.labels ?? Array.from({ length: die.shape }, (_, i) => i + 1);
  const labels = new Map<number, THREE.CanvasTexture>();
  const makeLabel = (face: number[], position: THREE.Vector3, value: number, size: number) => {
    let texture = labels.get(value);
    if (!texture) {
      texture = labelTexture(value, appearance.ink, die.role === "tens" && die.shape === 10);
      labels.set(value, texture);
    }
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2
      })
    );
    const normal = vector(faceNormal(geometry, face));
    const right = vector(geometry.vertices[face[1]]).sub(vector(geometry.vertices[face[0]])).normalize();
    const up = new THREE.Vector3().crossVectors(normal, right);
    plane.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, normal));
    plane.position.copy(position).addScaledVector(normal, 0.007);
    group.add(plane);
  };
  geometry.faces.forEach((face, faceIndex) => {
    const center = vector(faceCenter(geometry, face));
    if (die.shape === 4 && !die.custom?.geometry) {
      for (const index of face)
        makeLabel(face, vector(geometry.vertices[index]).lerp(center, 0.48), values[index], 0.48);
    } else {
      const outcome = results.indexOf(faceIndex);
      if (outcome < 0) return;
      const distances = face.map((id, i) => {
        const a = vector(geometry.vertices[id]),
          b = vector(geometry.vertices[face[(i + 1) % face.length]]);
        return new THREE.Vector3().crossVectors(center.clone().sub(a), b.clone().sub(a)).length() / a.distanceTo(b);
      });
      makeLabel(face, center, values[outcome % values.length], Math.min(...distances) * 1.72);
    }
  });
  return group;
}
function disposeObject(object: THREE.Object3D) {
  const textures = new Set<THREE.Texture>();
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    mesh.geometry?.dispose();
    if (mesh.material)
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        const map = (material as THREE.MeshBasicMaterial).map;
        if (map) textures.add(map);
        material.dispose();
      }
  });
  textures.forEach((texture) => texture.dispose());
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
function shadowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d")!,
    gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, "#0009");
  gradient.addColorStop(1, "#0000");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

/** One renderer per visible tray. No persistent animation loop or physics server. */
export class DiceRenderer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 5000);
  private frame = 0;
  private width = 1;
  private height = 1;
  private disposed = false;
  private cleanup?: () => void;
  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "low-power" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.setClearColor(0, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.setAttribute("aria-hidden", "true");
    host.appendChild(this.renderer.domElement);
    this.camera.position.set(0, -280, 1500);
    this.camera.lookAt(0, 0, 0);
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.3));
    const light = new THREE.DirectionalLight(0xffffff, 2);
    light.position.set(-300, 400, 650);
    this.scene.add(light);
    const fill = new THREE.DirectionalLight(0xb3caff, 0.7);
    fill.position.set(300, -100, 400);
    this.scene.add(fill);
    this.resize(host.clientWidth, host.clientHeight);
  }
  resize(width: number, height: number) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.renderer.setSize(this.width, this.height);
    this.camera.left = -this.width / 2;
    this.camera.right = this.width / 2;
    this.camera.top = this.height / 2;
    this.camera.bottom = -this.height / 2;
    this.camera.updateProjectionMatrix();
  }
  play(presentation: DicePresentation, onDone: () => void, staticOnly = false, hold = false) {
    this.clear();
    const random = seeded(presentation.seed),
      dice = presentation.dice;
    const columns = Math.ceil(Math.sqrt((dice.length * this.width) / Math.max(this.height, 1)));
    const rows = Math.ceil(dice.length / columns);
    const size = Math.max(5, Math.min(44, (this.width - 24) / (columns * 2.7), (this.height - 40) / (rows * 2.7)));
    const objects: DieObject[] = dice.map((die, i) => {
      const object = buildDie(die, presentation.appearance),
        geometry = geometryFor(die);
      const shadow = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false })
      );
      this.scene.add(shadow, object);
      const row = Math.floor(i / columns),
        col = i % columns;
      const rowCount = Math.min(columns, dice.length - row * columns);
      return {
        object,
        shadow,
        geometry,
        end: landingQuaternion(die, geometry),
        axis: new THREE.Vector3(random() - 0.5, random() - 0.5, random() - 0.5).normalize(),
        spin: (4 + random() * 4) * Math.PI,
        startX: 0.05 + random() * 0.15,
        startY: 0.15 + random() * 0.7,
        endX: 0.5 + ((col - (rowCount - 1) / 2) * size * 2.6) / this.width,
        endY: 0.5 + ((row - (rows - 1) / 2) * size * 2.6) / this.height,
        size,
        kept: die.kept
      };
    });
    this.cleanup = () =>
      objects.forEach(({ object, shadow }) => {
        this.scene.remove(object, shadow);
        disposeObject(object);
        disposeObject(shadow);
      });
    const started = performance.now(),
      duration = staticOnly ? 0 : 1350;
    const update = (now: number) => {
      if (this.disposed) return;
      const elapsed = now - started,
        t = duration ? Math.min(1, elapsed / duration) : 1,
        eased = 1 - (1 - t) ** 3;
      const fade = hold ? 1 : Math.max(0, Math.min(1, (duration + 1650 - elapsed) / 350));
      this.host.style.opacity = String(fade);
      for (const die of objects) {
        const size = Math.min(die.size, Math.max(3, (this.width - 16) / 2.5), Math.max(3, (this.height - 16) / 2.5));
        die.object.scale.setScalar(size);
        const rotation = new THREE.Quaternion().setFromAxisAngle(die.axis, die.spin * (1 - eased));
        die.object.quaternion.copy(die.end).multiply(rotation);
        const safeX = Math.max(0, this.width / 2 - size * 1.4 - 8),
          safeY = Math.max(0, this.height / 2 - size * 1.8 - 8);
        const x = THREE.MathUtils.clamp(
          (die.startX + (die.endX - die.startX) * eased - 0.5) * this.width,
          -safeX,
          safeX
        );
        const y = THREE.MathUtils.clamp(
          (die.startY + (die.endY - die.startY) * eased - 0.5) * this.height +
            Math.sin(t * Math.PI * 2) * size * (1 - t),
          -safeY,
          safeY
        );
        const support =
          -Math.min(...die.geometry.vertices.map((v) => vector(v).applyQuaternion(die.object.quaternion).z)) * size;
        const bounce = Math.abs(Math.sin(t * Math.PI * 3)) * size * 2 * (1 - t);
        die.object.position.set(x, y, support + bounce + 1);
        die.shadow.position.set(x + size * 0.18, y - size * 0.18, 0);
        die.shadow.scale.setScalar(size * (2.5 + (bounce / size) * 0.25));
        (die.shadow.material as THREE.MeshBasicMaterial).opacity = 1 - bounce / (size * 4);
        die.object.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.material.transparent = true;
            child.material.opacity = t === 1 && !die.kept ? 0.38 : 1;
          }
        });
      }
      this.renderer.render(this.scene, this.camera);
      if (elapsed < duration + 1650) this.frame = requestAnimationFrame(update);
      else {
        if (!hold) this.clear();
        onDone();
      }
    };
    this.frame = requestAnimationFrame(update);
  }
  clear() {
    cancelAnimationFrame(this.frame);
    this.cleanup?.();
    this.cleanup = undefined;
    this.renderer.clear();
    this.host.style.opacity = "1";
  }
  dispose() {
    this.disposed = true;
    this.clear();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
