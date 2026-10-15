// @ts-nocheck -- strict index checks only; runtime-safe
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

/* =========================================================
   Övningskörning i stadsmiljö – vägmärken och trafikregler
   ========================================================= */

type V2 = [number, number];
type Turn = "straight" | "left" | "right";
type Control = "none" | "yield" | "stop" | "main" | "light" | "finish";
type SignId =
  | "yield" | "stop" | "main" | "mainEnd" | "crosswalk" | "children" | "railWarn"
  | "railCross" | "noParking" | "noEntry" | "lightWarn" | "speed30" | "speed40" | "speed50";

type Item =
  | { at: number; kind: "speed"; kmh: 30 | 40 | 50; quiz?: string }
  | { at: number; kind: "sign"; sign: SignId; quiz?: string }
  | { at: number; kind: "crosswalk"; from: 1 | -1; child?: boolean; quiz?: string }
  | { at: number; kind: "rail" }
  | { at: number; kind: "quiz"; quiz: string };

interface Leg {
  len: number;
  turn: Turn;
  control: Control;
  cross?: "right" | "left";
  crossYields?: boolean;
  oncoming?: boolean;
  items: Item[];
  quizAfter?: string;
  stubSign?: { side: "right" | "left"; sign: SignId };
}

interface Quiz {
  sign?: SignId;
  q: string;
  options: string[];
  correct: number;
  explain: string;
}

/* ---------------- Teorifrågor ---------------- */
const QUIZ: Record<string, Quiz> = {
  speed50: {
    sign: "speed50",
    q: "Vad betyder skylten du just passerade?",
    options: ["Högsta tillåtna hastighet är 50 km/h", "Rekommenderad hastighet är 50 km/h", "Lägsta tillåtna hastighet är 50 km/h", "Hastighetsbegränsningen upphör"],
    correct: 0,
    explain: "Hastighetsbegränsningen gäller från skylten och fram till nästa hastighetsskylt.",
  },
  noParking: {
    sign: "noParking",
    q: "Vad får du göra där den här skylten står?",
    options: ["Stanna en kort stund för att släppa av en passagerare", "Parkera i högst 15 minuter", "Ingenting, du får inte stanna alls", "Parkera om du har varningsblinkers på"],
    correct: 0,
    explain: "Parkering förbjuden betyder att du inte får parkera, men du får stanna kort för att släppa av eller på någon eller för att lasta.",
  },
  rightRule: {
    q: "Vem har företräde i en korsning utan vägmärken eller trafiksignaler?",
    options: ["Den som kommer från höger", "Den som kommer från vänster", "Den som kör fortast", "Den som kör på den bredaste vägen"],
    correct: 0,
    explain: "Högerregeln: du har väjningsplikt mot fordon som kommer från höger.",
  },
  crosswalk: {
    sign: "crosswalk",
    q: "En gående är på väg ut på ett obevakat övergångsställe. Vad ska du göra?",
    options: ["Sakta in och stanna så att den gående kan gå över", "Tuta och köra förbi", "Köra förbi om du hinner först", "Blinka med helljuset"],
    correct: 0,
    explain: "Du ska anpassa farten och lämna företräde åt gående som är på eller precis ska gå ut på övergångsstället.",
  },
  yield: {
    sign: "yield",
    q: "Vad innebär skylten vid korsningen du nyss körde igenom?",
    options: ["Lämna företräde åt korsande trafik, men du behöver inte stanna om det är fritt", "Du måste alltid stanna helt", "Du kör på huvudled", "Förbud att köra in"],
    correct: 0,
    explain: "Väjningsplikt betyder att du ska släppa fram korsande trafik. Är vägen fri får du köra utan att stanna.",
  },
  children: {
    sign: "children",
    q: "Vad varnar skylten för?",
    options: ["Barn som kan springa ut i vägen, till exempel nära en skola", "Övergångsställe", "Gångfartsområde", "Lekplats där du inte får köra"],
    correct: 0,
    explain: "Varning för barn. Sänk farten och var beredd på att barn kan dyka upp plötsligt.",
  },
  yellow: {
    q: "Vad betyder gult ljus i en trafiksignal?",
    options: ["Stanna om du kan göra det på ett säkert sätt", "Öka farten så du hinner över", "Kör, gult betyder samma som grönt", "Stanna bara om det finns gående"],
    correct: 0,
    explain: "Gult ljus betyder stopp. Du får bara köra vidare om du inte kan stanna på ett säkert sätt.",
  },
  leftTurn: {
    q: "Du svänger vänster och en mötande bil kör rakt fram. Vem har företräde?",
    options: ["Den mötande bilen", "Du, eftersom du blinkar", "Den som kom först till korsningen", "Den som har haft grönt längst"],
    correct: 0,
    explain: "När du svänger vänster ska du lämna företräde åt mötande trafik som kör rakt fram eller svänger höger.",
  },
  main: {
    sign: "main",
    q: "Vad betyder skylten?",
    options: ["Du kör på huvudled och trafik från sidovägar ska släppa fram dig", "Väjningsplikt", "Varning för korsning", "Parkering"],
    correct: 0,
    explain: "Huvudled. Trafik från anslutande vägar har väjningsplikt eller stopplikt. Vid vänstersväng ska du ändå släppa fram mötande.",
  },
  noEntry: {
    sign: "noEntry",
    q: "Skylten stod vid sidogatan till höger i korsningen. Vad betyder den?",
    options: ["Förbud mot infart med fordon", "Enkelriktad väg, du får köra in", "Parkering förbjuden", "Återvändsgata"],
    correct: 0,
    explain: "Förbud mot infart. Du får inte köra in på gatan från det hållet.",
  },
  mainEnd: {
    sign: "mainEnd",
    q: "Vad betyder skylten?",
    options: ["Huvudleden upphör och vanliga företrädesregler gäller igen", "Du kör in på huvudled", "Vägen tar slut", "Hastighetsgränsen upphör"],
    correct: 0,
    explain: "Huvudled upphör. Efter skylten kan till exempel högerregeln gälla i korsningar.",
  },
  stop: {
    sign: "stop",
    q: "Vad måste du göra vid stopplikt?",
    options: ["Stanna helt vid stopplinjen och sedan lämna företräde", "Sakta in och köra om det är fritt", "Stanna bara om det kommer bilar", "Tuta innan du kör ut"],
    correct: 0,
    explain: "Vid stopplikt ska du alltid stanna helt, även om vägen är fri, och sedan släppa fram korsande trafik.",
  },
  railWarn: {
    sign: "railWarn",
    q: "Vad varnar skylten för?",
    options: ["Järnvägskorsning med bommar", "Järnvägskorsning utan bommar", "Vägarbete", "Bro som kan öppnas"],
    correct: 0,
    explain: "Varning för järnvägskorsning med bommar. Stanna när ljussignalerna blinkar eller bommarna fälls.",
  },
  railCross: {
    sign: "railCross",
    q: "Vad anger kryssmärket vid spåret?",
    options: ["Platsen för en järnvägskorsning", "Korsning med huvudled", "Stopplikt", "Förbud mot att stanna"],
    correct: 0,
    explain: "Kryssmärket står vid själva järnvägskorsningen. Ett enkelt kryss betyder ett spår, ett dubbelt kryss flera spår.",
  },
  base50: {
    q: "Vilken hastighet gäller inom tättbebyggt område om ingen skylt säger något annat?",
    options: ["30 km/h", "40 km/h", "50 km/h", "70 km/h"],
    correct: 2,
    explain: "Bashastigheten inom tättbebyggt område är 50 km/h. Utanför tättbebyggt område är den 70 km/h.",
  },
};

/* ---------------- Lektionsrundan ---------------- */
const COURSE: Leg[] = [
  { len: 200, turn: "straight", control: "none", cross: "right", quizAfter: "rightRule",
    items: [{ at: 12, kind: "speed", kmh: 50, quiz: "speed50" }, { at: 110, kind: "sign", sign: "noParking", quiz: "noParking" }] },
  { len: 180, turn: "right", control: "yield", cross: "right", quizAfter: "yield",
    items: [{ at: 85, kind: "crosswalk", from: 1, quiz: "crosswalk" }] },
  { len: 230, turn: "left", control: "light", oncoming: true, quizAfter: "leftTurn",
    items: [
      { at: 20, kind: "sign", sign: "children", quiz: "children" },
      { at: 32, kind: "speed", kmh: 30 },
      { at: 115, kind: "crosswalk", from: -1, child: true },
      { at: 160, kind: "speed", kmh: 50 },
      { at: 178, kind: "sign", sign: "lightWarn" },
    ] },
  { len: 250, turn: "straight", control: "main", cross: "right", crossYields: true, quizAfter: "noEntry",
    stubSign: { side: "right", sign: "noEntry" },
    items: [{ at: 25, kind: "sign", sign: "main", quiz: "main" }, { at: 130, kind: "quiz", quiz: "yellow" }] },
  { len: 200, turn: "left", control: "main", oncoming: true, items: [] },
  { len: 200, turn: "right", control: "stop", cross: "right", quizAfter: "stop",
    items: [{ at: 25, kind: "sign", sign: "mainEnd", quiz: "mainEnd" }] },
  { len: 320, turn: "straight", control: "none", cross: "left", crossYields: true,
    items: [{ at: 60, kind: "sign", sign: "railWarn", quiz: "railWarn" }, { at: 220, kind: "rail" }, { at: 255, kind: "quiz", quiz: "railCross" }] },
  { len: 200, turn: "right", control: "none", items: [{ at: 70, kind: "quiz", quiz: "base50" }] },
  { len: 160, turn: "straight", control: "finish", items: [{ at: 25, kind: "speed", kmh: 40 }] },
];

const B = 6; // halva korsningens storlek
const LANE = 1.75;
const STUB = 90;
const EYE_H = 1.15;
const HALF_CAR = 2.25;
const MR = { x: 0.52, y: 0.035, w: 0.26, h: 0.1 }; // backspegel

const DIRS: V2[] = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const rightOf = (d: V2): V2 => [-d[1], d[0]];
const neg = (d: V2): V2 => [-d[0], -d[1]];
const eq = (a: V2, b: V2) => a[0] === b[0] && a[1] === b[1];
const isPerp = (a: V2, b: V2) => a[0] * b[0] + a[1] * b[1] === 0;
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];

