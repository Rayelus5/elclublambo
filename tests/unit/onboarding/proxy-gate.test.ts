// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
    const res = await call("/c/x?a=1");
    expect(res.status).toBe(307);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.pathname).toBe("/bienvenida");
    expect(loc.searchParams.get("next")).toBe("/c/x?a=1");
  });

  it.each(["/guia", "/guia/dao", "/bienvenida", "/login", "/invite/abc", "/banned", "/no-access"])(
    "lets %s through while the welcome is incomplete",
    async (path) => {
      const res = await call(path);
      expect(res.headers.get("location")).toBeNull();
      expect(res.headers.get("x-middleware-next")).toBe("1");
    },
  );

  it("passes through when the welcome is completed", async () => {
    state.row = { data: { welcome_completed_at: "2026-10-18T00:00:00Z" }, error: null };
    const res = await call("/");
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("keeps the current behaviour for a non-member (no row)", async () => {
    state.row = { data: null, error: null };
    const res = await call("/");
    expect(res.headers.get("location")).toBeNull();
  });

  it("fails closed when the member row cannot be read", async () => {
    state.row = { data: null, error: { message: "boom" } };
    const res = await call("/");
    expect(new URL(res.headers.get("location")!).pathname).toBe("/bienvenida");
  });

  it("does not gate non-page requests", async () => {
    const res = await call("/c/x", { method: "POST" });
    expect(res.headers.get("location")).toBeNull();
    expect(state.membersReads).toBe(0);
  });

  it("overwrites a client-supplied x-pathname", async () => {
    state.row = { data: { welcome_completed_at: "2026-10-18T00:00:00Z" }, error: null };
    const res = await call("/perfil", { headers: { "x-pathname": "/guia/evil" } });
    expect(res.headers.get("x-middleware-request-x-pathname")).toBe("/perfil");
  });
});
