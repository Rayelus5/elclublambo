import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  path: "/guia/dao",
  welcome: { handle: null, welcome_completed_at: null } as { handle: string | null; welcome_completed_at: string | null } | null,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-pathname": state.path }) }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
  usePathname: () => "/guia/dao",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/lib/channels/queries", () => ({ getVisibleChannels: async () => [], toRow: (c: unknown) => c }));
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

import ForumLayout from "@/app/(forum)/layout";

async function renderShell() {
  const tree = ForumLayout({ children: <p>contenido</p> } as never) as React.ReactElement<{ children: React.ReactElement }>;
  const shell = tree.props.children as React.ReactElement<Record<string, unknown>> & { type: (p: unknown) => Promise<React.ReactNode> };
  return render(<>{await shell.type(shell.props)}</>);
}

describe("ForumLayout onboarding gate", () => {
  beforeEach(() => {
    state.path = "/guia/dao";
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
    state.path = "/c/abc?x=1";
    await expect(renderShell()).rejects.toThrow(`REDIRECT:/bienvenida?next=${encodeURIComponent("/c/abc?x=1")}`);
  });

  it("fails closed when the member row is missing", async () => {
    state.path = "/perfil";
    state.welcome = null;
    await expect(renderShell()).rejects.toThrow("REDIRECT:/bienvenida?next=%2Fperfil");
  });
});
