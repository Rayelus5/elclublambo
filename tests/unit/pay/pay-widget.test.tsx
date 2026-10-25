import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const account = vi.hoisted(() => ({ address: undefined as string | undefined, chainId: undefined as number | undefined, isConnected: false }));
vi.mock("wagmi", () => ({ useAccount: () => account }));
const openWallet = vi.hoisted(() => vi.fn());
vi.mock("@reown/appkit/react", () => ({ useAppKit: () => ({ open: openWallet }) }));
const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn() }) }));
const calls = vi.hoisted(() => [] as string[]);
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

import { PayWidget } from "@/components/pay/pay-widget";
import { getDictionary } from "@/lib/i18n";
import { localizedPath } from "@/lib/i18n/routes";
import type { AssetId } from "@/lib/economy/assets";
import type { NetworkKey } from "@/lib/economy/networks";

const en = getDictionary("en").pay.page;
const es = getDictionary("es").pay.page;
const PAYER = "0x1111111111111111111111111111111111111111";
const TO = "0x2222222222222222222222222222222222222222";
const HASH = `0x${"ab".repeat(32)}` as const;

function setup(props: { accept?: NetworkKey[]; amount?: string | null; asset?: AssetId | null; lang?: "es" | "en" } = {}) {
  const lang = props.lang ?? "en";
  return render(
    <PayWidget
      lang={lang}
      t={lang === "en" ? en : es}
      to={TO}
      accept={props.accept ?? ["base", "arbitrum"]}
      initialAmount={props.amount ?? null}
      initialAsset={props.asset ?? null}
    />,
  );
}

function connect(chainId = 84532) {
  account.address = PAYER;
  account.chainId = chainId;
  account.isConnected = true;
}

beforeEach(() => {
  calls.length = 0;
  account.address = undefined;
  account.chainId = undefined;
  account.isConnected = false;
  balances.map = {};
  openWallet.mockReset();
  push.mockReset();
  send.mockReset().mockImplementation(async () => {
    calls.push("send");
    return HASH;
  });
  ensure.mockReset().mockImplementation(async () => {
    calls.push("ensure");
    return true;
  });
  preflight.mockReset().mockImplementation(async () => {
    calls.push("preflight");
    return null;
  });
});

describe("PayWidget", () => {
  it("only offers the assets of the networks the recipient accepts", () => {
    setup({ accept: ["base"] });
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(2);
    for (const r of radios) expect(r.textContent).toMatch(/Base/);
    expect(screen.queryByText(/Arbitrum/)).not.toBeInTheDocument();
  });

  it("prefills the amount and the asset from the link", () => {
    setup({ amount: "5", asset: "USDC:84532" });
    expect(screen.getByLabelText(en.amountLabel)).toHaveValue("5");
    const checked = screen.getAllByRole("radio").find((r) => r.getAttribute("aria-checked") === "true");
    expect(checked?.textContent).toMatch(/USDC/);
    expect(checked?.textContent).toMatch(/Base/);
  });

  it("shows the no-custody notice in both languages", () => {
    const { unmount } = setup();
    expect(screen.getByText(en.noCustody)).toBeInTheDocument();
    unmount();
    setup({ lang: "es" });
    expect(screen.getByText(es.noCustody)).toBeInTheDocument();
  });

  it("disconnected: the main button opens the wallet modal and nothing is sent", async () => {
    setup({ amount: "5", asset: "USDC:84532" });
    await userEvent.click(screen.getByRole("button", { name: en.connect }));
    expect(openWallet).toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("wallet on another network: Pay switches first, then checks the balance and sends", async () => {
    connect(421614);
    setup({ amount: "5", asset: "USDC:84532" });
    await userEvent.click(screen.getByRole("button", { name: en.pay }));
    await waitFor(() => expect(send).toHaveBeenCalled());
    expect(ensure).toHaveBeenCalledWith(84532);
    expect(calls).toEqual(["ensure", "preflight", "send"]);
  });

  it("a failed switch stops before the balance check and the signature", async () => {
    connect(421614);
    ensure.mockResolvedValue(false);
    setup({ amount: "5", asset: "USDC:84532" });
    await userEvent.click(screen.getByRole("button", { name: en.pay }));
    expect(await screen.findByText(/Could not switch to Base/)).toBeInTheDocument();
    expect(preflight).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("insufficient balance at preflight: nothing is sent and the message shows", async () => {
    connect();
    preflight.mockResolvedValue("No tienes suficiente USDC");
    setup({ amount: "5", asset: "USDC:84532" });
    await userEvent.click(screen.getByRole("button", { name: en.pay }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Insufficient balance/);
    expect(send).not.toHaveBeenCalled();
  });

  it("a known short balance is explained inline before paying", () => {
    connect();
    balances.map = { "USDC:84532": 1_000_000n, "ETH:84532": 10n ** 15n };
    setup({ amount: "5", asset: "USDC:84532" });
    expect(screen.getByText(/Insufficient balance/)).toBeInTheDocument();
  });

  it("success: sends the exact transfer and goes to the receipt", async () => {
    connect();
    setup({ amount: "5", asset: "USDC:84532" });
    await userEvent.click(screen.getByRole("button", { name: en.pay }));
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(ensure).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith({ chain: 84532, token: "USDC", to: TO, amount: 5_000_000n, account: PAYER });
    expect(push).toHaveBeenCalledWith(localizedPath("en", "payReceipt", { chainId: 84532, hash: HASH }));
  });

  it("out-of-range amount: Pay does nothing and the limits are shown", async () => {
    connect();
    setup({ amount: "0.001", asset: "USDC:84532" });
    expect(screen.getByText(/between 0.01 and 100000 USDC/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: en.pay }));
    expect(preflight).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("paying your own address is blocked", async () => {
    account.address = TO;
    account.chainId = 84532;
    account.isConnected = true;
    setup({ amount: "5", asset: "USDC:84532" });
    expect(screen.getByText(en.self)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: en.pay }));
    expect(send).not.toHaveBeenCalled();
  });

  it("a wallet rejection says nothing was sent and stays on the form", async () => {
    connect();
    send.mockRejectedValue(Object.assign(new Error("User rejected"), { name: "UserRejectedRequestError" }));
    setup({ amount: "5", asset: "USDC:84532" });
    await userEvent.click(screen.getByRole("button", { name: en.pay }));
    expect(await screen.findByRole("alert")).toHaveTextContent(en.cancelled);
    expect(push).not.toHaveBeenCalled();
  });
});
