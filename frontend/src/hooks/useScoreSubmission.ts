import { useCallback, useState, type RefObject } from "react";
import { ApiError, api } from "../api/client";
import { REJECTED_CODES, type RankResponse } from "../api/types";
import type { RunResult } from "../game/types";
import type { TextKey } from "../i18n/strings";
import { playerId, storage } from "../lib/storage";
import { CaptchaError, getCaptchaToken } from "../lib/turnstile";

export type SubmitState =
  | { status: "form" }
  | { status: "sending" }
  | { status: "done"; rank: RankResponse }
  /** Lỗi tạm thời: còn ô nhập tên để thử lại */
  | { status: "error"; msg: TextKey }
  /** Không gửi được nữa (điểm 0, bị từ chối, quá hạn) */
  | { status: "off"; msg: TextKey };

function failure(err: unknown): SubmitState {
  if (err instanceof CaptchaError) return { status: "error", msg: "submitCaptcha" };
  if (err instanceof ApiError) {
    if (REJECTED_CODES.includes(err.code)) return { status: "off", msg: "submitRejected" };
    if (err.code === "expired") return { status: "off", msg: "submitExpired" };
    if (err.code === "captcha") return { status: "error", msg: "submitCaptcha" };
  }
  return { status: "error", msg: "submitErr" };
}

/**
 * Gửi điểm một ván lên bảng xếp hạng.
 * `session` là token server cấp lúc bắt đầu ván, `captchaRef` là chỗ Turnstile vẽ ô tick khi cần.
 */
export function useScoreSubmission(
  run: RunResult,
  session: Promise<string | null>,
  captchaRef: RefObject<HTMLElement | null>,
) {
  const [state, setState] = useState<SubmitState>(() =>
    run.score > 0 ? { status: "form" } : { status: "off", msg: "noRankZero" },
  );

  const submit = useCallback(
    async (name: string) => {
      storage.setName(name);
      setState({ status: "sending" });
      try {
        const [token, captcha] = await Promise.all([session, getCaptchaToken(captchaRef.current!)]);
        if (!token) throw new Error("no_session");
        const rank = await api.submitScore({
          token,
          captcha,
          pid: playerId(),
          name,
          strokes: run.count,
          survived: run.mode === "random" ? run.score : undefined,
          bins: run.bins,
          fps: run.fps,
          grip: run.grip,
          split: run.mode === "double" ? run.split : undefined,
        });
        setState({ status: "done", rank });
      } catch (err) {
        setState(failure(err));
      }
    },
    [run, session, captchaRef],
  );

  const edit = useCallback(() => setState({ status: "form" }), []);

  return { state, submit, edit };
}