/* ---------------- Körväg ---------------- */
class LanePath {
  xs: number[] = [];
  zs: number[] = [];
  S: number[] = [];
  total = 0;
  add(x: number, z: number) {
    const n = this.xs.length;
    if (n) {
      const d = Math.hypot(x - this.xs[n - 1], z - this.zs[n - 1]);
      if (d < 1e-4) return;
      this.total += d;
    }
    this.xs.push(x);
    this.zs.push(z);
    this.S.push(this.total);
  }
  at(s: number) {
    const S = this.S;
    const n = S.length;
    let i = 0;
    let t = 0;
    if (s >= this.total) { i = n - 2; t = 1; }
    else if (s > 0) {
      let lo = 0, hi = n - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m] <= s) lo = m; else hi = m; }
      i = lo;
      t = (s - S[lo]) / (S[hi] - S[lo]);
    }
    const dx = this.xs[i + 1] - this.xs[i];
    const dz = this.zs[i + 1] - this.zs[i];
    const l = Math.hypot(dx, dz) || 1;
    return { x: this.xs[i] + dx * t, z: this.zs[i] + dz * t, dx: dx / l, dz: dz / l };
  }
}

interface LegG { x0: number; z0: number; dir: V2; r: V2; len: number; nx: number; nz: number; out: V2; startLocal: number; endLocal: number; s0: number }

function buildCourse() {
  const legs: LegG[] = [];
  let x = 0, z = 0;
  let d: V2 = [0, -1];
  COURSE.forEach((L, i) => {
    const r = rightOf(d);
    const out: V2 = L.turn === "right" ? r : L.turn === "left" ? neg(r) : d;
    const last = i === COURSE.length - 1;
    legs.push({ x0: x, z0: z, dir: d, r, len: L.len, nx: x + d[0] * L.len, nz: z + d[1] * L.len, out, startLocal: i === 0 ? -40 : B, endLocal: last ? L.len + 40 : L.len - B, s0: 0 });
    x += d[0] * L.len;
    z += d[1] * L.len;
    d = out;
  });
  const path = new LanePath();
  const boxIn: number[] = [];
  const boxOut: number[] = [];
  legs.forEach((g, i) => {
    g.s0 = path.total;
    for (let l = g.startLocal; l < g.endLocal; l += 2) path.add(g.x0 + g.dir[0] * l + g.r[0] * LANE, g.z0 + g.dir[1] * l + g.r[1] * LANE);
    path.add(g.x0 + g.dir[0] * g.endLocal + g.r[0] * LANE, g.z0 + g.dir[1] * g.endLocal + g.r[1] * LANE);
    if (i < legs.length - 1) {
      boxIn[i] = path.total;
      const ro = rightOf(g.out);
      const p0x = g.nx - g.dir[0] * B + g.r[0] * LANE, p0z = g.nz - g.dir[1] * B + g.r[1] * LANE;
      const p2x = g.nx + g.out[0] * B + ro[0] * LANE, p2z = g.nz + g.out[1] * B + ro[1] * LANE;
      let p1x = (p0x + p2x) / 2, p1z = (p0z + p2z) / 2;
      if (!eq(g.out, g.dir)) { p1x = g.nx + g.r[0] * LANE + ro[0] * LANE; p1z = g.nz + g.r[1] * LANE + ro[1] * LANE; }
      for (let k = 1; k <= 16; k++) {
        const t = k / 16, a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, c = t * t;
        path.add(a * p0x + b * p1x + c * p2x, a * p0z + b * p1z + c * p2z);
      }
      boxOut[i] = path.total;
    }
  });
  const sOf = (i: number, local: number) => legs[i].s0 + (local - legs[i].startLocal);
  return { legs, path, boxIn, boxOut, sOf };
}

const C = buildCourse();

/* ---------------- Vägmärken ---------------- */
const ALL_SIGNS: SignId[] = ["yield", "stop", "main", "mainEnd", "crosswalk", "children", "railWarn", "railCross", "noParking", "noEntry", "lightWarn", "speed30", "speed40", "speed50"];

function drawSign(id: SignId): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  const YELLOW = "#f6cf1a", RED = "#d21f1f", BLUE = "#1f5fae";
  const poly = (pts: number[][], fill: string) => {
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (const p of pts.slice(1)) g.lineTo(p[0], p[1]);
    g.closePath();
    g.fillStyle = fill;
    g.fill();
  };
  const circle = (r: number, fill: string, x = 128, y = 128) => { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fillStyle = fill; g.fill(); };
  const warn = () => { poly([[128, 14], [246, 226], [10, 226]], RED); poly([[128, 58], [208, 204], [48, 204]], YELLOW); };
  const line = (x1: number, y1: number, x2: number, y2: number, w: number, col = "#111") => {
    g.strokeStyle = col; g.lineWidth = w; g.lineCap = "round"; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
  };
  switch (id) {
    case "speed30": case "speed40": case "speed50":
      circle(124, RED); circle(96, YELLOW);
      g.fillStyle = "#111"; g.font = "bold 100px Arial"; g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(id.slice(5), 128, 136);
      break;
    case "yield":
      poly([[10, 30], [246, 30], [128, 240]], RED); poly([[58, 56], [198, 56], [128, 180]], YELLOW);
      break;
    case "stop": {
      const oct = (r: number) => Array.from({ length: 8 }, (_, k) => { const a = Math.PI / 8 + (k * Math.PI) / 4; return [128 + r * Math.cos(a), 128 + r * Math.sin(a)]; });
      poly(oct(126), "#fff"); poly(oct(114), "#c8102e");
      g.fillStyle = "#fff"; g.font = "bold 70px Arial"; g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText("STOP", 128, 132);
      break;
    }
    case "main": case "mainEnd":
      poly([[128, 4], [252, 128], [128, 252], [4, 128]], "#9a9a9a");
      poly([[128, 10], [246, 128], [128, 246], [10, 128]], "#fff");
      poly([[128, 38], [218, 128], [128, 218], [38, 128]], YELLOW);
      if (id === "mainEnd") line(70, 186, 186, 70, 22);
      break;
    case "crosswalk":
      g.fillStyle = BLUE; g.fillRect(10, 10, 236, 236);
      poly([[128, 34], [226, 208], [30, 208]], "#fff");
      circle(13, "#111", 132, 96);
      line(130, 112, 122, 150, 12); line(122, 150, 104, 184, 10); line(122, 150, 146, 182, 10); line(128, 122, 152, 142, 9);
      g.fillStyle = "#111"; for (let k = 0; k < 5; k++) g.fillRect(70 + k * 24, 192, 14, 8);
      break;
    case "children":
      warn();
      circle(12, "#111", 106, 110); line(106, 124, 104, 160, 14); line(104, 160, 92, 190, 10); line(104, 160, 118, 190, 10);
      circle(10, "#111", 150, 128); line(150, 140, 150, 168, 12); line(150, 168, 140, 192, 9); line(150, 168, 160, 192, 9);
      line(112, 136, 144, 148, 8);
      break;
    case "railWarn":
      warn();
      g.fillStyle = "#111";
      g.fillRect(80, 118, 10, 76); g.fillRect(166, 118, 10, 76);
      g.fillRect(74, 132, 108, 12); g.fillRect(74, 164, 108, 12);
      break;
    case "railCross":
      for (const a of [0.62, -0.62]) {
        g.save(); g.translate(128, 128); g.rotate(a);
        g.fillStyle = RED; g.fillRect(-124, -22, 248, 44);
        g.fillStyle = "#fff"; g.fillRect(-116, -14, 232, 28);
        g.restore();
      }
      break;
    case "noParking":
      circle(124, RED); circle(98, BLUE);
      g.save(); g.beginPath(); g.arc(128, 128, 98, 0, Math.PI * 2); g.clip(); line(40, 40, 216, 216, 26, RED); g.restore();
      break;
    case "noEntry":
      circle(124, RED); g.fillStyle = "#fff"; g.fillRect(48, 106, 160, 44);
      break;
    case "lightWarn":
      warn();
      g.fillStyle = "#111"; g.fillRect(108, 96, 40, 100);
      circle(11, "#e02020", 128, 114); circle(11, "#f6c21a", 128, 146); circle(11, "#20b050", 128, 178);
      break;
  }
  return c;
}

const texCache = new Map<SignId, THREE.Texture>();
function texFor(id: SignId) {
  let t = texCache.get(id);
  if (!t) {
    t = new THREE.CanvasTexture(drawSign(id));
    t.colorSpace = THREE.SRGBColorSpace;
    texCache.set(id, t);
  }
  return t;
}

const POLE_MAT = new THREE.MeshLambertMaterial({ color: 0x8f959b });

function placeSign(scene: THREE.Scene, id: SignId, cx: number, cz: number, travel: V2, lat = 4.3) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.5, 8), POLE_MAT);
  pole.position.y = 1.25;
  g.add(pole);
  const size = id === "railCross" ? 1.25 : 0.8;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshLambertMaterial({ map: texFor(id), alphaTest: 0.5 }));
  face.position.set(0, 2.2, 0.05);
  g.add(face);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshLambertMaterial({ map: texFor(id), color: 0x3a3a3a, alphaTest: 0.5 }));
  back.position.set(0, 2.2, 0.03);
  back.rotation.y = Math.PI;
  g.add(back);
  const r = rightOf(travel);
  g.position.set(cx + r[0] * lat, 0, cz + r[1] * lat);
  g.rotation.y = Math.atan2(-travel[0], -travel[1]);
  scene.add(g);
}

/* ---------------- Fordon och människor ---------------- */
const WHEEL_GEO = new THREE.CylinderGeometry(1, 1, 1, 16);
WHEEL_GEO.rotateZ(Math.PI / 2);
const WHEEL_MAT = new THREE.MeshLambertMaterial({ color: 0x151515 });
const CAR_COLORS = [0xe8e8e8, 0x1c1c1c, 0x6b6f75, 0xb0b4b8, 0x1f3a5f, 0x8e1b1b, 0x2d4a3e];

const bx = (w: number, h: number, l: number, m: THREE.Material, x: number, y: number, z: number) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), m);
  mesh.position.set(x, y, z);
  return mesh;
};

