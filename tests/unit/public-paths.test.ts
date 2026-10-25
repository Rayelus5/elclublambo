import { describe, it, expect } from "vitest";
import { isPublicPath, safeNextPath } from "@/lib/auth/public-paths";

describe("safeNextPath", () => {
  it.each(["/invites", "/admin/members?x=1", "/"])("%s kept", (p) => expect(safeNextPath(p)).toBe(p));
  it.each([null, "", "//evil.com", "/\\evil.com", "https://x", "evil", "/login", "/login/complete", "/a\\b", "/\t/evil.com", "/\n/evil.com", "/ /x", "/\u0000x", "/\u007fx"])(
    "%s -> /",
    (p) => expect(safeNextPath(p)).toBe("/"),
  );
});

describe("isPublicPath", () => {
  it.each(["/login", "/login/complete", "/invite/abc", "/invite/abc/x", "/no-access", "/banned"])("%s public", (p) =>
    expect(isPublicPath(p)).toBe(true),
  );
  it("lets the bearer-protected cron route past the login redirect", () => {
    expect(isPublicPath("/api/cron/dao")).toBe(true);
    expect(isPublicPath("/api/cronx")).toBe(false);
    expect(isPublicPath("/api")).toBe(false);
  });
  it("lets the public checker API through, with a boundary", () => {
    expect(isPublicPath("/api/v1/check/token")).toBe(true);
    expect(isPublicPath("/api/v1")).toBe(true);
    expect(isPublicPath("/api/v1x")).toBe(false);
    expect(isPublicPath("/api/v2/check/token")).toBe(false);
    expect(isPublicPath("/api/other")).toBe(false);
  });
  it.each(["/", "/loginx", "/invites", "/invite", "/admin/members", "/u/0xabc", "/banned2"])("%s private", (p) =>
    expect(isPublicPath(p)).toBe(false),
  );
});
