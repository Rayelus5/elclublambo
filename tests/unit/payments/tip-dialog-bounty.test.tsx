import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const account = vi.hoisted(() => ({ address: undefined as string | undefined, chainId: undefined as number | undefined, isConnected: false }));
vi.mock("wagmi", () => ({
  useAccount: () => account,
  useSwitchChain: () => ({ switchChain: vi.fn(), isPending: false }),
}));
vi.mock("@reown/appkit/react", () => ({
  useAppKit: () => ({ open: vi.fn() }),
  useAppKitState: () => ({ open: false }),
}));

const send = vi.hoisted(() => vi.fn());
vi.mock("@/lib/payments/use-send-transfer", () => ({ useSendTransfer: () => ({ send }) }));
const balances = vi.hoisted(() => ({ map: {} as Record<string, bigint | null> }));
vi.mock("@/lib/payments/balances", () => ({ useAssetBalances: () => balances.map, useInvalidateAssetBalances: () => () => {}, readAssetBalance: vi.fn() }));
const preflight = vi.hoisted(() => vi.fn());
vi.mock("@/lib/payments/preflight", async (orig) => ({
  ...(await orig<typeof import("@/lib/payments/preflight")>()),
  useBalancePreflight: () => preflight,
}));

const createTipIntentAction = vi.hoisted(() => vi.fn());
const attachTxAction = vi.hoisted(() => vi.fn());
const verifyIntentAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/payments/tip-actions", () => ({ createTipIntentAction, attachTxAction, verifyIntentAction }));
const createBountyPaymentIntentAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/bounties/actions", () => ({ createBountyPaymentIntentAction }));

import { EconomyProvider } from "@/components/payments/economy-provider";
import { TipDialog, type BountyMode } from "@/components/payments/tip-dialog";
import type { EconomyConfig } from "@/lib/economy/config";
import { loadSends, upsertSend } from "@/lib/payments/pending-sends";

const SESSION = "0x1111111111111111111111111111111111111111";
const SOLVER_WALLET = "0x2222222222222222222222222222222222222222";
const MAIN_HASH = `0x${"aa".repeat(32)}`;
const MEMBER = "99999999-9999-4999-8999-999999999999";
const INTENT_ID = "11111111-1111-4111-8111-111111111111";
const BOUNTY = "33333333-3333-4333-8333-333333333333";

const solver = { id: "22222222-2222-4222-8222-222222222222", handle: "ana_l", displayName: "Ana", walletAddress: SOLVER_WALLET, avatarPath: null };

const config = (over: Partial<EconomyConfig> = {}): EconomyConfig => ({
  enabledChainIds: [84532, 421614],
  safes: {},
  legacyDaoEnabled: false,
  legacy: { activeChainId: 59141, withdrawalsEnabled: { 59144: false, 59141: false }, weightedRafflesEnabled: { 59144: false, 59141: false }, chains: { 59144: { safe: null, platform: null }, 59141: { safe: null, platform: null } } },
  ...over,
});

const mode = (over: Partial<BountyMode> = {}): BountyMode => ({
  kind: "bounty",
  bountyId: BOUNTY,
  token: "USDC",
  minAmount: 25_000_000n,
  chainId: 84532,
  ...over,
});

function setup(m: BountyMode = mode(), cfg: EconomyConfig = config()) {
  return render(
    <EconomyProvider config={cfg} wallet={SESSION} memberId={MEMBER}>
      <TipDialog mode={m} recipient={solver} open onOpenChange={() => {}} />
    </EconomyProvider>,
  );
}

const intent = {
  id: INTENT_ID,
  chainId: 84532,
  token: "USDC" as const,
  amount: "25000000",
  feeAmount: "0",
  recipientAddress: SOLVER_WALLET,
  platformAddress: null as string | null,
  expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
};

const continuar = () => screen.getByRole("button", { name: "Continuar" });
const amountBox = () => screen.getByLabelText("Importe");

beforeEach(() => {
  balances.map = {};
  preflight.mockReset().mockResolvedValue(null);
  window.localStorage.clear();
  account.address = SESSION;
  account.chainId = 84532;
  account.isConnected = true;
  send.mockReset().mockResolvedValueOnce(MAIN_HASH);
  createTipIntentAction.mockReset();
  createBountyPaymentIntentAction.mockReset().mockResolvedValue({ ok: true, intent });
  attachTxAction.mockReset().mockResolvedValue({ ok: true });
  verifyIntentAction.mockReset().mockResolvedValue({ status: "confirmed", tipId: "t1" });
});

