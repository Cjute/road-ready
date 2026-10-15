import { useEffect, useRef, useState } from "react";

type Kind = "slow" | "oncoming";
type Blinker = "left" | "right" | null;
type Phase = "start" | "running" | "crashed";

interface Vehicle { id: number; kind: Kind; x: number; y: number; v: number; w: number; l: number; color: string; }
interface Zone { top: number; bottom: number; }
interface Msg { text: string; good: boolean; t: number; }
interface Keys { up: boolean; down: boolean; left: boolean; right: boolean; }
interface Game {
  x: number; v: number; blinker: Blinker; vehicles: Vehicle[]; zones: Zone[]; scroll: number;
  inLeft: boolean; aheadAtExit: number[]; overtakes: number; penalties: number; msgs: Msg[];
  oncomingTimer: number; zoneTimer: number; nextId: number; closeT: number; speedT: number;
  time: number; crash: string; tooClose: boolean; speeding: boolean;
}

const W = 420, H = 760, PX = 5;
const LANE = 90, ROAD_X = (W - LANE * 2) / 2, CENTER = ROAD_X + LANE;
const LEFT_X = ROAD_X + LANE / 2, RIGHT_X = ROAD_X + LANE * 1.5;
const CAR_W = 44, CAR_L = 80, PLAYER_Y = H - 150, LIMIT = 80;

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

const newGame = (): Game => ({
  x: RIGHT_X, v: 60, blinker: null, vehicles: [], zones: [], scroll: 0, inLeft: false, aheadAtExit: [],
  overtakes: 0, penalties: 0, msgs: [], oncomingTimer: 4, zoneTimer: 10, nextId: 1, closeT: 0, speedT: 0,
  time: 0, crash: "", tooClose: false, speeding: false,
});

function say(g: Game, text: string, good = false) {
  g.msgs.push({ text, good, t: g.time });
  if (!good) g.penalties++;
}

const onSolid = (g: Game) => g.zones.some((z) => PLAYER_Y >= z.top && PLAYER_Y <= z.bottom);

