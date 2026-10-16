import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const completeLogin = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/actions", () => ({ completeLogin }));

import { GET } from "@/app/(gate)/login/complete/route";

const call = (qs = "") => GET(new NextRequest(`http://localhost:3000/login/complete${qs}`));

describe("GET /login/complete", () => {
  beforeEach(() => completeLogin.mockReset());

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

  it("honours a safe next only when the outcome is /", async () => {
    completeLogin.mockResolvedValue({ redirectTo: "/" });
    expect((await call("?next=/invites")).headers.get("location")).toBe("http://localhost:3000/invites");
  });

  it("ignores an unsafe next", async () => {
    completeLogin.mockResolvedValue({ redirectTo: "/" });
    expect((await call("?next=//evil.com")).headers.get("location")).toBe("http://localhost:3000/");
  });

  it("never lets next override a non-/ outcome", async () => {
    completeLogin.mockResolvedValue({ redirectTo: "/banned" });
    expect((await call("?next=/invites")).headers.get("location")).toBe("http://localhost:3000/banned");
  });
});
