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
  /** Only the account itself sees it: where password reset links go (null: none set) */
  email?: string | null;
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

/** GET /api/users/{username} (ProfileResponse in schemas.py) */
export interface ProfileRecord {
  mode: "single" | "double" | "random";
  duration: number;
  score: number;
  strokes: number;
  rank: number;
  total: number;
}

export interface ProfileMatch {
  id: string;
  mode: "single" | "double";
  duration: number;
  ended_at: number;
  result: "win" | "loss" | "draw";
  status: "ok" | "rejected" | "forfeit";
  strokes: number;
  opponent: { name: string; username: string | null; strokes: number; status: string } | null;
}

// Friends: GET /api/friends (who is online comes from the lobby socket, src/friends/FriendsHub.ts)
export type Relation = "self" | "friends" | "outgoing" | "incoming" | "none";

export interface Friend {
  username: string;
  since: number;
}

export interface FriendRequest {
  username: string;
  at: number;
}

export interface FriendsResponse {
  friends: Friend[];
  incoming: FriendRequest[];
  outgoing: FriendRequest[];
}

export interface Profile {
  username: string;
  joined_at: number;
  records: ProfileRecord[];
  pvp: { played: number; wins: number; losses: number; draws: number };
  matches: ProfileMatch[];
  /** How the logged-in viewer relates to this account (null for guests) */
  relation: Relation | null;
}

/** Luật tên / mật khẩu, khớp backend/src/app/rules.py */
export const USERNAME_RE = /^[a-z0-9_-]{3,16}$/;
export const RESERVED_PREFIX = "guest";
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

/** Mã lỗi server trả về khi điểm bị từ chối (không thử lại được) */
export const REJECTED_CODES = ["too_fast", "implausible", "bad_score", "used", "invalid_request"];
