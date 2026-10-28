// Kiểu dữ liệu của API, khớp backend/src/app/schemas.py (xem /api/docs khi chạy backend)
import type { Mode } from "../game/types";

export interface SessionRequest {
  mode: Mode;
  /** 10/20/30 cho single/double, 0 cho random */
  duration: number;
}

export interface ScoreRequest {
  token: string;
  captcha: string;
  pid: string;
  name: string;
  strokes: number;
  survived?: number;
  bins: number[];
  fps: number;
  grip: number;
  split?: number[];
}

export interface RankResponse {
  name: string;
  score: number;
  strokes: number;
  rank: number;
  total: number;
}

export interface LeaderboardEntry {
  name: string;
  score: number;
  strokes: number;
  me: boolean;
}

export interface LeaderboardResponse {
  entries: LeaderboardEntry[];
  me: RankResponse | null;
}

/** Mã lỗi server trả về khi điểm bị từ chối (không thử lại được) */
export const REJECTED_CODES = ["too_fast", "implausible", "bad_score", "used", "invalid_request"];
