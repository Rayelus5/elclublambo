import { describe, it, expect } from "vitest";
import { resolvePostLogin } from "@/lib/auth/post-login";

type S = "none" | "active" | "banned" | "left";
const r = (status: S, isSuperAdmin: boolean, inviteCode: string | null) =>
  resolvePostLogin({ status, isSuperAdmin, inviteCode });

describe("resolvePostLogin", () => {
  it("active -> enter", () => expect(r("active", false, null)).toBe("enter"));
  it("active superadmin -> enter", () => expect(r("active", true, "x")).toBe("enter"));
  it("banned -> banned", () => expect(r("banned", false, "x")).toBe("banned"));
  it("banned + superadmin -> banned", () => expect(r("banned", true, "x")).toBe("banned"));
  it("none + superadmin -> bootstrap", () => expect(r("none", true, null)).toBe("bootstrap"));
  it("none + code -> redeem", () => expect(r("none", false, "abc")).toBe("redeem"));
  it("none, nothing -> no_access", () => expect(r("none", false, null)).toBe("no_access"));
  it("left -> no_access (even with code or superadmin)", () => {
    expect(r("left", false, "abc")).toBe("no_access");
    expect(r("left", true, "abc")).toBe("no_access");
  });
});
