// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const state = vi.hoisted(() => ({
  user: { id: "u1" } as { id: string } | null,
  giveaway: { data: { id: "g" }, error: null } as { data: unknown; error: { message: string } | null },
  giveawayReads: [] as string[],
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
    from: (table: string) => ({
      select: () => ({
        eq: (_col: string, id: string) => ({
          maybeSingle: async () => {
            state.giveawayReads.push(`${table}:${id}`);
            return state.giveaway;
          },
        }),
      }),
    }),
  }),
}));

import { proxy } from "@/proxy";
import { NOT_FOUND_PATH } from "@/lib/channels/guard";

process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";

const ID = "3f1c0b9e-1111-4c4c-8888-000000000001";
const call = (path: string) => proxy(new NextRequest(`http://localhost:3000${path}`));
const rewrittenTo = (res: Response) => {
  const r = res.headers.get("x-middleware-rewrite");
  return r ? new URL(r).pathname : null;
};

beforeEach(() => {
  state.user = { id: "u1" };
  state.giveaway = { data: { id: ID }, error: null };
  state.giveawayReads = [];
});

describe("proxy · unknown top-level segment (item 1)", () => {
  it("a signed-in visitor on /xx gets a real 404", async () => {
    const res = await call("/xx");
    expect(res.status).toBe(404);
    expect(rewrittenTo(res)).toBe(NOT_FOUND_PATH);
  });

  it("an anonymous visitor on /xx still goes to /foro/login", async () => {
    state.user = null;
    const res = await call("/xx");
    expect(new URL(res.headers.get("location")!).pathname).toBe("/foro/login");
  });

  it("known top-level pages are not touched", async () => {
    for (const p of ["/foro", "/foro/perfil", "/en", "/robots.txt"]) {
      const res = await call(p);
      expect(res.status).not.toBe(404);
    }
  });
});

describe("proxy · unknown public giveaway (item 2)", () => {
  it("a missing giveaway behind a Spanish URL answers 404 (anonymous too)", async () => {
    state.user = null;
    state.giveaway = { data: null, error: null };
    const res = await call(`/herramientas/sorteos/${ID}`);
    expect(res.status).toBe(404);
    expect(rewrittenTo(res)).toBe(NOT_FOUND_PATH);
    expect(state.giveawayReads).toEqual([`public_giveaways:${ID}`]);
  });

  it("a missing giveaway behind an English URL answers 404 (anonymous and signed in)", async () => {
    state.giveaway = { data: null, error: null };
    for (const user of [null, { id: "u1" }]) {
      state.user = user;
      const res = await call(`/en/tools/giveaways/${ID}`);
      expect(res.status).toBe(404);
      expect(rewrittenTo(res)).toBe(NOT_FOUND_PATH);
    }
  });

  it("an existing giveaway is served (ES rewrite to the internal tree, EN passes)", async () => {
    state.user = null;
    const es = await call(`/herramientas/sorteos/${ID}`);
    expect(es.status).toBe(200);
    expect(rewrittenTo(es)).toBe(`/es/tools/giveaways/${ID}`);
    const en = await call(`/en/tools/giveaways/${ID}`);
    expect(en.status).toBe(200);
    expect(en.headers.get("x-middleware-next")).toBe("1");
  });

  it("a read error lets the page answer (fail open)", async () => {
    state.giveaway = { data: null, error: { message: "boom" } };
    const res = await call(`/en/tools/giveaways/${ID}`);
    expect(res.status).toBe(200);
  });

  it("only the page itself: the OG image and the entries route are not checked", async () => {
    state.giveaway = { data: null, error: null };
    state.user = null;
    for (const p of [`/en/tools/giveaways/${ID}/opengraph-image`, `/es/tools/giveaways/${ID}/opengraph-image`, `/en/tools/giveaways/${ID}/entries`, `/herramientas/sorteos/nuevo`]) {
      const res = await call(p);
      expect(res.status).not.toBe(404);
    }
    expect(state.giveawayReads).toEqual([]);
  });
});
