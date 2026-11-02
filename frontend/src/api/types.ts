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
  /** Điểm của một tài khoản: tên là username */
  registered: boolean;
}

export interface LeaderboardResponse {
  entries: LeaderboardEntry[];
  me: RankResponse | null;
}

export interface User {
  username: string;
  /** Mã người chơi của tài khoản: client lưu lại làm playerId() */
  pid: string;
  created_at: number;
}

export interface MeResponse {
  user: User | null;
}

export interface RegisterRequest {
  username: string;
  password: string;
  email?: string;
  pid: string;
  captcha: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface RoomTicket {
  code: string;
  ticket: string;
}

/** Luật tên / mật khẩu, khớp backend/src/app/rules.py */
export const USERNAME_RE = /^[a-z0-9_-]{3,16}$/;
export const RESERVED_PREFIX = "guest";
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

/** Mã lỗi server trả về khi điểm bị từ chối (không thử lại được) */
export const REJECTED_CODES = ["too_fast", "implausible", "bad_score", "used", "invalid_request"];
