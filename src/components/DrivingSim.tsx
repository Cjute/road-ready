// @ts-nocheck -- strict index checks only; runtime-safe
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

/* ================== Vägen ================== */
const ROAD_LEN = 12000;
const RIGHT_LANE = 1.65;
const LEFT_LANE = -1.65;
const EYE_H = 1.15;
const DRIVER_SIDE = -0.35;
const CAR_LEN = 4.5;
const CAR_W = 1.8;

const MR = { x: 0.52, y: 0.035, w: 0.26, h: 0.1 }; // backspegel
const MS = { x: 0.015, y: 0.54, w: 0.13, h: 0.11 }; // vänster sidospegel

const rX = (s: number) => 60 * Math.sin(s / 400) + 25 * Math.sin(s / 170 + 1);
const rdX = (s: number) => 0.15 * Math.cos(s / 400) + (25 / 170) * Math.cos(s / 170 + 1);
const rddX = (s: number) => -(60 / 160000) * Math.sin(s / 400) - (25 / 28900) * Math.sin(s / 170 + 1);
const rY = (s: number) => 12 * Math.sin(s / 300) + 6 * Math.sin(s / 130 + 2);
const rdY = (s: number) => (12 / 300) * Math.cos(s / 300) + (6 / 130) * Math.cos(s / 130 + 2);
const rddY = (s: number) => -(12 / 90000) * Math.sin(s / 300) - (6 / 16900) * Math.sin(s / 130 + 2);
const kappa = (s: number) => rddX(s) / Math.pow(1 + rdX(s) ** 2, 1.5);
const forestAt = (s: number) => Math.sin(s / 650) + 0.6 * Math.sin(s / 233 + 3) > -0.1;

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];

const LIMITS = [
  { from: 0, kmh: 80 },
  { from: 3500, kmh: 70 },
  { from: 5500, kmh: 80 },
  { from: 8800, kmh: 70 },
  { from: 10300, kmh: 80 },
];
const limitAt = (s: number) => {
  let k = 80;
  for (const z of LIMITS) if (s >= z.from) k = z.kmh;
  return k;
};

function roadPoint(s: number, d: number, h: number, out = new THREE.Vector3()) {
  const dx = rdX(s);
  const n = Math.hypot(1, dx);
  return out.set(rX(s) + d / n, rY(s) + h, -s + (d * dx) / n);
}
const tangent = (s: number, out = new THREE.Vector3()) => out.set(rdX(s), rdY(s), -1).normalize();
const rightVec = (s: number, out = new THREE.Vector3()) => out.set(1, 0, rdX(s)).normalize();

const PROFILE: [number, number, string][] = [
  [-220, 7, "g"], [-14, 0.4, "g"], [-6.2, -0.7, "ditch"], [-4.8, -0.08, "g"],
  [-4.8, -0.08, "gravel"], [-3.5, -0.02, "gravel"], [-3.5, 0, "asphalt"], [3.5, 0, "asphalt"],
  [3.5, -0.02, "gravel"], [4.8, -0.08, "gravel"], [4.8, -0.08, "g"], [6.2, -0.7, "ditch"],
  [14, 0.4, "g"], [220, 7, "g"],
];

function groundH(d: number) {
  const a = Math.abs(d);
  const pts: [number, number][] = [[0, 0], [3.5, -0.02], [4.8, -0.08], [6.2, -0.7], [14, 0.4], [220, 7]];
  for (let i = 1; i < pts.length; i++) {
    if (a <= pts[i][0]) {
      const [d0, h0] = pts[i - 1];
      const [d1, h1] = pts[i];
      return h0 + ((h1 - h0) * (a - d0)) / (d1 - d0);
    }
  }
  return 7;
}

// 0 = mittlinje (3 m streck, 9 m mellanrum), 1 = varningslinje (9+3), 2 = spärrlinje (heldragen)
function computeLines(): Int8Array {
  const n = ROAD_LEN + 1;
  const raw = new Uint8Array(n);
  for (let s = 0; s < n; s++) if (rddY(s) < -0.0003 || Math.abs(kappa(s)) > 0.0009) raw[s] = 1;
  const t = new Int8Array(n);
  let last = -1e9;
  for (let s = 0; s < n; s++) { if (raw[s]) last = s; if (s - last <= 40) t[s] = 2; }
  last = 1e9;
  for (let s = n - 1; s >= 0; s--) { if (raw[s]) last = s; if (last - s <= 40) t[s] = 2; }
  last = -1e9;
  for (let s = 0; s < n; s++) { if (t[s] === 2) last = s; else if (s - last <= 150) t[s] = 1; }
  last = 1e9;
  for (let s = n - 1; s >= 0; s--) { if (t[s] === 2) last = s; else if (t[s] === 0 && last - s <= 150) t[s] = 1; }
  return t;
}

