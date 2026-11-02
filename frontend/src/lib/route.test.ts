import { describe, expect, it } from "vitest";
import { parseRoute } from "./route";

describe("parseRoute", () => {
  it("reads challenge and profile links", () => {
    expect(parseRoute("/c/abc234")).toEqual({ name: "room", code: "abc234" });
    expect(parseRoute("/c/abc234/")).toEqual({ name: "room", code: "abc234" });
    expect(parseRoute("/u/Haro")).toEqual({ name: "profile", username: "haro" });
  });

  it("falls back to home", () => {
    for (const p of ["/", "/c/ABC234", "/c/abc", "/u/x", "/whatever"]) expect(parseRoute(p)).toEqual({ name: "home" });
  });
});
