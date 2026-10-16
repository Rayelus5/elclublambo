import { describe, it, expect } from "vitest";
import { isPublicPath } from "@/lib/auth/public-paths";

describe("isPublicPath", () => {
  it.each(["/login", "/login/complete", "/invite/abc", "/invite/abc/x", "/no-access", "/banned"])("%s public", (p) =>
    expect(isPublicPath(p)).toBe(true),
  );
  it.each(["/", "/loginx", "/invites", "/invite", "/admin/members", "/u/0xabc", "/banned2"])("%s private", (p) =>
    expect(isPublicPath(p)).toBe(false),
  );
});
