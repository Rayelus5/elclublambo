import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  path: "/foro/guia/dao",
  welcome: { handle: null, welcome_completed_at: null } as { handle: string | null; welcome_completed_at: string | null } | null,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-pathname": state.path }) }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
  usePathname: () => "/foro/guia/dao",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));
const after = vi.hoisted(() => vi.fn());
vi.mock("next/server", () => ({ after }));
vi.mock("@/lib/payments/confirm", () => ({ reverifyMyPendingIntents: async () => {} }));
vi.mock("@/lib/channels/queries", () => ({ getVisibleChannels: async () => [], getLockedChannels: async () => [], toRow: (c: unknown) => c }));
vi.mock("@/lib/economy/config", () => ({ getEconomyConfig: async () => ({ activeChainId: 59141 }) }));
vi.mock("@/lib/auth/wallet", () => ({ walletFromUser: () => "0xd590d5d858d5b61c357e7a40ee6b6a72d938b82d" }));
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    rpc: async (fn: string) => {
      if (fn === "my_membership_status") return { data: "active", error: null };
      if (fn === "current_member_id") return { data: "m1", error: null };
      return { data: 0, error: null };
    },
    from: () => {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = () => q;
      q.maybeSingle = async () => ({ data: state.welcome, error: null });
      q.then = (res: (v: unknown) => unknown) => res({ count: 0, error: null });
      return q;
    },
  }),
}));

import ForumLayout from "@/app/foro/(forum)/layout";

async function renderShell() {
  const tree = ForumLayout({ children: <p>contenido</p> } as never) as React.ReactElement<{ children: React.ReactElement }>;
  const shell = tree.props.children as React.ReactElement<Record<string, unknown>> & { type: (p: unknown) => Promise<React.ReactNode> };
  return render(<>{await shell.type(shell.props)}</>);
}

describe("ForumLayout onboarding gate", () => {
  beforeEach(() => {
    state.path = "/foro/guia/dao";
    state.welcome = { handle: null, welcome_completed_at: null };
  });

  it("renders /guia during onboarding without any forum navigation", async () => {
    await renderShell();
    expect(screen.getByText("contenido")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Volver a la bienvenida" }).getAttribute("href")).toBe("/bienvenida");
    expect(screen.queryByRole("navigation", { name: "Principal" })).toBeNull();
    expect(screen.queryByText("Canales")).toBeNull();
    expect(screen.queryByRole("search")).toBeNull();
  });

  it("redirects other paths during onboarding, keeping the path", async () => {
    state.path = "/foro/c/abc?x=1";
    await expect(renderShell()).rejects.toThrow(`REDIRECT:/foro/bienvenida?next=${encodeURIComponent("/foro/c/abc?x=1")}`);
  });

  it("fails closed when the member row is missing", async () => {
    state.path = "/foro/perfil";
    state.welcome = null;
    await expect(renderShell()).rejects.toThrow("REDIRECT:/foro/bienvenida?next=%2Fforo%2Fperfil");
  });
});

describe("ForumLayout background rechecks (F5 S2)", () => {
  it("schedules the member's payment rechecks at most once per throttle window, so reload spam cannot multiply RPC reads", async () => {
    const { resetRecheckThrottle } = await import("@/lib/payments/recheck-throttle");
    resetRecheckThrottle();
    state.path = "/foro/guia/dao";
    state.welcome = { handle: null, welcome_completed_at: null };
    after.mockClear();
    await renderShell();
    const first = after.mock.calls.length;
    expect(first).toBe(2); // reverify pending intents + settle own donations
    await renderShell();
    await renderShell();
    expect(after.mock.calls.length).toBe(first);
  });
});
