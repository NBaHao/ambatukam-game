import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

export type Mode = "single" | "double" | "random";
export const MODES: Mode[] = ["single", "double", "random"];
export const DURATIONS = [10, 20, 30] as const;
/** Giây của một ván tính giờ. Random không giới hạn, dùng 0 khi gửi lên server. */
export type Duration = (typeof DURATIONS)[number];

export const isTimed = (mode: Mode) => mode !== "random";

export interface RunConfig {
  mode: Mode;
  duration: Duration;
}

export type Landmarks = NormalizedLandmark[];

/** Điểm neo / trụ: tâm (toạ độ chuẩn hoá của khung), cỡ tay, hướng trục trụ (vector đơn vị, y ≥ 0) */
export interface Anchor {
  x: number;
  y: number;
  size: number;
  ux: number;
  uy: number;
}

/** Bàn tay đã phân tích trong một khung hình */
export interface HandPose {
  lm: Landmarks;
  x: number;
  y: number;
  size: number;
  ux: number;
  uy: number;
  open: boolean;
  grip: boolean;
  released: boolean;
}

/** Kết quả một ván, engine trả về khi hết ván */
export interface RunResult extends RunConfig {
  /** single/double: tổng nhát; random: số giây sống sót (làm tròn 0.1) */
  score: number;
  count: number;
  bins: number[];
  peak: number;
  split: number[];
  rods: number;
  /** % khung hình mọi tay đều nằm trên trụ */
  grip: number;
  /** số khung camera xử lý được mỗi giây */
  fps: number;
}