function update(g: Game, dt: number, k: Keys) {
  g.time += dt;
  if (k.up) g.v += 15 * dt; else if (k.down) g.v -= 35 * dt; else g.v -= 2 * dt;
  g.v = clamp(g.v, 0, 130);

  const steer = 120 * dt * Math.min(1, g.v / 30);
  if (k.left) g.x -= steer;
  if (k.right) g.x += steer;
  g.x = clamp(g.x, ROAD_X + CAR_W / 2 + 3, ROAD_X + LANE * 2 - CAR_W / 2 - 3);

  const move = (g.v / 3.6) * PX * dt;
  g.scroll += move;
  g.zones.forEach((z) => { z.top += move; z.bottom += move; });
  g.zones = g.zones.filter((z) => z.top < H + 50);

  for (const v of g.vehicles) {
    const rel = v.kind === "slow" ? g.v - v.v : g.v + v.v;
    v.y += (rel / 3.6) * PX * dt;
  }
  g.vehicles = g.vehicles.filter((v) => v.y < H + 300 && v.y > -6000);

  if (!g.vehicles.some((v) => v.kind === "slow" && v.y < PLAYER_Y)) {
    const truck = Math.random() < 0.5;
    g.vehicles.push({
      id: g.nextId++, kind: "slow", x: RIGHT_X, y: -rand(200, 700),
      v: truck ? rand(55, 65) : rand(40, 55), w: truck ? 52 : 46, l: truck ? 140 : 80,
      color: truck ? "#d97706" : "#16a34a",
    });
  }

  g.oncomingTimer -= dt;
  if (g.oncomingTimer <= 0) {
    const colors = ["#dc2626", "#7c3aed", "#0f172a", "#e5e7eb", "#0891b2"];
    g.vehicles.push({
      id: g.nextId++, kind: "oncoming", x: LEFT_X, y: PLAYER_Y - rand(300, 700) * PX,
      v: rand(70, 90), w: 46, l: 80, color: colors[Math.floor(Math.random() * colors.length)],
    });
    g.oncomingTimer = rand(4, 10);
  }

  g.zoneTimer -= dt;
  if (g.zoneTimer <= 0) {
    const bottom = -rand(50, 150) * PX;
    g.zones.push({ bottom, top: bottom - rand(150, 300) * PX });
    g.zoneTimer = rand(18, 30);
  }

  const nowLeft = g.x < CENTER;
  if (nowLeft && !g.inLeft) {
    g.inLeft = true;
    if (g.blinker !== "left") say(g, "Du blinkade inte vänster innan du svängde ut");
    if (onSolid(g)) say(g, "Du korsade heldragen linje");
    g.aheadAtExit = g.vehicles.filter((v) => v.kind === "slow" && v.y < PLAYER_Y).map((v) => v.id);
    g.blinker = null;
  }
  if (!nowLeft && g.inLeft) {
    g.inLeft = false;
    if (g.blinker !== "right") say(g, "Du blinkade inte höger när du svängde in");
    if (onSolid(g)) say(g, "Du korsade heldragen linje");
    const passed = g.vehicles.filter((v) => g.aheadAtExit.includes(v.id) && v.y > PLAYER_Y).length;
    const cutIn = g.vehicles.some(
      (v) => v.kind === "slow" && v.y > PLAYER_Y && (v.y - v.l / 2 - (PLAYER_Y + CAR_L / 2)) / PX < 12
    );
    if (cutIn) say(g, "Du svängde in för tätt framför fordonet");
    if (passed > 0) { g.overtakes += passed; if (!cutIn) say(g, "Bra omkörning!", true); }
    g.aheadAtExit = [];
    g.blinker = null;
  }

  const gaps = g.vehicles
    .filter((v) => v.kind === "slow" && v.y < PLAYER_Y && Math.abs(v.x - g.x) < (v.w + CAR_W) / 2)
    .map((v) => (PLAYER_Y - CAR_L / 2 - (v.y + v.l / 2)) / PX);
  const gap = gaps.length ? Math.min(...gaps) : Infinity;
  g.tooClose = g.v > 20 && gap < (g.v / 3.6) * 2;
  g.closeT = g.tooClose ? g.closeT + dt : g.closeT < 0 ? Math.min(0, g.closeT + dt) : 0;
  if (g.closeT > 3) { say(g, "För kort avstånd, håll minst 2 sekunder"); g.closeT = -8; }

  g.speeding = g.v > LIMIT + 3;
  g.speedT = g.speeding ? g.speedT + dt : g.speedT < 0 ? Math.min(0, g.speedT + dt) : 0;
  if (g.speedT > 3) { say(g, `Du kör för fort, gränsen är ${LIMIT} km/h`); g.speedT = -8; }

  for (const v of g.vehicles) {
    if (Math.abs(v.x - g.x) < (v.w + CAR_W) / 2 - 4 && Math.abs(v.y - PLAYER_Y) < (v.l + CAR_L) / 2 - 4) {
      g.crash = v.kind === "oncoming" ? "Frontalkrock med mötande bil" : "Du körde in i fordonet framför";
    }
  }
}

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawVehicle(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, l: number, color: string, facingUp: boolean) {
  const x = cx - w / 2, y = cy - l / 2;
  ctx.fillStyle = "rgba(0,0,0,0.25)"; rr(ctx, x + 3, y + 4, w, l, 8); ctx.fill();
  ctx.fillStyle = color; rr(ctx, x, y, w, l, 8); ctx.fill();
  ctx.fillStyle = "rgba(15,23,42,0.75)";
  const front = facingUp ? y + l * 0.15 : y + l * 0.71;
  const rear = facingUp ? y + l * 0.76 : y + l * 0.14;
  rr(ctx, x + 5, front, w - 10, l * 0.14, 4); ctx.fill();
  rr(ctx, x + 6, rear, w - 12, l * 0.1, 3); ctx.fill();
}