describe("TipDialog bounty mode: form", () => {
  it("is titled as a bounty payment and links to the bounties guide", () => {
    setup();
    expect(screen.getByRole("heading", { name: "Pagar bounty" })).toBeInTheDocument();
    expect(screen.getByText("Base Sepolia")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /¿Cómo funciona\?/ })).toHaveAttribute("href", "/guia/bounties");
  });

  it("locks the token: no token selector, only the bounty's token", () => {
    setup(mode({ token: "ETH", minAmount: 10n ** 16n }));
    expect(screen.queryByRole("radiogroup", { name: "Moneda" })).not.toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.getByTestId("locked-token")).toHaveTextContent("ETH");
  });

  it("pre-fills the announced amount and lets it be raised", async () => {
    setup();
    expect(amountBox()).toHaveValue("25");
    expect(continuar()).toBeEnabled();
    await userEvent.type(amountBox(), "5");
    expect(amountBox()).toHaveValue("255");
    expect(continuar()).toBeEnabled();
  });

  it("refuses an amount below the announced one", async () => {
    setup();
    await userEvent.clear(amountBox());
    await userEvent.type(amountBox(), "24,99");
    expect(screen.getByText("El importe no puede ser menor que el del bounty (25 USDC).")).toBeInTheDocument();
    expect(continuar()).toBeDisabled();
  });

  it("has no anonymous option", () => {
    setup();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByText(/donación sin esperar nada/)).not.toBeInTheDocument();
    expect(screen.queryByText(/anónima/i)).not.toBeInTheDocument();
  });

  it("when the bounty's network is not enabled, explains it and cannot continue", async () => {
    setup(mode({ chainId: 8453 }));
    expect(
      screen.getByText("Este bounty se publicó en Base; podrás pagarlo cuando esa red vuelva a estar activa."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continuar" })).not.toBeInTheDocument();
    expect(createBountyPaymentIntentAction).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});

describe("TipDialog bounty mode: signing", () => {
  it("creates the intent through the bounty action (never the tip action), signs the main, and clears the ledger", async () => {
    setup();
    await userEvent.click(continuar());
    await screen.findByText("Bounty pagado");
    expect(createTipIntentAction).not.toHaveBeenCalled();
    expect(createBountyPaymentIntentAction).toHaveBeenCalledWith({ bountyId: BOUNTY, chainId: 84532, amount: "25" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ chain: 84532, token: "USDC", to: SOLVER_WALLET, amount: 25000000n, account: SESSION });
    expect(attachTxAction).toHaveBeenCalledTimes(1);
    expect(attachTxAction).toHaveBeenCalledWith(INTENT_ID, "main", MAIN_HASH);
    expect(loadSends(MEMBER)).toEqual([]);
  });

  it("pays a bounty published on another enabled network on that network", async () => {
    account.chainId = 421614;
    createBountyPaymentIntentAction.mockResolvedValue({ ok: true, intent: { ...intent, chainId: 421614 } });
    setup(mode({ chainId: 421614 }));
    expect(screen.getByText("Arbitrum Sepolia")).toBeInTheDocument();
    await userEvent.click(continuar());
    await screen.findByText("Bounty pagado");
    expect(createBountyPaymentIntentAction).toHaveBeenCalledWith({ bountyId: BOUNTY, chainId: 421614, amount: "25" });
    expect(send).toHaveBeenCalledWith({ chain: 421614, token: "USDC", to: SOLVER_WALLET, amount: 25000000n, account: SESSION });
  });

  it("a fee-era leftover for this bounty is discarded and the form opens (Review Focus 4)", () => {
    upsertSend(MEMBER, { intentId: INTENT_ID, chainId: 84532, token: "USDC", targetType: "bounty", targetId: BOUNTY, feeRequired: true, createdAt: Date.now(), intent: { ...intent, feeAmount: "250000" } });
    setup();
    expect(amountBox()).toBeInTheDocument();
    expect(screen.queryByText(/ya está pagada/)).not.toBeInTheDocument();
    expect(loadSends(MEMBER)).toEqual([]);
    expect(createBountyPaymentIntentAction).not.toHaveBeenCalled();
  });

  it("blocks a fresh intent while a signature for this bounty may still be pending in the wallet", async () => {
    upsertSend(MEMBER, { intentId: INTENT_ID, chainId: 84532, token: "USDC", targetType: "bounty", targetId: BOUNTY, feeRequired: false, createdAt: Date.now(), inFlight: Date.now(), intent });
    setup();
    expect(screen.getByText(/Tienes una firma pendiente en tu wallet/)).toBeInTheDocument();
    expect(createBountyPaymentIntentAction).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses to sign an intent whose recipient is not the solver shown", async () => {
    createBountyPaymentIntentAction.mockResolvedValue({ ok: true, intent: { ...intent, recipientAddress: "0x9999999999999999999999999999999999999999" } });
    setup();
    await userEvent.click(continuar());
    expect(await screen.findByText("Los datos del envío no coinciden. Recarga la página.")).toBeInTheDocument();
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses an intent below the announced amount or in another token", async () => {
    createBountyPaymentIntentAction.mockResolvedValue({ ok: true, intent: { ...intent, amount: "24000000", feeAmount: "0", platformAddress: null } });
    setup();
    await userEvent.click(continuar());
    expect(await screen.findByText("Los datos del envío no coinciden. Recarga la página.")).toBeInTheDocument();
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses an intent on another chain than the bounty's", async () => {
    createBountyPaymentIntentAction.mockResolvedValue({ ok: true, intent: { ...intent, chainId: 8453 } });
    setup();
    await userEvent.click(continuar());
    expect(await screen.findByText("Los datos del envío no coinciden. Recarga la página.")).toBeInTheDocument();
    expect(send).not.toHaveBeenCalled();
  });

  it("when the server hands back an already prepared intent with a different amount, shows it instead of signing something unseen", async () => {
    createBountyPaymentIntentAction.mockResolvedValue({ ok: true, intent: { ...intent, amount: "30000000" } });
    setup();
    await userEvent.click(continuar());
    expect(await screen.findByText(/Ya tenías un pago de este bounty preparado con otro importe/)).toBeInTheDocument();
    expect(send).not.toHaveBeenCalled();
    expect(amountBox()).toHaveValue("30");
  });

  it("shows payment_in_progress and signs nothing", async () => {
    createBountyPaymentIntentAction.mockResolvedValue({ ok: false, code: "payment_in_progress", error: "Ya hay un pago de este bounty en curso. Espera a que se confirme." });
    setup();
    await userEvent.click(continuar());
    expect(await screen.findByText("Ya hay un pago de este bounty en curso. Espera a que se confirme.")).toBeInTheDocument();
    expect(send).not.toHaveBeenCalled();
  });
});
