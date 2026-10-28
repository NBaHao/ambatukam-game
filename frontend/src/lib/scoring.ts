import { RND_TIER_SEC, TIER_MIN } from "../game/constants";
import { isTimed, type RunResult } from "../game/types";

/** Chỉ số danh hiệu: số ngưỡng đạt được − 1 */
export function tierIndex(mins: number[], value: number): number {
  return mins.filter((m) => value >= m).length - 1;
}

export interface RunSummary {
  /** Số to trên màn kết quả: nhát/giây (ván tính giờ) hoặc giây sống sót (random) */
  hero: string;
  tier: number;
  prevBest: number;
  isNewBest: boolean;
}

export function summarize(run: RunResult, prevBest: number): RunSummary {
  const base = { prevBest, isNewBest: run.score > prevBest };
  if (!isTimed(run.mode)) {
    return { ...base, hero: run.score.toFixed(1), tier: tierIndex(RND_TIER_SEC, run.score) };
  }
  const avg = run.count / run.duration;
  // Double: danh hiệu tính theo tốc độ mỗi tay
  return { ...base, hero: avg.toFixed(2), tier: tierIndex(TIER_MIN, run.mode === "double" ? avg / 2 : avg) };
}

/** Điểm trên bảng xếp hạng: single/double xếp theo tổng nhát nhưng hiển thị nhát/giây; random theo giây */
export function formatBoardScore(score: number, mode: RunResult["mode"], duration: number): string {
  return mode === "random" ? `${score.toFixed(1)}s` : `${(score / duration).toFixed(2)}/s`;
}
