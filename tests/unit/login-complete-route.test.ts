import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const completeLogin = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/actions", () => ({ completeLogin }));

import { GET } from "@/app/(gate)/login/complete/route";

const call = (qs = "", site: string | null = "none") =>
  GET(
    new NextRequest(`http://localhost:3000/login/complete${qs}`, {
      headers: site === null ? {} : { "sec-fetch-site": site },
    }),
  );

describe("GET /login/complete", () => {
  beforeEach(() => {
    completeLogin.mockReset();
  });

  it("passes the invite code and redirects to the outcome", async () => {
    completeLogin.mockResolvedValue({ redirectTo: "/invite/abc?error=invite_expired" });
    const res = await call("?invite=abc");
    expect(completeLogin).toHaveBeenCalledWith("abc");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/invite/abc?error=invite_expired");
  });

  it("passes null without an invite", async () => {
    completeLogin.mockResolvedValue({ redirectTo: "/no-access" });
    const res = await call();
    expect(completeLogin).toHaveBeenCalledWith(null);
    expect(res.headers.get("location")).toBe("http://localhost:3000/no-access");
  });

  it.each(["invite_not_found", "unknown"])("passes the specific error %s through to /no-access like the JS path", async (error) => {
    completeLogin.mockResolvedValue({ redirectTo: "/no-access", error });
    const res = await call("?invite=abc");
    expect(res.headers.get("location")).toBe(`http://localhost:3000/no-access?error=${error}`);
  });

  it("honours a safe next only when the outcome is /", async () => {
    completeLogin.mockResolvedValue({ redirectTo: "/" });
    expect((await call("?next=/invites")).headers.get("location")).toBe("http://localhost:3000/invites");
  });

  it("ignores an unsafe next", async () => {
    completeLogin.mockResolvedValue({ redirectTo: "/" });
    expect((await call("?next=//evil.com")).headers.get("location")).toBe("http://localhost:3000/");
  });

  it.each(["/%09/evil.com", "/%0a/evil.com", "/%20/evil.com", "/%5cevil.com"])(
    "never redirects off-origin for next=%s",
    async (next) => {
      completeLogin.mockResolvedValue({ redirectTo: "/" });
      const loc = (await call(`?next=${next}`)).headers.get("location")!;
      expect(new URL(loc).origin).toBe("http://localhost:3000");
      expect(loc).toBe("http://localhost:3000/");
    },
  );

  it("falls back to / if the target resolves off-origin", async () => {
    completeLogin.mockResolvedValue({ redirectTo: "//evil.com" });
    expect((await call()).headers.get("location")).toBe("http://localhost:3000/");
  });

  it("never lets next override a non-/ outcome", async () => {
    completeLogin.mockResolvedValue({ redirectTo: "/banned" });
    expect((await call("?next=/invites")).headers.get("location")).toBe("http://localhost:3000/banned");
  });

  it.each(["same-origin", "none"])("proceeds when Sec-Fetch-Site is %s", async (site) => {
    completeLogin.mockResolvedValue({ redirectTo: "/" });
    await call("", site);
    expect(completeLogin).toHaveBeenCalledTimes(1);
  });

  it.each(["cross-site", "same-site", null])("does not run completeLogin when Sec-Fetch-Site is %s", async (site) => {
    const res = await call("?invite=abc", site);
    expect(completeLogin).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toBe("http://localhost:3000/login");
  });
});
