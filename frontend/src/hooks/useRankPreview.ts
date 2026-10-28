import { useEffect, useState } from "react";
import { api } from "../api/client";
import { isTimed, type RunResult } from "../game/types";
import { projectedRank } from "../lib/scoring";
import { playerId } from "../lib/storage";

/**
 * Hạng dự kiến của ván vừa chơi khi chưa gửi điểm (người chơi mới chưa có tên để tự gửi).
 * Đọc bảng xếp hạng một lần; lỗi mạng thì trả null, chỉ mất phần báo trước.
 */
export function useRankPreview(run: RunResult, enabled: boolean): number | null {
  const [rank, setRank] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled || run.score <= 0) return;
    const ctl = new AbortController();
    api
      .leaderboard({ mode: run.mode, duration: isTimed(run.mode) ? run.duration : 0, pid: playerId() }, ctl.signal)
      .then((res) => setRank(projectedRank(res.entries, run.score)))
      .catch(() => {});
    return () => ctl.abort();
  }, [run, enabled]);

  return rank;
}
