// Hook để test logic bằng dữ liệu tay giả, chỉ nạp khi chạy vite dev với ?debug.
// Thêm &auto=result|play&mode=single|double|random&lang=vi để nhảy thẳng tới một màn hình.
import type { GameEngine } from "./GameEngine";
import { MODES, type Duration, type Landmarks, type Mode } from "./types";

interface AppControls {
  setMode: (mode: Mode) => void;
  setDuration: (duration: Duration) => void;
}

declare global {
  interface Window {
    __amb?: unknown;
  }
}

/** Tay nắm giả: cổ tay bên trái, các khớp xếp dọc theo trục trụ nghiêng `tilt` */
function fakeHand(aspect: number, cx: number, cy: number, tilt: number): Landmarks {
  const rot = (dx: number, dy: number) => ({
    x: cx + (dx * Math.cos(tilt) - dy * Math.sin(tilt)) / aspect,
    y: cy + dx * Math.sin(tilt) + dy * Math.cos(tilt),
    z: 0,
    visibility: 1,
  });
  const lm = Array.from({ length: 21 }, () => rot(0, 0));
  lm[0] = rot(-0.14, 0);
  for (const [m, dy, tip] of [
    [5, -0.05, 8],
    [9, -0.015, 12],
    [13, 0.02, 16],
    [17, 0.055, 20],
  ]) {
    lm[m] = rot(-0.007, dy);
    lm[m + 1] = rot(0.007, dy); // khớp giữa ngón
    lm[tip] = rot(0.007, dy);
  }
  return lm;
}

export function installDebug(engine: GameEngine, params: URLSearchParams, app: AppControls): void {
  if (window.__amb) return; // StrictMode chạy effect hai lần: chỉ cài và tự chạy một lần
  const aspect = () => engine.ui.get().aspect ?? 640 / 480;
  window.__amb = {
    engine,
    processFrame: engine.processFrame.bind(engine),
    useFakeCamera: () => engine.fakeCamera(),
    setMode: (m: Mode) => {
      app.setMode(m);
      engine.config = { ...engine.config, mode: m };
    },
    fakeHand: (cx: number, cy: number, tilt: number) => fakeHand(aspect(), cx, cy, tilt),
    get phase() {
      return engine.phase;
    },
    get count() {
      return engine.run.count;
    },
    get counts() {
      return engine.tracks.map((x) => x.count);
    },
    get anchors() {
      return engine.tracks.map((x) => x.anchor);
    },
    get onRod() {
      return engine.tracks.map((x) => x.onRod);
    },
    get meter() {
      return engine.run.meter;
    },
    get rods() {
      return engine.run.rodsCaught;
    },
    diag: engine.diag,
  };

  const auto = params.get("auto");
  if (auto !== "result" && auto !== "play" && auto !== "top10") return;

  const fromUrl = params.get("mode") as Mode | null;
  const mode = fromUrl && MODES.includes(fromUrl) ? fromUrl : "single";
  engine.config = { mode, duration: 10 };
  app.setDuration(10);
  engine.fakeCamera();
  const double = mode === "double";
  const tilts = double ? [-0.35, 0.35] : [0.44];
  const xs = double ? [0.3, 0.7] : [0.5];
  engine.tracks.forEach((tr, i) => {
    tr.anchor = { x: xs[i], y: 0.5, size: 0.14, ux: Math.sin(tilts[i]), uy: Math.cos(tilts[i]) };
  });
  engine.startPlaying();
  const r = engine.run;
  const now = performance.now();

  if (auto === "play") {
    r.count = 12;
    if (double) [engine.tracks[0].count, engine.tracks[1].count] = [5, 7];
    if (mode === "random") {
      r.meter = 62;
      r.rodSpawnAt = now - 1000;
    }
    for (let i = 0; i < 6; i++) r.strokes.push(now - i * 200);
    engine.updateCount();
    engine.processFrame({ landmarks: engine.tracks.map((_, i) => fakeHand(aspect(), xs[i], 0.5, tilts[i])) }, now);
  } else {
    r.count = 39;
    r.bins = [3, 4, 4, 5, 4, 4, 4, 4, 4, 3];
    r.framesTotal = 100;
    r.framesOnRod = 82;
    if (double) [engine.tracks[0].count, engine.tracks[1].count] = [19, 20];
    r.playStart = now - (mode === "random" ? 23400 : 10000);
    if (mode === "random") r.rodsCaught = 6;
    engine.finish();
  }
}
