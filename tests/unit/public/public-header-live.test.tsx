import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The public header resolves the session in the browser (Supabase directly, never a Vercel function), so the public
// layout has no request-time read and the landing, /start and the hub are fully static. Same rules as the server's
// getPublicSession: a wallet, not banned, not held by a closed registration; «Ir al foro» only for active members.

const WALLET = "0x9F202eb556F95308de0268f60b5757d83744De02";
const sb = vi.hoisted(() => ({
  session: null as unknown,
  status: { data: "active", error: null } as { data: unknown; error: unknown },
  blocked: { data: false, error: null } as { data: unknown; error: unknown },
  listener: null as null | ((event: string, session?: unknown) => void),
  rpcs: [] as string[],
}));

vi.mock("@/lib/supabase/browser", () => ({
  createBrowserClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: sb.session } }),
      onAuthStateChange: (cb: (event: string, session?: unknown) => void) => {
        sb.listener = cb;
        return { data: { subscription: { unsubscribe: () => (sb.listener = null) } } };
      },
      signOut: async () => ({ error: null }),
    },
    rpc: async (fn: string) => {
      sb.rpcs.push(fn);
      return fn === "my_membership_status" ? sb.status : sb.blocked;
    },
  }),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/components/public/public-connect-lazy", () => ({ PublicConnectLazy: () => <button type="button">connect</button> }));
vi.mock("wagmi", () => ({ useDisconnect: () => ({ disconnect: vi.fn() }) }));

import { PublicHeaderLive } from "@/components/public/public-header-live";

const signedIn = { user: { id: "u1", identities: [{ provider: "web3", identity_data: { custom_claims: { address: WALLET } } }] } };

beforeEach(() => {
  sb.session = null;
  sb.status = { data: "active", error: null };
  sb.blocked = { data: false, error: null };
  sb.listener = null;
  sb.rpcs = [];
});

describe("PublicHeaderLive", () => {
  it("shows the connect button to a visitor, after the pending placeholder, without any membership read", async () => {
    render(<PublicHeaderLive lang="es" />);
    expect(screen.queryByRole("button", { name: "connect" })).toBeNull();
    expect(await screen.findByRole("button", { name: "connect" })).toBeInTheDocument();
    expect(sb.rpcs).toEqual([]);
  });

  it("shows an active member the account chip with «Ir al foro»", async () => {
    sb.session = signedIn;
    render(<PublicHeaderLive lang="es" />);
    expect(await screen.findByRole("link", { name: "Ir al foro" })).toHaveAttribute("href", "/foro");
    expect(screen.getByRole("button", { name: /Desconectar/ })).toBeInTheDocument();
  });

  it("shows a signed-in non-member the chip without the forum link", async () => {
    sb.session = signedIn;
    sb.status = { data: "none", error: null };
    render(<PublicHeaderLive lang="es" />);
    expect(await screen.findByRole("button", { name: /Desconectar/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Ir al foro" })).toBeNull();
    expect(sb.rpcs).toContain("my_registration_blocked");
  });

  it.each([
    ["banned", { data: "banned", error: null }, { data: false, error: null }],
    ["a failed status read", { data: null, error: { message: "boom" } }, { data: false, error: null }],
    ["held by a closed registration", { data: "none", error: null }, { data: true, error: null }],
  ])("treats %s as a visitor (connect button)", async (_name, status, blocked) => {
    sb.session = signedIn;
    sb.status = status;
    sb.blocked = blocked;
    render(<PublicHeaderLive lang="es" />);
    expect(await screen.findByRole("button", { name: "connect" })).toBeInTheDocument();
  });

  // auth-js emits SIGNED_IN at start-up and on every return to the tab for the same user: no new reads for those.
  it("does not read again on a SIGNED_IN for the user it already shows", async () => {
    sb.session = signedIn;
    render(<PublicHeaderLive lang="es" />);
    await screen.findByRole("link", { name: "Ir al foro" });
    const reads = sb.rpcs.length;
    await act(async () => sb.listener?.("SIGNED_IN", sb.session));
    expect(sb.rpcs.length).toBe(reads);
    sb.session = { user: { ...signedIn.user, id: "u2" } };
    await act(async () => sb.listener?.("SIGNED_IN", sb.session));
    await waitFor(() => expect(sb.rpcs.length).toBeGreaterThan(reads));
  });

  it("follows a sign-out (and a sign-in) without reloading the page", async () => {
    sb.session = signedIn;
    render(<PublicHeaderLive lang="es" />);
    await screen.findByRole("link", { name: "Ir al foro" });
    sb.session = null;
    await act(async () => sb.listener?.("SIGNED_OUT"));
    await waitFor(() => expect(screen.getByRole("button", { name: "connect" })).toBeInTheDocument());
    sb.session = signedIn;
    await act(async () => sb.listener?.("SIGNED_IN"));
    expect(await screen.findByRole("link", { name: "Ir al foro" })).toBeInTheDocument();
  });
});