function buildRoad() {
  const step = 2;
  const n = Math.floor(ROAD_LEN / step) + 1;
  const m = PROFILE.length;
  const pos = new Float32Array(n * m * 3);
  const col = new Float32Array(n * m * 3);
  const p = new THREE.Vector3();
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const s = i * step;
    const forest = forestAt(s);
    for (let j = 0; j < m; j++) {
      const [d, h, kind] = PROFILE[j];
      roadPoint(s, d, h, p);
      const k = (i * m + j) * 3;
      pos[k] = p.x; pos[k + 1] = p.y; pos[k + 2] = p.z;
      if (kind === "asphalt") c.setHex(0x46484c).offsetHSL(0, 0, (Math.random() - 0.5) * 0.015);
      else if (kind === "gravel") c.setHex(0x8b8272);
      else if (kind === "ditch") c.setHex(0x465f2b);
      else if (Math.abs(d) > 100) c.setHex(forest ? 0x34502a : 0x8c9a4c);
      else c.setHex(0x5f7f35);
      if (kind !== "asphalt") c.offsetHSL(0, 0, (Math.random() - 0.5) * 0.04);
      col[k] = c.r; col[k + 1] = c.g; col[k + 2] = c.b;
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < m - 1; j++) {
      const a = i * m + j, b = a + 1, c2 = a + m, d2 = c2 + 1;
      idx.push(a, b, c2, b, d2, c2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
}

function buildMarkings(lines: Int8Array) {
  const arr: number[] = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), e = new THREE.Vector3();
  const stripe = (s0: number, s1: number, d: number, w: number) => {
    for (let s = s0; s < s1 - 1e-6; s += 1) {
      const s2 = Math.min(s1, s + 1);
      roadPoint(s, d - w / 2, 0.02, a); roadPoint(s, d + w / 2, 0.02, b);
      roadPoint(s2, d - w / 2, 0.02, c); roadPoint(s2, d + w / 2, 0.02, e);
      arr.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, b.x, b.y, b.z, e.x, e.y, e.z, c.x, c.y, c.z);
    }
  };
  let s = 0;
  while (s < ROAD_LEN - 12) {
    const t = lines[Math.floor(s)];
    if (t === 2) { stripe(s, s + 1, 0, 0.12); s += 1; }
    else if (t === 1) { stripe(s, s + 9, 0, 0.12); s += 12; }
    else { stripe(s, s + 3, 0, 0.12); s += 12; }
  }
  for (let k = 0; k < ROAD_LEN - 3; k += 3) { stripe(k, k + 1, 3.3, 0.1); stripe(k, k + 1, -3.3, 0.1); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3));
  geo.computeVertexNormals();
  return new THREE.Mesh(
    geo,
    new THREE.MeshLambertMaterial({ color: 0xe9e9e9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
  );
}

function buildScenery(scene: THREE.Scene) {
  // Granar
  const crowns: THREE.Matrix4[] = [];
  const trunks: THREE.Matrix4[] = [];
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
  for (let i = 0; i < 12000 && crowns.length < 3800; i++) {
    const s = Math.random() * ROAD_LEN;
    const forest = forestAt(s);
    if (!forest && Math.random() > 0.1) continue;
    const side = Math.random() < 0.5 ? -1 : 1;
    const d = side * (9 + Math.pow(Math.random(), 1.4) * (forest ? 120 : 200));
    const H = 6 + Math.random() * 12;
    const h = groundH(d);
    roadPoint(s, d, h + H * 0.575, p); sc.set(H * 0.22, H * 0.85, H * 0.22);
    crowns.push(new THREE.Matrix4().compose(p.clone(), q, sc.clone()));
    roadPoint(s, d, h + H * 0.125, p); sc.set(0.22, H * 0.25, 0.22);
    trunks.push(new THREE.Matrix4().compose(p.clone(), q, sc.clone()));
  }
  const crownMesh = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 7), new THREE.MeshLambertMaterial({ color: 0xffffff }), crowns.length);
  const trunkMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 5), new THREE.MeshLambertMaterial({ color: 0x4a3a2a }), trunks.length);
  const col = new THREE.Color();
  crowns.forEach((m, i) => {
    crownMesh.setMatrixAt(i, m);
    crownMesh.setColorAt(i, col.setHSL(0.3 + Math.random() * 0.05, 0.4, 0.13 + Math.random() * 0.06));
  });
  trunks.forEach((m, i) => trunkMesh.setMatrixAt(i, m));
  scene.add(crownMesh, trunkMesh);

  // Kantstolpar
  const posts: THREE.Matrix4[] = [];
  for (let s = 20; s < ROAD_LEN; s += 50) {
    for (const side of [-1, 1]) {
      roadPoint(s, side * 5.0, groundH(5.0) + 0.5, p);
      posts.push(new THREE.Matrix4().compose(p.clone(), q, new THREE.Vector3(0.1, 1, 0.1)));
    }
  }
  const postMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xf2f2f2 }), posts.length);
  posts.forEach((m, i) => postMesh.setMatrixAt(i, m));
  scene.add(postMesh);

  // Röda stugor
  const wall = new THREE.MeshLambertMaterial({ color: 0x8c1c13 });
  const roof = new THREE.MeshLambertMaterial({ color: 0x2b2b2b });
  const white = new THREE.MeshLambertMaterial({ color: 0xf4f4f4 });
  const roofShape = new THREE.Shape();
  roofShape.moveTo(-4.9, 0); roofShape.lineTo(4.9, 0); roofShape.lineTo(0, 2.6); roofShape.closePath();
  const roofGeo = new THREE.ExtrudeGeometry(roofShape, { depth: 6.6, bevelEnabled: false });
  roofGeo.translate(0, 0, -3.3);
  let houses = 0;
  for (let i = 0; i < 400 && houses < 30; i++) {
    const s = Math.random() * ROAD_LEN;
    if (forestAt(s)) continue;
    const d = (Math.random() < 0.5 ? -1 : 1) * rand(30, 110);
    const h = groundH(d);
    const g = new THREE.Group();
    const w = new THREE.Mesh(new THREE.BoxGeometry(9, 3.2, 6), wall); w.position.y = 1.6; g.add(w);
    const r = new THREE.Mesh(roofGeo, roof); r.position.y = 3.2; g.add(r);
    for (const x of [-4.52, 4.52]) { const c = new THREE.Mesh(new THREE.BoxGeometry(0.2, 3.2, 6.05), white); c.position.set(x, 1.6, 0); g.add(c); }
    for (const x of [-2.5, 0, 2.5]) { const win = new THREE.Mesh(new THREE.BoxGeometry(1, 1.1, 6.1), white); win.position.set(x, 1.8, 0); g.add(win); }
    roadPoint(s, d, h, p);
    g.position.copy(p);
    g.rotation.y = Math.random() * Math.PI;
    scene.add(g);
    houses++;
  }

  // Hastighetsskyltar (svensk C31 med gul bakgrund)
  for (const z of LIMITS) addSpeedSign(scene, Math.max(30, z.from), z.kmh);
}

function signTexture(n: number) {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  g.beginPath(); g.arc(128, 128, 124, 0, Math.PI * 2); g.fillStyle = "#d21f1f"; g.fill();
  g.beginPath(); g.arc(128, 128, 94, 0, Math.PI * 2); g.fillStyle = "#f6cf1a"; g.fill();
  g.fillStyle = "#111"; g.font = "bold 104px Arial"; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(String(n), 128, 136);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function addSpeedSign(scene: THREE.Scene, s: number, kmh: number) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.3, 8), new THREE.MeshLambertMaterial({ color: 0x9aa0a6 }));
  pole.position.y = 1.15; g.add(pole);
  const face = new THREE.Mesh(new THREE.CircleGeometry(0.42, 40), new THREE.MeshLambertMaterial({ map: signTexture(kmh) }));
  face.position.set(0, 2.15, 0.05); g.add(face);
  const back = new THREE.Mesh(new THREE.CircleGeometry(0.42, 40), new THREE.MeshLambertMaterial({ color: 0x8a8f94 }));
  back.position.set(0, 2.15, 0.03); back.rotation.y = Math.PI; g.add(back);
  const p = roadPoint(s, 5.4, groundH(5.4));
  g.position.copy(p);
  const target = roadPoint(s - 20, 5.4, 0);
  target.y = p.y;
  g.lookAt(target);
  scene.add(g);
}

/* ================== Fordon ================== */
type Kind = "car" | "truck" | "tractor";
type Model = { obj: THREE.Group; lights: THREE.Mesh[]; len: number; w: number };
interface Veh {
  id: number; type: Kind; dir: 1 | -1; s: number; d: number; dTarget: number; v: number; vWant: number;
  len: number; w: number; obj: THREE.Group; lights: THREE.Mesh[]; hinted: boolean; flashed: boolean;
}

const WHEEL_GEO = new THREE.CylinderGeometry(1, 1, 1, 18);
WHEEL_GEO.rotateZ(Math.PI / 2);
const WHEEL_MAT = new THREE.MeshLambertMaterial({ color: 0x151515 });
const CAR_COLORS = [0xe8e8e8, 0x1c1c1c, 0x6b6f75, 0xb0b4b8, 0x1f3a5f, 0x8e1b1b, 0x2d4a3e];
const CAB_COLORS = [0x1d4fa0, 0xe6e6e6, 0xa31d1d, 0x2b2b2b];

