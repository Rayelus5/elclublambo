// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
// Administración: the site is open (no maintenance, every switch on) unless a test says otherwise.
vi.mock("@/lib/admin/site-state", async () => {
  const { OPEN_STATE } = await import("@/lib/admin/state");
  return { getSiteState: async () => OPEN_STATE };
});

const state = vi.hoisted(() => ({
  user: null as { id: string } | null,
  view: { data: { alias: "rayelus" } as unknown, error: null as { message: string } | null },
  reads: [] as string[],
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    rpc: async () => ({ data: "active", error: null }),
    from: () => {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = () => q;
      q.in = () => q;
      q.limit = () => q;
      q.maybeSingle = async () => ({ data: { welcome_completed_at: "2026-10-18T00:00:00Z" }, error: null });
      return q;
    },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "x" }, error: null }) }) }) }),
    rpc: async (fn: string, args: { p_target: string }) => {
      state.reads.push(`${fn}:${args.p_target}`);
      return state.view;
    },
  }),
}));

import { proxy } from "@/proxy";
import { NOT_FOUND_PATH } from "@/lib/channels/guard";

process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";

const ADDRESS = `0x${"ab".repeat(20)}`;
const call = (path: string) => proxy(new NextRequest(`http://localhost:3000${path}`));
const rewrittenTo = (res: Response) => {
  const r = res.headers.get("x-middleware-rewrite");
  return r ? new URL(r).pathname : null;
};

beforeEach(() => {
  state.user = null;
  state.view = { data: { alias: "rayelus" }, error: null };
  state.reads = [];
});

describe("proxy · unknown pay alias", () => {
  it("a missing alias answers 404, in Spanish and English, with or without a session", async () => {
    state.view = { data: null, error: null };
    for (const user of [null, { id: "u1" }]) {
      state.user = user;
      for (const p of ["/pay/nobody", "/en/pay/nobody"]) {
        const res = await call(p);
        expect(res.status, p).toBe(404);
        expect(rewrittenTo(res)).toBe(NOT_FOUND_PATH);
      }
    }
    expect(state.reads[0]).toBe("public_profile_view:nobody");
  });

  it("an existing alias is served (ES rewrite, EN passes)", async () => {
    const es = await call("/pay/rayelus");
    expect(es.status).toBe(200);
    expect(rewrittenTo(es)).toBe("/es/pay/rayelus");
    const en = await call("/en/pay/rayelus");
    expect(en.status).toBe(200);
    expect(en.headers.get("x-middleware-next")).toBe("1");
  });

  it("an address never 404s and is not looked up", async () => {
    state.view = { data: null, error: null };
    for (const p of [`/pay/${ADDRESS}`, `/en/pay/${ADDRESS}`]) {
      expect((await call(p)).status).toBe(200);
    }
    expect(state.reads).toEqual([]);
  });

  it("a read error lets the page answer (fail open)", async () => {
    state.view = { data: null, error: { message: "boom" } };
    expect((await call("/en/pay/rayelus")).status).toBe(200);
  });

  it("the badge and the share cards are not checked", async () => {
    state.view = { data: null, error: null };
    for (const p of ["/pay/nobody/badge", "/en/pay/nobody/badge", "/en/pay/nobody/opengraph-image", "/es/pay/nobody/opengraph-image"]) {
      expect((await call(p)).status, p).not.toBe(404);
    }
    expect(state.reads).toEqual([]);
  });

  it("a bare /pay and a too short alias are a real 404, anonymous or not", async () => {
    for (const user of [null, { id: "u1" }]) {
      state.user = user;
      for (const p of ["/pay", "/pay/ab", "/en/pay", "/en/pay/ab"]) {
        const res = await call(p);
        expect(res.status, `${p} ${user ? "member" : "anon"}`).toBe(404);
        expect(rewrittenTo(res)).toBe(NOT_FOUND_PATH);
      }
    }
    expect(state.reads).toEqual([]);
  });
});