function draw(ctx: CanvasRenderingContext2D, g: Game) {
  ctx.fillStyle = "#4d7c0f"; ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = "#e5e7eb";
  const off = g.scroll % 120;
  for (let y = -120 + off; y < H; y += 120) {
    ctx.fillRect(ROAD_X - 18, y, 4, 14);
    ctx.fillRect(ROAD_X + LANE * 2 + 14, y, 4, 14);
  }

  ctx.fillStyle = "#374151"; ctx.fillRect(ROAD_X, 0, LANE * 2, H);
  ctx.fillStyle = "#f9fafb";
  ctx.fillRect(ROAD_X + 4, 0, 3, H);
  ctx.fillRect(ROAD_X + LANE * 2 - 7, 0, 3, H);

  const d = g.scroll % 50;
  for (let y = -50 + d; y < H; y += 50) {
    const mid = y + 12;
    if (!g.zones.some((z) => mid >= z.top && mid <= z.bottom)) ctx.fillRect(CENTER - 2, y, 4, 24);
  }
  for (const z of g.zones) {
    const t = Math.max(0, z.top), b = Math.min(H, z.bottom);
    if (b > t) ctx.fillRect(CENTER - 2, t, 4, b - t);
  }

  ctx.font = "bold 12px system-ui, sans-serif";
  ctx.textAlign = "left";
  for (const z of g.zones) {
    const sy = z.bottom + 30;
    if (sy > 0 && sy < H) {
      ctx.fillStyle = "#facc15"; rr(ctx, ROAD_X + LANE * 2 + 24, sy - 14, 86, 22, 4); ctx.fill();
      ctx.fillStyle = "#111827"; ctx.fillText("Heldragen", ROAD_X + LANE * 2 + 34, sy + 2);
    }
  }

  for (const v of g.vehicles) drawVehicle(ctx, v.x, v.y, v.w, v.l, v.color, v.kind === "slow");

  drawVehicle(ctx, g.x, PLAYER_Y, CAR_W, CAR_L, "#2563eb", true);
  if (g.blinker && Math.floor(g.time * 2.5) % 2 === 0) {
    ctx.fillStyle = "#f59e0b";
    const bx = g.blinker === "left" ? g.x - CAR_W / 2 - 2 : g.x + CAR_W / 2 - 6;
    ctx.fillRect(bx, PLAYER_Y - CAR_L / 2 + 2, 8, 8);
    ctx.fillRect(bx, PLAYER_Y + CAR_L / 2 - 10, 8, 8);
  }

  ctx.fillStyle = "rgba(15,23,42,0.85)"; ctx.fillRect(0, 0, W, 64);
  ctx.fillStyle = g.speeding ? "#f87171" : "#f9fafb";
  ctx.font = "bold 28px system-ui, sans-serif"; ctx.textAlign = "left";
  ctx.fillText(`${Math.round(g.v)} km/h`, 14, 40);
  ctx.font = "13px system-ui, sans-serif"; ctx.fillStyle = "#cbd5e1";
  ctx.fillText(`Omkörningar: ${g.overtakes}`, 170, 26);
  ctx.fillText(`Felpoäng: ${g.penalties}`, 170, 46);

  ctx.beginPath(); ctx.arc(W - 34, 32, 22, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff"; ctx.fill();
  ctx.lineWidth = 5; ctx.strokeStyle = "#dc2626"; ctx.stroke();
  ctx.fillStyle = "#111827"; ctx.font = "bold 16px system-ui, sans-serif"; ctx.textAlign = "center";
  ctx.fillText(String(LIMIT), W - 34, 38);

  const hidden = g.vehicles.filter((v) => v.kind === "oncoming" && v.y < 64).map((v) => (PLAYER_Y - v.y) / PX);
  if (hidden.length) {
    const dist = Math.min(...hidden);
    ctx.fillStyle = "rgba(220,38,38,0.9)"; rr(ctx, ROAD_X + 4, 72, LANE - 8, 24, 6); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.font = "bold 12px system-ui, sans-serif";
    ctx.fillText(`▼ Möte ${Math.round(dist)} m`, LEFT_X, 89);
  }

  ctx.font = "bold 13px system-ui, sans-serif";
  if (g.tooClose) { ctx.fillStyle = "#fbbf24"; ctx.fillText("Håll avstånd", g.x, PLAYER_Y + CAR_L / 2 + 22); }

  const recent = g.msgs.filter((m) => g.time - m.t < 3).slice(-3);
  recent.forEach((m, i) => {
    const y = 130 + i * 34;
    ctx.font = "bold 14px system-ui, sans-serif";
    const tw = ctx.measureText(m.text).width + 24;
    ctx.fillStyle = m.good ? "rgba(22,163,74,0.92)" : "rgba(220,38,38,0.92)";
    rr(ctx, W / 2 - tw / 2, y - 18, tw, 28, 8); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.fillText(m.text, W / 2, y + 1);
  });
}

function HoldButton({ label, onChange, className = "" }: { label: string; onChange: (down: boolean) => void; className?: string }) {
  return (
    <button
      className={`select-none touch-none rounded-xl bg-slate-700 active:bg-slate-500 py-4 text-lg font-semibold ${className}`}
      onPointerDown={(e) => { e.preventDefault(); onChange(true); }}
      onPointerUp={() => onChange(false)}
      onPointerLeave={() => onChange(false)}
      onPointerCancel={() => onChange(false)}
    >
      {label}
    </button>
  );
}

export default function Index() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game>(newGame());
  const keys = useRef<Keys>({ up: false, down: false, left: false, right: false });
  const phaseRef = useRef<Phase>("start");
  const [phase, setPhase] = useState<Phase>("start");
  const [result, setResult] = useState({ overtakes: 0, penalties: 0, reason: "" });
  const [blinker, setBlinker] = useState<Blinker>(null);

  const start = () => {
    gameRef.current = newGame();
    keys.current = { up: false, down: false, left: false, right: false };
    phaseRef.current = "running";
    setPhase("running");
  };

  const toggleBlinker = (dir: "left" | "right") => {
    const g = gameRef.current;
    g.blinker = g.blinker === dir ? null : dir;
  };

  useEffect(() => {
    const map: Record<string, keyof Keys> = {
      ArrowUp: "up", KeyW: "up", ArrowDown: "down", KeyS: "down",
      ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right",
    };
    const down = (e: KeyboardEvent) => {
      if (map[e.code]) { e.preventDefault(); keys.current[map[e.code]] = true; }
      if (e.code === "KeyQ") toggleBlinker("left");
      if (e.code === "KeyE") toggleBlinker("right");
      if ((e.code === "Space" || e.code === "Enter") && phaseRef.current !== "running") { e.preventDefault(); start(); }
    };
    const up = (e: KeyboardEvent) => { if (map[e.code]) keys.current[map[e.code]] = false; };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, []);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let last = performance.now();
    const loop = (t: number) => {
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      const g = gameRef.current;
      if (phaseRef.current === "running") {
        update(g, dt, keys.current);
        if (g.crash) {
          phaseRef.current = "crashed";
          setPhase("crashed");
          setResult({ overtakes: g.overtakes, penalties: g.penalties, reason: g.crash });
        }
      }
      setBlinker((b) => (b === g.blinker ? b : g.blinker));
      draw(ctx, g);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const setKey = (k: keyof Keys) => (v: boolean) => { keys.current[k] = v; };

  return (
    <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center p-4 gap-4">
      <h1 className="text-2xl font-bold">Körsimulator: öva omkörning</h1>

      <div className="relative">
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          className="rounded-2xl shadow-2xl"
          style={{ height: "min(72vh, 760px)", maxWidth: "100%", aspectRatio: `${W} / ${H}`, objectFit: "contain" }}
        />
        {phase !== "running" && (
          <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-slate-900/80 p-6">
            <div className="text-center space-y-4 max-w-xs">
              {phase === "start" ? (
                <>
                  <h2 className="text-xl font-bold">Kör om säkert</h2>
                  <ul className="text-sm text-slate-300 text-left space-y-1 list-disc pl-4">
                    <li>Håll 2 sekunders avstånd bakom fordonet framför</li>
                    <li>Blinka vänster (Q) innan du svänger ut</li>
                    <li>Kolla mötande trafik, den röda rutan visar avståndet</li>
                    <li>Blinka höger (E) och sväng in med god marginal</li>
                    <li>Kör aldrig om vid heldragen linje</li>
                    <li>Håll dig under {LIMIT} km/h</li>
                  </ul>
                  <p className="text-xs text-slate-400">Piltangenter eller WASD för gas, broms och styrning</p>
                </>
              ) : (
                <>
                  <h2 className="text-xl font-bold text-red-400">{result.reason}</h2>
                  <p>Omkörningar: {result.overtakes}</p>
                  <p>Felpoäng: {result.penalties}</p>
                </>
              )}
              <button onClick={start} className="rounded-xl bg-blue-600 hover:bg-blue-500 px-6 py-3 font-semibold">
                {phase === "start" ? "Starta" : "Försök igen"}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-4 gap-2 w-full max-w-md">
        <button
          onClick={() => toggleBlinker("left")}
          className={`rounded-xl py-3 font-semibold ${blinker === "left" ? "bg-amber-500 text-black" : "bg-slate-700"}`}
        >
          ⇦ Blinka
        </button>
        <HoldButton label="Gas" onChange={setKey("up")} className="col-span-2 bg-green-700 active:bg-green-600" />
        <button
          onClick={() => toggleBlinker("right")}
          className={`rounded-xl py-3 font-semibold ${blinker === "right" ? "bg-amber-500 text-black" : "bg-slate-700"}`}
        >
          Blinka ⇨
        </button>
        <HoldButton label="◀" onChange={setKey("left")} />
        <HoldButton label="Broms" onChange={setKey("down")} className="col-span-2 bg-red-700 active:bg-red-600" />
        <HoldButton label="▶" onChange={setKey("right")} />
      </div>
    </div>
  );
}