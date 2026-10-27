import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ADDRESS = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

const account = vi.hoisted(() => ({ address: undefined as string | undefined, chainId: undefined as number | undefined, isConnected: false }));
const signMessageAsync = vi.hoisted(() => vi.fn());
const open = vi.hoisted(() => vi.fn());
const hardReload = vi.hoisted(() => vi.fn());
const signInWithWallet = vi.hoisted(() => vi.fn());
const fetchMock = vi.hoisted(() => vi.fn());

vi.mock("wagmi", () => ({
  useAccount: () => account,
  useSignMessage: () => ({ signMessageAsync }),
  useSwitchChain: () => ({ switchChain: vi.fn(), isPending: false }),
}));
vi.mock("@reown/appkit/react", () => ({ useAppKit: () => ({ open }) }));
vi.mock("@/lib/navigation/hard-navigate", () => ({ hardReload, hardNavigate: vi.fn() }));
vi.mock("@/lib/auth/siwe-sign-in", () => ({ signInWithWallet }));

import { TeamAccess } from "@/components/status/team-access";
// Warm the wallet step that TeamAccess loads with next/dynamic: under a loaded full run the cold import can outlast findBy*.
import "@/components/status/team-access-sign";
import { getDictionary } from "@/lib/i18n";

const es = getDictionary("es");
const en = getDictionary("en");

function reply(status: string, code = 200) {
  return Promise.resolve(new Response(JSON.stringify({ status }), { status: code, headers: { "Content-Type": "application/json" } }));
}

const fills = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>("*")].filter((el) => el.className.toString().split(/\s+/).includes("bg-accent-fill"));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_NETWORK_SET", "testnet");
  vi.stubGlobal("fetch", fetchMock);
  account.address = ADDRESS;
  account.chainId = 84532;
  account.isConnected = true;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function openPanel(lang: "es" | "en" = "es") {
  const view = render(<TeamAccess lang={lang} />);
  await userEvent.click(screen.getByRole("button", { name: getDictionary(lang).status.teamAccess }));
  return view;
}

