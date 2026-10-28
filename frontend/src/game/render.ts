import { ROD_HALF_LEN, ROD_TOL_X } from "./constants";
import { rodScale, type HandTrack } from "./HandTrack";
import type { HandPose } from "./types";

const COLOR = { fg: "#f2f2f2", bg: "#0b0b0b", mute: "#8b8b8b", accent: "#ff3b3b" };

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
}

export function drawOverlay(ctx: CanvasRenderingContext2D, scene: OverlayScene): void {
  const { width: w, height: h } = ctx.canvas;
  ctx.clearRect(0, 0, w, h);
  if (scene.frame) ctx.drawImage(scene.frame, 0, 0, w, h);

  if (scene.showRods) {
    for (const tr of scene.tracks) {
      if (tr.anchor) drawRod(ctx, tr, scene.spawnAge);
    }
  }
  for (const hd of scene.seen) {
    if (hd) drawHand(ctx, hd, scene.progress);
  }
}

function drawRod(ctx: CanvasRenderingContext2D, tr: HandTrack, spawnAge: number | null): void {
  const { width: w, height: h } = ctx.canvas;
  const a = tr.anchor!;
  const half = rodScale(a) * ROD_HALF_LEN * h;
  const tol = rodScale(a) * ROD_TOL_X * h;
  // Trắng: đúng trụ · Đỏ: buông tay / lệch trụ · Xám: mất dấu tay
  const color = !tr.hand ? COLOR.mute : tr.onRod ? COLOR.fg : COLOR.accent;
  // Vẽ trong hệ toạ độ của trụ: gốc tại điểm neo, trục y cục bộ trùng trục trụ
  ctx.save();
  ctx.translate(a.x * w, a.y * h);
  ctx.rotate(Math.atan2(a.uy, a.ux) - Math.PI / 2);
  // Vùng hợp lệ: viền nét đứt mảnh
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.5;
  ctx.setLineDash([4, 6]);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(-tol, -half, tol * 2, half * 2, tol);
  ctx.stroke();
  ctx.setLineDash([]);
  // Thanh trụ: một khối đặc
  const rodW = rodScale(a) * 0.3 * h;
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(-rodW / 2, -half, rodW, half * 2, rodW / 2);
  ctx.fill();
  // Điểm neo: vạch cắt ngang trụ
  ctx.globalAlpha = 1;
  ctx.fillStyle = COLOR.bg;
  ctx.fillRect(-rodW / 2, -1.5, rodW, 3);
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