function makeCar(color: number) {
  const g = new THREE.Group();
  const body = new THREE.MeshLambertMaterial({ color });
  const glass = new THREE.MeshLambertMaterial({ color: 0x1b2530 });
  g.add(bx(1.8, 0.62, 4.4, body, 0, 0.6, 0));
  g.add(bx(1.62, 0.5, 2.2, glass, 0, 1.15, -0.25));
  g.add(bx(1.64, 0.07, 1.9, body, 0, 1.42, -0.3));
  for (const x of [-0.86, 0.86]) for (const z of [-1.35, 1.35]) {
    const w = new THREE.Mesh(WHEEL_GEO, WHEEL_MAT);
    w.scale.set(0.24, 0.33, 0.33);
    w.position.set(x, 0.33, z);
    g.add(w);
  }
  const hl = new THREE.MeshBasicMaterial({ color: 0xfff4d6 });
  const tl = new THREE.MeshBasicMaterial({ color: 0xa01018 });
  g.add(bx(0.34, 0.14, 0.05, hl, -0.58, 0.68, 2.21), bx(0.34, 0.14, 0.05, hl, 0.58, 0.68, 2.21));
  g.add(bx(0.36, 0.14, 0.05, tl, -0.6, 0.72, -2.21), bx(0.36, 0.14, 0.05, tl, 0.6, 0.72, -2.21));
  return { obj: g, len: 4.4 };
}

function makePerson(child: boolean) {
  const g = new THREE.Group();
  const shirt = new THREE.MeshLambertMaterial({ color: pick([0xc0392b, 0x2e86c1, 0xf1c40f, 0x27ae60, 0x8e44ad]) });
  const pants = new THREE.MeshLambertMaterial({ color: 0x2c3e50 });
  const skin = new THREE.MeshLambertMaterial({ color: 0xe0b899 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.65, 10), shirt);
  body.position.y = 1.15;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), skin);
  head.position.y = 1.62;
  g.add(body, head);
  const legGeo = new THREE.BoxGeometry(0.13, 0.8, 0.15);
  legGeo.translate(0, -0.4, 0);
  const legs: THREE.Mesh[] = [];
  for (const x of [-0.1, 0.1]) {
    const l = new THREE.Mesh(legGeo, pants);
    l.position.set(x, 0.82, 0);
    g.add(l);
    legs.push(l);
  }
  g.scale.setScalar(child ? 0.68 : 1);
  return { obj: g, legs };
}

function buildHood() {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute([
    -0.55, -0.52, -1.35, 1.25, -0.52, -1.35, -0.55, -0.66, -3.05, 1.25, -0.66, -3.05, -0.55, -0.82, -3.12, 1.25, -0.82, -3.12,
  ], 3));
  geo.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4]);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshPhongMaterial({ color: 0x1f3b6e, shininess: 80, specular: 0x555555, side: THREE.DoubleSide }));
}

/* ---------------- Staden ---------------- */
interface Rect { x0: number; x1: number; z0: number; z1: number }
const along = (x: number, z: number, d: V2, l0: number, l1: number, w: number): Rect => {
  const ax = x + d[0] * l0, az = z + d[1] * l0, bx2 = x + d[0] * l1, bz = z + d[1] * l1;
  const hx = d[0] === 0 ? w : 0, hz = d[1] === 0 ? w : 0;
  return { x0: Math.min(ax, bx2) - hx, x1: Math.max(ax, bx2) + hx, z0: Math.min(az, bz) - hz, z1: Math.max(az, bz) + hz };
};
const overlap = (a: Rect, b: Rect, m = 0) => a.x0 < b.x1 + m && a.x1 > b.x0 - m && a.z0 < b.z1 + m && a.z1 > b.z0 - m;

function localRect(arr: number[], x: number, z: number, dir: V2, l0: number, l1: number, t0: number, t1: number, y = 0.015) {
  const r = rightOf(dir);
  const P = (l: number, t: number) => [x + dir[0] * l + r[0] * t, z + dir[1] * l + r[1] * t];
  const a = P(l0, t0), b = P(l1, t0), c = P(l1, t1), d = P(l0, t1);
  arr.push(a[0], y, a[1], b[0], y, b[1], c[0], y, c[1], a[0], y, a[1], c[0], y, c[1], d[0], y, d[1]);
}
function localTri(arr: number[], x: number, z: number, dir: V2, pts: [number, number][], y = 0.015) {
  const r = rightOf(dir);
  for (const [l, t] of pts) arr.push(x + dir[0] * l + r[0] * t, y, z + dir[1] * l + r[1] * t);
}

