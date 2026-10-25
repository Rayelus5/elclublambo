import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const account = vi.hoisted(() => ({ address: undefined as string | undefined, chainId: undefined as number | undefined, isConnected: false }));
vi.mock("wagmi", () => ({ useAccount: () => account }));
const openWallet = vi.hoisted(() => vi.fn());
vi.mock("@reown/appkit/react", () => ({ useAppKit: () => ({ open: openWallet }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }) }));
const send = vi.hoisted(() => vi.fn());
vi.mock("@/lib/payments/use-send-transfer", () => ({ useSendTransfer: () => ({ send }) }));
const ensure = vi.hoisted(() => vi.fn());
vi.mock("@/lib/payments/use-ensure-chain", () => ({ useEnsureChain: () => ({ ensure, switching: false, failedFor: null }) }));
const balances = vi.hoisted(() => ({ map: {} as Record<string, bigint | null> }));
vi.mock("@/lib/payments/balances", () => ({
  useAssetBalances: () => balances.map,
  useInvalidateAssetBalances: () => vi.fn(),
  readAssetBalance: vi.fn(),
}));
const preflight = vi.hoisted(() => vi.fn());
vi.mock("@/lib/payments/preflight", async (orig) => ({
  ...(await orig<typeof import("@/lib/payments/preflight")>()),
  useBalancePreflight: () => preflight,
}));
const createPublicDonationIntentAction = vi.hoisted(() => vi.fn());
const attachPublicDonationTxAction = vi.hoisted(() => vi.fn());
const verifyPublicDonationAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/donations/public-actions", () => ({ createPublicDonationIntentAction, attachPublicDonationTxAction, verifyPublicDonationAction }));
vi.mock("@/components/public/public-connect-lazy", () => ({ PublicConnectLazy: () => <div data-testid="public-connect" /> }));

import { PublicDonatePanel, storageKey } from "@/components/public-donations/public-donate-panel";
import { getDictionary } from "@/lib/i18n";
import type { ChainId } from "@/lib/economy/networks";

const es = getDictionary("es").donate;
const en = getDictionary("en").donate;
const WALLET = "0x1111111111111111111111111111111111111111" as const;
const SAFE_BASE = "0x380f2e12081995359e2ab88e3c31c6b227904234";
const SAFE_ARB = "0x4444444444444444444444444444444444444444";
const HASH = `0x${"ab".repeat(32)}` as const;
const INTENT_ID = "11111111-1111-4111-8111-111111111111";

function intentFor(input: { chainId: number; token: "USDC" | "ETH"; amount: string }) {
  return {
    id: INTENT_ID,
    chainId: input.chainId,
    token: input.token,
    amount: input.token === "USDC" ? String(Number(input.amount) * 1_000_000) : "0",
    feeAmount: "0",
    recipientAddress: input.chainId === 421614 ? SAFE_ARB : SAFE_BASE,
    platformAddress: null,
    expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
  };
}

function setup(props: { session?: { wallet: `0x${string}`; isMember: boolean } | null; chains?: ChainId[]; chainsFailed?: boolean; lang?: "es" | "en"; myTotalUsd6?: string | null } = {}) {
  const lang = props.lang ?? "es";
  return render(
    <PublicDonatePanel
      lang={lang}
      t={lang === "en" ? en : es}
      session={props.session === undefined ? { wallet: WALLET, isMember: false } : props.session}
      chains={props.chains ?? [84532, 421614]}
      chainsFailed={props.chainsFailed}
      myTotalUsd6={props.myTotalUsd6 ?? "0"}
      next="/donar"
    />,
  );
}

function connect(chainId = 84532) {
  account.address = WALLET;
  account.chainId = chainId;
  account.isConnected = true;
}

beforeEach(() => {
  window.localStorage.clear();
  account.address = undefined;
  account.chainId = undefined;
  account.isConnected = false;
  balances.map = {};
  openWallet.mockReset();
  send.mockReset().mockResolvedValue(HASH);
  ensure.mockReset().mockResolvedValue(true);
  preflight.mockReset().mockResolvedValue(null);
  createPublicDonationIntentAction.mockReset().mockImplementation(async (input) => ({ ok: true, intent: intentFor(input) }));
  attachPublicDonationTxAction.mockReset().mockResolvedValue({ ok: true });
  verifyPublicDonationAction.mockReset().mockResolvedValue({ status: "confirmed" });
});

