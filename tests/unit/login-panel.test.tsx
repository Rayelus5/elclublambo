import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ADDRESS = "0xD590d5D858d5B61C357e7a40Ee6b6a72D938b82d";
const BASE_SEPOLIA = 84532;
const ARBITRUM_SEPOLIA = 421614;

const account = vi.hoisted(() => ({
  address: undefined as string | undefined,
  chainId: undefined as number | undefined,
  isConnected: false,
}));
const signMessageAsync = vi.hoisted(() => vi.fn());
const switchChain = vi.hoisted(() => vi.fn());
const disconnect = vi.hoisted(() => vi.fn());
const switchState = vi.hoisted(() => ({ isPending: false }));
const open = vi.hoisted(() => vi.fn());
const signInWithWeb3 = vi.hoisted(() => vi.fn());
const completeLogin = vi.hoisted(() => vi.fn());
const replace = vi.hoisted(() => vi.fn());

vi.mock("wagmi", () => ({
  useAccount: () => account,
  useSignMessage: () => ({ signMessageAsync }),
  useSwitchChain: () => ({ switchChain, isPending: switchState.isPending }),
  useDisconnect: () => ({ disconnect }),
}));
vi.mock("@reown/appkit/react", () => ({ useAppKit: () => ({ open }) }));
vi.mock("@/lib/supabase/browser", () => ({
  createBrowserClient: () => ({ auth: { signInWithWeb3 } }),
}));
vi.mock("@/lib/auth/actions", () => ({ completeLogin }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

import { LoginPanel } from "@/components/auth/login-panel";

function connect(chainId: number = BASE_SEPOLIA) {
  account.address = ADDRESS;
  account.chainId = chainId;
  account.isConnected = true;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_NETWORK_SET", "testnet");
  switchState.isPending = false;
  account.address = undefined;
  account.chainId = undefined;
  account.isConnected = false;
  signMessageAsync.mockResolvedValue("0xsig");
  signInWithWeb3.mockResolvedValue({ data: {}, error: null });
  completeLogin.mockResolvedValue({ redirectTo: "/foro" });
});
afterEach(() => vi.unstubAllEnvs());

describe("LoginPanel", () => {
  it("disconnected: shows 'Conectar wallet' and opens AppKit", async () => {
    render(<LoginPanel />);
    const btn = screen.getByRole("button", { name: "Conectar wallet" });
    await userEvent.click(btn);
    expect(open).toHaveBeenCalledTimes(1);
  });

  // MetaMask crashes ("reading 'origin'") when connect and a chain switch are
  // requested back to back, so we ask users to pick a login network before connecting.
  it("disconnected: hints to use the wallet on Base or Arbitrum", () => {
    render(<LoginPanel />);
    const btn = screen.getByRole("button", { name: "Conectar wallet" });
    expect(btn).toHaveAccessibleDescription("Usa tu wallet en Base o Arbitrum.");
  });

  it("connected: no network hint", () => {
    connect(BASE_SEPOLIA);
    render(<LoginPanel />);
    expect(screen.queryByText(/Usa tu wallet/)).toBeNull();
  });

  it("wrong chain: shows 'Cambiar a Base Sepolia', switches to the first chain and never signs", async () => {
    connect(1);
    render(<LoginPanel />);
    expect(screen.queryByRole("button", { name: /Firmar y entrar/ })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Cambiar a Base Sepolia" }));
    expect(switchChain).toHaveBeenCalledWith({ chainId: BASE_SEPOLIA }, expect.objectContaining({ onError: expect.any(Function) }));
    expect(signMessageAsync).not.toHaveBeenCalled();
  });

  it("wrong chain on the mainnet set: shows 'Cambiar a Base' and switches to 8453", async () => {
    vi.stubEnv("NEXT_PUBLIC_NETWORK_SET", "mainnet");
    connect(BASE_SEPOLIA);
    render(<LoginPanel />);
    await userEvent.click(screen.getByRole("button", { name: "Cambiar a Base" }));
    expect(switchChain).toHaveBeenCalledWith({ chainId: 8453 }, expect.objectContaining({ onError: expect.any(Function) }));
  });

  it("connected on Arbitrum Sepolia: signs with that chain id without asking to switch", async () => {
    connect(ARBITRUM_SEPOLIA);
    render(<LoginPanel />);
    expect(screen.queryByRole("button", { name: /Cambiar a/ })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Firmar y entrar/ }));
    await waitFor(() => expect(signInWithWeb3).toHaveBeenCalled());
    expect(signInWithWeb3.mock.calls[0]![0].message).toContain(`Chain ID: ${ARBITRUM_SEPOLIA}`);
    expect(switchChain).not.toHaveBeenCalled();
  });

  it("a legacy Linea wallet is asked to switch and never signs", () => {
    connect(59141);
    render(<LoginPanel />);
    expect(screen.getByRole("button", { name: "Cambiar a Base Sepolia" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Firmar y entrar/ })).toBeNull();
  });

  it.each([
    ["disconnected", () => {}],
    ["wrong chain", () => connect(1)],
    ["connected", () => connect()],
  ])("%s: no text mentions Linea", (_n, setup) => {
    setup();
    const { container } = render(<LoginPanel />);
    expect(container.textContent).not.toMatch(/Linea/);
  });

  it("connected: shows short address in mono and signs a SIWE message", async () => {
    connect();
    render(<LoginPanel />);
    expect(screen.getByText("0xD590…b82d")).toHaveClass("font-mono");
    await userEvent.click(screen.getByRole("button", { name: /Firmar y entrar/ }));
    await waitFor(() => expect(signInWithWeb3).toHaveBeenCalled());
    const arg = signInWithWeb3.mock.calls[0]![0];
    expect(arg).toMatchObject({ chain: "ethereum", signature: "0xsig" });
    expect(arg.message).toContain(ADDRESS);
    expect(arg.message).toContain(`Chain ID: ${BASE_SEPOLIA}`);
    expect(arg.message).toContain(`URI: ${window.location.origin}/foro/login`);
  });

  it("success: completeLogin gets the invite code and the router redirects", async () => {
    connect();
    completeLogin.mockResolvedValue({ redirectTo: "/foro/no-access" });
    render(<LoginPanel inviteCode="abc123" />);
    await userEvent.click(screen.getByRole("button", { name: /Firmar y entrar/ }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/foro/no-access"));
    expect(completeLogin).toHaveBeenCalledWith("abc123");
  });

  it("passes null when there is no invite code", async () => {
    connect();
    render(<LoginPanel />);
    await userEvent.click(screen.getByRole("button", { name: /Firmar y entrar/ }));
    await waitFor(() => expect(completeLogin).toHaveBeenCalledWith(null));
  });

  it("honours a safe ?next= only when redirectTo is '/'", async () => {
    connect();
    render(<LoginPanel next="/foro/invites" />);
    await userEvent.click(screen.getByRole("button", { name: /Firmar y entrar/ }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/foro/invites"));
  });

  it("ignores ?next= when redirectTo is not '/'", async () => {
    connect();
    completeLogin.mockResolvedValue({ redirectTo: "/foro/banned" });
    render(<LoginPanel next="/foro/invites" />);
    await userEvent.click(screen.getByRole("button", { name: /Firmar y entrar/ }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/foro/banned"));
  });

  it("sanitizes an unsafe ?next=", async () => {
    connect();
    render(<LoginPanel next="//evil.com" />);
    await userEvent.click(screen.getByRole("button", { name: /Firmar y entrar/ }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/foro"));
  });

  it("signInWithWeb3 error shows a role=alert and does not redirect", async () => {
    connect();
    signInWithWeb3.mockResolvedValue({ data: null, error: { message: "bad" } });
    render(<LoginPanel />);
    await userEvent.click(screen.getByRole("button", { name: /Firmar y entrar/ }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("No se pudo verificar la firma. Inténtalo de nuevo.");
    expect(completeLogin).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it("user-rejected signature shows 'Firma cancelada.'", async () => {
    connect();
    signMessageAsync.mockRejectedValue(
      Object.assign(new Error("User rejected the request."), { name: "UserRejectedRequestError", code: 4001 }),
    );
    render(<LoginPanel />);
    await userEvent.click(screen.getByRole("button", { name: /Firmar y entrar/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Firma cancelada.");
    expect(signInWithWeb3).not.toHaveBeenCalled();
  });

  it("completeLogin error ending on /no-access navigates with ?error=<code>", async () => {
    connect();
    completeLogin.mockResolvedValue({ redirectTo: "/foro/no-access", error: "forbidden" });
    render(<LoginPanel />);
    await userEvent.click(screen.getByRole("button", { name: /Firmar y entrar/ }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/foro/no-access?error=forbidden"));
  });

  it("signing: button is disabled and reads 'Firmando…'", async () => {
    connect();
    signMessageAsync.mockReturnValue(new Promise(() => {}));
    render(<LoginPanel />);
    await userEvent.click(screen.getByRole("button", { name: /Firmar y entrar/ }));
    const btn = await screen.findByRole("button", { name: /Firmando…/ });
    expect(btn).toBeDisabled();
  });

  it("does not re-enable the button after a successful redirect (no double submit)", async () => {
    connect();
    render(<LoginPanel />);
    await userEvent.click(screen.getByRole("button", { name: /Firmar y entrar/ }));
    await waitFor(() => expect(replace).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: /Firmando…/ })).toBeDisabled();
  });

  it("wrong chain: switching shows pending state", () => {
    connect(1);
    switchState.isPending = true;
    render(<LoginPanel />);
    expect(screen.getByRole("button", { name: "Cambiando…" })).toBeDisabled();
  });

  it("wrong chain: switch failure shows role=alert", async () => {
    connect(1);
    switchChain.mockImplementation((_v, opts) => opts?.onError?.(new Error("nope")));
    render(<LoginPanel />);
    await userEvent.click(screen.getByRole("button", { name: "Cambiar a Base Sepolia" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo cambiar de red.");
  });

  it("connected: 'Cambiar de wallet' disconnects and has a 44px target", async () => {
    connect();
    render(<LoginPanel />);
    const btn = screen.getByRole("button", { name: "Cambiar de wallet" });
    expect(btn).toHaveClass("min-h-11");
    await userEvent.click(btn);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("disconnected: no 'Cambiar de wallet'", () => {
    render(<LoginPanel />);
    expect(screen.queryByRole("button", { name: "Cambiar de wallet" })).toBeNull();
  });

  it("a failed sign-in re-enables the button", async () => {
    connect();
    signInWithWeb3.mockResolvedValue({ data: null, error: { message: "bad" } });
    render(<LoginPanel />);
    await userEvent.click(screen.getByRole("button", { name: /Firmar y entrar/ }));
    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: /Firmar y entrar/ })).toBeEnabled();
  });

  it.each([
    ["disconnected", () => {}],
    ["wrong chain", () => connect(1)],
    ["connected", () => connect()],
  ])("%s: primary button has min-h-11", (_n, setup) => {
    setup();
    render(<LoginPanel />);
    expect(screen.getAllByRole("button")[0]).toHaveClass("min-h-11");
  });
});