function buildWorld(scene: THREE.Scene) {
  const legs = C.legs;
  const last = legs.length - 1;
  const lines: { x: number; z: number; dir: V2; l0: number; l1: number }[] = [];
  const boxes: Rect[] = [];
  legs.forEach((g) => lines.push({ x: g.x0, z: g.z0, dir: g.dir, l0: g.startLocal, l1: g.endLocal }));
  legs.forEach((g, i) => {
    if (i === last) return;
    boxes.push({ x0: g.nx - B, x1: g.nx + B, z0: g.nz - B, z1: g.nz + B });
    for (const a of DIRS) {
      if (eq(a, neg(g.dir)) || eq(a, g.out)) continue;
      lines.push({ x: g.nx, z: g.nz, dir: a, l0: B, l1: STUB });
    }
  });
  const roadRects = [...lines.map((l) => along(l.x, l.z, l.dir, l.l0, l.l1, 3.5)), ...boxes];

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshLambertMaterial({ color: 0x6d8a44 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(100, -0.05, -700);
  scene.add(ground);

  const asph = new THREE.MeshLambertMaterial({ color: 0x4a4c50 });
  for (const r of roadRects) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(r.x1 - r.x0, r.z1 - r.z0), asph);
    m.rotation.x = -Math.PI / 2;
    m.position.set((r.x0 + r.x1) / 2, 0, (r.z0 + r.z1) / 2);
    scene.add(m);
  }

  const walkMat = new THREE.MeshLambertMaterial({ color: 0xa9a59c });
  for (const l of lines) for (const side of [-1, 1]) {
    const r = rightOf(l.dir);
    const rc = along(l.x + r[0] * side * 5, l.z + r[1] * side * 5, l.dir, l.l0, l.l1, 1.5);
    const m = new THREE.Mesh(new THREE.BoxGeometry(rc.x1 - rc.x0, 0.14, rc.z1 - rc.z0), walkMat);
    m.position.set((rc.x0 + rc.x1) / 2, 0.07, (rc.z0 + rc.z1) / 2);
    scene.add(m);
  }

  // Vägmarkeringar
  const mk: number[] = [];
  for (const l of lines) for (let s = l.l0 + 2; s + 3 <= l.l1 - 2; s += 12) localRect(mk, l.x, l.z, l.dir, s, s + 3, -0.06, 0.06);
  legs.forEach((g, i) => {
    if (i === last) return;
    const L = COURSE[i];
    const sl = g.len - B;
    if (L.control === "stop" || L.control === "light") localRect(mk, g.x0, g.z0, g.dir, sl - 1.5, sl - 1.0, 0, 3.4);
    if (L.control === "yield") for (let t = 0.3; t < 3.3; t += 0.6) localTri(mk, g.x0, g.z0, g.dir, [[sl - 0.9, t], [sl - 0.9, t + 0.45], [sl - 1.7, t + 0.225]]);
    if (L.control === "main") {
      for (const a of DIRS) {
        if (!isPerp(a, g.dir)) continue;
        for (let t = 0.3; t < 3.3; t += 0.6) localTri(mk, g.nx, g.nz, a, [[B + 0.9, -t], [B + 0.9, -t - 0.45], [B + 1.7, -t - 0.225]]);
        placeSign(scene, "yield", g.nx + a[0] * (B + 2.5), g.nz + a[1] * (B + 2.5), neg(a));
      }
    }
  });
  COURSE.forEach((L, i) => {
    const g = legs[i];
    for (const it of L.items) {
      if (it.kind === "crosswalk") for (let t = -3.25; t < 3.3; t += 1) localRect(mk, g.x0, g.z0, g.dir, it.at - 1.5, it.at + 1.5, t, t + 0.5);
      if (it.kind === "rail") {
        localRect(mk, g.x0, g.z0, g.dir, it.at - 7.5, it.at - 7.0, 0, 3.4);
        localRect(mk, g.x0, g.z0, g.dir, it.at + 7.0, it.at + 7.5, -3.4, 0);
      }
    }
  });
  const mkGeo = new THREE.BufferGeometry();
  mkGeo.setAttribute("position", new THREE.Float32BufferAttribute(mk, 3));
  mkGeo.computeVertexNormals();
  scene.add(new THREE.Mesh(mkGeo, new THREE.MeshLambertMaterial({ color: 0xeeeeee, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })));

  // Skyltar längs rundan
  COURSE.forEach((L, i) => {
    const g = legs[i];
    const pt = (local: number) => [g.x0 + g.dir[0] * local, g.z0 + g.dir[1] * local];
    for (const it of L.items) {
      if (it.kind === "speed") { const p = pt(it.at); placeSign(scene, `speed${it.kmh}` as SignId, p[0], p[1], g.dir); }
      if (it.kind === "sign") { const p = pt(it.at); placeSign(scene, it.sign, p[0], p[1], g.dir); }
      if (it.kind === "crosswalk") {
        const a = pt(it.at - 2), b = pt(it.at + 2);
        placeSign(scene, "crosswalk", a[0], a[1], g.dir);
        placeSign(scene, "crosswalk", b[0], b[1], neg(g.dir));
      }
    }
    if (i < last) {
      const p = pt(g.len - B - 2.5);
      if (L.control === "yield") placeSign(scene, "yield", p[0], p[1], g.dir);
      if (L.control === "stop") placeSign(scene, "stop", p[0], p[1], g.dir);
      if (L.stubSign) {
        const arm = L.stubSign.side === "right" ? g.r : neg(g.r);
        placeSign(scene, L.stubSign.sign, g.nx + arm[0] * (B + 2.5), g.nz + arm[1] * (B + 2.5), arm);
      }
    }
  });

  // Trafiksignal
  let light: { red: THREE.MeshBasicMaterial; yellow: THREE.MeshBasicMaterial; green: THREE.MeshBasicMaterial } | null = null;
  COURSE.forEach((L, i) => {
    if (L.control !== "light") return;
    const g = legs[i];
    const local = g.len - B - 2.5;
    const grp = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.3, 8), POLE_MAT);
    pole.position.y = 1.65;
    grp.add(pole);
    grp.add(bx(0.36, 1.05, 0.3, new THREE.MeshLambertMaterial({ color: 0x1a1a1a }), 0, 2.95, 0));
    const red = new THREE.MeshBasicMaterial({ color: 0x330000 });
    const yellow = new THREE.MeshBasicMaterial({ color: 0x332800 });
    const green = new THREE.MeshBasicMaterial({ color: 0x003311 });
    [[red, 3.28], [yellow, 2.95], [green, 2.62]].forEach(([m, y]) => {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10), m as THREE.Material);
      s.position.set(0, y as number, 0.16);
      grp.add(s);
    });
    grp.position.set(g.x0 + g.dir[0] * local + g.r[0] * 4.3, 0, g.z0 + g.dir[1] * local + g.r[1] * 4.3);
    grp.rotation.y = Math.atan2(-g.dir[0], -g.dir[1]);
    scene.add(grp);
    light = { red, yellow, green };
  });

  // Järnvägskorsning
  let rail: null | {
    i: number; at: number; cx: number; cz: number; r: V2;
    arms: THREE.Group[]; lamps: THREE.MeshBasicMaterial[]; train: THREE.Group;
  } = null;
  const railRects: Rect[] = [];
  COURSE.forEach((L, i) => {
    for (const it of L.items) {
      if (it.kind !== "rail") continue;
      const g = legs[i];
      const cx = g.x0 + g.dir[0] * it.at, cz = g.z0 + g.dir[1] * it.at;
      const r = g.r;
      railRects.push(along(cx, cz, r, -260, 260, 3));
      const bed = new THREE.MeshLambertMaterial({ color: 0x7a6e60 });
      for (const [a, b] of [[4, 260], [-260, -4]]) {
        const rc = along(cx, cz, r, a, b, 1.6);
        const m = new THREE.Mesh(new THREE.BoxGeometry(rc.x1 - rc.x0, 0.1, rc.z1 - rc.z0), bed);
        m.position.set((rc.x0 + rc.x1) / 2, 0.03, (rc.z0 + rc.z1) / 2);
        scene.add(m);
      }
      const steel = new THREE.MeshLambertMaterial({ color: 0x80858b });
      for (const off of [-0.72, 0.72]) {
        const rc = along(cx + g.dir[0] * off, cz + g.dir[1] * off, r, -260, 260, 0.035);
        const m = new THREE.Mesh(new THREE.BoxGeometry(rc.x1 - rc.x0, 0.12, rc.z1 - rc.z0), steel);
        m.position.set((rc.x0 + rc.x1) / 2, 0.1, (rc.z0 + rc.z1) / 2);
        scene.add(m);
      }
      const sleepers: THREE.Matrix4[] = [];
      for (let k = -260; k <= 260; k += 0.8) {
        if (Math.abs(k) < 3.6) continue;
        const sx = r[0] !== 0 ? 0.25 : 2.4, sz = r[0] !== 0 ? 2.4 : 0.25;
        sleepers.push(new THREE.Matrix4().compose(new THREE.Vector3(cx + r[0] * k, 0.08, cz + r[1] * k), new THREE.Quaternion(), new THREE.Vector3(sx, 0.08, sz)));
      }
      const sm = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0x4a3c30 }), sleepers.length);
      sleepers.forEach((m, k) => sm.setMatrixAt(k, m));
      scene.add(sm);

      const p1 = [g.x0 + g.dir[0] * (it.at - 4), g.z0 + g.dir[1] * (it.at - 4)];
      const p2 = [g.x0 + g.dir[0] * (it.at + 4), g.z0 + g.dir[1] * (it.at + 4)];
      placeSign(scene, "railCross", p1[0], p1[1], g.dir, 4.6);
      placeSign(scene, "railCross", p2[0], p2[1], neg(g.dir), 4.6);

      const stripe = document.createElement("canvas");
      stripe.width = 64; stripe.height = 8;
      const sg = stripe.getContext("2d")!;
      for (let k = 0; k < 4; k++) { sg.fillStyle = k % 2 ? "#ffffff" : "#d21f1f"; sg.fillRect(k * 16, 0, 16, 8); }
      const stex = new THREE.CanvasTexture(stripe);
      stex.colorSpace = THREE.SRGBColorSpace;
      stex.wrapS = stex.wrapT = THREE.RepeatWrapping;
      stex.repeat.set(3, 1);
      const armMat = new THREE.MeshLambertMaterial({ map: stex });
      const armGeo = new THREE.BoxGeometry(0.1, 0.1, 4.4);
      armGeo.translate(0, 0, 2.2);
      const arms: THREE.Group[] = [];
      const lamps: THREE.MeshBasicMaterial[] = [];
      const makeBarrier = (local: number, lat: number, toward: V2, travel: V2) => {
        const px = g.x0 + g.dir[0] * local + g.r[0] * lat, pz = g.z0 + g.dir[1] * local + g.r[1] * lat;
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.9, 8), POLE_MAT);
        post.position.set(px, 0.95, pz);
        scene.add(post);
        const pivot = new THREE.Group();
        pivot.position.set(px, 1.05, pz);
        pivot.rotation.y = Math.atan2(toward[0], toward[1]);
        const holder = new THREE.Group();
        holder.add(new THREE.Mesh(armGeo, armMat));
        holder.rotation.x = -Math.PI / 2;
        pivot.add(holder);
        scene.add(pivot);
        arms.push(holder);
        const lampHolder = new THREE.Group();
        lampHolder.position.set(px, 1.75, pz);
        lampHolder.rotation.y = Math.atan2(-travel[0], -travel[1]);
        for (const x of [-0.22, 0.22]) {
          const m = new THREE.MeshBasicMaterial({ color: 0x330000 });
          const s = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), m);
          s.position.set(x, 0, 0.1);
          lampHolder.add(s);
          lamps.push(m);
        }
        scene.add(lampHolder);
      };
      makeBarrier(it.at - 5.5, 4.3, neg(g.r), g.dir);
      makeBarrier(it.at + 5.5, -4.3, g.r, neg(g.dir));

      const train = new THREE.Group();
      const tMat = new THREE.MeshLambertMaterial({ color: 0x34495e });
      const tStripe = new THREE.MeshLambertMaterial({ color: 0xc0392b });
      for (let k = 0; k < 3; k++) {
        const zc = -9.2 - k * 18.4;
        train.add(bx(3, 3.6, 18, tMat, 0, 2.2, zc));
        train.add(bx(3.02, 0.3, 18, tStripe, 0, 1.6, zc));
      }
      train.rotation.y = Math.atan2(r[0], r[1]);
      train.position.set(cx - r[0] * 600, 0, cz - r[1] * 600);
      scene.add(train);
      rail = { i, at: it.at, cx, cz, r, arms, lamps, train };
    }
  });

  // Hus, lyktstolpar och träd
  const blockRects = [...roadRects, ...railRects];
  const winC = document.createElement("canvas");
  winC.width = winC.height = 64;
  const wg = winC.getContext("2d")!;
  wg.fillStyle = "#fff"; wg.fillRect(0, 0, 64, 64);
  wg.fillStyle = "#e9e9e9"; wg.fillRect(14, 12, 36, 42);
  wg.fillStyle = "#3a4654"; wg.fillRect(17, 15, 30, 36);
  const winTex = new THREE.CanvasTexture(winC);
  winTex.colorSpace = THREE.SRGBColorSpace;
  winTex.wrapS = winTex.wrapT = THREE.RepeatWrapping;
  const palette = [0xe8d9a8, 0xd8cfc0, 0xb5543c, 0x8c1c13, 0xf0ece4, 0x9fb3a6, 0xd7a86e, 0xc9c3b6];
  const roofMat = new THREE.MeshLambertMaterial({ color: 0x3a3a3a });
  const placed: Rect[] = [];
  const lamps: THREE.Matrix4[] = [];
  const trees: THREE.Matrix4[] = [];
  const q = new THREE.Quaternion();
  for (const l of lines) {
    const r = rightOf(l.dir);
    for (const side of [-1, 1]) {
      for (let s = l.l0 + 5; s < l.l1 - 5; s += 30) {
        lamps.push(new THREE.Matrix4().compose(new THREE.Vector3(l.x + l.dir[0] * s + r[0] * side * 6.1, 3, l.z + l.dir[1] * s + r[1] * side * 6.1), q, new THREE.Vector3(1, 1, 1)));
        if (Math.random() < 0.5) trees.push(new THREE.Matrix4().compose(new THREE.Vector3(l.x + l.dir[0] * (s + 15) + r[0] * side * 7.6, 0, l.z + l.dir[1] * (s + 15) + r[1] * side * 7.6), q, new THREE.Vector3(1, rand(0.8, 1.3), 1)));
      }
      let s = l.l0 + 2;
      while (s < l.l1 - 8) {
        const w = rand(9, 20), dpt = rand(8, 14), h = pick([4, 6, 7, 9, 12, 15]);
        const setback = rand(9, 11.5);
        const along2 = s + w / 2, lat = side * (setback + dpt / 2);
        const cx = l.x + l.dir[0] * along2 + r[0] * lat, cz = l.z + l.dir[1] * along2 + r[1] * lat;
        const sx = l.dir[0] !== 0 ? w : dpt, sz = l.dir[0] !== 0 ? dpt : w;
        const rect = { x0: cx - sx / 2, x1: cx + sx / 2, z0: cz - sz / 2, z1: cz + sz / 2 };
        if (!blockRects.some((b) => overlap(rect, b, 5)) && !placed.some((b) => overlap(rect, b, 1))) {
          placed.push(rect);
          const t = winTex.clone();
          t.needsUpdate = true;
          t.repeat.set(Math.max(1, Math.round(w / 3.5)), Math.max(1, Math.round(h / 3)));
          const m = new THREE.Mesh(new THREE.BoxGeometry(sx, h, sz), new THREE.MeshLambertMaterial({ color: pick(palette), map: t }));
          m.position.set(cx, h / 2, cz);
          scene.add(m);
          const roof = new THREE.Mesh(new THREE.BoxGeometry(sx + 0.3, 0.4, sz + 0.3), roofMat);
          roof.position.set(cx, h + 0.2, cz);
          scene.add(roof);
        }
        s += w + rand(1, 6);
      }
    }
  }
  const lampPole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.09, 6, 6), POLE_MAT, lamps.length);
  lamps.forEach((m, i) => lampPole.setMatrixAt(i, m));
  scene.add(lampPole);
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.15, 0.2, 2.6, 6), new THREE.MeshLambertMaterial({ color: 0x5a4632 }), trees.length);
  const crown = new THREE.InstancedMesh(new THREE.SphereGeometry(1.9, 10, 8), new THREE.MeshLambertMaterial({ color: 0x3f6b2e }), trees.length);
  const tmp = new THREE.Matrix4(), pos = new THREE.Vector3(), sc = new THREE.Vector3();
  trees.forEach((m, i) => {
    m.decompose(pos, q, sc);
    trunk.setMatrixAt(i, tmp.compose(new THREE.Vector3(pos.x, 1.3, pos.z), q, new THREE.Vector3(1, 1, 1)));
    crown.setMatrixAt(i, tmp.compose(new THREE.Vector3(pos.x, 3.6 * sc.y, pos.z), q, new THREE.Vector3(1, sc.y, 1)));
  });
  scene.add(trunk, crown);

  return { light, rail };
}

