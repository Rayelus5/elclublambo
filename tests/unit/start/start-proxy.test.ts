// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// /start is the public landing: served with and without a session, never redirected (login, welcome).
const state = vi.hoisted(() => ({ user: null as { id: string } | null }));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    rpc: async () => ({ data: "active", error: null }),
    from: () => {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = () => q;
      // A member whose welcome is pending: any gated page would go to /bienvenida.
      q.maybeSingle = async () => ({ data: { welcome_completed_at: null }, error: null });
      return q;
    },
  }),
}));

import { proxy } from "@/proxy";
import { isPublicPath } from "@/lib/auth/public-paths";

process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";

const call = (path: string) => proxy(new NextRequest(`http://localhost:3000${path}`));

beforeEach(() => {
  state.user = null;
});

describe("isPublicPath for the landing", () => {
  it.each(["/start", "/start/opengraph-image", "/start/twitter-image", "/robots.txt"])("%s is public", (p) =>
    expect(isPublicPath(p)).toBe(true),
  );
  it.each(["/startx", "/starting", "/robots.txtx", "/robots"])("%s stays private", (p) => expect(isPublicPath(p)).toBe(false));
});

describe("proxy on /start", () => {
  it.each(["/start", "/start/opengraph-image", "/robots.txt"])("serves %s without a session (no login redirect)", async (path) => {
    const res = await call(path);
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("serves /start to a member whose welcome is pending (no /bienvenida redirect)", async () => {
    state.user = { id: "u1" };
    const res = await call("/start");
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("still sends an anonymous visitor of a private page to /login", async () => {
    const res = await call("/startx");
    expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
  });
});
