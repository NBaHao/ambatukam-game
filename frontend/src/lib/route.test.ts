import { describe, expect, it } from "vitest";
import { parseRoute } from "./route";

describe("parseRoute", () => {
  it("reads challenge and profile links", () => {
    expect(parseRoute("/c/abc234")).toEqual({ name: "room", code: "abc234" });
    expect(parseRoute("/c/abc234/")).toEqual({ name: "room", code: "abc234" });
    expect(parseRoute("/u/Haro")).toEqual({ name: "profile", username: "haro" });
    const token = "aB3_-".repeat(9);
    expect(parseRoute(`/reset/${token}`)).toEqual({ name: "reset", token });
  });

  it("falls back to home", () => {
    for (const p of ["/", "/c/ABC234", "/c/abc", "/u/x", "/reset/short", "/whatever"]) expect(parseRoute(p)).toEqual({ name: "home" });
  });
});
