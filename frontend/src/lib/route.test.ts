import { describe, expect, it } from "vitest";
import { inviteUrl, parseRoute } from "./route";

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

describe("inviteUrl", () => {
  it("carries the inviter's language only when it is Vietnamese", () => {
    const origin = "https://ambatukam.bahao.site";
    expect(inviteUrl("abc234", "vi", origin)).toBe(`${origin}/c/abc234?lang=vi`);
    expect(inviteUrl("abc234", "en", origin)).toBe(`${origin}/c/abc234`);
  });
});
