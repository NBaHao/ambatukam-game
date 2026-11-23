import { describe, expect, it } from "vitest";
import { RodFx } from "./RodFx";

/** Run the effect for `ms` at the given frame interval */
function run(fx: RodFx, from: number, ms: number, frameMs: number, along: number | null = 0): number {
  let t = from;
  for (; t <= from + ms; t += frameMs) fx.update(along, t);
  return t;
}

describe("RodFx", () => {
  it("bounces after a stroke and settles back", () => {
    const fx = new RodFx();
    let t = run(fx, 0, 0, 16);
    fx.kick("bottom");
    let peak = 0;
    let dipped = false;
    for (let i = 0; i < 30; i++) {
      t = run(fx, t, 0, 16);
      peak = Math.max(peak, fx.pulse);
      dipped ||= fx.pulse < 0;
    }
    expect(peak).toBeGreaterThan(0.1);
    expect(dipped).toBe(true); // underdamped: it overshoots below rest
    run(fx, t, 3000, 16);
    expect(Math.abs(fx.pulse)).toBeLessThan(0.001);
  });

  it("stays bounded on a slow camera and under rapid strokes", () => {
    const fx = new RodFx();
    let t = 0;
    for (let i = 0; i < 60; i++) {
      fx.kick("bottom");
      fx.kick("top");
      t = run(fx, t, 0, 70, i % 2 ? 0.2 : -0.2);
      expect(Math.abs(fx.pulse)).toBeLessThanOrEqual(0.6);
      expect(Math.abs(fx.bulgeAt)).toBeLessThan(0.6);
    }
  });

  it("moves the bulge to the hand", () => {
    const fx = new RodFx();
    run(fx, 0, 2000, 33, 0.15);
    expect(fx.bulgeAt).toBeCloseTo(0.15, 3);
    expect(fx.bulgeAmp(0.15)).toBeCloseTo(0.45, 2);
  });
});
