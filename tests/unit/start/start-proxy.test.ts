// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
// Administración: the site is open (no maintenance, every switch on) unless a test says otherwise.
vi.mock("@/lib/admin/site-state", async () => {
  const { OPEN_STATE } = await import("@/lib/admin/state");
  return { getSiteState: async () => OPEN_STATE };
});

// /start is the public landing: served with and without a session, never redirected (login, welcome).
const state = vi.hoisted(() => ({ user: null as { id: string } | null, membership: "active" as string, rpcs: [] as string[] }));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    rpc: async (fn: string) => {
      state.rpcs.push(fn);
      return { data: state.membership, error: null };
    },
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
  state.rpcs = [];
});

describe("isPublicPath for the landing", () => {
  it.each(["/start", "/start/opengraph-image", "/start/twitter-image", "/robots.txt", "/sitemap.xml", "/en", "/en/tools", "/herramientas", "/herramientas/sorteos/nuevo", "/pay/rayelus", "/pay/tx/84532/0x1"])("%s is public", (p) =>
    expect(isPublicPath(p)).toBe(true),
  );
  it.each(["/startx", "/starting", "/robots.txtx", "/robots", "/entities", "/herramientasx", "/es"])("%s stays private", (p) => expect(isPublicPath(p)).toBe(false));
  // The landing and the public donate page: exact paths only ("/" is no prefix, /donar/x is the club's).
  it.each(["/", "/donar"])("%s is public (exact)", (p) => expect(isPublicPath(p)).toBe(true));
  it.each(["/donar/x", "/donarx", "/foro"])("%s is not made public by the exact entries", (p) => expect(isPublicPath(p)).toBe(false));
});

describe("proxy on /start", () => {
  it("serves /robots.txt without a session (no login redirect)", async () => {
    const res = await call("/robots.txt");
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  // The rewrite to the internal tree is next.config's (tests/unit/i18n/route-rules.test.ts): the proxy lets it through.
  it("lets /start through without a session (no login redirect)", async () => {
    const res = await call("/start");
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-rewrite")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("serves /start to a member whose welcome is pending (no /bienvenida redirect)", async () => {
    state.user = { id: "u1" };
    const res = await call("/start");
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("serves the internal OG image without a session", async () => {
    const res = await call("/es/start/opengraph-image");
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("still sends an anonymous visitor of a private page to /foro/login", async () => {
    const res = await call("/foro/startx");
    expect(new URL(res.headers.get("location")!).pathname).toBe("/foro/login");
  });

  it("an unknown look-alike (/startx) is the custom 404, not the login (I1)", async () => {
    const res = await call("/startx");
    expect(res.status).toBe(404);
    expect(res.headers.get("location")).toBeNull();
  });
});

describe("proxy on the public tree", () => {
  // next.config rewrites / to /es after the proxy: the proxy sees "/" itself and must never send it to the login.
  it("lets / (the landing) through for an anonymous visitor, no login redirect", async () => {
    const res = await call("/");
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("does not redirect /herramientas to /login", async () => {
    const res = await call("/herramientas");
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("serves /en/tools as is, without a session", async () => {
    const res = await call("/en/tools");
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  // R1-R3: the club lives under /foro, so "/" is the landing for everyone and costs no membership read.
  it("shows the landing at / to an active member whose welcome is pending, without reading the membership", async () => {
    state.user = { id: "u1" };
    state.membership = "active";
    const res = await call("/");
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
    expect(state.rpcs).not.toContain("my_membership_status");
  });

  it("shows the landing at / to a signed-in account without membership", async () => {
    state.user = { id: "u1" };
    state.membership = "none";
    const res = await call("/");
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });
});

describe("proxy on /donar and /pay (P3)", () => {
  it("shows the public donate page to an anonymous visitor (no login redirect)", async () => {
    const res = await call("/donar");
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("shows the public donate page to a signed-in non-member", async () => {
    state.user = { id: "u1" };
    state.membership = "none";
    const res = await call("/donar");
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("shows the public donate page to an active member whose welcome is pending (R1-R3), without reading the membership", async () => {
    state.user = { id: "u1" };
    state.membership = "active";
    const res = await call("/donar");
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
    expect(state.rpcs).not.toContain("my_membership_status");
  });

  it("still gates what /donar never was: a deeper /donar/x is the club's (next.config 308s it to /foro first)", async () => {
    const res = await call("/donar/x");
    expect(new URL(res.headers.get("location")!).pathname).toBe("/foro/login");
  });

  it("gates the club donations page at /foro/donar (here the mocked pending welcome)", async () => {
    state.user = { id: "u1" };
    const res = await call("/foro/donar");
    expect(new URL(res.headers.get("location")!).pathname).toBe("/foro/bienvenida");
  });

  it("serves /pay/<address> without a session", async () => {
    const res = await call("/pay/0xAbCdEf0123456789abcdef0123456789ABCDEF01");
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });
});
