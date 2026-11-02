import { describe, expect, it } from "vitest";
import { ClockSync } from "./clock";

describe("ClockSync", () => {
  it("uses the sample with the shortest round trip", () => {
    const c = new ClockSync();
    expect(c.ready).toBe(false);
    // server is 5000 ms ahead; first sample has a slow, lopsided trip
    c.add(1000, 1400, 1000 + 5000 + 50);
    c.add(2000, 2020, 2010 + 5000);
    expect(c.rtt).toBe(20);
    expect(c.toLocal(10_000 + 5000)).toBe(10_000);
  });

  it("ignores samples with a negative round trip", () => {
    const c = new ClockSync();
    c.add(10, 5, 100);
    expect(c.ready).toBe(false);
  });
});
