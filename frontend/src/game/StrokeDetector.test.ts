import { describe, expect, it } from "vitest";
import { Hold } from "./Hold";
import { StrokeDetector } from "./StrokeDetector";

describe("StrokeDetector", () => {
  it("counts one stroke per down-then-up cycle", () => {
    const d = new StrokeDetector();
    const ys = [0, 0.1, 0.2, 0.1, 0, 0.1, 0.2, 0.1, 0];
    const out = ys.map((y) => d.push(y, 0.05)).filter(Boolean);
    expect(out).toEqual(["bottom", "top", "bottom"]);
  });

  it("ignores jitter below the threshold", () => {
    const d = new StrokeDetector();
    const out = [0, 0.02, 0, 0.03, 0.01].map((y) => d.push(y, 0.05));
    expect(out.every((r) => r === null)).toBe(true);
  });
});

describe("Hold", () => {
  it("reports progress while the condition holds and resets otherwise", () => {
    const h = new Hold(1000);
    expect(h.update(true, 0)).toBe(0);
    expect(h.update(true, 500)).toBe(0.5);
    expect(h.update(false, 600)).toBe(0);
    expect(h.update(true, 700)).toBe(0);
    expect(h.update(true, 2000)).toBe(1);
  });
});