const bx = (w: number, h: number, l: number, m: THREE.Material, x: number, y: number, z: number) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), m);
  mesh.position.set(x, y, z);
  return mesh;
};
const wheel = (r: number, w: number, x: number, y: number, z: number) => {
  const m = new THREE.Mesh(WHEEL_GEO, WHEEL_MAT);
  m.scale.set(w, r, r);
  m.position.set(x, y, z);
  return m;
};

function makeCar(color: number): Model {
  const g = new THREE.Group();
  const body = new THREE.MeshLambertMaterial({ color });
  const glass = new THREE.MeshLambertMaterial({ color: 0x1b2530 });
  g.add(bx(1.8, 0.62, 4.4, body, 0, 0.6, 0));
  g.add(bx(1.62, 0.5, 2.2, glass, 0, 1.15, -0.25));
  g.add(bx(1.64, 0.07, 1.9, body, 0, 1.42, -0.3));
  for (const x of [-0.86, 0.86]) for (const z of [-1.35, 1.35]) g.add(wheel(0.33, 0.24, x, 0.33, z));
  const hl = new THREE.MeshBasicMaterial({ color: 0xfff4d6 });
  const tl = new THREE.MeshBasicMaterial({ color: 0xa01018 });
  const l1 = bx(0.34, 0.14, 0.05, hl, -0.58, 0.68, 2.21);
  const l2 = bx(0.34, 0.14, 0.05, hl, 0.58, 0.68, 2.21);
  g.add(l1, l2, bx(0.36, 0.14, 0.05, tl, -0.6, 0.72, -2.21), bx(0.36, 0.14, 0.05, tl, 0.6, 0.72, -2.21));
  return { obj: g, lights: [l1, l2], len: 4.4, w: 1.8 };
}

function makeTruck(color: number): Model {
  const g = new THREE.Group();
  const glass = new THREE.MeshLambertMaterial({ color: 0x1b2530 });
  g.add(bx(2.5, 2.8, 2.2, new THREE.MeshLambertMaterial({ color }), 0, 1.9, 5.3));
  g.add(bx(2.3, 1.0, 0.05, glass, 0, 2.6, 6.42));
  g.add(bx(2.55, 3.1, 10.4, new THREE.MeshLambertMaterial({ color: 0xdedede }), 0, 2.15, -1.1));
  g.add(bx(2.2, 0.4, 13, new THREE.MeshLambertMaterial({ color: 0x222222 }), 0, 0.75, -0.2));
  for (const x of [-1.1, 1.1]) for (const z of [5.2, 2.6, -3.6, -4.8, -6.0]) g.add(wheel(0.5, 0.32, x, 0.5, z));
  const hl = new THREE.MeshBasicMaterial({ color: 0xfff4d6 });
  const tl = new THREE.MeshBasicMaterial({ color: 0xa01018 });
  const l1 = bx(0.35, 0.2, 0.05, hl, -0.95, 1.0, 6.43);
  const l2 = bx(0.35, 0.2, 0.05, hl, 0.95, 1.0, 6.43);
  g.add(l1, l2, bx(0.3, 0.2, 0.05, tl, -1.0, 1.0, -6.33), bx(0.3, 0.2, 0.05, tl, 1.0, 1.0, -6.33));
  return { obj: g, lights: [l1, l2], len: 13, w: 2.55 };
}

function makeTractor(): Model {
  const g = new THREE.Group();
  const green = new THREE.MeshLambertMaterial({ color: 0x2f7d32 });
  const glass = new THREE.MeshLambertMaterial({ color: 0x24303c });
  g.add(bx(1.2, 0.9, 2.0, green, 0, 1.05, 0.7));
  g.add(bx(1.5, 1.5, 1.4, glass, 0, 2.25, -0.45));
  g.add(bx(1.6, 0.08, 1.5, green, 0, 3.03, -0.45));
  for (const x of [-0.98, 0.98]) g.add(wheel(0.82, 0.48, x, 0.82, -0.5));
  for (const x of [-0.78, 0.78]) g.add(wheel(0.48, 0.3, x, 0.48, 1.35));
  const tri = (size: number) => {
    const sh = new THREE.Shape();
    const h = (size * Math.sqrt(3)) / 2;
    sh.moveTo(-size / 2, -h / 3); sh.lineTo(size / 2, -h / 3); sh.lineTo(0, (2 * h) / 3); sh.closePath();
    return new THREE.ShapeGeometry(sh);
  };
  const lgf = new THREE.Group();
  lgf.add(new THREE.Mesh(tri(0.72), new THREE.MeshBasicMaterial({ color: 0xc81e1e, side: THREE.DoubleSide })));
  const orange = new THREE.Mesh(tri(0.54), new THREE.MeshBasicMaterial({ color: 0xff7a00, side: THREE.DoubleSide }));
  orange.position.z = 0.01;
  lgf.add(orange);
  lgf.position.set(0, 1.75, -1.25);
  lgf.rotation.y = Math.PI;
  g.add(lgf);
  const hl = new THREE.MeshBasicMaterial({ color: 0xfff4d6 });
  const l1 = bx(0.2, 0.15, 0.05, hl, -0.4, 1.3, 1.72);
  const l2 = bx(0.2, 0.15, 0.05, hl, 0.4, 1.3, 1.72);
  g.add(l1, l2);
  return { obj: g, lights: [l1, l2], len: 3.8, w: 2.4 };
}

function buildHood() {
  const geo = new THREE.BufferGeometry();
  const v = [
    -0.55, -0.52, -1.35, 1.25, -0.52, -1.35, -0.55, -0.66, -3.05, 1.25, -0.66, -3.05,
    -0.55, -0.82, -3.12, 1.25, -0.82, -3.12,
  ];
  geo.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
  geo.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4]);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshPhongMaterial({ color: 0x1f3b6e, shininess: 80, specular: 0x555555, side: THREE.DoubleSide }));
}

/* ================== Sidan ================== */
type MsgKind = "info" | "good" | "bad";
type Phase = "start" | "running" | "crashed" | "finished";

