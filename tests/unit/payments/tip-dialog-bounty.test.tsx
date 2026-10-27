import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const account = vi.hoisted(() => ({ address: undefined as string | undefined, chainId: undefined as number | undefined, isConnected: false }));
const switchChain = vi.hoisted(() => vi.fn());
vi.mock("wagmi", () => ({
  useAccount: () => account,
  useSwitchChain: () => ({ switchChain, isPending: false }),
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
const getReceiveNetworks = vi.hoisted(() => vi.fn());
vi.mock("@/lib/payments/queries", () => ({ getReceiveNetworks }));
vi.mock("@/lib/supabase/browser", () => ({ createBrowserClient: () => ({ fake: true }) }));

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
  solverId: solver.id,
  ...over,
});

/** Mounts and waits until the solver's networks arrived and the network picker is shown. */
async function setup(m: BountyMode = mode(), cfg: EconomyConfig = config()) {
  const view = mount(m, cfg);
  await screen.findByRole("radiogroup", { name: "Red de pago" });
  return view;
}

function mount(m: BountyMode = mode(), cfg: EconomyConfig = config()) {
  return render(ui(m, cfg));
}
function ui(m: BountyMode = mode(), cfg: EconomyConfig = config()) {
  return (
    <EconomyProvider config={cfg} wallet={SESSION} memberId={MEMBER}>
      <TipDialog mode={m} recipient={solver} open onOpenChange={() => {}} />
    </EconomyProvider>
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
const radio = (re: RegExp) => screen.getByRole("radio", { name: re });

beforeEach(() => {
  balances.map = {};
  preflight.mockReset().mockResolvedValue(null);
  window.localStorage.clear();
  account.address = SESSION;
  account.chainId = 84532;
  account.isConnected = true;
  switchChain.mockReset();
  send.mockReset().mockResolvedValueOnce(MAIN_HASH);
  createTipIntentAction.mockReset();
  createBountyPaymentIntentAction.mockReset().mockResolvedValue({ ok: true, intent });
  attachTxAction.mockReset().mockResolvedValue({ ok: true });
  verifyIntentAction.mockReset().mockResolvedValue({ status: "confirmed", tipId: "t1" });
  getReceiveNetworks.mockReset().mockResolvedValue(["base", "arbitrum"]);
});

describe("TipDialog bounty mode: form", () => {
  it("is titled as a bounty payment, says ElClub. holds no funds and links to the bounties guide", async () => {
    await setup();
    expect(screen.getByRole("heading", { name: "Pagar bounty" })).toBeInTheDocument();
    expect(screen.getByText("ElClub. no custodia fondos: va directo a su wallet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /¿Cómo funciona\?/ })).toHaveAttribute("href", "/foro/guia/bounties");
  });

  it("reads the solver's networks with the browser client", async () => {
    await setup();
    expect(getReceiveNetworks).toHaveBeenCalledWith({ fake: true }, solver.id);
  });

  it("solver accepting base and arbitrum: one USDC row per network, no ETH, the announced network chosen", async () => {
    await setup();
    const group = screen.getByRole("radiogroup", { name: "Red de pago" });
    expect(within(group).getAllByRole("radio")).toHaveLength(2);
    expect(radio(/USDC.*Base Sepolia/)).toHaveAttribute("aria-checked", "true");
    expect(radio(/USDC.*Arbitrum Sepolia/)).toHaveAttribute("aria-checked", "false");
    expect(screen.queryByRole("radio", { name: /ETH/ })).not.toBeInTheDocument();
  });

  it("the announced network stays chosen even when another one ranks better by balance", async () => {
    balances.map = { "USDC:84532": 0n, "ETH:84532": 0n, "USDC:421614": 50_000_000n, "ETH:421614": 10n ** 18n };
    await setup();
    expect(radio(/USDC.*Base Sepolia/)).toHaveAttribute("aria-checked", "true");
  });

  it("solver accepting only arbitrum: only 421614 is offered, and chosen", async () => {
    getReceiveNetworks.mockResolvedValue(["arbitrum"]);
    await setup();
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(1);
    expect(radios[0]).toHaveAccessibleName(/USDC.*Arbitrum Sepolia/);
    expect(radios[0]).toHaveAttribute("aria-checked", "true");
  });

  it("only the bounty's token is offered (ETH bounty: ETH rows only)", async () => {
    await setup(mode({ token: "ETH", minAmount: 10n ** 16n }));
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(2);
    for (const r of radios) expect(r).toHaveAccessibleName(/^ETH/);
    expect(screen.getByTestId("locked-token")).toHaveTextContent("ETH");
  });

  it("a solver with no enabled network in common says so and offers no Continuar", async () => {
    getReceiveNetworks.mockResolvedValue(["arbitrum"]);
    mount(mode(), config({ enabledChainIds: [84532] }));
    expect(await screen.findByText("Esta persona no recibe pagos en las redes disponibles.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continuar" })).not.toBeInTheDocument();
  });

  it("pre-fills the announced amount and lets it be raised", async () => {
    await setup();
    expect(amountBox()).toHaveValue("25");
    expect(continuar()).toBeEnabled();
    await userEvent.type(amountBox(), "5");
    expect(amountBox()).toHaveValue("255");
    expect(continuar()).toBeEnabled();
  });

  it("refuses an amount below the announced one", async () => {
    await setup();
    await userEvent.clear(amountBox());
    await userEvent.type(amountBox(), "24,99");
    expect(screen.getByText("El importe no puede ser menor que el del bounty (25 USDC).")).toBeInTheDocument();
    expect(continuar()).toBeDisabled();
  });

  it("has no anonymous option", async () => {
    await setup();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByText(/donación sin esperar nada/)).not.toBeInTheDocument();
    expect(screen.queryByText(/anónima/i)).not.toBeInTheDocument();
  });

  it("announced on a network that is no longer enabled: pays with the same token on an enabled one, no 'inactive' notice", async () => {
    await setup(mode({ chainId: 8453 }));
    expect(screen.queryByText(/vuelva a estar activa/)).not.toBeInTheDocument();
    expect(radio(/USDC.*Base Sepolia/)).toHaveAttribute("aria-checked", "true");
    await userEvent.click(continuar());
    await screen.findByText("Bounty pagado");
    expect(createBountyPaymentIntentAction).toHaveBeenCalledWith({ bountyId: BOUNTY, chainId: 84532, amount: "25" });
  });
});

describe("TipDialog bounty mode: signing", () => {
  it("creates the intent through the bounty action (never the tip action), signs the main, and clears the ledger", async () => {
    await setup();
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
    await setup(mode({ chainId: 421614 }));
    expect(radio(/USDC.*Arbitrum Sepolia/)).toHaveAttribute("aria-checked", "true");
    await userEvent.click(continuar());
    await screen.findByText("Bounty pagado");
    expect(createBountyPaymentIntentAction).toHaveBeenCalledWith({ bountyId: BOUNTY, chainId: 421614, amount: "25" });
    expect(send).toHaveBeenCalledWith({ chain: 421614, token: "USDC", to: SOLVER_WALLET, amount: 25000000n, account: SESSION });
  });

  it("announced on Base, paid on Arbitrum: the picked network is the one the intent is asked for and signed on", async () => {
    account.chainId = 421614;
    createBountyPaymentIntentAction.mockResolvedValue({ ok: true, intent: { ...intent, chainId: 421614 } });
    await setup();
    expect(screen.getByText("Tu wallet está en otra red.")).toBeInTheDocument();
    await userEvent.click(radio(/USDC.*Arbitrum Sepolia/));
    await userEvent.click(continuar());
    await screen.findByText("Bounty pagado");
    expect(createBountyPaymentIntentAction).toHaveBeenCalledWith({ bountyId: BOUNTY, chainId: 421614, amount: "25" });
    expect(send).toHaveBeenCalledWith({ chain: 421614, token: "USDC", to: SOLVER_WALLET, amount: 25000000n, account: SESSION });
  });

  it("announced network differs from the wallet's: Continuar switches the wallet and pays on the announced one", async () => {
    account.chainId = 421614;
    let accepted: (() => void) | undefined;
    switchChain.mockImplementation((_a: unknown, o?: { onSuccess?: () => void }) => {
      accepted = () => o?.onSuccess?.();
    });
    const view = await setup();
    expect(switchChain).not.toHaveBeenCalled();
    await userEvent.click(continuar());
    expect(switchChain.mock.calls[0]![0]).toEqual({ chainId: 84532 });
    expect(createBountyPaymentIntentAction).not.toHaveBeenCalled();
    account.chainId = 84532;
    view.rerender(ui());
    act(() => accepted!());
    await screen.findByText("Bounty pagado");
    expect(createBountyPaymentIntentAction).toHaveBeenCalledWith({ bountyId: BOUNTY, chainId: 84532, amount: "25" });
    expect(send).toHaveBeenCalledWith({ chain: 84532, token: "USDC", to: SOLVER_WALLET, amount: 25000000n, account: SESSION });
  });

  it("a fee-era leftover for this bounty is discarded and the form opens (Review Focus 4)", async () => {
    upsertSend(MEMBER, { intentId: INTENT_ID, chainId: 84532, token: "USDC", targetType: "bounty", targetId: BOUNTY, feeRequired: true, createdAt: Date.now(), intent: { ...intent, feeAmount: "250000" } });
    await setup();
    expect(amountBox()).toBeInTheDocument();
    expect(screen.queryByText(/ya está pagada/)).not.toBeInTheDocument();
    expect(loadSends(MEMBER)).toEqual([]);
    expect(createBountyPaymentIntentAction).not.toHaveBeenCalled();
  });

  it("blocks a fresh intent while a signature for this bounty may still be pending in the wallet", async () => {
    upsertSend(MEMBER, { intentId: INTENT_ID, chainId: 84532, token: "USDC", targetType: "bounty", targetId: BOUNTY, feeRequired: false, createdAt: Date.now(), inFlight: Date.now(), intent });
    mount();
    expect(screen.getByText(/Tienes una firma pendiente en tu wallet/)).toBeInTheDocument();
    expect(createBountyPaymentIntentAction).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses to sign an intent whose recipient is not the solver shown", async () => {
    createBountyPaymentIntentAction.mockResolvedValue({ ok: true, intent: { ...intent, recipientAddress: "0x9999999999999999999999999999999999999999" } });
    await setup();
    await userEvent.click(continuar());
    expect(await screen.findByText("Los datos del envío no coinciden. Recarga la página.")).toBeInTheDocument();
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses an intent below the announced amount or in another token", async () => {
    createBountyPaymentIntentAction.mockResolvedValue({ ok: true, intent: { ...intent, amount: "24000000", feeAmount: "0", platformAddress: null } });
    await setup();
    await userEvent.click(continuar());
    expect(await screen.findByText("Los datos del envío no coinciden. Recarga la página.")).toBeInTheDocument();
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses an intent on another chain than the chosen one", async () => {
    createBountyPaymentIntentAction.mockResolvedValue({ ok: true, intent: { ...intent, chainId: 421614 } });
    await setup();
    await userEvent.click(continuar());
    expect(await screen.findByText("Los datos del envío no coinciden. Recarga la página.")).toBeInTheDocument();
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses an intent on a network the solver does not accept (not offered here)", async () => {
    getReceiveNetworks.mockResolvedValue(["arbitrum"]);
    account.chainId = 421614;
    createBountyPaymentIntentAction.mockResolvedValue({ ok: true, intent: { ...intent, chainId: 84532 } });
    await setup();
    await userEvent.click(continuar());
    expect(await screen.findByText("Los datos del envío no coinciden. Recarga la página.")).toBeInTheDocument();
    expect(send).not.toHaveBeenCalled();
  });

  it("when the server hands back an already prepared intent with a different amount, shows it instead of signing something unseen", async () => {
    createBountyPaymentIntentAction.mockResolvedValue({ ok: true, intent: { ...intent, amount: "30000000" } });
    await setup();
    await userEvent.click(continuar());
    expect(await screen.findByText(/Ya tenías un pago de este bounty preparado con otro importe/)).toBeInTheDocument();
    expect(send).not.toHaveBeenCalled();
    expect(amountBox()).toHaveValue("30");
  });

  it("shows payment_in_progress and signs nothing", async () => {
    createBountyPaymentIntentAction.mockResolvedValue({ ok: false, code: "payment_in_progress", error: "Ya hay un pago de este bounty en curso. Espera a que se confirme." });
    await setup();
    await userEvent.click(continuar());
    expect(await screen.findByText("Ya hay un pago de este bounty en curso. Espera a que se confirme.")).toBeInTheDocument();
    expect(send).not.toHaveBeenCalled();
  });
});