describe("TeamAccess", () => {
  it("starts as a discreet text button, no fill and no request", () => {
    const { container } = render(<TeamAccess lang="es" />);
    const button = screen.getByRole("button", { name: es.status.teamAccess });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(fills(container)).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("opening asks the route without a password (POST, no body)", async () => {
    fetchMock.mockReturnValueOnce(reply("needs_password"));
    await openPanel();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/team-access");
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
  });

  it("needs_password shows the password field (type password, current-password) and «Entrar» as the only fill", async () => {
    fetchMock.mockReturnValueOnce(reply("needs_password"));
    const { container } = await openPanel();
    const input = await screen.findByLabelText(es.status.passwordLabel);
    expect(input).toHaveAttribute("type", "password");
    expect(input).toHaveAttribute("autocomplete", "current-password");
    expect(screen.getByRole("button", { name: es.status.enter })).toBeInTheDocument();
    expect(fills(container)).toHaveLength(1);
  });

  it("submitting POSTs { password }", async () => {
    fetchMock.mockReturnValueOnce(reply("needs_password")).mockReturnValueOnce(reply("wrong_password"));
    await openPanel();
    await userEvent.type(await screen.findByLabelText(es.status.passwordLabel), "una-clave-larga");
    await userEvent.click(screen.getByRole("button", { name: es.status.enter }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [url, init] = fetchMock.mock.calls[1]!;
    expect(url).toBe("/api/team-access");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ password: "una-clave-larga" });
  });

  it("wrong_password: «Contraseña incorrecta.» alert and no reload", async () => {
    fetchMock.mockReturnValueOnce(reply("needs_password")).mockReturnValueOnce(reply("wrong_password"));
    await openPanel();
    await userEvent.type(await screen.findByLabelText(es.status.passwordLabel), "mala");
    await userEvent.click(screen.getByRole("button", { name: es.status.enter }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Contraseña incorrecta.");
    expect(hardReload).not.toHaveBeenCalled();
    expect(screen.getByLabelText(es.status.passwordLabel)).toBeInTheDocument();
  });

  it("granted after the password: full reload", async () => {
    fetchMock.mockReturnValueOnce(reply("needs_password")).mockReturnValueOnce(reply("granted"));
    await openPanel();
    await userEvent.type(await screen.findByLabelText(es.status.passwordLabel), "una-clave-larga");
    await userEvent.click(screen.getByRole("button", { name: es.status.enter }));
    await waitFor(() => expect(hardReload).toHaveBeenCalledTimes(1));
  });

  it.each(["granted", "superadmin", "off"])("%s on open: full reload", async (status) => {
    fetchMock.mockReturnValueOnce(reply(status));
    await openPanel();
    await waitFor(() => expect(hardReload).toHaveBeenCalledTimes(1));
  });

  it("not_listed: the A-R19 message", async () => {
    fetchMock.mockReturnValueOnce(reply("not_listed"));
    await openPanel();
    expect(await screen.findByRole("alert")).toHaveTextContent(es.status.notListed);
    expect(hardReload).not.toHaveBeenCalled();
  });

  it("rate_limited (429): too many attempts", async () => {
    fetchMock.mockReturnValueOnce(reply("needs_password")).mockReturnValueOnce(reply("rate_limited", 429));
    await openPanel("en");
    await userEvent.type(await screen.findByLabelText(en.status.passwordLabel), "whatever-password");
    await userEvent.click(screen.getByRole("button", { name: en.status.enter }));
    expect(await screen.findByRole("alert")).toHaveTextContent(en.status.tooManyAttempts);
  });

  it.each([
    ["error", 503],
    ["forbidden", 403],
  ])("%s (%i): a generic error, no reload", async (status, code) => {
    fetchMock.mockReturnValueOnce(reply(status, code));
    await openPanel();
    expect(await screen.findByRole("alert")).toHaveTextContent(es.status.teamError);
    expect(hardReload).not.toHaveBeenCalled();
  });

  it("a network failure is the generic error", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await openPanel();
    expect(await screen.findByRole("alert")).toHaveTextContent(es.status.teamError);
  });

  it("not_signed_in shows «Firmar y entrar» (the only fill); signing goes back to the check, then reloads", async () => {
    fetchMock.mockReturnValueOnce(reply("not_signed_in", 401)).mockReturnValueOnce(reply("superadmin"));
    signInWithWallet.mockResolvedValueOnce({ ok: true });
    signMessageAsync.mockResolvedValue("0xsig");
    const { container } = await openPanel();
    const sign = await screen.findByRole("button", { name: es.connect.signIn });
    expect(fills(container)).toHaveLength(1);
    await userEvent.click(sign);
    await waitFor(() => expect(hardReload).toHaveBeenCalledTimes(1));
    expect(signInWithWallet).toHaveBeenCalledWith(expect.objectContaining({ address: ADDRESS, chainId: 84532, lang: "es" }));
    // The wallet signs through the `sign` callback.
    const { sign: signFn } = signInWithWallet.mock.calls[0]![0] as { sign: (m: string) => Promise<string> };
    await signFn("hola");
    expect(signMessageAsync).toHaveBeenCalledWith({ message: "hola" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]![1].body).toBeUndefined();
  });

  it("not_signed_in, disconnected: «Conectar wallet» opens AppKit (outline, not the fill)", async () => {
    account.isConnected = false;
    account.address = undefined;
    account.chainId = undefined;
    fetchMock.mockReturnValueOnce(reply("not_signed_in", 401));
    const { container } = await openPanel();
    const connect = await screen.findByRole("button", { name: es.common.connect });
    expect(fills(container)).toHaveLength(0);
    await userEvent.click(connect);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("a cancelled signature says so and stays", async () => {
    fetchMock.mockReturnValueOnce(reply("not_signed_in", 401));
    signInWithWallet.mockResolvedValueOnce({ ok: false, error: "cancelled" });
    await openPanel();
    await userEvent.click(await screen.findByRole("button", { name: es.connect.signIn }));
    expect(await screen.findByRole("alert")).toHaveTextContent(es.connect.errCancelled);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