/* =========================================================
   Sidan
   ========================================================= */
type MsgKind = "info" | "good" | "bad";
type Phase = "start" | "running" | "crashed" | "finished";
type Keys = { up: boolean; down: boolean; lookL: boolean; lookR: boolean };

interface Car {
  path: LanePath; s: number; v: number; vWant: number; len: number;
  role: "priority" | "yield" | "ambient"; node: number; boxIn: number; boxOut: number; obj: THREE.Group;
}

export default function Index() {
  const mountRef = useRef<HTMLDivElement>(null);
  const needleRef = useRef<SVGGElement>(null);
  const speedRef = useRef<SVGTextElement>(null);
  const wheelRef = useRef<SVGGElement>(null);
  const limitRef = useRef<HTMLSpanElement>(null);
  const blinkLRef = useRef<SVGSVGElement>(null);
  const blinkRRef = useRef<SVGSVGElement>(null);
  const btnLRef = useRef<HTMLButtonElement>(null);
  const btnRRef = useRef<HTMLButtonElement>(null);
  const navRef = useRef<HTMLDivElement>(null);
  const navTextRef = useRef<HTMLSpanElement>(null);
  const navArrowRef = useRef<SVGSVGElement>(null);
  const dashRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const keys = useRef<Keys>({ up: false, down: false, lookL: false, lookR: false });
  const api = useRef<{ start: () => void; blink: (d: "left" | "right") => void; resume: (ok: boolean) => void } | null>(null);
  const settings = useRef({ voice: true, quiz: true });

  const [phase, setPhase] = useState<Phase>("start");
  const [msg, setMsg] = useState<{ text: string; kind: MsgKind; id: number } | null>(null);
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [quizPick, setQuizPick] = useState<number | null>(null);
  const [summary, setSummary] = useState<{ reason: string; faults: string[]; right: number; total: number } | null>(null);
  const [voice, setVoice] = useState(true);
  const [quizOn, setQuizOn] = useState(true);
  const [touch, setTouch] = useState(false);

  const signImages = useMemo(() => {
    if (typeof document === "undefined") return {} as Record<string, string>;
    const out: Record<string, string> = {};
    for (const id of ALL_SIGNS) out[id] = drawSign(id).toDataURL();
    return out;
  }, []);

  useEffect(() => { settings.current.voice = voice; }, [voice]);
  useEffect(() => { settings.current.quiz = quizOn; }, [quizOn]);
  useEffect(() => { setTouch(window.matchMedia("(pointer: coarse)").matches); }, []);
  useEffect(() => {
    if (!msg) return;
    const id = msg.id;
    const t = setTimeout(() => setMsg((m) => (m && m.id === id ? null : m)), 5000);
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
    scene.fog = new THREE.Fog(sky, 40, 650);
    scene.add(new THREE.HemisphereLight(0xe6f0ff, 0x4d5a33, 1.0));
    const sun = new THREE.DirectionalLight(0xfff1dc, 1.6);
    sun.position.set(300, 400, 200);
    scene.add(sun);

    const world = buildWorld(scene);

    const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 1500);
    const rig = new THREE.Object3D();
    scene.add(rig);
    rig.add(camera);
    rig.add(buildHood());
    const rearCam = new THREE.PerspectiveCamera(13, 3, 0.5, 900);
    rearCam.position.set(0.35, 0.12, 0.4);
    rearCam.rotation.y = Math.PI;
    rig.add(rearCam);

    const rtRear = new THREE.WebGLRenderTarget(512, 170);
    rtRear.texture.repeat.set(-1, 1);
    rtRear.texture.offset.set(1, 0);
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
      const pr = renderer.getPixelRatio();
      rtRear.setSize(Math.max(2, (MR.w * W * pr) | 0), Math.max(2, (MR.h * H * pr) | 0));
    };
    const ro = new ResizeObserver(resize);
    ro.observe(mount);
    resize();

    /* ---------- Spelstatus ---------- */
    const path = C.path;
    const last = C.legs.length - 1;
    const finishS = C.sOf(last, COURSE[last].len - 20);

    type NodeRT = { i: number; L: Leg; g: LegG; boxIn: number; boxOut: number; stopLine: number; spawned: boolean; checked: boolean; exited: boolean; nav: boolean; minV: number; turnWarned: boolean };
    let nodes: NodeRT[] = [];
    let cars: Car[] = [];
    let peds: { S: number; cx: number; cz: number; r: V2; from: 1 | -1; child: boolean; offset: number; state: "wait" | "walk" | "done"; speed: number; obj: THREE.Group; legs: THREE.Mesh[]; checked: boolean }[] = [];
    let quizzes: { S: number; id: string; done: boolean }[] = [];
    let zones: { S: number; kmh: number }[] = [];
    let ambientDone: boolean[] = [];

    const P = { s: 15, v: 0, gas: 0, brake: 0, acc: 0, prevF: 0 };
    const G = {
      t: 0, running: false, paused: false, blinker: null as null | "left" | "right", blinkSince: 0, blinkWarned: false,
      head: 0, yaw: 0, wheel: 0, overT: 0, faults: [] as string[], said: new Map<string, number>(), lastPhase: 0,
      lastLimit: 50, quizRight: 0, quizTotal: 0,
    };
    const LT = { phase: "green" as "green" | "yellow" | "red", t: 0, triggered: false, stoppable: false, done: false };
    const RL = { active: false, done: false, t: 0, bell: 0 };

    /* ---------- Ljud och röst ---------- */
    let actx: AudioContext | null = null;
    let osc: OscillatorNode | null = null;
    let eng: GainNode | null = null;
    const initAudio = () => {
      try {
        if (!actx) {
          actx = new AudioContext();
          osc = actx.createOscillator(); osc.type = "sawtooth";
          const f = actx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 420;
          eng = actx.createGain(); eng.gain.value = 0;
          osc.connect(f); f.connect(eng); eng.connect(actx.destination); osc.start();
        }
        actx.resume();
      } catch { /* inget ljud */ }
    };
    const beep = (freq: number, vol = 0.03, len = 0.04) => {
      if (!actx) return;
      const t = actx.currentTime;
      const o = actx.createOscillator(); const g = actx.createGain();
      o.type = "square"; o.frequency.value = freq;
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t + len + 0.02);
    };
    const speak = (text: string) => {
      if (!settings.current.voice || !("speechSynthesis" in window)) return;
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "sv-SE"; u.rate = 1.05;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    };
    const say = (text: string, kind: MsgKind, cooldown = 8) => {
      const lastT = G.said.get(text) ?? -1e9;
      if (G.t - lastT < cooldown) return;
      G.said.set(text, G.t);
      if (kind === "bad") G.faults.push(text);
      setMsg({ text, kind, id: Math.random() });
      speak(text);
    };

    /* ---------- Trafik ---------- */
    const removeCar = (c: Car) => {
      scene.remove(c.obj);
      c.obj.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          if (m.geometry !== WHEEL_GEO) m.geometry.dispose();
          if (m.material !== WHEEL_MAT) (m.material as THREE.Material).dispose();
        }
      });
    };
    const spawnCross = (n: NodeRT, travel: V2, D0: number, role: "priority" | "yield") => {
      const p = new LanePath();
      const r = rightOf(travel);
      p.add(n.g.nx - travel[0] * D0 + r[0] * LANE, n.g.nz - travel[1] * D0 + r[1] * LANE);
      p.add(n.g.nx + travel[0] * 130 + r[0] * LANE, n.g.nz + travel[1] * 130 + r[1] * LANE);
      const m = makeCar(pick(CAR_COLORS));
      scene.add(m.obj);
      cars.push({ path: p, s: 0, v: role === "yield" ? 9 : 11, vWant: 11, len: m.len, role, node: n.i, boxIn: D0 - B, boxOut: D0 + B, obj: m.obj });
    };
    const spawnAmbient = (i: number) => {
      const g = C.legs[i];
      const travel = neg(g.dir);
      const r = rightOf(travel);
      const a = g.len - B - 2, b = g.startLocal;
      const p = new LanePath();
      p.add(g.x0 + g.dir[0] * a + r[0] * LANE, g.z0 + g.dir[1] * a + r[1] * LANE);
      p.add(g.x0 + g.dir[0] * b + r[0] * LANE, g.z0 + g.dir[1] * b + r[1] * LANE);
      const m = makeCar(pick(CAR_COLORS));
      scene.add(m.obj);
      cars.push({ path: p, s: 0, v: 12, vWant: 12, len: m.len, role: "ambient", node: -1, boxIn: 1e9, boxOut: 1e9, obj: m.obj });
    };

    const reset = () => {
      cars.forEach(removeCar);
      cars = [];
      peds.forEach((p) => scene.remove(p.obj));
      peds = [];
      nodes = C.legs.slice(0, -1).map((g, i) => ({
        i, L: COURSE[i], g, boxIn: C.boxIn[i], boxOut: C.boxOut[i], stopLine: C.sOf(i, g.len - B - 1.3),
        spawned: false, checked: false, exited: false, nav: false, minV: 99, turnWarned: false,
      }));
      quizzes = [];
      zones = [{ S: -1e9, kmh: 50 }];
      COURSE.forEach((L, i) => {
        const g = C.legs[i];
        for (const it of L.items) {
          const S = C.sOf(i, it.at);
          if (it.kind === "speed") { zones.push({ S, kmh: it.kmh }); if (it.quiz) quizzes.push({ S: S + 15, id: it.quiz, done: false }); }
          if (it.kind === "sign" && it.quiz) quizzes.push({ S: S + 15, id: it.quiz, done: false });
          if (it.kind === "crosswalk") {
            if (it.quiz) quizzes.push({ S: S + 15, id: it.quiz, done: false });
            const child = !!it.child;
            const m = makePerson(child);
            scene.add(m.obj);
            peds.push({ S, cx: g.x0 + g.dir[0] * it.at, cz: g.z0 + g.dir[1] * it.at, r: g.r, from: it.from, child, offset: it.from * 5.4, state: "wait", speed: child ? 1.6 : 1.3, obj: m.obj, legs: m.legs, checked: false });
          }
          if (it.kind === "quiz") quizzes.push({ S, id: it.quiz, done: false });
        }
        if (L.quizAfter && i < last) quizzes.push({ S: C.boxOut[i] + 20, id: L.quizAfter, done: false });
      });
      zones.sort((a, b) => a.S - b.S);
      ambientDone = C.legs.map(() => false);
      Object.assign(P, { s: 15, v: 0, gas: 0, brake: 0, acc: 0, prevF: 15 + HALF_CAR });
      Object.assign(G, {
        t: 0, paused: false, blinker: null, blinkSince: 0, blinkWarned: false, head: 0, wheel: 0, overT: 0,
        faults: [], said: new Map(), lastPhase: 0, lastLimit: 50, quizRight: 0, quizTotal: 0,
      });
      const p0 = path.at(P.s);
      G.yaw = Math.atan2(-p0.dx, -p0.dz);
      Object.assign(LT, { phase: "green", t: 0, triggered: false, stoppable: false, done: false });
      Object.assign(RL, { active: false, done: false, t: 0, bell: 0 });
      if (world.rail) world.rail.train.position.set(world.rail.cx - world.rail.r[0] * 600, 0, world.rail.cz - world.rail.r[1] * 600);
    };

    const end = (reason: string, crashed: boolean) => {
      G.running = false;
      setSummary({ reason, faults: [...G.faults], right: G.quizRight, total: G.quizTotal });
      setPhase(crashed ? "crashed" : "finished");
      speak(reason);
    };

    const start = () => {
      reset();
      G.running = true;
      setSummary(null);
      setQuiz(null);
      setPhase("running");
      initAudio();
      say("Välkommen. Vi kör genom stan. Här gäller 50 kilometer i timmen. Kör iväg när du är redo.", "info", 0);
    };

    const blink = (dir: "left" | "right") => {
      if (!G.running) return;
      G.blinker = G.blinker === dir ? null : dir;
      G.blinkSince = G.t;
      G.blinkWarned = false;
      beep(1400);
    };

    const resume = (ok: boolean) => {
      G.quizTotal++;
      if (ok) G.quizRight++;
      G.paused = false;
    };
    api.current = { start, blink, resume };

    const limitAt = (s: number) => { let k = 50; for (const z of zones) if (s >= z.S) k = z.kmh; return k; };
    const turnWord = (t: Turn) => (t === "right" ? "höger" : "vänster");

    /* ---------- Uppdatering ---------- */
    const update = (dt: number) => {
      const k = keys.current;
      G.t += dt;

      P.gas = k.up ? Math.min(1, P.gas + dt * 1.0) : Math.max(0, P.gas - dt * 2.5);
      P.brake = k.down ? Math.min(1, P.brake + dt * 2.5) : Math.max(0, P.brake - dt * 4);
      const acc = P.gas * 2.5 * Math.max(0, 1 - P.v / 30) - P.brake * 7.5 - (P.v > 0.05 ? 0.25 + 0.0004 * P.v * P.v : 0);
      P.v = Math.max(0, P.v + acc * dt);
      P.acc += (acc - P.acc) * Math.min(1, dt * 3);
      P.s = Math.min(path.total - 1, P.s + P.v * dt);
      const Sf = P.s + HALF_CAR;
      const prevF = P.prevF;
      P.prevF = Sf;
      const crossed = (line: number) => prevF < line && Sf >= line;

      G.head += ((k.lookL ? 1.35 : 0) + (k.lookR ? -1.35 : 0) - G.head) * Math.min(1, dt * 6);

      // Blinkers
      if (G.blinker) {
        const ph = Math.floor((G.t - G.blinkSince) / 0.38) % 2;
        if (ph !== G.lastPhase) { G.lastPhase = ph; beep(ph === 0 ? 1400 : 1000); }
        if (!G.blinkWarned && G.t - G.blinkSince > 15) {
          const soon = nodes.some((n) => !n.exited && n.L.turn !== "straight" && n.boxIn - Sf < 120);
          if (!soon) { G.blinkWarned = true; say("Glöm inte att slå av blinkersen.", "bad"); }
        }
      }

      // Hastighet
      const lim = limitAt(P.s);
      if (lim !== G.lastLimit) { G.lastLimit = lim; say(`Nu gäller ${lim} kilometer i timmen.`, "info", 0); }
      const kmh = P.v * 3.6;
      G.overT = kmh > lim + 3 ? G.overT + dt : G.overT < 0 ? Math.min(0, G.overT + dt) : 0;
      if (G.overT > 2.5) { say(`Du kör för fort. Här gäller ${lim} kilometer i timmen.`, "bad", 0); G.overT = -10; }

      // Mötande trafik på längre sträckor
      C.legs.forEach((g, i) => {
        if (ambientDone[i] || g.len < 200) return;
        const local = P.s - g.s0 + g.startLocal;
        if (local > g.startLocal + 10 && local < g.len - 150) { ambientDone[i] = true; spawnAmbient(i); }
      });

      // Korsningar
      for (const n of nodes) {
        const L = n.L;
        const dEntry = n.boxIn - Sf;
        if (!n.nav && dEntry < 110 && dEntry > 0) {
          n.nav = true;
          say(L.turn === "straight" ? "I nästa korsning kör vi rakt fram." : `I nästa korsning svänger vi ${turnWord(L.turn)}.`, "info", 0);
        }
        if (!n.spawned && dEntry < 70) {
          n.spawned = true;
          if (L.control !== "light") {
            const eta = Math.max(1.5, dEntry / Math.max(P.v, 6));
            const D = clamp(eta * 11 + B, 22, 85);
            if (L.cross) {
              const travel = L.cross === "right" ? neg(n.g.r) : n.g.r;
              if (L.crossYields) spawnCross(n, travel, 32, "yield");
              else spawnCross(n, travel, D, "priority");
            }
            if (L.oncoming) spawnCross(n, neg(n.g.dir), D, "priority");
          }
        }
        if (L.control === "stop" && Sf > n.stopLine - 12 && Sf <= n.stopLine + 0.5) n.minV = Math.min(n.minV, P.v);

        if (!n.checked && Sf >= n.boxIn - 0.5) {
          n.checked = true;
          if (L.turn !== "straight") {
            if (G.blinker !== L.turn) say(G.blinker ? `Fel blinkers. Du skulle blinka ${turnWord(L.turn)}.` : `Du blinkade inte innan du svängde ${turnWord(L.turn)}.`, "bad", 2);
            else if (G.t - G.blinkSince < 2) say("Blinka i god tid före svängen.", "bad", 2);
          } else if (G.blinker) say("Du blinkade men körde rakt fram. Slå av blinkersen.", "bad", 2);
          if (L.control === "stop" && n.minV > 0.4) say("Du stannade inte helt vid stopplikten.", "bad", 2);
          if (L.control === "light") {
            if (LT.phase === "red") say("Du körde mot rött ljus.", "bad", 2);
            else if (LT.phase === "yellow" && LT.stoppable) say("Gult ljus betyder stopp om du kan stanna säkert.", "bad", 2);
          }
          for (const c of cars) {
            if (c.node !== n.i || c.role !== "priority") continue;
            const front = c.s + c.len / 2;
            if (c.s - c.len / 2 > c.boxOut) continue;
            const dist = c.boxIn - front;
            const inBox = front > c.boxIn && c.s - c.len / 2 < c.boxOut;
            if (inBox || (dist > 0 && dist < c.v * 3.2 + 3)) {
              const oncoming = L.oncoming && L.turn === "left" && !L.cross;
              say(
                oncoming ? "Vid vänstersväng ska du släppa fram mötande trafik."
                  : L.control === "none" ? "Högerregeln gäller här. Du skulle ha släppt fram bilen från höger."
                  : L.control === "light" ? "Du hade inte företräde. Släpp fram trafiken som har grönt."
                  : "Du lämnade inte företräde åt korsande trafik.",
                "bad", 2
              );
              break;
            }
          }
        }
        if (L.turn !== "straight" && Sf > n.boxIn && P.s - HALF_CAR < n.boxOut && !n.turnWarned) {
          const maxK = L.turn === "right" ? 22 : 28;
          if (kmh > maxK) { n.turnWarned = true; say(`För hög fart i ${turnWord(L.turn)}svängen.`, "bad", 2); }
        }
        if (!n.exited && P.s - HALF_CAR > n.boxOut) {
          n.exited = true;
          if (L.turn !== "straight" && G.blinker === L.turn) G.blinker = null;
        }
      }

      // Trafiksignal
      const ln = nodes.find((n) => n.L.control === "light");
      if (ln && world.light) {
        const dLine = ln.stopLine - Sf;
        if (!LT.triggered && dLine < 75) {
          LT.triggered = true; LT.phase = "yellow"; LT.t = 0;
          LT.stoppable = dLine > (P.v * P.v) / 8 + P.v * 0.8;
        }
        LT.t += dt;
        if (LT.phase === "yellow" && LT.t > 3) { LT.phase = "red"; LT.t = 0; spawnCross(ln, ln.g.r, 60, "priority"); }
        else if (LT.phase === "red" && LT.t > 9) { LT.phase = "green"; LT.t = 0; if (ln.L.oncoming) spawnCross(ln, neg(ln.g.dir), 40, "priority"); }
        world.light.red.color.setHex(LT.phase === "red" ? 0xff2a1a : 0x330000);
        world.light.yellow.color.setHex(LT.phase === "yellow" ? 0xffc21a : 0x332800);
        world.light.green.color.setHex(LT.phase === "green" ? 0x22ff66 : 0x003311);
      }

      // Järnvägskorsning
      const R = world.rail;
      if (R) {
        const stopS = C.sOf(R.i, R.at - 7.0);
        const barrierS = C.sOf(R.i, R.at - 5.5);
        const crossS = C.sOf(R.i, R.at);
        if (!RL.active && !RL.done && stopS - Sf < 130) { RL.active = true; RL.t = 0; }
        let angle = -Math.PI / 2;
        let front = -600;
        if (RL.active) {
          RL.t += dt;
          const t = RL.t;
          if (t < 4) angle = -Math.PI / 2;
          else if (t < 7) angle = -Math.PI / 2 * (1 - (t - 4) / 3);
          else if (t < 18) angle = 0;
          else if (t < 21) angle = -Math.PI / 2 * ((t - 18) / 3);
          else { RL.active = false; RL.done = true; }
          front = (t - 11) * 22;
          const on = t < 20 && Math.floor(t * 2.5) % 2 === 0;
          R.lamps.forEach((m, k) => m.color.setHex(t < 20 && (k % 2 === 0) === on ? 0xff2020 : 0x330000));
          RL.bell -= dt;
          if (t < 20 && RL.bell <= 0) { RL.bell = 0.5; beep(880, 0.025, 0.12); }
          if (crossed(stopS) && t < 20) say("Stanna när ljussignalerna blinkar vid järnvägskorsningen.", "bad", 2);
          if (crossed(barrierS) && t > 5 && t < 19) { end("Du körde in i bommen vid järnvägskorsningen.", true); return; }
          if (front > -3.5 && front - 55 < 3.5 && Math.abs(P.s - crossS) < 3.5) { end("Du blev påkörd av tåget.", true); return; }
        } else R.lamps.forEach((m) => m.color.setHex(0x330000));
        R.arms.forEach((a) => (a.rotation.x = angle));
        R.train.position.set(R.cx + R.r[0] * front, 0, R.cz + R.r[1] * front);
      }

      // Gående
      for (const p of peds) {
        const dS = p.S - Sf;
        if (p.state === "wait" && ((dS < 45 && dS > 14) || (P.v < 1 && dS < 45 && dS > 0))) p.state = "walk";
        if (p.state === "walk") {
          p.offset += -p.from * p.speed * dt;
          if (-p.from * p.offset > 5.4) p.state = "done";
          const ph = Math.sin(G.t * 9);
          p.legs[0].rotation.x = ph * 0.5;
          p.legs[1].rotation.x = -ph * 0.5;
        } else p.legs.forEach((l) => (l.rotation.x = 0));
        const wx = p.r[0] * -p.from, wz = p.r[1] * -p.from;
        p.obj.position.set(p.cx + p.r[0] * p.offset, Math.abs(p.offset) > 3.5 ? 0.14 : 0, p.cz + p.r[1] * p.offset);
        p.obj.rotation.y = Math.atan2(wx, wz);
        if (!p.checked && crossed(p.S - 1.6)) {
          p.checked = true;
          if (p.state === "walk" && Math.abs(p.offset) < 5) say("Du lämnade inte företräde åt den gående på övergångsstället.", "bad", 2);
        }
        if (Math.abs(P.s - p.S) < HALF_CAR + 0.3 && p.offset > LANE - 1.2 && p.offset < LANE + 1.2) { end("Du körde på en gående.", true); return; }
      }

      // Bilar
      for (const c of cars) {
        const n = c.node >= 0 ? nodes[c.node] : null;
        const front = c.s + c.len / 2;
        let want = c.vWant;
        if (c.role === "yield" && n && !n.exited) {
          const dist = c.boxIn - 1.5 - front;
          want = dist <= 0.3 ? 0 : Math.min(c.vWant, Math.sqrt(6 * dist));
        }
        if (c.role === "priority" && n) {
          const pIn = Sf > n.boxIn && P.s - HALF_CAR < n.boxOut;
          const dc = c.boxIn - front;
          if (pIn && dc > -1 && dc < 22) want = 0;
        }
        c.v = want < c.v ? Math.max(want, c.v - 8 * dt) : Math.min(want, c.v + 2 * dt);
        c.s += c.v * dt;
        const pt = c.path.at(c.s);
        c.obj.position.set(pt.x, 0, pt.z);
        c.obj.rotation.y = Math.atan2(pt.dx, pt.dz);
      }
      cars = cars.filter((c) => {
        const keep = c.s < c.path.total - 1;
        if (!keep) removeCar(c);
        return keep;
      });

      // Krock med bil
      const pc = path.at(P.s);
      for (const c of cars) {
        const cc = c.path.at(c.s);
        if (Math.hypot(cc.x - pc.x, cc.z - pc.z) > 12) continue;
        for (let a = -1; a <= 1; a++) {
          const cp = c.path.at(c.s + (a * c.len) / 3);
          for (let b = -1; b <= 1; b++) {
            const pp = path.at(P.s + b * 1.5);
            if (Math.hypot(cp.x - pp.x, cp.z - pp.z) < 1.75) { end("Du krockade med en annan bil.", true); return; }
          }
        }
      }

      // Teorifrågor
      if (settings.current.quiz) {
        for (const q of quizzes) {
          if (!q.done && P.s > q.S) {
            q.done = true;
            const quizObj = QUIZ[q.id];
            if (quizObj) {
              G.paused = true;
              setQuizPick(null);
              setQuiz(quizObj);
            }
            break;
          }
        }
      }

      if (P.s > finishS) end("Körlektionen är slut. Bra jobbat!", false);
    };

    /* ---------- Kamera och instrument ---------- */
    const place = (dt: number) => {
      const p = path.at(P.s);
      const target = Math.atan2(-p.dx, -p.dz);
      let diff = target - G.yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      G.yaw += diff * Math.min(1, dt * 8);
      const ex = p.x + p.dz * 0.35, ez = p.z - p.dx * 0.35;
      rig.position.set(ex, EYE_H + (G.running && P.v > 1 ? (Math.random() - 0.5) * 0.003 : 0), ez);
      rig.rotation.set(0, G.yaw, 0);
      camera.rotation.set(clamp(P.acc * 0.006, -0.05, 0.03), G.head, 0, "YXZ");
      const b = path.at(P.s + 4);
      const cross = p.dx * b.dz - p.dz * b.dx;
      G.wheel += (clamp((Math.asin(clamp(cross, -1, 1)) * 180) / Math.PI * 5, -360, 360) - G.wheel) * Math.min(1, dt * 5);
    };

    const hud = () => {
      const kmh = P.v * 3.6;
      needleRef.current?.setAttribute("transform", `rotate(${-120 + (Math.min(120, kmh) / 120) * 240} 50 50)`);
      if (speedRef.current) speedRef.current.textContent = String(Math.round(kmh));
      wheelRef.current?.setAttribute("transform", `rotate(${G.wheel} 50 50)`);
      if (limitRef.current) limitRef.current.textContent = String(limitAt(P.s));
      const on = !!G.blinker && Math.floor((G.t - G.blinkSince) / 0.38) % 2 === 0;
      if (blinkLRef.current) blinkLRef.current.style.opacity = G.blinker === "left" && on ? "1" : "0.15";
      if (blinkRRef.current) blinkRRef.current.style.opacity = G.blinker === "right" && on ? "1" : "0.15";
      if (btnLRef.current) btnLRef.current.style.background = G.blinker === "left" ? (on ? "#f59e0b" : "#b45309") : "rgba(30,30,34,0.85)";
      if (btnRRef.current) btnRRef.current.style.background = G.blinker === "right" ? (on ? "#f59e0b" : "#b45309") : "rgba(30,30,34,0.85)";
      const vis = String(clamp(1 - (Math.abs(G.head) - 0.3) * 2, 0, 1));
      if (dashRef.current) dashRef.current.style.opacity = vis;
      if (frameRef.current) frameRef.current.style.opacity = vis;

      const Sf = P.s + HALF_CAR;
      const next = nodes.find((n) => !n.exited);
      if (navRef.current && navTextRef.current && navArrowRef.current) {
        if (next && G.running) {
          const d = Math.max(0, Math.round((next.boxIn - Sf) / 10) * 10);
          navRef.current.style.display = d < 250 ? "flex" : "none";
          navTextRef.current.textContent = next.L.turn === "straight" ? `Rakt fram om ${d} m` : `Sväng ${turnWord(next.L.turn)} om ${d} m`;
          navArrowRef.current.style.transform = `rotate(${next.L.turn === "right" ? 90 : next.L.turn === "left" ? -90 : 0}deg)`;
        } else if (G.running) {
          const d = Math.max(0, Math.round((finishS - P.s) / 10) * 10);
          navRef.current.style.display = "flex";
          navTextRef.current.textContent = `Mål om ${d} m`;
          navArrowRef.current.style.transform = "rotate(0deg)";
        } else navRef.current.style.display = "none";
      }

      if (actx && osc && eng) {
        const band = 20;
        const frac = (kmh % band) / band;
        osc.frequency.setTargetAtTime(30 + frac * 35 + P.gas * 10 + Math.floor(kmh / band) * 2, actx.currentTime, 0.08);
        eng.gain.setTargetAtTime(G.running && !G.paused ? 0.02 + P.gas * 0.02 : 0, actx.currentTime, 0.2);
      }
    };

    const render = () => {
      const showM = Math.abs(G.head) < 0.5;
      renderer.setScissorTest(false);
      if (showM) { renderer.setRenderTarget(rtRear); renderer.render(scene, rearCam); renderer.setRenderTarget(null); }
      renderer.setViewport(0, 0, W, H);
      renderer.render(scene, camera);
      if (showM) {
        renderer.autoClear = false;
        renderer.setScissorTest(true);
        const x = MR.x * W, y = H - (MR.y + MR.h) * H, w = MR.w * W, h = MR.h * H;
        renderer.setViewport(x, y, w, h);
        renderer.setScissor(x, y, w, h);
        renderer.render(quadScene, quadCam);
        renderer.setScissorTest(false);
        renderer.autoClear = true;
        renderer.setViewport(0, 0, W, H);
      }
    };

    /* ---------- Tangentbord ---------- */
    const map: Record<string, keyof Keys> = {
      ArrowUp: "up", KeyW: "up", ArrowDown: "down", KeyS: "down",
      ArrowLeft: "lookL", KeyA: "lookL", ArrowRight: "lookR", KeyD: "lookR",
    };
    const kd = (e: KeyboardEvent) => {
      if (map[e.code]) { e.preventDefault(); keys.current[map[e.code]] = true; }
      if (e.repeat) return;
      if (e.code === "KeyQ") blink("left");
      if (e.code === "KeyE") blink("right");
      if (e.code === "Enter" && !G.running) start();
    };
    const ku = (e: KeyboardEvent) => { if (map[e.code]) keys.current[map[e.code]] = false; };
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);

    reset();
    let raf = 0;
    let lastT = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - lastT) / 1000);
      lastT = now;
      if (G.running && !G.paused) update(dt);
      place(dt);
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
      rtRear.dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, []);

  const hold = (k: keyof Keys) => ({
    onPointerDown: (e: React.PointerEvent) => { e.preventDefault(); keys.current[k] = true; },
    onPointerUp: () => { keys.current[k] = false; },
    onPointerLeave: () => { keys.current[k] = false; },
    onPointerCancel: () => { keys.current[k] = false; },
  });

  const faultCounts = summary
    ? Object.entries(summary.faults.reduce<Record<string, number>>((acc, f) => { acc[f] = (acc[f] || 0) + 1; return acc; }, {}))
    : [];
  const ticks = Array.from({ length: 13 }, (_, i) => i * 10);

  return (
    <div className="fixed inset-0 bg-black overflow-hidden select-none text-white">
      <div ref={mountRef} className="absolute inset-0" />

      {/* Bilens ram och backspegel */}
      <div ref={frameRef} className="pointer-events-none absolute inset-0">
        <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
          <rect x="0" y="0" width="100" height="3" fill="#0b0c0e" />
          <polygon points="0,0 7,0 2.5,58 0,64" fill="#0b0c0e" />
          <polygon points="100,0 96,0 99.5,52 100,55" fill="#0b0c0e" />
        </svg>
        <div className="absolute" style={{ left: `${(MR.x + MR.w / 2) * 100}%`, top: 0, width: 8, marginLeft: -4, height: `${MR.y * 100}%`, background: "#111" }} />
        <div className="absolute rounded-md" style={{ left: `${MR.x * 100}%`, top: `${MR.y * 100}%`, width: `${MR.w * 100}%`, height: `${MR.h * 100}%`, boxShadow: "0 0 0 5px #121212, 0 6px 14px rgba(0,0,0,.5)" }} />
      </div>

      {/* Navigering */}
      <div ref={navRef} className="pointer-events-none absolute left-3 top-3 hidden items-center gap-2 rounded-xl bg-slate-900/85 px-3 py-2 text-sm font-semibold shadow-lg">
        <svg ref={navArrowRef} viewBox="0 0 24 24" className="h-6 w-6 transition-transform">
          <path d="M12 3 L19 11 H14 V21 H10 V11 H5 Z" fill="#38bdf8" />
        </svg>
        <span ref={navTextRef} />
      </div>

      {/* Instrumentbräda */}
      <div ref={dashRef} className="pointer-events-none absolute inset-x-0 bottom-0" style={{ height: "28%" }}>
        <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
          <path d="M0,22 Q50,0 100,22 L100,100 L0,100 Z" fill="#141518" />
          <path d="M0,22 Q50,0 100,22" stroke="#2a2c31" strokeWidth="1.2" fill="none" />
        </svg>
        <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-3" style={{ bottom: "4vh", height: "18vh" }}>
          <svg ref={blinkLRef} viewBox="0 0 20 20" style={{ width: "4vh", opacity: 0.15 }}>
            <polygon points="2,10 11,3 11,7 18,7 18,13 11,13 11,17" fill="#22c55e" />
          </svg>
          <svg viewBox="0 0 100 100" style={{ height: "18vh", width: "18vh" }}>
            <circle cx="50" cy="50" r="47" fill="#0a0b0d" stroke="#2d3036" strokeWidth="2" />
            {ticks.map((k) => {
              const a = ((-120 + (k / 120) * 240) * Math.PI) / 180;
              const major = k % 20 === 0;
              const r1 = major ? 37 : 40;
              return (
                <g key={k}>
                  <line x1={50 + r1 * Math.sin(a)} y1={50 - r1 * Math.cos(a)} x2={50 + 44 * Math.sin(a)} y2={50 - 44 * Math.cos(a)} stroke="#d9dde3" strokeWidth={major ? 1.6 : 0.8} />
                  {major && <text x={50 + 30 * Math.sin(a)} y={50 - 30 * Math.cos(a) + 2.5} fill="#d9dde3" fontSize="7" textAnchor="middle" fontFamily="system-ui">{k}</text>}
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
              <span ref={limitRef}>50</span>
            </div>
          </div>
          <svg ref={blinkRRef} viewBox="0 0 20 20" style={{ width: "4vh", opacity: 0.15 }}>
            <polygon points="18,10 9,3 9,7 2,7 2,13 9,13 9,17" fill="#22c55e" />
          </svg>
        </div>
        <div className="absolute left-1/2 -translate-x-1/2" style={{ width: "62vh", height: "62vh", bottom: "-31vh" }}>
          <svg viewBox="0 0 100 100" className="w-full h-full">
            <g ref={wheelRef}>
              <circle cx="50" cy="50" r="45" fill="none" stroke="#1b1c1f" strokeWidth="7" />
              <rect x="10" y="47" width="28" height="6" rx="3" fill="#1b1c1f" />
              <rect x="62" y="47" width="28" height="6" rx="3" fill="#1b1c1f" />
              <circle cx="50" cy="50" r="11" fill="#222428" stroke="#33363c" />
            </g>
          </svg>
        </div>
      </div>

      {/* Blinkersknappar, alltid synliga */}
      {phase === "running" && (
        <>
          <button
            ref={btnLRef}
            onClick={() => api.current?.blink("left")}
            className="absolute left-3 rounded-2xl px-4 py-3 text-left font-semibold shadow-xl border border-white/20"
            style={{ bottom: "30%" }}
          >
            <div className="text-lg">⬅ Blinkers vänster</div>
            <div className="text-xs opacity-70">Tangent Q</div>
          </button>
          <button
            ref={btnRRef}
            onClick={() => api.current?.blink("right")}
            className="absolute right-3 rounded-2xl px-4 py-3 text-right font-semibold shadow-xl border border-white/20"
            style={{ bottom: "30%" }}
          >
            <div className="text-lg">Blinkers höger ➡</div>
            <div className="text-xs opacity-70">Tangent E</div>
          </button>
          {!touch && (
            <div className="pointer-events-none absolute right-3 top-3 rounded-xl bg-slate-900/80 px-3 py-2 text-xs leading-relaxed">
              ↑ gas · ↓ broms<br />← → titta åt sidan<br />Q / E blinkers
            </div>
          )}
        </>
      )}

      {/* Pekskärm */}
      {touch && phase === "running" && (
        <>
          <div className="absolute left-3 bottom-3 flex gap-2">
            <button {...hold("lookL")} className="touch-none w-16 h-14 rounded-2xl bg-white/15 text-sm">Titta ◀</button>
            <button {...hold("lookR")} className="touch-none w-16 h-14 rounded-2xl bg-white/15 text-sm">▶ Titta</button>
          </div>
          <div className="absolute right-3 bottom-3 flex gap-2">
            <button {...hold("down")} className="touch-none w-16 h-16 rounded-2xl bg-red-600/60 font-semibold">Broms</button>
            <button {...hold("up")} className="touch-none w-16 h-20 rounded-2xl bg-green-600/60 font-semibold">Gas</button>
          </div>
        </>
      )}

      {/* Körläraren */}
      {msg && phase === "running" && !quiz && (
        <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 max-w-[90%]" style={{ top: "17%" }}>
          <div className={`rounded-xl px-4 py-3 text-sm md:text-base shadow-xl border-l-4 ${msg.kind === "bad" ? "bg-red-950/90 border-red-500" : msg.kind === "good" ? "bg-green-950/90 border-green-500" : "bg-slate-900/90 border-sky-400"}`}>
            <span className="font-semibold opacity-80">Körläraren: </span>{msg.text}
          </div>
        </div>
      )}

      {/* Teorifråga */}
      {quiz && phase === "running" && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl bg-slate-900 p-5 space-y-4 shadow-2xl">
            <div className="text-xs font-semibold uppercase tracking-wide text-sky-300">Teorifråga</div>
            {quiz.sign && <img src={signImages[quiz.sign]} alt="" className="mx-auto h-28 w-28 object-contain" />}
            <p className="font-semibold">{quiz.q}</p>
            <div className="space-y-2">
              {quiz.options.map((o, i) => {
                const picked = quizPick !== null;
                const style = !picked ? "bg-slate-800 hover:bg-slate-700"
                  : i === quiz.correct ? "bg-green-700"
                  : i === quizPick ? "bg-red-700" : "bg-slate-800 opacity-60";
                return (
                  <button key={i} disabled={picked} onClick={() => setQuizPick(i)} className={`w-full rounded-xl px-4 py-3 text-left text-sm ${style}`}>
                    {o}
                  </button>
                );
              })}
            </div>
            {quizPick !== null && (
              <>
                <p className="text-sm text-slate-300">{quiz.explain}</p>
                <button
                  onClick={() => { api.current?.resume(quizPick === quiz.correct); setQuiz(null); }}
                  className="w-full rounded-xl bg-blue-600 hover:bg-blue-500 py-3 font-semibold"
                >
                  Fortsätt köra
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Start och resultat */}
      {phase !== "running" && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/70 p-4 overflow-y-auto">
          <div className="w-full max-w-lg rounded-2xl bg-slate-900 p-6 space-y-4 shadow-2xl">
            {phase === "start" ? (
              <>
                <h1 className="text-2xl font-bold">Övningskörning inför körkortet</h1>
                <p className="text-sm text-slate-300">
                  Du kör en lektionsrunda genom stan med korsningar, vägmärken, övergångsställen, trafiksignal och järnvägskorsning. Ratten sköts automatiskt så att du kan fokusera på trafikreglerna. Körläraren säger till när något blir fel, och efter viktiga skyltar får du teorifrågor som på provet.
                </p>
                <div className="rounded-xl bg-slate-800 p-3 text-sm space-y-1">
                  <p><b>↑ / ↓</b> gas och broms</p>
                  <p><b>Q</b> blinkers vänster · <b>E</b> blinkers höger (eller de stora knapparna på skärmen)</p>
                  <p><b>← / →</b> titta åt vänster och höger i korsningar</p>
                  <p>Navigeringen uppe till vänster visar var du ska svänga.</p>
                </div>
                <div className="flex flex-wrap gap-4 text-sm">
                  <label className="flex items-center gap-2"><input type="checkbox" checked={voice} onChange={(e) => setVoice(e.target.checked)} /> Körlärarens röst</label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={quizOn} onChange={(e) => setQuizOn(e.target.checked)} /> Teorifrågor under körningen</label>
                </div>
              </>
            ) : (
              <>
                <h2 className={`text-xl font-bold ${phase === "crashed" ? "text-red-400" : "text-green-400"}`}>{summary?.reason}</h2>
                <div className="grid grid-cols-2 gap-2 text-center">
                  <div className="rounded-xl bg-slate-800 p-3"><div className="text-2xl font-bold">{summary?.faults.length}</div><div className="text-xs text-slate-400">körfel</div></div>
                  <div className="rounded-xl bg-slate-800 p-3"><div className="text-2xl font-bold">{summary?.right}/{summary?.total}</div><div className="text-xs text-slate-400">rätt på teorifrågor</div></div>
                </div>
                {faultCounts.length > 0 ? (
                  <ul className="text-sm text-slate-300 space-y-1">
                    {faultCounts.map(([f, n]) => <li key={f}>• {f}{n > 1 ? ` (${n} gånger)` : ""}</li>)}
                  </ul>
                ) : (
                  <p className="text-sm text-slate-300">Inga körfel. Snyggt kört!</p>
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