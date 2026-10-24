// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// /start is the public landing: served with and without a session, never redirected (login, welcome).
const state = vi.hoisted(() => ({ user: null as { id: string } | null, membership: "active" as string }));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    rpc: async () => ({ data: state.membership, error: null }),
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
  state.membership = "active";
});

describe("isPublicPath for the landing", () => {
  it.each(["/start", "/start/opengraph-image", "/start/twitter-image", "/robots.txt", "/sitemap.xml", "/en", "/en/tools", "/herramientas", "/herramientas/sorteos/nuevo"])("%s is public", (p) =>
    expect(isPublicPath(p)).toBe(true),
  );
  it.each(["/startx", "/starting", "/robots.txtx", "/robots", "/entities", "/herramientasx", "/es"])("%s stays private", (p) => expect(isPublicPath(p)).toBe(false));
});

describe("proxy on /start", () => {
  it("serves /robots.txt without a session (no login redirect)", async () => {
    const res = await call("/robots.txt");
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("rewrites /start to the internal Spanish tree without a session", async () => {
    const res = await call("/start");
    expect(res.headers.get("location")).toBeNull();
    expect(new URL(res.headers.get("x-middleware-rewrite")!).pathname).toBe("/es/start");
  });

  it("serves /start to a member whose welcome is pending (no /bienvenida redirect)", async () => {
    state.user = { id: "u1" };
    const res = await call("/start");
    expect(res.headers.get("location")).toBeNull();
    expect(new URL(res.headers.get("x-middleware-rewrite")!).pathname).toBe("/es/start");
  });

  it("serves the internal OG image without a session", async () => {
    const res = await call("/es/start/opengraph-image");
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("still sends an anonymous visitor of a private page to /login", async () => {
    const res = await call("/startx");
    expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
  });
});

describe("proxy on the public tree", () => {
  it("rewrites / to /es for an anonymous visitor (landing, no login redirect)", async () => {
    const res = await call("/");
    expect(res.headers.get("location")).toBeNull();
    expect(new URL(res.headers.get("x-middleware-rewrite")!).pathname).toBe("/es");
  });

  it("does not redirect /herramientas to /login", async () => {
    const res = await call("/herramientas");
    expect(res.headers.get("location")).toBeNull();
    expect(new URL(res.headers.get("x-middleware-rewrite")!).pathname).toBe("/es/tools");
  });

  it("serves /en/tools as is, without a session", async () => {
    const res = await call("/en/tools");
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("redirects /es/tools to /herramientas with a 308", async () => {
    const res = await call("/es/tools");
    expect(res.status).toBe(308);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/herramientas");
  });

  it("keeps the forum at / for an active member", async () => {
    state.user = { id: "u1" };
    state.membership = "active";
    const res = await call("/");
    expect(res.headers.get("x-middleware-rewrite")).toBeNull();
  });

  it("shows the landing at / to a signed-in account without membership", async () => {
    state.user = { id: "u1" };
    state.membership = "none";
    const res = await call("/");
    expect(new URL(res.headers.get("x-middleware-rewrite")!).pathname).toBe("/es");
  });
});
