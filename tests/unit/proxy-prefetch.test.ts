// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// T-006: a router prefetch only receives the route's static App Shell (partialPrefetching), so the per-page checks of
// the proxy (welcome gate, 404 guards) cannot change what it gets. They run again on the navigation request itself.
// The session is still validated: a signed-out prefetch is redirected like any other request.
const state = vi.hoisted(() => ({ user: { id: "u1" } as { id: string } | null, getUser: 0, db: 0 }));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getUser: async () => {
        state.getUser += 1;
        return { data: { user: state.user } };
      },
    },
    rpc: async (fn: string) => {
      state.db += 1;
      return { data: fn === "my_membership_status" ? "active" : null, error: null };
    },
    from: () => {
      state.db += 1;
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = () => q;
      // Nothing readable: the welcome is pending and the channel is "missing", so a checked request is redirected.
      q.maybeSingle = async () => ({ data: null, error: null });
      return q;
    },
  }),
}));

import { proxy } from "@/proxy";

process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";

const CHANNEL = "/c/0b7c1e0a-1111-4222-8333-944455556666";
const call = (path: string, headers?: Record<string, string>) => proxy(new NextRequest(`http://localhost:3000${path}`, { headers }));

beforeEach(() => {
  state.user = { id: "u1" };
  state.getUser = 0;
  state.db = 0;
});

describe("proxy and router prefetches", () => {
  it.each([
    ["next-router-prefetch", "1"],
    ["next-router-segment-prefetch", "/_tree"],
  ])("lets a %s request through after checking the session, without the page checks", async (name, value) => {
    const res = await call(CHANNEL, { rsc: "1", [name]: value });
    expect(res.headers.get("x-middleware-next")).toBe("1");
    expect(res.headers.get("x-middleware-rewrite")).toBeNull();
    expect(state.getUser).toBe(1);
    expect(state.db).toBe(0);
  });

  it("still runs the 404 guard on the navigation request", async () => {
    const res = await call(CHANNEL, { rsc: "1" });
    expect(res.status).toBe(404);
    expect(state.db).toBeGreaterThan(0);
  });

  it("redirects a signed-out prefetch to /login", async () => {
    state.user = null;
    const res = await call(CHANNEL, { rsc: "1", "next-router-prefetch": "1" });
    expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
  });
});
