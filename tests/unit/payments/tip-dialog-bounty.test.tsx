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

const createTipIntentAction = vi.hoisted(() => vi.fn());
const attachTxAction = vi.hoisted(() => vi.fn());
const verifyIntentAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/payments/tip-actions", () => ({ createTipIntentAction, attachTxAction, verifyIntentAction }));
const createBountyPaymentIntentAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/bounties/actions", () => ({ createBountyPaymentIntentAction }));
vi.mock("@/lib/treasury/actions", () => ({ createDonationIntentAction: vi.fn() }));

import { EconomyProvider } from "@/components/payments/economy-provider";
import { TipDialog, type BountyMode } from "@/components/payments/tip-dialog";
import type { EconomyConfig } from "@/lib/economy/config";
import { loadSends, upsertSend } from "@/lib/payments/pending-sends";

const SESSION = "0x1111111111111111111111111111111111111111";
const PLATFORM = "0x4444444444444444444444444444444444444444";
const SOLVER_WALLET = "0x2222222222222222222222222222222222222222";
const FEE_HASH = `0x${"fe".repeat(32)}`;
const MAIN_HASH = `0x${"aa".repeat(32)}`;
const MEMBER = "99999999-9999-4999-8999-999999999999";
const INTENT_ID = "11111111-1111-4111-8111-111111111111";
const BOUNTY = "33333333-3333-4333-8333-333333333333";

const solver = { id: "22222222-2222-4222-8222-222222222222", handle: "ana_l", displayName: "Ana", walletAddress: SOLVER_WALLET, avatarPath: null };

const config = (over: Partial<EconomyConfig> = {}): EconomyConfig => ({
  activeChainId: 59141,
  minFeeBps: 100,
  chains: { 59144: { safe: null, platform: null }, 59141: { safe: null, platform: PLATFORM } },
  ...over,
});

