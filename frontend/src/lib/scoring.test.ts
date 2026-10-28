import { describe, expect, it } from "vitest";
import type { RunResult } from "../game/types";
import { formatBoardScore, projectedRank, summarize, tierIndex } from "./scoring";

const run = (over: Partial<RunResult>): RunResult => ({
  mode: "single",
  duration: 10,
  score: 39,
  count: 39,
  bins: [],
  peak: 0,
  split: [39],
  rods: 0,
  grip: 90,
  fps: 30,
  ...over,
});

describe("scoring", () => {
  it("picks the highest tier reached", () => {
    expect(tierIndex([0, 1, 2, 3], 0)).toBe(0);
    expect(tierIndex([0, 1, 2, 3], 2.5)).toBe(2);
    expect(tierIndex([0, 1, 2, 3], 9)).toBe(3);
  });

  it("summarizes timed runs as strokes per second", () => {
    expect(summarize(run({}), 30)).toEqual({ hero: "3.90", tier: 3, prevBest: 30, isNewBest: true });
  });

  it("rates double mode per hand", () => {
    expect(summarize(run({ mode: "double", count: 80, score: 80 }), 100).tier).toBe(4);
  });

  it("summarizes random runs as seconds survived", () => {
    expect(summarize(run({ mode: "random", score: 23.4 }), 30)).toMatchObject({ hero: "23.4", tier: 2, isNewBest: false });
  });

  it("formats board scores", () => {
    expect(formatBoardScore(39, "single", 10)).toBe("3.90/s");
    expect(formatBoardScore(23.4, "random", 0)).toBe("23.4s");
  });

  it("projects the rank of an unsubmitted run", () => {
    const board = [50, 40, 30].map((score) => ({ score, me: false }));
    expect(projectedRank([], 10)).toBe(1);
    expect(projectedRank(board, 45)).toBe(2);
    // Bằng điểm thì người đạt trước đứng trên
    expect(projectedRank(board, 40)).toBe(3);
    expect(projectedRank(board, 5)).toBe(4);
    // Dòng cũ của mình cao hơn ván này thì giữ hạng cũ
    expect(projectedRank([...board, { score: 45, me: true }], 20)).toBe(2);
  });
});
