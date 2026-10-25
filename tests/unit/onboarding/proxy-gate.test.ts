// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

type Row = { data: { welcome_completed_at: string | null } | null; error: { message: string } | null };
const state = vi.hoisted(() => ({
  user: { id: "u1" } as { id: string } | null,
  row: { data: { welcome_completed_at: null }, error: null } as Row,
  membersReads: 0,
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    rpc: async () => ({ data: "active", error: null }),
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = () => q;
      q.maybeSingle = async () => {
        if (table === "members") {
          state.membersReads += 1;
          return state.row;
        }
        return { data: { id: "x" }, error: null };
      };
      return q;
    },
  }),
}));

import { proxy } from "@/proxy";

process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";

const call = (path: string, init?: { method?: string; headers?: Record<string, string> }) =>
  proxy(new NextRequest(`http://localhost:3000${path}`, init));

beforeEach(() => {
  state.user = { id: "u1" };
  state.row = { data: { welcome_completed_at: null }, error: null };
  state.membersReads = 0;
});

describe("proxy onboarding gate", () => {
  it("redirects an incomplete member to /bienvenida with the encoded path and query", async () => {
    const res = await call("/foro/c/x?a=1");
    expect(res.status).toBe(307);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.pathname).toBe("/foro/bienvenida");
    expect(loc.searchParams.get("next")).toBe("/foro/c/x?a=1");
  });

  it.each([
    "/foro/guia",
    "/foro/guia/dao",
    "/foro/bienvenida",
    "/foro/login",
    "/foro/invite/abc",
    "/foro/banned",
    "/foro/no-access",
    "/es/opengraph-image",
    "/es/start/twitter-image-1a2b3c",
    "/es/tools/giveaways/3f1c0b9e-1111-4c4c-8888-000000000001/opengraph-image",
  ])(
    "lets %s through while the welcome is incomplete",
    async (path) => {
      const res = await call(path);
      expect(res.headers.get("location")).toBeNull();
      expect(res.headers.get("x-middleware-next")).toBe("1");
    },
  );

  it("passes through when the welcome is completed", async () => {
    state.row = { data: { welcome_completed_at: "2026-10-18T00:00:00Z" }, error: null };
    const res = await call("/foro");
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("keeps the current behaviour for a non-member (no row)", async () => {
    state.row = { data: null, error: null };
    const res = await call("/foro");
    expect(res.headers.get("location")).toBeNull();
  });

  it("fails closed when the member row cannot be read", async () => {
    state.row = { data: null, error: { message: "boom" } };
    const res = await call("/foro");
    expect(new URL(res.headers.get("location")!).pathname).toBe("/foro/bienvenida");
  });

  it("does not gate non-page requests", async () => {
    const res = await call("/foro/c/x", { method: "POST" });
    expect(res.headers.get("location")).toBeNull();
    expect(state.membersReads).toBe(0);
  });

  it("overwrites a client-supplied x-pathname", async () => {
    state.row = { data: { welcome_completed_at: "2026-10-18T00:00:00Z" }, error: null };
    const res = await call("/foro/perfil", { headers: { "x-pathname": "/foro/guia/evil" } });
    expect(res.headers.get("x-middleware-request-x-pathname")).toBe("/foro/perfil");
  });
});

// T-006: the proxy runs on every page request, router prefetches included (one per link in view), and Next strips the
// router headers before it, so prefetches cannot be told apart. The welcome is set once and never undone
// (coalesce in complete_welcome), so once the read sees it completed, a cookie bound to the user remembers it and later
// requests skip the read. A cookie for anyone else is ignored. It is a UX gate: the forum layout re-checks the row.
describe("proxy welcome memo", () => {
  const done = { data: { welcome_completed_at: "2026-10-18T00:00:00Z" }, error: null };

  it("remembers a completed welcome in an httpOnly cookie bound to the user and skips the read afterwards", async () => {
    state.row = done;
    const first = await call("/foro");
    expect(state.membersReads).toBe(1);
    const cookie = first.cookies.get("ecl_welcomed");
    expect(cookie?.value).toBe("u1");
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("lax");

    const second = await call("/foro/c/x", { headers: { cookie: "ecl_welcomed=u1" } });
    expect(second.headers.get("location")).toBeNull();
    expect(state.membersReads).toBe(1);
  });

  it("ignores a memo cookie of another user", async () => {
    state.row = { data: { welcome_completed_at: null }, error: null };
    const res = await call("/foro", { headers: { cookie: "ecl_welcomed=someone-else" } });
    expect(state.membersReads).toBe(1);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/foro/bienvenida");
  });

  it("keeps the memo a year, httpOnly, lax, on the whole site, and not Secure on a plain-http site", async () => {
    state.row = done;
    delete process.env.NEXT_PUBLIC_SITE_URL;
    const cookie = (await call("/foro")).cookies.get("ecl_welcomed");
    expect(cookie).toMatchObject({ value: "u1", httpOnly: true, sameSite: "lax", path: "/", maxAge: 31_536_000 });
    expect(cookie?.secure).toBeFalsy();
  });

  // Same rule as HSTS (F5-R4): behind the Cloudflare Tunnel the request reaches Next as http://web:3000, so the
  // request protocol cannot decide it; the public site URL does.
  it("is Secure whenever the public site URL is https, even when the request arrives over http", async () => {
    state.row = done;
    process.env.NEXT_PUBLIC_SITE_URL = "https://www.elclub.party";
    try {
      const cookie = (await call("/foro")).cookies.get("ecl_welcomed");
      expect(cookie?.secure).toBe(true);
    } finally {
      delete process.env.NEXT_PUBLIC_SITE_URL;
    }
  });

  it("clears the memo once the session is gone (signed out)", async () => {
    state.user = null;
    // A private page: signed out, "/" is the public landing now (it clears the memo too, but does not go to /login).
    const res = await call("/foro/perfil", { headers: { cookie: "ecl_welcomed=u1" } });
    expect(new URL(res.headers.get("location")!).pathname).toBe("/foro/login");
    const cleared = res.cookies.get("ecl_welcomed");
    expect(cleared?.value).toBe("");
    expect(cleared?.maxAge === 0 || (cleared?.expires instanceof Date && cleared.expires.getTime() <= Date.now())).toBe(true);
  });

  it("leaves a signed-out request without the memo alone", async () => {
    state.user = null;
    const res = await call("/foro");
    expect(res.cookies.get("ecl_welcomed")).toBeUndefined();
  });

  it("does not set the memo while the welcome is pending, nor for a non-member", async () => {
    const pending = await call("/foro");
    expect(pending.cookies.get("ecl_welcomed")).toBeUndefined();
    state.row = { data: null, error: null };
    const outsider = await call("/foro");
    expect(outsider.cookies.get("ecl_welcomed")).toBeUndefined();
  });
});
