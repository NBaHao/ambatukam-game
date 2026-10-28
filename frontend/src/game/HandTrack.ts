import {
  ANCHOR_STILL,
  FINGERS,
  GRIP_IDS,
  GRIP_MAX_AVG,
  LOST_HAND_MS,
  OPEN_MIN_CURL,
  RELEASE_FINGERS,
  ROD_HALF_LEN,
  ROD_MAX_HALF,
  ROD_TOL_X,
  STROKE_THR,
} from "./constants";
import { StrokeDetector, type Reversal } from "./StrokeDetector";
import type { Anchor, HandPose, Landmarks } from "./types";

/** Tâm nắm tay (trung bình các khớp nằm quanh thân trụ) */
export function gripCenter(lm: Landmarks): { x: number; y: number } {
  return {
    x: GRIP_IDS.reduce((s, i) => s + lm[i].x, 0) / GRIP_IDS.length,
    y: GRIP_IDS.reduce((s, i) => s + lm[i].y, 0) / GRIP_IDS.length,
  };
}

/** Cỡ dùng để dựng trụ: cỡ tay lúc đặt neo, chặn trên để trụ không dài quá ROD_MAX_HALF (giữ tỉ lệ dài/rộng) */
export const rodScale = (a: Anchor) => Math.min(a.size, ROD_MAX_HALF / ROD_HALF_LEN);

/**
 * Một bàn tay đang được theo dõi: bộ đếm, điểm neo và bộ làm mượt riêng.
 * Single/Random dùng 1 track, Double dùng 2.
 * Mọi khoảng cách quy về đơn vị chiều cao khung hình (x nhân với aspect).
 */
export class HandTrack {
  readonly detector = new StrokeDetector();
  count = 0;
  hand: HandPose | null = null; // kết quả analyze của khung gần nhất (giữ lại trong LOST_HAND_MS)
  lastAt = 0;
  smooth: number | null = null; // toạ độ dọc trục đếm đã làm mượt
  curlEma: number[] | null = null;
  anchor: Anchor | null = null;
  onRod = false;
  invalidSince: number | null = null;
  anchorRef: { x: number; y: number } | null = null; // vị trí lúc bắt đầu giữ yên
  axisEma: { ux: number; uy: number } | null = null;

  clearMotion(): void {
    this.detector.reset();
    this.smooth = null;
  }

  clearAnchor(): void {
    this.anchor = null;
    this.anchorRef = null;
    this.axisEma = null;
  }

  visible(now: number): boolean {
    return now - this.lastAt < LOST_HAND_MS;
  }

  // z của MediaPipe cùng thang với x
  analyze(lm: Landmarks, aspect: number): HandPose {
    const P = (i: number) => [lm[i].x * aspect, lm[i].y, lm[i].z * aspect];
    const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const wrist = P(0);
    const size = dist(wrist, P(9));
    // Độ duỗi mỗi ngón = (cổ tay→đầu ngón) / (cổ tay→gốc ngón): ~1.9 khi duỗi, ~1 khi co.
    // Làm mượt qua các khung để vài khung nhòe không làm đổi trạng thái nắm/xòe.
    const raw = FINGERS.map(([tip, mcp]) => dist(P(tip), wrist) / dist(P(mcp), wrist));
    const prev = this.curlEma;
    const curls = prev ? prev.map((c, i) => c * 0.5 + raw[i] * 0.5) : raw;
    this.curlEma = curls;
    const extended = curls.filter((c) => c > OPEN_MIN_CURL).length;
    // Trục nắm tay (2D): khớp ngón trỏ → khớp ngón út, chuẩn hoá để hướng "xuống" (y ≥ 0)
    let ux = (lm[17].x - lm[5].x) * aspect;
    let uy = lm[17].y - lm[5].y;
    const len = Math.hypot(ux, uy) || 1;
    ux /= len;
    uy /= len;
    if (uy < 0 || (uy === 0 && ux < 0)) {
      ux = -ux;
      uy = -uy;
    }
    return {
      lm,
      size,
      ux,
      uy,
      ...gripCenter(lm),
      open: extended === 4,
      // Khi cầm trụ, ngón trỏ thường duỗi hơn các ngón khác nên xét trung bình thay vì từng ngón
      grip: curls.reduce((a, b) => a + b, 0) / curls.length < GRIP_MAX_AVG,
      released: extended >= RELEASE_FINGERS,
    };
  }

