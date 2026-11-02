// Gọi API leaderboard (backend FastAPI, cùng tên miền). Lỗi trả về dạng { error: "<code>" }.
import { config } from "../config";
import type {
  FriendsResponse,
  LeaderboardResponse,
  LoginRequest,
  MeResponse,
  Profile,
  RankResponse,
  RegisterRequest,
  ResetSentResponse,
  Relation,
  RoomTicket,
  ScoreRequest,
  SessionRequest,
} from "./types";

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(config.apiBaseUrl + path, init);
  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = (data as { error?: unknown }).error;
    throw new ApiError(typeof code === "string" ? code : String(res.status), res.status);
  }
  return data as T;
}

const post = <T>(path: string, body: unknown) =>
  request<T>(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export const api = {
  /** Server ghi lại lúc bắt đầu ván để đối chiếu thời lượng khi nộp điểm */
  createSession: (body: SessionRequest) => post<{ token: string }>("/api/session", body).then((d) => d.token),

  submitScore: (body: ScoreRequest) => post<RankResponse>("/api/score", body),

  leaderboard: (params: { mode: string; duration: number; pid?: string }, signal?: AbortSignal) => {
    const q = new URLSearchParams({ mode: params.mode, duration: String(params.duration) });
    if (params.pid) q.set("pid", params.pid);
    return request<LeaderboardResponse>(`/api/leaderboard?${q}`, { signal });
  },

  // Tài khoản: phiên đăng nhập nằm trong cookie HttpOnly `amb_sid` (Path=/api), JS không đọc được
  me: () => request<MeResponse>("/api/me"),
  usernameExists: (username: string) =>
    request<{ exists: boolean }>(`/api/users/${encodeURIComponent(username)}/exists`).then((d) => d.exists),
  register: (body: RegisterRequest) => post<MeResponse>("/api/auth/register", body),
  login: (body: LoginRequest) => post<MeResponse>("/api/auth/login", body),
  logout: () => post<MeResponse>("/api/auth/logout", {}),
  // Password reset by email (off when the server has no email service)
  resetRequest: (body: { username: string; captcha: string; lang: string }) =>
    post<ResetSentResponse>("/api/auth/reset/request", body),
  resetComplete: (body: { token: string; password: string }) => post<MeResponse>("/api/auth/reset", body),
  changeEmail: (body: { email: string | null; password: string }) =>
    request<MeResponse>("/api/me/email", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  profile: (username: string, signal?: AbortSignal) =>
    request<Profile>(`/api/users/${encodeURIComponent(username)}`, { signal }),

  // PvP: a signed ticket for the room socket (roomSocketUrl in src/pvp/RoomClient.ts)
  createRoom: (body: { mode: string; duration: number; pid: string; name: string }) =>
    post<RoomTicket>("/api/rooms", body),
  joinRoom: (code: string, body: { pid: string; name: string }) =>
    post<RoomTicket>(`/api/rooms/${encodeURIComponent(code)}/join`, body),

  // Video / voice with the PvP opponent: 503 rtc_unavailable when the server has no TURN service
  roomIce: (code: string, ticket: string) =>
    post<{ ice_servers: RTCIceServer[]; relay: boolean }>(`/api/rooms/${encodeURIComponent(code)}/ice`, { ticket }),

  // Friends (logged in only) and the lobby socket ticket (src/friends/FriendsHub.ts)
  friends: () => request<FriendsResponse>("/api/friends"),
  addFriend: (username: string) =>
    post<{ relation: Relation }>(`/api/friends/${encodeURIComponent(username)}`, {}).then((d) => d.relation),
  removeFriend: (username: string) =>
    request<{ relation: Relation }>(`/api/friends/${encodeURIComponent(username)}`, { method: "DELETE" }),
  lobbyTicket: (body: { pid: string; name: string }) =>
    post<{ ticket: string; name: string }>("/api/lobby", body).then((d) => d.ticket),
};