const mode = (over: Partial<BountyMode> = {}): BountyMode => ({
  kind: "bounty",
  bountyId: BOUNTY,
  token: "USDC",
  minAmount: 25_000_000n,
  chainId: 59141,
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
  chainId: 59141,
  token: "USDC" as const,
  amount: "25000000",
  feeAmount: "250000",
  recipientAddress: SOLVER_WALLET,
  platformAddress: PLATFORM,
  expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
};

const continuar = () => screen.getByRole("button", { name: "Continuar" });
const amountBox = () => screen.getByLabelText("Importe");

beforeEach(() => {
  window.localStorage.clear();
  account.address = SESSION;
  account.chainId = 59141;
  account.isConnected = true;
  send.mockReset().mockResolvedValueOnce(FEE_HASH).mockResolvedValueOnce(MAIN_HASH);
  createTipIntentAction.mockReset();
  createBountyPaymentIntentAction.mockReset().mockResolvedValue({ ok: true, intent });
  attachTxAction.mockReset().mockResolvedValue({ ok: true });
  verifyIntentAction.mockReset().mockResolvedValue({ status: "confirmed", tipId: "t1" });
});

describe("TipDialog bounty mode: form", () => {
  it("is titled as a bounty payment and links to the bounties guide", () => {
    setup();
    expect(screen.getByRole("heading", { name: "Pagar bounty" })).toBeInTheDocument();
    expect(screen.getByText(/MODO PRUEBA/)).toBeInTheDocument();
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
    expect(screen.queryByText(/anónima/i)).not.toBeInTheDocument();
  });

  it("when the bounty chain is not the active one, explains it and cannot continue", async () => {
    setup(mode({ chainId: 59144 }));
    expect(
      screen.getByText("Este bounty se publicó en Linea; podrás pagarlo cuando esa red vuelva a estar activa."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continuar" })).not.toBeInTheDocument();
    expect(createBountyPaymentIntentAction).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});

describe("TipDialog bounty mode: signing", () => {
  it("creates the intent through the bounty action (never the tip action), signs fee then main, and clears the ledger", async () => {
    setup();
    await userEvent.click(continuar());
    await screen.findByText("Bounty pagado");
    expect(createTipIntentAction).not.toHaveBeenCalled();
    expect(createBountyPaymentIntentAction).toHaveBeenCalledWith({ bountyId: BOUNTY, amount: "25", feeBps: 100 });
    expect(send).toHaveBeenNthCalledWith(1, { chain: 59141, token: "USDC", to: PLATFORM, amount: 250000n, account: SESSION });
    expect(send).toHaveBeenNthCalledWith(2, { chain: 59141, token: "USDC", to: SOLVER_WALLET, amount: 25000000n, account: SESSION });
    expect(attachTxAction).toHaveBeenNthCalledWith(1, INTENT_ID, "fee", FEE_HASH);
    expect(attachTxAction).toHaveBeenNthCalledWith(2, INTENT_ID, "main", MAIN_HASH);
    expect(loadSends(MEMBER)).toEqual([]);
  });

  it("keys the ledger by targetType 'bounty' and the bounty message id; fee paid + main rejected resumes the same intent", async () => {
    send.mockReset().mockResolvedValueOnce(FEE_HASH).mockRejectedValueOnce(Object.assign(new Error("rejected"), { code: 4001 })).mockResolvedValueOnce(MAIN_HASH);
    setup();
    await userEvent.click(continuar());
    expect(await screen.findByText("La comisión ya está pagada. Falta firmar el pago.")).toBeInTheDocument();
    expect(loadSends(MEMBER)[0]).toMatchObject({ intentId: INTENT_ID, targetType: "bounty", targetId: BOUNTY, feeHash: FEE_HASH });
    await userEvent.click(screen.getByRole("button", { name: "Firmar el pago" }));
    await screen.findByText("Bounty pagado");
    expect(send).toHaveBeenCalledTimes(3);
    expect(send).toHaveBeenNthCalledWith(3, { chain: 59141, token: "USDC", to: SOLVER_WALLET, amount: 25000000n, account: SESSION });
    expect(createBountyPaymentIntentAction).toHaveBeenCalledTimes(1);
  });

  it("opens straight into the resume state for a bounty whose fee is already paid, without a new intent", async () => {
    upsertSend(MEMBER, { intentId: INTENT_ID, chainId: 59141, token: "USDC", targetType: "bounty", targetId: BOUNTY, feeRequired: true, feeHash: FEE_HASH, feeAttached: true, createdAt: Date.now(), intent });
    setup();
    expect(screen.getByText("La comisión ya está pagada. Falta firmar el pago.")).toBeInTheDocument();
    expect(createBountyPaymentIntentAction).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("F3c-R7: resumes a paid-fee intent on its own chain although it is no longer the active one (badge, switch to the intent's network, signs there)", async () => {
    const cfg = config({ chains: { 59144: { safe: null, platform: PLATFORM }, 59141: { safe: null, platform: PLATFORM } } });
    const old = { ...intent, chainId: 59144 };
    upsertSend(MEMBER, { intentId: INTENT_ID, chainId: 59144, token: "USDC", targetType: "bounty", targetId: BOUNTY, feeRequired: true, feeHash: FEE_HASH, feeAttached: true, createdAt: Date.now(), intent: old });
    account.chainId = 59141; // the wallet is on the active chain, the intent lives on the other one
    const view = setup(mode({ chainId: 59144 }), cfg);
    expect(screen.getByText("La comisión ya está pagada. Falta firmar el pago.")).toBeInTheDocument();
    expect(screen.getByText("Linea", { exact: true })).toBeInTheDocument();
    expect(screen.queryByText(/vuelva a estar activa/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cambiar a Linea" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cambiar a Linea Sepolia" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Firmar el pago" })).toBeDisabled();
    expect(send).not.toHaveBeenCalled();

    account.chainId = 59144; // the member switched
    view.unmount();
    setup(mode({ chainId: 59144 }), cfg);
    expect(screen.queryByRole("button", { name: /^Cambiar a/ })).not.toBeInTheDocument();
    send.mockReset().mockResolvedValueOnce(MAIN_HASH);
    await userEvent.click(screen.getByRole("button", { name: "Firmar el pago" }));
    await screen.findByText("Bounty pagado");
    expect(send).toHaveBeenCalledWith({ chain: 59144, token: "USDC", to: SOLVER_WALLET, amount: 25000000n, account: SESSION });
    expect(createBountyPaymentIntentAction).not.toHaveBeenCalled();
  });

  it("does not mix ledgers: a message tip entry with the same id does not resume a bounty", () => {
    upsertSend(MEMBER, { intentId: INTENT_ID, chainId: 59141, token: "USDC", targetType: "message", targetId: BOUNTY, feeRequired: true, feeHash: FEE_HASH, createdAt: Date.now(), intent });
    setup();
    expect(screen.queryByText(/La comisión ya está pagada/)).not.toBeInTheDocument();
    expect(amountBox()).toBeInTheDocument();
  });

  it("blocks a fresh intent while a signature for this bounty may still be pending in the wallet", async () => {
    upsertSend(MEMBER, { intentId: INTENT_ID, chainId: 59141, token: "USDC", targetType: "bounty", targetId: BOUNTY, feeRequired: true, createdAt: Date.now(), inFlight: Date.now(), intent });
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
    createBountyPaymentIntentAction.mockResolvedValue({ ok: true, intent: { ...intent, chainId: 59144 } });
    setup();
    await userEvent.click(continuar());
    expect(await screen.findByText("Los datos del envío no coinciden. Recarga la página.")).toBeInTheDocument();
    expect(send).not.toHaveBeenCalled();
  });

  it("when the server hands back an already prepared intent with a different amount, shows it instead of signing something unseen", async () => {
    createBountyPaymentIntentAction.mockResolvedValue({ ok: true, intent: { ...intent, amount: "30000000", feeAmount: "300000" } });
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
