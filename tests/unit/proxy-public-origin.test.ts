// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
// Administración: the site is open (no maintenance, every switch on) unless a test says otherwise.
vi.mock("@/lib/admin/site-state", async () => {
  const { OPEN_STATE } = await import("@/lib/admin/state");
  return { getSiteState: async () => OPEN_STATE };
});

// Docker standalone on PRE: Next binds HOSTNAME=0.0.0.0:3000 behind the Cloudflare Tunnel, so request.nextUrl is the
// bind address. The proxy's redirects must point at the public site (NEXT_PUBLIC_SITE_URL); rewrites stay internal.
const state = vi.hoisted(() => ({
  user: null as { id: string } | null,
  welcome: null as string | null,
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    rpc: async () => ({ data: "active", error: null }),
    from: () => {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = () => q;
      q.maybeSingle = async () => ({ data: { welcome_completed_at: state.welcome }, error: null });
      return q;
    },
  }),
}));

import { proxy } from "@/proxy";

process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";

const docker = (path: string) => proxy(new NextRequest(`http://0.0.0.0:3000${path}`));

beforeEach(() => {
  state.user = null;
  state.welcome = null;
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://pre.elclub.party");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("proxy redirects behind the tunnel", () => {
  it("308s a direct /es visit to its Spanish URL on the public host", async () => {
    const res = await docker("/es/tools");
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe("https://pre.elclub.party/herramientas");
  });

  it("keeps the query string on the 308", async () => {
    const res = await docker("/es/tools?x=1&y=2");
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe("https://pre.elclub.party/herramientas?x=1&y=2");
  });

  it("sends an anonymous visitor of a club page to the public /foro/login with next", async () => {
    const res = await docker("/foro/c/general?a=1");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://pre.elclub.party/foro/login?next=%2Fforo%2Fc%2Fgeneral");
  });

  it("sends a member with a pending welcome to the public /foro/bienvenida with next", async () => {
    state.user = { id: "u1" };
    const res = await docker("/foro/c/general?a=1");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://pre.elclub.party/foro/bienvenida?next=%2Fforo%2Fc%2Fgeneral%3Fa%3D1");
  });

  // R1: the club moved under /foro; old links (shared invites, bookmarks, delivered push notifications) 308 there,
  // same path and query, before any session gate.
  it.each([
    ["/c/abc?m=1", "/foro/c/abc?m=1"],
    ["/invite/Zx_9?x=1", "/foro/invite/Zx_9?x=1"],
    ["/login", "/foro/login"],
    ["/bienvenida?next=%2Fc%2Fx", "/foro/bienvenida?next=%2Fc%2Fx"],
    ["/donar/x", "/foro/donar/x"],
  ])("308s the old club URL %s to %s on the public host, signed out", async (from, to) => {
    const res = await docker(from);
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe(`https://pre.elclub.party${to}`);
  });

  it("308s an old club URL before the welcome gate (signed in, welcome pending)", async () => {
    state.user = { id: "u1" };
    const res = await docker("/c/abc?m=1");
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe("https://pre.elclub.party/foro/c/abc?m=1");
  });

  it("keeps rewrites internal (Spanish URL served from the /es tree, no redirect)", async () => {
    const res = await docker("/herramientas");
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-rewrite")).toContain("/es/tools");
  });
});
