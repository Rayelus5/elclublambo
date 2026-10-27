import { describe, it, expect } from "vitest";
import { isPublicPath, safeClubNextPath, safeNextPath } from "@/lib/auth/public-paths";

describe("safeNextPath", () => {
  it.each(["/foro/invites", "/foro/admin/members?x=1", "/foro", "/", "/herramientas"])("%s kept", (p) => expect(safeNextPath(p)).toBe(p));
  it.each([null, "", "//evil.com", "/\\evil.com", "https://x", "evil", "/foro/login", "/foro/login/complete", "/foro/login?next=/x", "/login", "/login/complete", "/a\\b", "/\t/evil.com", "/\n/evil.com", "/ /x", "/\u0000x", "/\u007fx"])(
    "%s -> /foro (R1-R4)",
    (p) => expect(safeNextPath(p)).toBe("/foro"),
  );
  it("keeps /foro/loginx (not the login page)", () => expect(safeNextPath("/foro/loginx")).toBe("/foro/loginx"));
  it("takes another fallback (the public connect goes back to the landing)", () => {
    expect(safeNextPath(null, "/")).toBe("/");
    expect(safeNextPath("//evil.com", "/")).toBe("/");
    expect(safeNextPath("/foro/login", "/")).toBe("/");
    expect(safeNextPath("/herramientas", "/")).toBe("/herramientas");
  });
});

describe("safeClubNextPath", () => {
  it("maps an exact / to the club home", () => {
    expect(safeClubNextPath("/")).toBe("/foro");
  });
  it("behaves like safeNextPath otherwise", () => {
    expect(safeClubNextPath("/foro/invites")).toBe("/foro/invites");
    expect(safeClubNextPath("/?x=1")).toBe("/?x=1");
    expect(safeClubNextPath("//evil.com")).toBe("/foro");
    expect(safeClubNextPath(null)).toBe("/foro");
  });
});

describe("isPublicPath", () => {
  it.each(["/foro/login", "/foro/login/complete", "/foro/invite/abc", "/foro/invite/abc/x", "/foro/no-access", "/foro/banned"])("%s public", (p) =>
    expect(isPublicPath(p)).toBe(true),
  );
  it("lets the bearer-protected cron route past the login redirect", () => {
    expect(isPublicPath("/api/cron/dao")).toBe(true);
    expect(isPublicPath("/api/cronx")).toBe(false);
    expect(isPublicPath("/api")).toBe(false);
  });
  it("lets the team access endpoint through (signed on the maintenance page)", () => {
    expect(isPublicPath("/api/team-access")).toBe(true);
    expect(isPublicPath("/api/team-accessx")).toBe(false);
  });
  it("lets the public checker API through, with a boundary", () => {
    expect(isPublicPath("/api/v1/check/token")).toBe(true);
    expect(isPublicPath("/api/v1")).toBe(true);
    expect(isPublicPath("/api/v1x")).toBe(false);
    expect(isPublicPath("/api/v2/check/token")).toBe(false);
    expect(isPublicPath("/api/other")).toBe(false);
  });
  it.each(["/", "/foro", "/foro/loginx", "/foro/invites", "/foro/invite", "/foro/admin/members", "/foro/u/0xabc", "/foro/banned2", "/foro/c/x"])("%s private", (p) =>
    expect(isPublicPath(p)).toBe(false),
  );
  it.each(["/login", "/invite/abc", "/no-access", "/banned"])("the old root gate page %s is no longer public (it 308s)", (p) =>
    expect(isPublicPath(p)).toBe(false),
  );
});