describe("PublicDonatePanel", () => {
  it("a member sees the link to donate from the club and no form", () => {
    setup({ session: { wallet: WALLET, isMember: true } });
    const link = screen.getByRole("link", { name: es.memberLink });
    expect(link).toHaveAttribute("href", "/donar");
    expect(screen.queryByLabelText(es.panel.amountLabel)).not.toBeInTheDocument();
  });

  it("without a session it offers the public sign-in", () => {
    setup({ session: null });
    expect(screen.getByTestId("public-connect")).toBeInTheDocument();
    expect(screen.queryByLabelText(es.panel.amountLabel)).not.toBeInTheDocument();
  });

  it("no Safe deployed on any network: says so and shows no form", () => {
    connect();
    setup({ chains: [] });
    expect(screen.getByText(es.unavailable)).toBeInTheDocument();
    expect(screen.queryByLabelText(es.panel.amountLabel)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: es.panel.submit })).not.toBeInTheDocument();
  });

  it("shows the custody, economic-rights and Mecenas notices in both languages", () => {
    const { unmount } = setup();
    expect(screen.getByText(es.noCustody)).toBeInTheDocument();
    expect(screen.getByText(es.noRights)).toBeInTheDocument();
    expect(screen.getByText(es.mecenasNote)).toBeInTheDocument();
    unmount();
    setup({ lang: "en", myTotalUsd6: "12500000" });
    expect(screen.getByText(en.noCustody)).toBeInTheDocument();
    expect(screen.getByText(en.noRights)).toBeInTheDocument();
    expect(screen.getByText(en.myTotal)).toBeInTheDocument();
    expect(screen.getByText("12.5 USD")).toBeInTheDocument();
  });

  it("sends to the Safe of the chosen network (the intent's recipient), after switching the wallet to it", async () => {
    connect(84532);
    setup();
    const arbUsdc = screen.getAllByRole("radio").find((r) => /USDC/.test(r.textContent ?? "") && /Arbitrum/.test(r.textContent ?? ""))!;
    await userEvent.click(arbUsdc);
    await userEvent.type(screen.getByLabelText(es.panel.amountLabel), "5");
    await userEvent.click(screen.getByLabelText(es.panel.listed));
    await userEvent.click(screen.getByRole("button", { name: es.panel.submit }));
    await waitFor(() => expect(send).toHaveBeenCalled());
    expect(ensure).toHaveBeenCalledWith(421614);
    expect(createPublicDonationIntentAction).toHaveBeenCalledWith({ chainId: 421614, token: "USDC", amount: "5", anonymous: false, listed: true });
    expect(send.mock.calls[0]![0]).toMatchObject({ chain: 421614, token: "USDC", to: SAFE_ARB, amount: 5_000_000n, account: WALLET });
    expect(await screen.findByText(es.panel.done)).toBeInTheDocument();
  });

  it("stores the hash for the intent before attaching and verifying, and clears it once confirmed", async () => {
    connect(84532);
    let storedAtAttach: string | null = null;
    let storedAtVerify: string | null = null;
    attachPublicDonationTxAction.mockImplementation(async () => {
      storedAtAttach = window.localStorage.getItem(storageKey(WALLET, INTENT_ID));
      return { ok: true };
    });
    verifyPublicDonationAction.mockImplementation(async () => {
      storedAtVerify = window.localStorage.getItem(storageKey(WALLET, INTENT_ID));
      return { status: "confirmed" };
    });
    setup();
    const baseUsdc = screen.getAllByRole("radio").find((r) => /USDC/.test(r.textContent ?? "") && /Base/.test(r.textContent ?? ""))!;
    await userEvent.click(baseUsdc);
    await userEvent.type(screen.getByLabelText(es.panel.amountLabel), "5");
    await userEvent.click(screen.getByRole("button", { name: es.panel.submit }));
    expect(await screen.findByText(es.panel.done)).toBeInTheDocument();
    expect(attachPublicDonationTxAction).toHaveBeenCalledWith(INTENT_ID, HASH);
    expect(storedAtAttach).toContain(HASH);
    expect(storedAtVerify).toContain(HASH);
    expect(window.localStorage.getItem(storageKey(WALLET, INTENT_ID))).toBeNull();
  });

  it("a stored hash resumes verification after a reload instead of sending again", async () => {
    connect(84532);
    window.localStorage.setItem(storageKey(WALLET, INTENT_ID), JSON.stringify({ intentId: INTENT_ID, chainId: 84532, hash: HASH, attached: true }));
    setup();
    expect(await screen.findByText(es.panel.done)).toBeInTheDocument();
    expect(verifyPublicDonationAction).toHaveBeenCalledWith(INTENT_ID);
    expect(send).not.toHaveBeenCalled();
    expect(createPublicDonationIntentAction).not.toHaveBeenCalled();
  });

  it("a cancelled signature stores nothing and returns to the form", async () => {
    connect(84532);
    send.mockRejectedValue(Object.assign(new Error("User rejected"), { code: 4001 }));
    setup();
    const baseUsdc = screen.getAllByRole("radio").find((r) => /USDC/.test(r.textContent ?? "") && /Base/.test(r.textContent ?? ""))!;
    await userEvent.click(baseUsdc);
    await userEvent.type(screen.getByLabelText(es.panel.amountLabel), "5");
    await userEvent.click(screen.getByRole("button", { name: es.panel.submit }));
    expect(await screen.findByRole("alert")).toHaveTextContent(es.panel.cancelled);
    expect(window.localStorage.getItem(storageKey(WALLET, INTENT_ID))).toBeNull();
    expect(attachPublicDonationTxAction).not.toHaveBeenCalled();
  });

  it("a failed Safe check says it could not load (not «not available yet») and shows no form", () => {
    connect();
    setup({ chains: [], chainsFailed: true });
    expect(screen.getByRole("alert")).toHaveTextContent(es.readFailed);
    expect(screen.queryByText(es.unavailable)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(es.panel.amountLabel)).not.toBeInTheDocument();
  });

  async function fillAndSubmit(network: RegExp) {
    const radio = screen.getAllByRole("radio").find((r) => /USDC/.test(r.textContent ?? "") && network.test(r.textContent ?? ""))!;
    await userEvent.click(radio);
    await userEvent.type(screen.getByLabelText(es.panel.amountLabel), "5");
    await userEvent.click(screen.getByRole("button", { name: es.panel.submit }));
  }

  it("a failed network switch never creates an intent nor sends", async () => {
    connect(84532);
    ensure.mockResolvedValue(false);
    setup();
    await fillAndSubmit(/Arbitrum/);
    expect(await screen.findByRole("alert")).toHaveTextContent(/Arbitrum/);
    expect(createPublicDonationIntentAction).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("a balance shortfall at preflight never sends and stores nothing", async () => {
    connect(84532);
    preflight.mockResolvedValue("No tienes suficiente USDC");
    setup();
    await fillAndSubmit(/Base/);
    expect(await screen.findByRole("alert")).toHaveTextContent(/Saldo insuficiente/);
    expect(send).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(storageKey(WALLET, INTENT_ID))).toBeNull();
  });
});
