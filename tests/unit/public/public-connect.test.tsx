import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ADDRESS = "0xD590d5D858d5B61C357e7a40Ee6b6a72D938b82d";

const account = vi.hoisted(() => ({ address: undefined as string | undefined, chainId: undefined as number | undefined, isConnected: false }));
const signMessageAsync = vi.hoisted(() => vi.fn());
const switchChain = vi.hoisted(() => vi.fn());
const open = vi.hoisted(() => vi.fn());
const signInWithWeb3 = vi.hoisted(() => vi.fn());
const completeLogin = vi.hoisted(() => vi.fn());
const replace = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn());

vi.mock("wagmi", () => ({
  useAccount: () => account,
  useSignMessage: () => ({ signMessageAsync }),
  useSwitchChain: () => ({ switchChain, isPending: false }),
  useDisconnect: () => ({ disconnect: vi.fn() }),
}));
vi.mock("@reown/appkit/react", () => ({ useAppKit: () => ({ open }) }));
vi.mock("@/lib/supabase/browser", () => ({ createBrowserClient: () => ({ auth: { signInWithWeb3 } }) }));
vi.mock("@/lib/auth/actions", () => ({ completeLogin }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh }) }));

import { PublicConnect } from "@/components/public/public-connect";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_NETWORK_SET", "testnet");
  account.address = ADDRESS;
  account.chainId = 84532;
  account.isConnected = true;
  signMessageAsync.mockResolvedValue("0xsig");
  signInWithWeb3.mockResolvedValue({ data: {}, error: null });
  completeLogin.mockResolvedValue({ redirectTo: "public" });
});
afterEach(() => vi.unstubAllEnvs());

describe("PublicConnect", () => {
  it("disconnected: opens AppKit from the localized button", async () => {
    account.isConnected = false;
    account.address = undefined;
    render(<PublicConnect lang="en" next="/en/tools" />);
    await userEvent.click(screen.getByRole("button", { name: "Connect wallet" }));
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("signs the English statement, logs in as public and navigates to next", async () => {
    render(<PublicConnect lang="en" next="/en/tools" />);
    await userEvent.click(screen.getByRole("button", { name: /Sign in/ }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/en/tools"));
    const message = signMessageAsync.mock.calls[0]![0].message as string;
    expect(message).toContain("Sign in to ElClub. This signature costs no gas and moves no funds.");
    expect(signInWithWeb3).toHaveBeenCalledWith({ chain: "ethereum", message, signature: "0xsig" });
    expect(completeLogin).toHaveBeenCalledWith(null, "public");
    expect(refresh).toHaveBeenCalled();
  });

  it("signs the Spanish statement in es", async () => {
    render(<PublicConnect lang="es" next="/herramientas" />);
    await userEvent.click(screen.getByRole("button", { name: /Firmar/ }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/herramientas"));
    expect(signMessageAsync.mock.calls[0]![0].message).toContain("Entra en ElClub. Esta firma no cuesta gas ni mueve fondos.");
  });

  it("an unsafe next goes to /", async () => {
    render(<PublicConnect lang="en" next="//evil" />);
    await userEvent.click(screen.getByRole("button", { name: /Sign in/ }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
  });

  it("banned goes to /banned", async () => {
    completeLogin.mockResolvedValue({ redirectTo: "/banned" });
    render(<PublicConnect lang="en" next="/en/tools" />);
    await userEvent.click(screen.getByRole("button", { name: /Sign in/ }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/banned"));
  });
});
