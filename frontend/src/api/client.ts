// Gọi API leaderboard (backend FastAPI, cùng tên miền). Lỗi trả về dạng { error: "<code>" }.
import { config } from "../config";
import type { LeaderboardResponse, RankResponse, ScoreRequest, SessionRequest } from "./types";

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
};
