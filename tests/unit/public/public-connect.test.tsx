import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ADDRESS = "0xD590d5D858d5B61C357e7a40Ee6b6a72D938b82d";

const account = vi.hoisted(() => ({ address: undefined as string | undefined, chainId: undefined as number | undefined, isConnected: false }));
const signMessageAsync = vi.hoisted(() => vi.fn());
const switchChain = vi.hoisted(() => vi.fn());
const open = vi.hoisted(() => vi.fn());
const signInWithWeb3 = vi.hoisted(() => vi.fn());
const hardNavigate = vi.hoisted(() => vi.fn());
const signOut = vi.hoisted(() => vi.fn());
const gate = vi.hoisted(() => vi.fn());

vi.mock("wagmi", () => ({
  useAccount: () => account,
  useSignMessage: () => ({ signMessageAsync }),
  useSwitchChain: () => ({ switchChain, isPending: false }),
  useDisconnect: () => ({ disconnect: vi.fn() }),
}));
vi.mock("@reown/appkit/react", () => ({ useAppKit: () => ({ open }) }));
vi.mock("@/lib/supabase/browser", () => ({ createBrowserClient: () => ({ auth: { signInWithWeb3, signOut } }) }));
// A-R13: the server action that deletes a new account while registration is closed, asked before navigating.
vi.mock("@/lib/admin/registration-actions", () => ({ publicRegistrationGate: gate }));
// A full navigation to /login/complete, not a server action: signing in on the landing at / turns a member's / into the
// forum mid-request, so an action posted from / would no longer reach the page that holds it.
vi.mock("@/lib/navigation/hard-navigate", () => ({ hardNavigate }));

import { PublicConnect } from "@/components/public/public-connect";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_NETWORK_SET", "testnet");
  account.address = ADDRESS;
  account.chainId = 84532;
  account.isConnected = true;
  signMessageAsync.mockResolvedValue("0xsig");
  signInWithWeb3.mockResolvedValue({ data: {}, error: null });
  signOut.mockResolvedValue({ error: null });
  gate.mockResolvedValue({ ok: true });
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
    await waitFor(() => expect(hardNavigate).toHaveBeenCalledWith("/foro/login/complete?mode=public&next=%2Fen%2Ftools"));
    const message = signMessageAsync.mock.calls[0]![0].message as string;
    expect(message).toContain("Sign in to ElClub. This signature costs no gas and moves no funds.");
    expect(message).toContain(`URI: ${window.location.origin}/foro/login`);
    expect(signInWithWeb3).toHaveBeenCalledWith({ chain: "ethereum", message, signature: "0xsig" });
  });

  it("signs the Spanish statement in es", async () => {
    render(<PublicConnect lang="es" next="/herramientas" />);
    await userEvent.click(screen.getByRole("button", { name: /Firmar/ }));
    await waitFor(() => expect(hardNavigate).toHaveBeenCalledWith("/foro/login/complete?mode=public&next=%2Fherramientas"));
    expect(signMessageAsync.mock.calls[0]![0].message).toContain("Entra en ElClub. Esta firma no cuesta gas ni mueve fondos.");
  });

  it("an unsafe next goes to /", async () => {
    render(<PublicConnect lang="en" next="//evil" />);
    await userEvent.click(screen.getByRole("button", { name: /Sign in/ }));
    await waitFor(() => expect(hardNavigate).toHaveBeenCalledWith("/foro/login/complete?mode=public&next=%2F"));
  });

  it("keeps the query of next (?join=1)", async () => {
    render(<PublicConnect lang="es" next="/herramientas/sorteos/x?join=1" />);
    await userEvent.click(screen.getByRole("button", { name: /Firmar/ }));
    await waitFor(() => expect(hardNavigate).toHaveBeenCalledWith("/foro/login/complete?mode=public&next=%2Fherramientas%2Fsorteos%2Fx%3Fjoin%3D1"));
  });

  it("a failed Supabase sign-in shows the error and does not navigate", async () => {
    signInWithWeb3.mockResolvedValue({ data: null, error: { message: "bad" } });
    render(<PublicConnect lang="en" next="/en/tools" />);
    await userEvent.click(screen.getByRole("button", { name: /Sign in/ }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(hardNavigate).not.toHaveBeenCalled();
  });
});

describe("PublicConnect with registration closed (A-R13)", () => {
  it("shows the closed message, signs out locally and does not navigate", async () => {
    gate.mockResolvedValue({ ok: false, error: "registration_closed" });
    render(<PublicConnect lang="es" next="/herramientas" />);
    await userEvent.click(screen.getByRole("button", { name: /Firmar/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("El registro de cuentas está cerrado ahora.");
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(hardNavigate).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Firmar/ })).toBeEnabled();
  });

  it("asks the gate after signing and before navigating when it is open", async () => {
    render(<PublicConnect lang="en" next="/en/tools" />);
    await userEvent.click(screen.getByRole("button", { name: /Sign in/ }));
    await waitFor(() => expect(hardNavigate).toHaveBeenCalledWith("/foro/login/complete?mode=public&next=%2Fen%2Ftools"));
    expect(gate).toHaveBeenCalledTimes(1);
    expect(signInWithWeb3.mock.invocationCallOrder[0]).toBeLessThan(gate.mock.invocationCallOrder[0]!);
    expect(signOut).not.toHaveBeenCalled();
  });

  it("registrationClosed (the fallback's ?registration=closed) shows the message before any click", () => {
    account.isConnected = false;
    account.address = undefined;
    render(<PublicConnect lang="en" next={null} registrationClosed />);
    expect(screen.getByRole("alert")).toHaveTextContent("Account registration is closed right now.");
  });

  it("a failed sign-in never asks the gate", async () => {
    signInWithWeb3.mockResolvedValue({ data: null, error: { message: "bad" } });
    render(<PublicConnect lang="en" next="/en/tools" />);
    await userEvent.click(screen.getByRole("button", { name: /Sign in/ }));
    await screen.findByRole("alert");
    expect(gate).not.toHaveBeenCalled();
  });
});

describe("PublicConnect variant", () => {
  it("is the brand fill by default and takes the outline variant when asked", () => {
    account.isConnected = false;
    account.address = undefined;
    const { rerender } = render(<PublicConnect lang="en" next={null} />);
    expect(screen.getByRole("button", { name: "Connect wallet" }).getAttribute("data-variant")).toBe("default");
    rerender(<PublicConnect lang="en" next={null} variant="outline" />);
    expect(screen.getByRole("button", { name: "Connect wallet" }).getAttribute("data-variant")).toBe("outline");
  });
});
