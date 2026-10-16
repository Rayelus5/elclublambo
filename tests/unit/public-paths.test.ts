import { describe, it, expect } from "vitest";
import { isPublicPath, safeNextPath } from "@/lib/auth/public-paths";

describe("safeNextPath", () => {
  it.each(["/invites", "/admin/members?x=1", "/"])("%s kept", (p) => expect(safeNextPath(p)).toBe(p));
  it.each([null, "", "//evil.com", "/\\evil.com", "https://x", "evil", "/login", "/login/complete", "/a\\b"])(
    "%s -> /",
    (p) => expect(safeNextPath(p)).toBe("/"),
  );
});

describe("isPublicPath", () => {
  it.each(["/login", "/login/complete", "/invite/abc", "/invite/abc/x", "/no-access", "/banned"])("%s public", (p) =>
    expect(isPublicPath(p)).toBe(true),
  );
  it.each(["/", "/loginx", "/invites", "/invite", "/admin/members", "/u/0xabc", "/banned2"])("%s private", (p) =>
    expect(isPublicPath(p)).toBe(false),
  );
});
