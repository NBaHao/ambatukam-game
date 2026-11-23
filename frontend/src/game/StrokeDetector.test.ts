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
  it("scores only strokes that travel far enough", () => {
    const d = new StrokeDetector();
    // wiggle around the centre (0.1 peak to peak), then one long stroke (0.4)
    const ys = [0, 0.1, 0, 0.1, 0, 0.2, 0.4, 0.2, 0];
    const out = ys.map((y) => d.push(y, 0.05, 0.3)).filter(Boolean);
    expect(out).toEqual(["short", "top", "short", "top", "bottom"]);
  });

  it("measures travel from where the way down started, not from the centre", () => {
    const d = new StrokeDetector();
    const out = [0, -0.2, 0.2, -0.2].map((y) => d.push(y, 0.05, 0.3)).filter(Boolean);
    expect(out).toEqual(["top", "bottom"]);
  });
});

describe("StrokeDetector raw travel", () => {
  it("measures travel on the raw position when the smoothed one falls short", () => {
    const d = new StrokeDetector();
    const smooth = [0, 0.1, 0.25, 0.1, 0];
    const raw = [0, 0.15, 0.35, 0.05, -0.05];
    const out = smooth.map((y, i) => d.push(y, 0.05, 0.3, raw[i])).filter(Boolean);
    expect(out).toEqual(["bottom"]);
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