const rectStyle = (r: typeof MR, shadow: string) => ({
  left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%`, boxShadow: shadow,
});

export default function Index() {
  const mountRef = useRef<HTMLDivElement>(null);
  const needleRef = useRef<SVGGElement>(null);
  const wheelRef = useRef<SVGGElement>(null);
  const speedRef = useRef<SVGTextElement>(null);
  const limitRef = useRef<HTMLSpanElement>(null);
  const blinkLRef = useRef<SVGSVGElement>(null);
  const blinkRRef = useRef<SVGSVGElement>(null);
  const dashRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const keys = useRef({ up: false, down: false, left: false, right: false, head: false });
  const api = useRef<{ start: () => void; blink: (d: "left" | "right") => void } | null>(null);
  const settings = useRef({ voice: true, assist: true });

  const [phase, setPhase] = useState<Phase>("start");
  const [msg, setMsg] = useState<{ text: string; kind: MsgKind; id: number } | null>(null);
  const [summary, setSummary] = useState<{ reason: string; faults: string[]; overtakes: number; km: number } | null>(null);
  const [voice, setVoice] = useState(true);
  const [assist, setAssist] = useState(true);
  const [touch, setTouch] = useState(false);

  useEffect(() => { settings.current.voice = voice; }, [voice]);
  useEffect(() => { settings.current.assist = assist; }, [assist]);
  useEffect(() => { setTouch(window.matchMedia("(pointer: coarse)").matches); }, []);
  useEffect(() => {
    if (!msg) return;
    const id = msg.id;
    const t = setTimeout(() => setMsg((m) => (m && m.id === id ? null : m)), 4500);
    return () => clearTimeout(t);
  }, [msg]);

  useEffect(() => {
    const mount = mountRef.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.domElement.style.display = "block";
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const sky = new THREE.Color(0xc9dbe8);
    scene.background = sky;
    scene.fog = new THREE.Fog(sky, 60, 950);
    scene.add(new THREE.HemisphereLight(0xe6f0ff, 0x4d5a33, 1.0));
    const sun = new THREE.DirectionalLight(0xfff1dc, 1.6);
    sun.position.set(300, 400, 200);
    scene.add(sun);

    const lines = computeLines();
    scene.add(buildRoad());
    scene.add(buildMarkings(lines));
    buildScenery(scene);

    // Kamera i förarsätet + speglar
    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 2000);
    const rig = new THREE.Object3D();
    scene.add(rig);
    rig.add(camera);
    rig.add(buildHood());
    const rearCam = new THREE.PerspectiveCamera(13, 3, 0.5, 1200);
    rearCam.position.set(0.35, 0.12, 0.4);
    rearCam.rotation.y = Math.PI;
    rig.add(rearCam);
    const sideCam = new THREE.PerspectiveCamera(26, 1.3, 0.5, 1200);
    sideCam.position.set(-0.62, -0.25, -0.75);
    sideCam.rotation.y = Math.PI - 0.22;
    rig.add(sideCam);

    const rtRear = new THREE.WebGLRenderTarget(512, 170);
    const rtSide = new THREE.WebGLRenderTarget(256, 200);
    for (const rt of [rtRear, rtSide]) { rt.texture.repeat.set(-1, 1); rt.texture.offset.set(1, 0); }
    const quadMat = new THREE.MeshBasicMaterial({ map: rtRear.texture, depthTest: false, depthWrite: false, toneMapped: false });
    const quadScene = new THREE.Scene();
    quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), quadMat));
    const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    quadCam.position.z = 0.5;

    let W = 1, H = 1;
    const resize = () => {
      W = mount.clientWidth; H = mount.clientHeight;
      renderer.setSize(W, H);
      camera.aspect = W / H; camera.updateProjectionMatrix();
      rearCam.aspect = (MR.w * W) / (MR.h * H); rearCam.updateProjectionMatrix();
      sideCam.aspect = (MS.w * W) / (MS.h * H); sideCam.updateProjectionMatrix();
      const pr = renderer.getPixelRatio();
      rtRear.setSize(Math.max(2, (MR.w * W * pr) | 0), Math.max(2, (MR.h * H * pr) | 0));
      rtSide.setSize(Math.max(2, (MS.w * W * pr) | 0), Math.max(2, (MS.h * H * pr) | 0));
    };
    const ro = new ResizeObserver(resize);
    ro.observe(mount);
    resize();

    // Spelstatus
    let vehicles: Veh[] = [];
    let nextId = 1;
    const P = { s: 150, d: RIGHT_LANE, v: 70 / 3.6, psi: 0, u: 0, gas: 0, brake: 0, acc: 0 };
    const G = {
      t: 0, running: false, blinker: null as null | "left" | "right", blinkSince: 0, blinkWarned: false,
      pendingCancel: false, out: false, targets: [] as number[], fault: false, noNeedT: 0, keepWarned: false,
      lastHead: -99, head: 0, closeT: 0, overT: 0, edgeT: 0, overtakes: 0, faults: [] as string[],
      oncomingT: 6, followerT: 20, slowT: 0, lastLimit: 80, said: new Map<string, number>(), lastPhase: 0,
    };

    // Ljud
    let actx: AudioContext | null = null;
    let osc: OscillatorNode | null = null;
    let eng: GainNode | null = null;
    const initAudio = () => {
      try {
        if (!actx) {
          actx = new AudioContext();
          osc = actx.createOscillator(); osc.type = "sawtooth";
          const f = actx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 420;
          eng = actx.createGain(); eng.gain.value = 0.03;
          osc.connect(f); f.connect(eng); eng.connect(actx.destination); osc.start();
        }
        actx.resume();
      } catch { /* inget ljud */ }
    };
    const tick = (hi: boolean) => {
      if (!actx) return;
      const t = actx.currentTime;
      const o = actx.createOscillator(); const g = actx.createGain();
      o.type = "square"; o.frequency.value = hi ? 1400 : 1000;
      g.gain.setValueAtTime(0.03, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
      o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t + 0.05);
    };
    const speak = (text: string) => {
      if (!settings.current.voice || !("speechSynthesis" in window)) return;
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "sv-SE"; u.rate = 1.05;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    };
    const say = (text: string, kind: MsgKind, cooldown = 8) => {
      const last = G.said.get(text) ?? -1e9;
      if (G.t - last < cooldown) return;
      G.said.set(text, G.t);
      if (kind === "bad") G.faults.push(text);
      setMsg({ text, kind, id: Math.random() });
      speak(text);
    };

    const spawn = (type: Kind, dir: 1 | -1, s: number, vWant: number) => {
      const m = type === "car" ? makeCar(pick(CAR_COLORS)) : type === "truck" ? makeTruck(pick(CAB_COLORS)) : makeTractor();
      scene.add(m.obj);
      const d = dir === 1 ? RIGHT_LANE : LEFT_LANE;
      const veh: Veh = { id: nextId++, type, dir, s, d, dTarget: d, v: vWant, vWant, len: m.len, w: m.w, obj: m.obj, lights: m.lights, hinted: false, flashed: false };
      vehicles.push(veh);
      return veh;
    };
    const removeVeh = (v: Veh) => {
      scene.remove(v.obj);
      v.obj.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          if (mesh.geometry !== WHEEL_GEO) mesh.geometry.dispose();
          const mat = mesh.material as THREE.Material;
          if (mat !== WHEEL_MAT) mat.dispose();
        }
      });
    };

    const reset = () => {
      vehicles.forEach(removeVeh);
      vehicles = [];
      Object.assign(P, { s: 150, d: RIGHT_LANE, v: 70 / 3.6, psi: 0, u: 0, gas: 0, brake: 0, acc: 0 });
      Object.assign(G, {
        t: 0, blinker: null, blinkSince: 0, blinkWarned: false, pendingCancel: false, out: false, targets: [],
        fault: false, noNeedT: 0, keepWarned: false, lastHead: -99, head: 0, closeT: 0, overT: 0, edgeT: 0,
        overtakes: 0, faults: [], oncomingT: 6, followerT: 20, slowT: 0, lastLimit: 80, said: new Map(), lastPhase: 0,
      });
      spawn("car", 1, 95, 100 / 3.6);
      spawn("truck", 1, 410, 68 / 3.6);
    };

    const end = (reason: string, crashed: boolean) => {
      G.running = false;
      setSummary({ reason, faults: [...G.faults], overtakes: G.overtakes, km: Math.max(0, (P.s - 150) / 1000) });
      setPhase(crashed ? "crashed" : "finished");
      speak(reason);
    };

    const start = () => {
      reset();
      G.running = true;
      setSummary(null);
      setPhase("running");
      initAudio();
      say("Vi kör ut på landsvägen. Här gäller 80 kilometer i timmen. Håll till höger.", "info", 0);
    };

    const blink = (dir: "left" | "right") => {
      if (!G.running) return;
      G.blinker = G.blinker === dir ? null : dir;
      G.blinkSince = G.t; G.blinkWarned = false; G.pendingCancel = false;
      tick(true);
    };
    api.current = { start, blink };

    const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpT = new THREE.Vector3();
    const tmpR = new THREE.Vector3(), F = new THREE.Vector3(), eye = new THREE.Vector3();

    const findVeh = (id: number) => vehicles.find((x) => x.id === id);

    const update = (dt: number) => {
      const k = keys.current;
      G.t += dt;

      // Pedaler
      P.gas = k.up ? Math.min(1, P.gas + dt * 0.9) : Math.max(0, P.gas - dt * 2.5);
      P.brake = k.down ? Math.min(1, P.brake + dt * 2.2) : Math.max(0, P.brake - dt * 4);
      const dX = rdX(P.s), dY = rdY(P.s);
      const norm = Math.sqrt(1 + dX * dX + dY * dY);
      const slope = dY / norm;
      const acc = P.gas * 2.8 * Math.max(0, 1 - P.v / 52) - P.brake * 8 - (P.v > 0.1 ? 0.2 + 0.00035 * P.v * P.v : 0) - 9.81 * slope * 0.9;
      P.v = Math.max(0, P.v + acc * dt);
      P.acc += (acc - P.acc) * Math.min(1, dt * 3);

      // Ratt
      const target = (k.left ? -1 : 0) + (k.right ? 1 : 0);
      if (target !== 0) P.u += Math.sign(target - P.u) * Math.min(Math.abs(target - P.u), dt * 1.6);
      else P.u -= Math.sign(P.u) * Math.min(Math.abs(P.u), dt * 2.5);
      const maxYaw = Math.min(0.5, P.v * 0.06) / (1 + P.v / 12);
      const curve = kappa(P.s) * P.v * (settings.current.assist ? 0.25 : 1);
      P.psi = clamp(P.psi + (P.u * maxYaw - curve) * dt, -0.5, 0.5);
      P.d += P.v * Math.sin(P.psi) * dt;
      P.s += (P.v * Math.cos(P.psi) * dt) / norm;

      // Huvudvridning (döda vinkeln)
      G.head += ((k.head ? 1.25 : 0) - G.head) * Math.min(1, dt * 6);
      if (G.head > 1.0) G.lastHead = G.t;

      // Blinkers
      if (G.blinker) {
        const ph = Math.floor((G.t - G.blinkSince) / 0.38) % 2;
        if (ph !== G.lastPhase) { G.lastPhase = ph; tick(ph === 0); }
        if (!G.blinkWarned && G.t - G.blinkSince > 14) { G.blinkWarned = true; say("Glöm inte att slå av blinkersen.", "bad"); }
      }

      // Övrig trafik
      for (const v of vehicles) {
        if (v.dir === 1) {
          let gap = Infinity, leadV = v.vWant;
          for (const o of vehicles) {
            if (o !== v && o.dir === 1 && o.s > v.s) {
              const g = o.s - o.len / 2 - (v.s + v.len / 2);
              if (g < gap) { gap = g; leadV = o.v; }
            }
          }
          if (P.d > 0.4 && P.s > v.s) {
            const g = P.s - CAR_LEN / 2 - (v.s + v.len / 2);
            if (g < gap) { gap = g; leadV = P.v; }
          }
          let want = Math.min(v.vWant, limitAt(v.s) / 3.6);
          const safe = Math.max(8, v.v * 2.2);
          if (gap < safe) want = Math.min(want, leadV + (gap - safe) * 0.25);
          const a = want > v.v ? Math.min(1.2, want - v.v) : Math.max(-6, (want - v.v) * 1.5);
          v.v = Math.max(0, v.v + a * dt);
        } else {
          const ahead = v.s - P.s;
          const threat = P.d < 0.9 && ahead > -5 && ahead / (P.v + v.v + 0.1) < 6;
          if (threat) {
            v.v = Math.max(0, v.v - 5 * dt);
            v.dTarget = -2.7;
            if (!v.flashed) { v.flashed = true; say("Mötande fordon fick bromsa för dig. Kör bara om när vägen är fri.", "bad", 3); }
          } else {
            v.v += clamp(v.vWant - v.v, -6 * dt, 1.2 * dt);
            if (ahead < -5) v.dTarget = LEFT_LANE;
          }
          v.d += (v.dTarget - v.d) * Math.min(1, dt * 0.8);
          const on = v.flashed && threat && Math.floor(G.t * 5) % 2 === 0;
          v.lights.forEach((l) => l.scale.setScalar(on ? 2.5 : 1));
        }
        const dXv = rdX(v.s), dYv = rdY(v.s);
        v.s += (v.dir * v.v * dt) / Math.sqrt(1 + dXv * dXv + dYv * dYv);
      }

      // Nya fordon
      const aheadSlow = vehicles.some((v) => v.dir === 1 && v.s > P.s + 5 && v.s < P.s + 1500);
      if (!aheadSlow && P.s < ROAD_LEN - 1500) {
        G.slowT -= dt;
        if (G.slowT <= 0) {
          const r = Math.random();
          const type: Kind = r < 0.4 ? "truck" : r < 0.7 ? "tractor" : "car";
          const kmh = type === "truck" ? rand(64, 72) : type === "tractor" ? rand(28, 38) : rand(52, 62);
          spawn(type, 1, P.s + rand(450, 650), kmh / 3.6);
          G.slowT = rand(8, 20);
        }
      }
      G.oncomingT -= dt;
      if (G.oncomingT <= 0 && P.s < ROAD_LEN - 1000) {
        const n = Math.random() < 0.3 ? 2 + Math.floor(Math.random() * 2) : 1;
        let s = P.s + 950;
        const gv = (limitAt(s) / 3.6) * rand(0.9, 1.02);
        for (let i = 0; i < n; i++) { spawn(Math.random() < 0.15 ? "truck" : "car", -1, s, gv); s += rand(45, 80); }
        G.oncomingT = rand(7, 18);
      }
      if (!vehicles.some((v) => v.dir === 1 && v.s < P.s && v.s > P.s - 400)) {
        G.followerT -= dt;
        if (G.followerT <= 0) { spawn("car", 1, P.s - 380, 100 / 3.6); G.followerT = rand(25, 50); }
      }
      vehicles = vehicles.filter((v) => {
        const keep = v.dir === 1 ? v.s > P.s - 600 : v.s > P.s - 150;
        if (!keep) removeVeh(v);
        return keep;
      });

      // Trafikregler
      const lt = lines[clamp(Math.floor(P.s), 0, ROAD_LEN)];

      if (!G.out && P.d < 0.8) {
        G.out = true; G.fault = false; G.noNeedT = 0; G.keepWarned = false;
        if (G.blinker !== "left") { say("Du bytte körfält utan att blinka vänster.", "bad", 3); G.fault = true; }
        else if (G.t - G.blinkSince < 1.2) { say("Blinka i god tid innan du svänger ut.", "bad", 3); G.fault = true; }
        if (G.t - G.lastHead > 6) { say("Kontrollera speglarna och döda vinkeln innan du svänger ut.", "bad", 3); G.fault = true; }
        if (lt === 2) { say("Du korsade spärrlinjen. Heldragen linje får inte överskridas.", "bad", 3); G.fault = true; }
        else if (lt === 1) say("Varningslinje. Kör bara om när du ser att vägen är fri långt fram.", "info", 15);
        G.targets = vehicles.filter((v) => v.dir === 1 && v.s > P.s && v.s - P.s < 150).map((v) => v.id);
        G.pendingCancel = true;
      }

      if (G.out && P.d > 1.0) {
        G.out = false;
        if (G.blinker !== "right") { say("Blinka höger innan du kör in i ditt körfält igen.", "bad", 3); G.fault = true; }
        if (lt === 2) { say("Du korsade spärrlinjen när du körde in.", "bad", 3); G.fault = true; }
        let gapBehind = Infinity;
        let behindV: Veh | null = null;
        for (const v of vehicles) {
          if (v.dir === 1 && v.s < P.s) {
            const g = P.s - CAR_LEN / 2 - (v.s + v.len / 2);
            if (g < gapBehind) { gapBehind = g; behindV = v; }
          }
        }
        if (behindV && gapBehind > -3 && gapBehind < Math.max(12, behindV.v * 0.9)) {
          say("Du svängde in för tätt. Vänta tills du ser fordonet du kört om i backspegeln.", "bad", 3);
          G.fault = true;
        }
        const passed = G.targets.filter((id) => { const v = findVeh(id); return v && v.s < P.s; }).length;
        if (passed > 0) { G.overtakes += passed; if (!G.fault) say("Bra omkörning!", "good", 2); }
        else if (G.targets.length > 0) say("Du avbröt omkörningen. Bra att vänta om det inte känns säkert.", "info", 10);
        G.targets = [];
        G.pendingCancel = true;
      }

      if (G.out) {
        const stillNeeded = G.targets.some((id) => { const v = findVeh(id); return v && v.s > P.s - v.len / 2 - 15; });
        G.noNeedT = stillNeeded ? 0 : G.noNeedT + dt;
        if (G.noNeedT > 5 && !G.keepWarned) { G.keepWarned = true; say("Håll till höger. Kör tillbaka in i ditt körfält när du har kört om.", "bad"); }
      }

      if (G.pendingCancel && Math.abs(P.u) < 0.08 && Math.abs(P.psi) < 0.025) {
        const settled = G.out ? P.d < -0.6 : P.d > 1.2;
        if (settled) {
          if ((G.out && G.blinker === "left") || (!G.out && G.blinker === "right")) G.blinker = null;
          G.pendingCancel = false;
        }
      }

      const lim = limitAt(P.s);
      if (lim !== G.lastLimit) { G.lastLimit = lim; say(`Nu gäller ${lim} kilometer i timmen.`, "info", 0); }
      const kmh = P.v * 3.6;
      G.overT = kmh > lim + 3 ? G.overT + dt : G.overT < 0 ? Math.min(0, G.overT + dt) : 0;
      if (G.overT > 3) { say(`Du kör för fort. Här gäller ${lim} kilometer i timmen.`, "bad", 0); G.overT = -10; }

      if (!G.out) {
        let gap = Infinity;
        let lead: Veh | null = null;
        for (const v of vehicles) {
          if (v.dir === 1 && v.s > P.s) {
            const g = v.s - v.len / 2 - (P.s + CAR_LEN / 2);
            if (g < gap) { gap = g; lead = v; }
          }
        }
        if (lead) {
          if (!lead.hinted && gap < 200) {
            lead.hinted = true;
            say(
              lead.type === "tractor" ? "Traktor med LGF-skylt framför. Den kör långsamt, så planera omkörningen."
                : lead.type === "truck" ? "Lastbil framför. Håll avstånd så att du ser förbi den."
                : "Långsam bil framför. Håll avstånd.",
              "info", 0
            );
          }
          const tg = gap / Math.max(P.v, 1);
          G.closeT = P.v > 8 && tg < 2 ? G.closeT + dt : G.closeT < 0 ? Math.min(0, G.closeT + dt) : 0;
          if (G.closeT > 3) { say("För kort avstånd. Håll minst tre sekunder till fordonet framför.", "bad", 0); G.closeT = -10; }
          if (lt === 2 && gap < 90 && Math.abs(P.v - lead.v) < 3) say("Heldragen linje. Vänta med omkörningen tills linjen blir streckad.", "info", 40);
        }
      }

      if (P.d + CAR_W / 2 > 3.4) {
        G.edgeT += dt;
        if (G.edgeT > 1.5) say("Du är ute på kantlinjen. Håll dig i körfältet.", "info", 10);
      } else G.edgeT = 0;

      if (P.d > 4.4 || P.d < -4.4) { end("Du körde av vägen och ner i diket.", true); return; }
      for (const v of vehicles) {
        if (Math.abs(v.s - P.s) < (v.len + CAR_LEN) / 2 - 0.2 && Math.abs(v.d - P.d) < (v.w + CAR_W) / 2 - 0.1) {
          end(v.dir === -1 ? "Frontalkrock med mötande fordon." : v.s > P.s ? "Du körde in i fordonet framför." : "Fordonet bakom körde in i dig.", true);
          return;
        }
      }
      if (P.s > ROAD_LEN - 200) end("Körlektionen är slut. Bra jobbat!", false);
    };

    const place = () => {
      for (const v of vehicles) {
        roadPoint(v.s, v.d, 0, tmpA);
        tangent(v.s, tmpT);
        if (v.dir === -1) tmpT.negate();
        v.obj.position.copy(tmpA);
        v.obj.lookAt(tmpB.copy(tmpA).add(tmpT));
      }
      roadPoint(P.s, P.d + DRIVER_SIDE, EYE_H, eye);
      tangent(P.s, tmpT);
      rightVec(P.s, tmpR);
      F.copy(tmpT).multiplyScalar(Math.cos(P.psi)).addScaledVector(tmpR, Math.sin(P.psi));
      if (G.running && P.v > 1) eye.y += (Math.random() - 0.5) * 0.004 * Math.min(1, P.v / 20);
      rig.position.copy(eye);
      rig.lookAt(tmpB.copy(eye).sub(F));
      camera.rotation.set(clamp(P.acc * 0.006, -0.05, 0.03), G.head, 0, "YXZ");
    };

    const hud = () => {
      const kmh = P.v * 3.6;
      needleRef.current?.setAttribute("transform", `rotate(${-120 + (Math.min(160, kmh) / 160) * 240} 50 50)`);
      if (speedRef.current) speedRef.current.textContent = String(Math.round(kmh));
      wheelRef.current?.setAttribute("transform", `rotate(${P.u * 140} 50 50)`);
      if (limitRef.current) limitRef.current.textContent = String(limitAt(P.s));
      const on = !!G.blinker && Math.floor((G.t - G.blinkSince) / 0.38) % 2 === 0;
      if (blinkLRef.current) blinkLRef.current.style.opacity = G.blinker === "left" && on ? "1" : "0.15";
      if (blinkRRef.current) blinkRRef.current.style.opacity = G.blinker === "right" && on ? "1" : "0.15";
      const vis = String(clamp(1 - (G.head - 0.3) * 2, 0, 1));
      if (dashRef.current) dashRef.current.style.opacity = vis;
      if (frameRef.current) frameRef.current.style.opacity = vis;
      if (actx && osc && eng) {
        const band = 25;
        const frac = (kmh % band) / band;
        osc.frequency.setTargetAtTime(32 + frac * 38 + P.gas * 10 + Math.floor(kmh / band) * 2, actx.currentTime, 0.08);
        eng.gain.setTargetAtTime(G.running ? 0.022 + P.gas * 0.02 : 0, actx.currentTime, 0.2);
      }
    };

    const render = () => {
      const showM = G.head < 0.5;
      renderer.setScissorTest(false);
      if (showM) {
        renderer.setRenderTarget(rtRear); renderer.render(scene, rearCam);
        renderer.setRenderTarget(rtSide); renderer.render(scene, sideCam);
        renderer.setRenderTarget(null);
      }
      renderer.setViewport(0, 0, W, H);
      renderer.render(scene, camera);
      if (showM) {
        renderer.autoClear = false;
        renderer.setScissorTest(true);
        const list: [typeof MR, THREE.Texture][] = [[MR, rtRear.texture], [MS, rtSide.texture]];
        for (const [r, tex] of list) {
          const x = r.x * W, y = H - (r.y + r.h) * H, w = r.w * W, h = r.h * H;
          renderer.setViewport(x, y, w, h);
          renderer.setScissor(x, y, w, h);
          quadMat.map = tex;
          renderer.render(quadScene, quadCam);
        }
        renderer.setScissorTest(false);
        renderer.autoClear = true;
        renderer.setViewport(0, 0, W, H);
      }
    };

    // Tangentbord
    const map: Record<string, "up" | "down" | "left" | "right" | "head"> = {
      ArrowUp: "up", KeyW: "up", ArrowDown: "down", KeyS: "down",
      ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right", KeyM: "head",
    };
    const kd = (e: KeyboardEvent) => {
      if (map[e.code]) { e.preventDefault(); keys.current[map[e.code]] = true; }
      if (e.repeat) return;
      if (e.code === "KeyQ") blink("left");
      if (e.code === "KeyE") blink("right");
      if ((e.code === "Enter" || e.code === "Space") && !G.running) { e.preventDefault(); start(); }
    };
    const ku = (e: KeyboardEvent) => { if (map[e.code]) keys.current[map[e.code]] = false; };
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);

    reset();
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (G.running) update(dt);
      place();
      hud();
      render();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      actx?.close();
      rtRear.dispose(); rtSide.dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, []);

  const hold = (k: "up" | "down" | "left" | "right" | "head") => ({
    onPointerDown: (e: React.PointerEvent) => { e.preventDefault(); keys.current[k] = true; },
    onPointerUp: () => { keys.current[k] = false; },
    onPointerLeave: () => { keys.current[k] = false; },
    onPointerCancel: () => { keys.current[k] = false; },
  });

  const faultCounts = summary
    ? Object.entries(summary.faults.reduce<Record<string, number>>((acc, f) => { acc[f] = (acc[f] || 0) + 1; return acc; }, {}))
    : [];

  const ticks = Array.from({ length: 17 }, (_, i) => i * 10);

  return (
    <div className="fixed inset-0 bg-black overflow-hidden select-none text-white">
      <div ref={mountRef} className="absolute inset-0" />

      {/* Bilens ram, backspegel och sidospegel */}
      <div ref={frameRef} className="pointer-events-none absolute inset-0">
        <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
          <rect x="0" y="0" width="100" height="3" fill="#0b0c0e" />
          <polygon points="0,0 11,0 4.5,58 0,66" fill="#0b0c0e" />
          <polygon points="100,0 94,0 99,52 100,56" fill="#0b0c0e" />
        </svg>
        <div className="absolute" style={{ left: `${(MR.x + MR.w / 2) * 100}%`, top: 0, width: 8, marginLeft: -4, height: `${MR.y * 100}%`, background: "#111" }} />
        <div className="absolute rounded-md" style={rectStyle(MR, "0 0 0 5px #121212, 0 6px 14px rgba(0,0,0,.5)")} />
        <div className="absolute rounded-xl" style={rectStyle(MS, "0 0 0 6px #18191b, 0 6px 14px rgba(0,0,0,.5)")} />
      </div>

      {/* Instrumentbräda och ratt */}
      <div ref={dashRef} className="pointer-events-none absolute inset-x-0 bottom-0" style={{ height: "28%" }}>
        <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
          <path d="M0,22 Q50,0 100,22 L100,100 L0,100 Z" fill="#141518" />
          <path d="M0,22 Q50,0 100,22" stroke="#2a2c31" strokeWidth="1.2" fill="none" />
        </svg>

        <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-3" style={{ bottom: "4vh", height: "18vh" }}>
          <svg ref={blinkLRef} viewBox="0 0 20 20" style={{ width: "3.5vh", opacity: 0.15 }}>
            <polygon points="2,10 11,3 11,7 18,7 18,13 11,13 11,17" fill="#22c55e" />
          </svg>
          <svg viewBox="0 0 100 100" style={{ height: "18vh", width: "18vh" }}>
            <circle cx="50" cy="50" r="47" fill="#0a0b0d" stroke="#2d3036" strokeWidth="2" />
            {ticks.map((k) => {
              const a = ((-120 + (k / 160) * 240) * Math.PI) / 180;
              const major = k % 20 === 0;
              const r1 = major ? 37 : 40;
              return (
                <g key={k}>
                  <line x1={50 + r1 * Math.sin(a)} y1={50 - r1 * Math.cos(a)} x2={50 + 44 * Math.sin(a)} y2={50 - 44 * Math.cos(a)} stroke="#d9dde3" strokeWidth={major ? 1.6 : 0.8} />
                  {major && (
                    <text x={50 + 30 * Math.sin(a)} y={50 - 30 * Math.cos(a) + 2.5} fill="#d9dde3" fontSize="7" textAnchor="middle" fontFamily="system-ui">{k}</text>
                  )}
                </g>
              );
            })}
            <g ref={needleRef} transform="rotate(-120 50 50)">
              <line x1="50" y1="56" x2="50" y2="12" stroke="#ff4d2e" strokeWidth="2.2" strokeLinecap="round" />
            </g>
            <circle cx="50" cy="50" r="5" fill="#222" stroke="#444" />
            <text ref={speedRef} x="50" y="76" fill="#fff" fontSize="12" fontWeight="700" textAnchor="middle" fontFamily="system-ui">0</text>
            <text x="50" y="85" fill="#9aa1ab" fontSize="5.5" textAnchor="middle" fontFamily="system-ui">km/h</text>
          </svg>
          <div className="flex flex-col items-center gap-2">
            <div className="rounded-full flex items-center justify-center font-bold text-black" style={{ width: "5.5vh", height: "5.5vh", background: "#f6cf1a", border: "0.7vh solid #d21f1f", fontSize: "2vh" }}>
              <span ref={limitRef}>80</span>
            </div>
            <div className="text-[1.4vh] text-green-400">● Halvljus</div>
          </div>
          <svg ref={blinkRRef} viewBox="0 0 20 20" style={{ width: "3.5vh", opacity: 0.15 }}>
            <polygon points="18,10 9,3 9,7 2,7 2,13 9,13 9,17" fill="#22c55e" />
          </svg>
        </div>

        <div className="absolute left-1/2 -translate-x-1/2" style={{ width: "62vh", height: "62vh", bottom: "-31vh" }}>
          <svg viewBox="0 0 100 100" className="w-full h-full">
            <g ref={wheelRef}>
              <circle cx="50" cy="50" r="45" fill="none" stroke="#1b1c1f" strokeWidth="7" />
              <circle cx="50" cy="50" r="45" fill="none" stroke="#2c2e33" strokeWidth="1" />
              <rect x="10" y="47" width="28" height="6" rx="3" fill="#1b1c1f" />
              <rect x="62" y="47" width="28" height="6" rx="3" fill="#1b1c1f" />
              <circle cx="50" cy="50" r="11" fill="#222428" stroke="#33363c" />
              <rect x="44" y="48.5" width="12" height="3" rx="1.5" fill="#55585e" />
            </g>
          </svg>
        </div>
      </div>

      {/* Körläraren */}
      {msg && phase === "running" && (
        <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 max-w-[90%]" style={{ top: "17%" }}>
          <div
            className={`rounded-xl px-4 py-3 text-sm md:text-base shadow-xl backdrop-blur border-l-4 ${
              msg.kind === "bad" ? "bg-red-950/85 border-red-500" : msg.kind === "good" ? "bg-green-950/85 border-green-500" : "bg-slate-900/85 border-sky-400"
            }`}
          >
            <span className="font-semibold opacity-80">Körläraren: </span>
            {msg.text}
          </div>
        </div>
      )}

      {/* Pekskärmskontroller */}
      {touch && phase === "running" && (
        <>
          <div className="absolute left-3 bottom-3 flex gap-2">
            <button {...hold("left")} className="touch-none w-16 h-16 rounded-2xl bg-white/15 text-2xl">◀</button>
            <button {...hold("right")} className="touch-none w-16 h-16 rounded-2xl bg-white/15 text-2xl">▶</button>
          </div>
          <div className="absolute right-3 bottom-3 flex gap-2">
            <button {...hold("down")} className="touch-none w-16 h-16 rounded-2xl bg-red-600/50 font-semibold">Broms</button>
            <button {...hold("up")} className="touch-none w-16 h-20 rounded-2xl bg-green-600/50 font-semibold">Gas</button>
          </div>
          <div className="absolute right-3 flex flex-col gap-2" style={{ top: "20%" }}>
            <button onClick={() => api.current?.blink("left")} className="px-3 py-2 rounded-xl bg-amber-500/60 text-sm font-semibold">⇦ Blinka</button>
            <button onClick={() => api.current?.blink("right")} className="px-3 py-2 rounded-xl bg-amber-500/60 text-sm font-semibold">Blinka ⇨</button>
            <button {...hold("head")} className="touch-none px-3 py-2 rounded-xl bg-white/20 text-sm font-semibold">Döda vinkeln</button>
          </div>
        </>
      )}

      {/* Start, krock och slut */}
      {phase !== "running" && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/70 p-4 overflow-y-auto">
          <div className="w-full max-w-lg rounded-2xl bg-slate-900 p-6 space-y-4 shadow-2xl">
            {phase === "start" ? (
              <>
                <h1 className="text-2xl font-bold">Övningskörning på landsväg</h1>
                <p className="text-slate-300 text-sm">
                  Du sitter bakom ratten på en tvåfilig landsväg. Körläraren säger till när något blir fel, precis som på en riktig lektion.
                </p>
                <div className="text-sm space-y-1">
                  <p className="font-semibold">Så kör du om enligt svenska trafikregler</p>
                  <ol className="list-decimal pl-5 text-slate-300 space-y-1">
                    <li>Håll minst tre sekunders avstånd till fordonet framför.</li>
                    <li>Kör bara om där mittlinjen är streckad och du ser att vägen är fri. Aldrig vid heldragen linje, backkrön eller skymd kurva.</li>
                    <li>Kontrollera speglar och döda vinkeln, blinka vänster och sväng ut.</li>
                    <li>Håll hastighetsgränsen även under omkörningen.</li>
                    <li>Blinka höger och kör in när du ser fordonet i backspegeln.</li>
                  </ol>
                </div>
                <div className="text-xs text-slate-400 leading-relaxed">
                  ↑ gas · ↓ broms · ← → ratt · Q / E blinkers · håll M för speglar och döda vinkeln
                </div>
                <div className="flex flex-wrap gap-4 text-sm">
                  <label className="flex items-center gap-2"><input type="checkbox" checked={voice} onChange={(e) => setVoice(e.target.checked)} /> Körlärarens röst</label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={assist} onChange={(e) => setAssist(e.target.checked)} /> Styrhjälp i kurvor</label>
                </div>
              </>
            ) : (
              <>
                <h2 className={`text-xl font-bold ${phase === "crashed" ? "text-red-400" : "text-green-400"}`}>{summary?.reason}</h2>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-xl bg-slate-800 p-3"><div className="text-2xl font-bold">{summary?.km.toFixed(1)}</div><div className="text-xs text-slate-400">km körda</div></div>
                  <div className="rounded-xl bg-slate-800 p-3"><div className="text-2xl font-bold">{summary?.overtakes}</div><div className="text-xs text-slate-400">omkörningar</div></div>
                  <div className="rounded-xl bg-slate-800 p-3"><div className="text-2xl font-bold">{summary?.faults.length}</div><div className="text-xs text-slate-400">fel</div></div>
                </div>
                {faultCounts.length > 0 ? (
                  <ul className="text-sm text-slate-300 space-y-1">
                    {faultCounts.map(([f, n]) => (<li key={f}>• {f}{n > 1 ? ` (${n} gånger)` : ""}</li>))}
                  </ul>
                ) : (
                  <p className="text-sm text-slate-300">Inga fel. Snyggt kört!</p>
                )}
              </>
            )}
            <button onClick={() => api.current?.start()} className="w-full rounded-xl bg-blue-600 hover:bg-blue-500 py-3 font-semibold">
              {phase === "start" ? "Starta lektionen" : "Kör igen"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}