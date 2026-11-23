import { ROD_HALF_LEN, ROD_OVERSHOOT, ROD_TOL_X } from "./constants";
import { rodScale, type HandTrack } from "./HandTrack";
import type { HandPose } from "./types";

const ROD_SEGMENTS = 32; // outline samples per side
const LUMP_WIDTH = 0.55; // lump spread along the rod (rod scales)
const ZONE_PULSE = 0.35; // how much of the rod's pulse the dashed zone outline shows
const ZONE_CRAWL = 0.02; // dash crawl speed (px per ms)

const COLOR = { fg: "#f2f2f2", bg: "#0b0b0b", mute: "#8b8b8b", accent: "#ff3b3b" };
const SCORE_RGB = [61, 255, 122]; // flash when a stroke scores
const FG_RGB = [242, 242, 242];

export interface OverlayScene {
  /** Khung camera vừa nhận diện (vẽ đúng khung này để tay, chấm và trụ luôn khớp nhau) */
  frame: HTMLCanvasElement | null;
  tracks: HandTrack[];
  seen: (HandPose | null)[];
  /** Tiến độ cử chỉ đang giữ (0..1), vẽ vòng quanh lòng bàn tay */
  progress: number;
  showRods: boolean;
  /** Random: tuổi của trụ vừa xuất hiện (0..1) để vẽ vòng lan toả, null nếu không có */
  spawnAge: number | null;
  /** Clock for the rod animations (ms) */
  now: number;
}

export function drawOverlay(ctx: CanvasRenderingContext2D, scene: OverlayScene): void {
  const { width: w, height: h } = ctx.canvas;
  ctx.clearRect(0, 0, w, h);
  if (scene.frame) ctx.drawImage(scene.frame, 0, 0, w, h);

  if (scene.showRods) {
    for (const tr of scene.tracks) {
      if (tr.anchor) drawRod(ctx, tr, scene.spawnAge, scene.now);
    }
  }
  for (const hd of scene.seen) {
    if (hd) drawHand(ctx, hd, scene.progress);
  }
}

function drawRod(ctx: CanvasRenderingContext2D, tr: HandTrack, spawnAge: number | null, now: number): void {
  const { width: w, height: h } = ctx.canvas;
  const a = tr.anchor!;
  const half = rodScale(a) * ROD_HALF_LEN * h;
  const tol = rodScale(a) * ROD_TOL_X * h;
  // Trắng: đúng trụ · Đỏ: buông tay / lệch trụ · Xám: mất dấu tay
  const flash = tr.hand && tr.onRod ? tr.fx.flash(now) : 0;
  const color = !tr.hand
    ? COLOR.mute
    : !tr.onRod
      ? COLOR.accent
      : flash > 0
        ? `rgb(${FG_RGB.map((c, i) => Math.round(c + (SCORE_RGB[i] - c) * flash)).join(",")})`
        : COLOR.fg;
  // Vẽ trong hệ toạ độ của trụ: gốc tại điểm neo, trục y cục bộ trùng trục trụ
  ctx.save();
  ctx.translate(a.x * w, a.y * h);
  ctx.rotate(Math.atan2(a.uy, a.ux) - Math.PI / 2);
  // Rubber look (visual only: the on-rod check keeps using the fixed `tol` / `half`)
  const scale = rodScale(a);
  const pulse = tr.fx.pulse;
  // Valid zone: thin dashed outline, dashes crawl around and the outline breathes with each stroke
  const zTol = tol * (1 + pulse * ZONE_PULSE);
  // longer than the rod: the hand may overshoot both ends
  const zHalf = half * (1 + ROD_OVERSHOOT) * (1 + pulse * ZONE_PULSE * 0.5);
  ctx.strokeStyle = color;
  ctx.globalAlpha = Math.min(0.9, 0.5 + Math.abs(pulse));
  ctx.setLineDash([4, 6]);
  ctx.lineDashOffset = -((now * ZONE_CRAWL) % 10);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(-zTol, -zHalf, zTol * 2, zHalf * 2, zTol);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;
  // Rod body: one solid shape, squashed by the pulse, with a lump that chases the hand
  const baseHw = scale * 0.15 * h * (1 + pulse);
  const rodHalf = half * (1 - pulse * 0.25);
  const lumpAt = tr.fx.bulgeAt * h;
  const lumpAmp = tr.fx.bulgeAmp(scale);
  const lumpWidth = scale * LUMP_WIDTH * h;
  const halfWidth = (s: number) => baseHw * (1 + lumpAmp * Math.exp(-(((s - lumpAt) / lumpWidth) ** 2)));
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i <= ROD_SEGMENTS * 2 + 1; i++) {
    // down the right side, then back up the left
    const right = i <= ROD_SEGMENTS;
    // cosine spacing: samples bunch up at both ends, where the round caps need them
    const s = -rodHalf * Math.cos((Math.PI * (right ? i : ROD_SEGMENTS * 2 + 1 - i)) / ROD_SEGMENTS);
    let hw = halfWidth(s);
    const edge = rodHalf - Math.abs(s);
    if (edge < hw) hw *= Math.sqrt(Math.max(0, 1 - ((hw - edge) / hw) ** 2)); // round caps
    ctx.lineTo(right ? hw : -hw, s);
  }
  ctx.closePath();
  ctx.fill();
  // Anchor point: a notch across the rod
  const notch = halfWidth(0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = COLOR.bg;
  ctx.fillRect(-notch, -1.5, notch * 2, 3);
  ctx.restore();
  // Random: vòng lan toả khi trụ vừa xuất hiện
  if (spawnAge !== null && spawnAge < 1) {
    ctx.globalAlpha = 1 - spawnAge;
    ctx.lineWidth = 2;
    ctx.strokeStyle = COLOR.fg;
    ctx.beginPath();
    ctx.arc(a.x * w, a.y * h, (0.5 + spawnAge * 2) * half, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

function drawHand(ctx: CanvasRenderingContext2D, hd: HandPose, progress: number): void {
  const { width: w, height: h } = ctx.canvas;
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = hd.released ? COLOR.accent : COLOR.fg;
  for (const p of hd.lm) {
    ctx.beginPath();
    ctx.arc(p.x * w, p.y * h, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  if (progress <= 0) return;
  // Vòng tiến độ cử chỉ quanh lòng bàn tay
  const r = hd.size * 0.9 * h;
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(242,242,242,.25)";
  ctx.beginPath();
  ctx.arc(hd.x * w, hd.y * h, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = COLOR.fg;
  ctx.beginPath();
  ctx.arc(hd.x * w, hd.y * h, r, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
  ctx.stroke();
}