  /** Toạ độ tay so với trụ: `along` dọc trục (dương = về phía ngón út), `perp` lệch ngang */
  rodCoords(h: HandPose, aspect: number, a: Anchor): { along: number; perp: number } {
    const dx = (h.x - a.x) * aspect;
    const dy = h.y - a.y;
    return { along: dx * a.ux + dy * a.uy, perp: Math.abs(dx * a.uy - dy * a.ux) };
  }

  isOnRod(h: HandPose, aspect: number): boolean {
    if (!this.anchor || h.released) return false;
    const { along, perp } = this.rodCoords(h, aspect, this.anchor);
    const r = rodScale(this.anchor);
    return perp < r * ROD_TOL_X && Math.abs(along) < r * ROD_HALF_LEN;
  }

  /** Cập nhật trục tay làm mượt trong lúc giữ yên; lật dấu nếu khung này ngược với trung bình */
  accumulateAxis(h: HandPose): void {
    if (!this.axisEma) {
      this.axisEma = { ux: h.ux, uy: h.uy };
      return;
    }
    const s = h.ux * this.axisEma.ux + h.uy * this.axisEma.uy < 0 ? -1 : 1;
    this.axisEma.ux = this.axisEma.ux * 0.8 + s * h.ux * 0.2;
    this.axisEma.uy = this.axisEma.uy * 0.8 + s * h.uy * 0.2;
  }

  /** Tay có đang giữ yên không (so với lúc bắt đầu giữ). Trả về false nếu vừa dịch chuyển. */
  updateStill(h: HandPose, aspect: number): boolean {
    const ref = this.anchorRef;
    if (!ref || Math.hypot((h.x - ref.x) * aspect, h.y - ref.y) > h.size * ANCHOR_STILL) {
      this.anchorRef = { x: h.x, y: h.y };
      this.axisEma = null;
      return false;
    }
    return true;
  }

  commitAnchor(h: HandPose): void {
    const a = this.axisEma ?? { ux: h.ux, uy: h.uy };
    const len = Math.hypot(a.ux, a.uy) || 1;
    this.anchor = { x: h.x, y: h.y, size: h.size, ux: a.ux / len, uy: a.uy / len };
    this.clearMotion();
  }

  /** Đưa một mẫu toạ độ vào bộ đếm. Trả về "bottom" (một nhát), "top" hoặc null. */
  feed(v: number, size: number): Reversal {
    this.smooth = this.smooth === null ? v : this.smooth * 0.35 + v * 0.65;
    return this.detector.push(this.smooth, Math.max(0.015, size * STROKE_THR));
  }
}

/**
 * Gán bàn tay nhận diện được vào từng track.
 * `preferAnchor`: random dùng vị trí trụ làm mốc (tay gần trụ nhất) thay vì vị trí tay khung trước.
 */
export function assignHands(
  tracks: HandTrack[],
  list: Landmarks[],
  aspect: number,
  preferAnchor: boolean,
): (Landmarks | null)[] {
  if (!list.length) return tracks.map(() => null);
  const centers = list.map(gripCenter);
  const d = (c: { x: number; y: number }, p: { x: number; y: number }) =>
    Math.hypot((c.x - p.x) * aspect, c.y - p.y);
  if (tracks.length === 1) {
    const t = tracks[0];
    const ref = t.anchor && preferAnchor ? t.anchor : t.hand;
    if (!ref || list.length === 1) return [list[0]];
    let best = 0;
    for (let i = 1; i < list.length; i++) if (d(centers[i], ref) < d(centers[best], ref)) best = i;
    return [list[best]];
  }
  // Hai track: nếu đã có mốc (neo hoặc vị trí cũ) cho cả hai → ghép theo khoảng cách gần nhất
  const refs = tracks.map((tr) => tr.anchor ?? tr.hand);
  if (refs.every(Boolean)) {
    const pairs: { ti: number; ci: number; dist: number }[] = [];
    refs.forEach((r, ti) => centers.forEach((c, ci) => pairs.push({ ti, ci, dist: d(c, r!) })));
    pairs.sort((a, b) => a.dist - b.dist);
    const out: (Landmarks | null)[] = [null, null];
    const used = new Set<number>();
    for (const p of pairs) {
      if (out[p.ti] || used.has(p.ci)) continue;
      out[p.ti] = list[p.ci];
      used.add(p.ci);
    }
    return out;
  }
  // Chưa có mốc: xếp theo chiều ngang, track 0 = tay bên trái khung (chưa lật gương)
  const order = centers.map((_, i) => i).sort((a, b) => centers[a].x - centers[b].x);
  return [list[order[0]] ?? null, list[order[1]] ?? null];
}
