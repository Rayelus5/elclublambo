import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

const account = vi.hoisted(() => ({ address: undefined as string | undefined, chainId: undefined as number | undefined, isConnected: false }));
const switchChain = vi.hoisted(() => vi.fn());
vi.mock("@/lib/bounties/actions", () => ({ createBountyAction: vi.fn(), createBountyPaymentIntentAction: vi.fn(), cancelBountyAction: vi.fn(), markSolutionAction: vi.fn() }));
vi.mock("wagmi", () => ({
  useAccount: () => account,
  useSwitchChain: () => ({ switchChain, isPending: false }),
}));
const openAppKit = vi.hoisted(() => vi.fn());
vi.mock("@reown/appkit/react", () => ({
  useAppKit: () => ({ open: openAppKit }),
  useAppKitState: () => ({ open: false }),
}));

const send = vi.hoisted(() => vi.fn());
vi.mock("@/lib/payments/use-send-transfer", () => ({ useSendTransfer: () => ({ send }) }));
const balances = vi.hoisted(() => ({ map: {} as Record<string, bigint | null> }));
const invalidate = vi.hoisted(() => vi.fn());
vi.mock("@/lib/payments/balances", () => ({
  useAssetBalances: () => balances.map,
  useInvalidateAssetBalances: () => invalidate,
  readAssetBalance: vi.fn(),
}));
const preflight = vi.hoisted(() => vi.fn());
vi.mock("@/lib/payments/preflight", async (orig) => ({
  ...(await orig<typeof import("@/lib/payments/preflight")>()),
  useBalancePreflight: () => preflight,
}));
const getReceiveNetworks = vi.hoisted(() => vi.fn());
vi.mock("@/lib/payments/queries", () => ({ getReceiveNetworks }));
vi.mock("@/lib/supabase/browser", () => ({ createBrowserClient: () => ({ fake: true }) }));

const createTipIntentAction = vi.hoisted(() => vi.fn());
const attachTxAction = vi.hoisted(() => vi.fn());
const verifyIntentAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/payments/tip-actions", () => ({ createTipIntentAction, attachTxAction, verifyIntentAction }));
// The real ledger, with patchSend observable so a test can make one write blow up.
const ledger = vi.hoisted(() => ({ patchSend: undefined as unknown as Mock<typeof import("@/lib/payments/pending-sends").patchSend> }));
vi.mock("@/lib/payments/pending-sends", async (orig) => {
  const real = await orig<typeof import("@/lib/payments/pending-sends")>();
  ledger.patchSend = vi.fn(real.patchSend);
  return { ...real, patchSend: (...a: Parameters<typeof real.patchSend>) => ledger.patchSend(...a) };
});

import { EconomyProvider } from "@/components/payments/economy-provider";
import { TipDialog } from "@/components/payments/tip-dialog";
import type { EconomyConfig } from "@/lib/economy/config";
import { loadSends, upsertSend } from "@/lib/payments/pending-sends";

const SESSION = "0x1111111111111111111111111111111111111111";
const RECIPIENT_WALLET = "0x2222222222222222222222222222222222222222";
const MAIN_HASH = "0x" + "aa".repeat(32);
const MEMBER = "99999999-9999-4999-8999-999999999999";
const INTENT_ID = "11111111-1111-4111-8111-111111111111";
const MESSAGE = "33333333-3333-4333-8333-333333333333";
const E = 10n ** 18n;

const recipient = { id: "22222222-2222-4222-8222-222222222222", handle: "ana_l", displayName: "Ana", walletAddress: RECIPIENT_WALLET, avatarPath: null };

const config = (over: Partial<EconomyConfig> = {}): EconomyConfig => ({
  enabledChainIds: [84532, 421614],
  safes: {},
  legacyDaoEnabled: false,
  legacy: { activeChainId: 59141, withdrawalsEnabled: { 59144: false, 59141: false }, weightedRafflesEnabled: { 59144: false, 59141: false }, chains: { 59144: { safe: null, platform: null }, 59141: { safe: null, platform: null } } },
  ...over,
});

type MountOpts = { open?: boolean; onOpenChange?: (o: boolean) => void; cfg?: EconomyConfig; recipient?: typeof recipient; target?: Parameters<typeof TipDialog>[0]["target"] };
function mount(opts: MountOpts = {}) {
  return render(ui(opts));
}
function ui(opts: MountOpts = {}) {
  return (
    <EconomyProvider config={opts.cfg ?? config()} wallet={SESSION} memberId={MEMBER}>
      <TipDialog target={opts.target ?? { type: "message", messageId: MESSAGE }} recipient={opts.recipient ?? recipient} open={opts.open ?? true} onOpenChange={opts.onOpenChange ?? (() => {})} />
    </EconomyProvider>
  );
}

/** Mounts and waits until the recipient's networks arrived and the asset picker is shown. */
async function setup(opts: Parameters<typeof mount>[0] = {}) {
  const view = mount(opts);
  await screen.findByRole("radiogroup", { name: "Moneda" });
  return view;
}

const intent = {
  id: INTENT_ID,
  chainId: 84532,
  token: "USDC" as const,
  amount: "10000000",
  feeAmount: "0",
  recipientAddress: RECIPIENT_WALLET,
  platformAddress: null as string | null,
  expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
};

const continuar = () => screen.getByRole("button", { name: "Continuar" });
const radio = (re: RegExp) => screen.getByRole("radio", { name: re });
async function typeAmount(v: string) {
  await userEvent.type(screen.getByLabelText("Importe"), v);
}

beforeEach(() => {
  window.localStorage.clear();
  account.address = SESSION;
  account.chainId = 84532;
  account.isConnected = true;
  switchChain.mockReset();
  balances.map = {};
  invalidate.mockReset();
  preflight.mockReset().mockResolvedValue(null);
  openAppKit.mockReset();
  getReceiveNetworks.mockReset().mockResolvedValue(["base", "arbitrum"]);
  send.mockReset().mockResolvedValueOnce(MAIN_HASH);
  createTipIntentAction.mockReset().mockResolvedValue({ ok: true, intent });
  attachTxAction.mockReset().mockResolvedValue({ ok: true });
  verifyIntentAction.mockReset().mockResolvedValue({ status: "confirmed", tipId: "t1" });
});

describe("TipDialog form", () => {
  it("shows the recipient, the anonymous note, the custody line and the guide link; no fee anywhere", async () => {
    await setup();
    expect(screen.getByText("@ana_l")).toBeInTheDocument();
    expect(screen.getByText("0x2222…2222")).toBeInTheDocument();
    expect(screen.getByText("Va directo a su wallet.")).toBeInTheDocument();
    expect(screen.getByText("ElClub. no custodia fondos: va directo a su wallet.")).toBeInTheDocument();
    expect(screen.getByText("Solo se oculta en el foro: en la blockchain la transacción es pública.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /¿Cómo funciona\?/ })).toHaveAttribute("href", "/guia/propinas");
    expect(screen.queryByRole("checkbox", { name: /donación sin esperar nada/ })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Comisión|comisión/);
  });

  it("reads the recipient's networks with the browser client", async () => {
    await setup();
    expect(getReceiveNetworks).toHaveBeenCalledWith({ fake: true }, recipient.id);
  });

  it("offers USDC and ETH of every enabled network the recipient accepts", async () => {
    await setup();
    expect(screen.getAllByRole("radio")).toHaveLength(4);
  });

  it("with receive_networks ['arbitrum'] only Arbitrum Sepolia assets are offered (Review Focus 2)", async () => {
    getReceiveNetworks.mockResolvedValue(["arbitrum"]);
    await setup();
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(2);
    for (const r of radios) expect(r).toHaveAccessibleName(/Arbitrum Sepolia/);
  });

  it("a recipient with no network in common says so and offers no Continuar", async () => {
    getReceiveNetworks.mockResolvedValue(["arbitrum"]);
    mount({ cfg: config({ enabledChainIds: [84532] }) });
    expect(await screen.findByText("Esta persona no recibe pagos en las redes disponibles.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continuar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  });

  it("starts on the best payable asset once balances arrive, without switching the wallet by itself", async () => {
    balances.map = { "USDC:84532": 0n, "ETH:84532": 0n, "USDC:421614": 5_000_000n, "ETH:421614": E };
    await setup();
    expect(radio(/USDC.*Arbitrum Sepolia/)).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("Tu wallet está en otra red.")).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 450));
    expect(switchChain).not.toHaveBeenCalled();
  });

  it("the summary names the recipient, the amount and the token", async () => {
    await setup();
    await typeAmount("10");
    expect(screen.getByTestId("tip-summary")).toHaveTextContent("Para @ana_l: 10 USDC");
  });

  it("disables Continuar with a reason when the amount is out of range", async () => {
    await setup();
    await typeAmount("0,001");
    expect(continuar()).toBeDisabled();
    expect(screen.getByText(/entre 0,01 y 100000 USDC/)).toBeInTheDocument();
  });

  it("blocks tipping oneself", async () => {
    await setup({ recipient: { ...recipient, walletAddress: SESSION } });
    await typeAmount("10");
    expect(screen.getByText(/No puedes enviarte una propina/)).toBeInTheDocument();
    expect(continuar()).toBeDisabled();
  });
});

describe("TipDialog network switch (Review Focus 1)", () => {
  it("choosing USDC:421614 with the account on 84532 asks the wallet to switch to 421614", async () => {
    await setup();
    await userEvent.click(radio(/USDC.*Arbitrum Sepolia/));
    await waitFor(() => expect(switchChain).toHaveBeenCalledTimes(1));
    expect(switchChain.mock.calls[0]![0]).toEqual({ chainId: 421614 });
  });

  it("arrow keys only move the selection: no switch per key, nothing when it ends on the wallet's network", async () => {
    await setup();
    radio(/USDC.*Base Sepolia/).focus();
    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    expect(radio(/ETH.*Base Sepolia/)).toHaveAttribute("aria-checked", "true");
    await new Promise((r) => setTimeout(r, 450));
    expect(switchChain).not.toHaveBeenCalled();
  });

  it("arrow keys ending on another network's asset ask for exactly one switch, after the debounce", async () => {
    await setup();
    radio(/USDC.*Base Sepolia/).focus();
    // USDC Base → USDC Arbitrum → ETH Base → ETH Arbitrum
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}");
    expect(radio(/ETH.*Arbitrum Sepolia/)).toHaveAttribute("aria-checked", "true");
    expect(switchChain).not.toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 450));
    expect(switchChain).toHaveBeenCalledTimes(1);
    expect(switchChain.mock.calls[0]![0]).toEqual({ chainId: 421614 });
  });

  it("when the switch fails: 'Cambiar a Arbitrum Sepolia', and Continuar only retries the switch: nothing is sent", async () => {
    switchChain.mockImplementation((_a: unknown, o?: { onError?: (e: Error) => void }) => o?.onError?.(new Error("rejected")));
    await setup();
    await userEvent.click(radio(/USDC.*Arbitrum Sepolia/));
    await waitFor(() => expect(switchChain).toHaveBeenCalled());
    await typeAmount("1");
    expect(screen.getByText("Tu wallet está en otra red.")).toBeInTheDocument();
    expect(screen.getByText("No se pudo cambiar de red. Cámbiala desde tu wallet o inténtalo otra vez.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cambiar a Arbitrum Sepolia" })).toBeInTheDocument();
    await userEvent.click(continuar());
    await waitFor(() => expect(switchChain).toHaveBeenCalledTimes(2));
    expect(switchChain.mock.calls[1]![0]).toEqual({ chainId: 421614 });
    expect(screen.getByText("No se pudo cambiar de red. Cámbiala desde tu wallet o inténtalo otra vez.")).toBeInTheDocument();
    expect(createTipIntentAction).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("auto-selected asset on another network: no prompt on open; Continuar switches the wallet, then the tip goes ahead there", async () => {
    balances.map = { "USDC:84532": 0n, "ETH:84532": 0n, "USDC:421614": 5_000_000n, "ETH:421614": E };
    createTipIntentAction.mockResolvedValue({ ok: true, intent: { ...intent, chainId: 421614, amount: "1000000" } });
    // The wallet accepts the switch: wagmi re-renders with the new chain (here: an explicit rerender), then onSuccess.
    let accepted: (() => void) | undefined;
    switchChain.mockImplementation((_a: unknown, o?: { onSuccess?: () => void }) => {
      accepted = () => o?.onSuccess?.();
    });
    const view = await setup();
    expect(radio(/USDC.*Arbitrum Sepolia/)).toHaveAttribute("aria-checked", "true");
    await typeAmount("1");
    await new Promise((r) => setTimeout(r, 450));
    expect(switchChain).not.toHaveBeenCalled();
    expect(continuar()).toBeEnabled();
    await userEvent.click(continuar());
    expect(switchChain).toHaveBeenCalledTimes(1);
    expect(switchChain.mock.calls[0]![0]).toEqual({ chainId: 421614 });
    expect(createTipIntentAction).not.toHaveBeenCalled();
    account.chainId = 421614;
    view.rerender(ui());
    act(() => accepted!());
    await screen.findByText("Propina enviada");
    expect(createTipIntentAction).toHaveBeenCalledTimes(1);
    expect(createTipIntentAction).toHaveBeenCalledWith(expect.objectContaining({ chainId: 421614, token: "USDC", amount: "1" }));
    expect(send).toHaveBeenCalledWith({ chain: 421614, token: "USDC", to: RECIPIENT_WALLET, amount: 1_000_000n, account: SESSION });
  });

  it("choosing another asset (even on the same network) while the switch is pending cancels the automatic send", async () => {
    balances.map = { "USDC:84532": 0n, "ETH:84532": 0n, "USDC:421614": 5_000_000n, "ETH:421614": E };
    let accepted: (() => void) | undefined;
    switchChain.mockImplementation((_a: unknown, o?: { onSuccess?: () => void }) => {
      accepted ??= () => o?.onSuccess?.();
    });
    const view = await setup();
    await typeAmount("0,5");
    await userEvent.click(continuar());
    expect(switchChain).toHaveBeenCalledTimes(1);
    await userEvent.click(radio(/ETH.*Arbitrum Sepolia/));
    account.chainId = 421614;
    view.rerender(ui());
    act(() => accepted!());
    await new Promise((r) => setTimeout(r, 50));
    expect(createTipIntentAction).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("the automatic pick moving to another asset on the same network while the switch is pending cancels the send", async () => {
    // ETH on Arbitrum not known yet: USDC Arbitrum is the best so far and the pick is not frozen.
    balances.map = { "USDC:84532": 0n, "ETH:84532": 0n, "USDC:421614": 5_000_000n, "ETH:421614": null };
    let accepted: (() => void) | undefined;
    switchChain.mockImplementation((_a: unknown, o?: { onSuccess?: () => void }) => {
      accepted ??= () => o?.onSuccess?.();
    });
    const view = await setup();
    expect(radio(/USDC.*Arbitrum Sepolia/)).toHaveAttribute("aria-checked", "true");
    await typeAmount("0,5");
    await userEvent.click(continuar());
    expect(switchChain).toHaveBeenCalledTimes(1);
    // While the wallet switches, the balances arrive and the automatic pick moves to ETH on Arbitrum (same network).
    balances.map = { "USDC:84532": 0n, "ETH:84532": 0n, "USDC:421614": 0n, "ETH:421614": E };
    view.rerender(ui());
    expect(radio(/ETH.*Arbitrum Sepolia/)).toHaveAttribute("aria-checked", "true");
    account.chainId = 421614;
    view.rerender(ui());
    act(() => accepted!());
    await new Promise((r) => setTimeout(r, 50));
    expect(createTipIntentAction).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("a different amount while the switch is pending cancels the send", async () => {
    balances.map = { "USDC:84532": 0n, "ETH:84532": 0n, "USDC:421614": 5_000_000n, "ETH:421614": E };
    let accepted: (() => void) | undefined;
    switchChain.mockImplementation((_a: unknown, o?: { onSuccess?: () => void }) => {
      accepted ??= () => o?.onSuccess?.();
    });
    const view = await setup();
    await typeAmount("1");
    await userEvent.click(continuar());
    await userEvent.clear(screen.getByLabelText("Importe"));
    await typeAmount("2");
    account.chainId = 421614;
    view.rerender(ui());
    act(() => accepted!());
    await new Promise((r) => setTimeout(r, 50));
    expect(createTipIntentAction).not.toHaveBeenCalled();
  });

  it("closing the dialog while the switch is pending: nothing is sent after the switch lands", async () => {
    balances.map = { "USDC:84532": 0n, "ETH:84532": 0n, "USDC:421614": 5_000_000n, "ETH:421614": E };
    let accepted: (() => void) | undefined;
    switchChain.mockImplementation((_a: unknown, o?: { onSuccess?: () => void }) => {
      accepted ??= () => o?.onSuccess?.();
    });
    const view = await setup();
    await typeAmount("1");
    await userEvent.click(continuar());
    expect(switchChain).toHaveBeenCalledTimes(1);
    view.rerender(ui({ open: false }));
    account.chainId = 421614;
    view.rerender(ui({ open: false }));
    act(() => accepted!());
    await new Promise((r) => setTimeout(r, 50));
    expect(createTipIntentAction).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("the switch button retries the switch to the chosen asset's network", async () => {
    account.chainId = 8453;
    await setup();
    await userEvent.click(screen.getByRole("button", { name: "Cambiar a Base Sepolia" }));
    expect(switchChain.mock.calls[0]![0]).toEqual({ chainId: 84532 });
  });
});

describe("TipDialog wallet check", () => {
  it("offers to connect a wallet when none is connected", async () => {
    account.isConnected = false;
    account.address = undefined;
    account.chainId = undefined;
    await setup();
    await typeAmount("10");
    expect(continuar()).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Conectar wallet" }));
    expect(openAppKit).toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("signs nothing when the connected address is not the session wallet", async () => {
    account.address = "0x9999999999999999999999999999999999999999";
    await setup();
    await typeAmount("10");
    expect(screen.getByText("Conecta la wallet 0x1111…1111 para enviar.")).toBeInTheDocument();
    expect(continuar()).toBeDisabled();
    expect(createTipIntentAction).not.toHaveBeenCalled();
  });
});

describe("TipDialog signing and verification", () => {
  it("Arbitrum USDC: one intent without fee, one transfer to the recipient, attach, explorer link, balances re-read", async () => {
    account.chainId = 421614;
    createTipIntentAction.mockResolvedValue({ ok: true, intent: { ...intent, chainId: 421614, amount: "1000000" } });
    await setup();
    await userEvent.click(radio(/USDC.*Arbitrum Sepolia/));
    await typeAmount("1");
    await userEvent.click(continuar());
    await screen.findByText("Propina enviada");

    expect(createTipIntentAction).toHaveBeenCalledWith({ targetType: "message", targetId: MESSAGE, chainId: 421614, token: "USDC", amount: "1", anonymous: false });
    expect(createTipIntentAction.mock.calls[0]![0]).not.toHaveProperty("feeBps");
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ chain: 421614, token: "USDC", to: RECIPIENT_WALLET, amount: 1_000_000n, account: SESSION });
    expect(preflight).toHaveBeenCalledWith({ chain: 421614, token: "USDC", amount: 1_000_000n, mainLabel: "la propina", account: SESSION });
    expect(attachTxAction).toHaveBeenCalledTimes(1);
    expect(attachTxAction).toHaveBeenCalledWith(INTENT_ID, "main", MAIN_HASH);
    const links = screen.getAllByRole("link", { name: /Ver en el explorador/ });
    expect(links.map((l) => l.getAttribute("href"))).toEqual([`https://sepolia.arbiscan.io/tx/${MAIN_HASH}`]);
    expect(invalidate).toHaveBeenCalled();
    expect(document.body.textContent).not.toMatch(/Comisión|comisión/);
  });

  it("sends a profile tip with the profile target and anonymous flag", async () => {
    await setup({ target: { type: "profile" } });
    await typeAmount("10");
    await userEvent.click(screen.getByRole("checkbox", { name: /Propina anónima/ }));
    await userEvent.click(continuar());
    await screen.findByText("Propina enviada");
    expect(createTipIntentAction).toHaveBeenCalledWith(expect.objectContaining({ targetType: "profile", targetId: recipient.id, anonymous: true, chainId: 84532 }));
  });

  it("signing shows a single step, never a fee step", async () => {
    let resolve!: (h: string) => void;
    send.mockReset().mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    await setup();
    await typeAmount("10");
    await userEvent.click(continuar());
    expect(await screen.findByText("Confirma en tu wallet.")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(document.body.textContent).not.toMatch(/Comisión|1\/2/);
    resolve(MAIN_HASH);
    await screen.findByText("Propina enviada");
  });

  it("returns to the form when the wallet rejects the signature", async () => {
    send.mockReset().mockRejectedValue(Object.assign(new Error("User rejected the request."), { code: 4001 }));
    await setup();
    await typeAmount("10");
    await userEvent.click(continuar());
    expect(await screen.findByText("Has cancelado la firma.")).toBeInTheDocument();
    expect(screen.getByLabelText("Importe")).toHaveValue("10");
    expect(attachTxAction).not.toHaveBeenCalled();
    expect(loadSends(MEMBER)).toEqual([]);
  });

  it("shows the server error when the intent is refused, and signs nothing", async () => {
    createTipIntentAction.mockResolvedValue({ ok: false, code: "network_not_accepted", error: "Esta persona no recibe pagos en esa red." });
    await setup();
    await typeAmount("10");
    await userEvent.click(continuar());
    expect(await screen.findByText("Esta persona no recibe pagos en esa red.")).toBeInTheDocument();
    expect(send).not.toHaveBeenCalled();
  });

  it("polls while pending and then confirms", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      verifyIntentAction.mockReset().mockResolvedValueOnce({ status: "pending" }).mockResolvedValueOnce({ status: "confirmed", tipId: "t1" });
      await setup();
      await typeAmount("10");
      await userEvent.click(continuar());
      await screen.findByText(/Verificando/);
      await vi.advanceTimersByTimeAsync(3100);
      await screen.findByText("Propina enviada");
      expect(verifyIntentAction).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("after 2 minutes still pending, tells the member they can close", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      verifyIntentAction.mockReset().mockResolvedValue({ status: "pending" });
      await setup();
      await typeAmount("10");
      await userEvent.click(continuar());
      await screen.findByText(/Verificando/);
      await vi.advanceTimersByTimeAsync(125_000);
      expect(await screen.findByText(/Seguimos verificando\. Puedes cerrar: la propina se acreditará sola cuando se confirme\./)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the failure message when verification fails", async () => {
    verifyIntentAction.mockReset().mockResolvedValue({ status: "failed", code: "tx_mismatch", error: "La transferencia no coincide." });
    await setup();
    await typeAmount("10");
    await userEvent.click(continuar());
    await waitFor(() => expect(screen.getByText("La transferencia no coincide.")).toBeInTheDocument());
  });
});

describe("TipDialog definitive outcomes (F3-R3)", () => {
  it("a non-definitive failure keeps polling and keeps the ledger entry", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      verifyIntentAction
        .mockReset()
        .mockResolvedValueOnce({ status: "failed", code: "unknown", error: "Algo falló. Inténtalo de nuevo." })
        .mockResolvedValueOnce({ status: "pending" });
      await setup();
      await typeAmount("10");
      await userEvent.click(continuar());
      await screen.findByText(/Verificando/);
      await vi.advanceTimersByTimeAsync(3100);
      expect(verifyIntentAction).toHaveBeenCalledTimes(2);
      expect(screen.queryByRole("alert")).toBeNull();
      expect(loadSends(MEMBER).map((e) => e.intentId)).toEqual([INTENT_ID]);
      expect(loadSends(MEMBER)[0]).toMatchObject({ feeRequired: false, mainHash: MAIN_HASH, chainId: 84532 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("a definitive failure ends the flow and drops the ledger entry", async () => {
    verifyIntentAction.mockReset().mockResolvedValue({ status: "failed", code: "tx_failed", error: "La transacción falló en la red." });
    await setup();
    await typeAmount("10");
    await userEvent.click(continuar());
    await screen.findByText("La transacción falló en la red.");
    expect(loadSends(MEMBER)).toEqual([]);
  });
});

describe("TipDialog tip intent check (M1)", () => {
  it.each([
    ["another chain than the chosen asset's", { chainId: 421614 }],
    ["another amount", { amount: "20000000" }],
    ["another token", { token: "ETH" }],
    ["a fee", { feeAmount: "999" }],
    ["another recipient", { recipientAddress: "0x5555555555555555555555555555555555555555" }],
  ])("refuses to sign a returned intent with %s", async (_label, over) => {
    createTipIntentAction.mockReset().mockResolvedValue({ ok: true, intent: { ...intent, ...over } });
    await setup();
    await typeAmount("10");
    await userEvent.click(continuar());
    expect(await screen.findByText("Los datos del envío no coinciden. Recarga la página.")).toBeInTheDocument();
    expect(send).not.toHaveBeenCalled();
  });
});

const setupAttachFailures = (failMain: number) => {
  let n = 0;
  attachTxAction.mockImplementation(async (_id: string, role: string) => {
    if (role === "main" && n < failMain) {
      n += 1;
      throw new Error("offline");
    }
    return { ok: true };
  });
};

describe("TipDialog after something was signed (F3b-R4)", () => {
  it("a non-rejection send error returns to the form with a generic message", async () => {
    send.mockReset().mockRejectedValue(new Error("boom"));
    await setup();
    await typeAmount("10");
    await userEvent.click(continuar());
    expect(await screen.findByText(/No se pudo enviar la transacción/)).toBeInTheDocument();
    expect(continuar()).toBeEnabled();
  });

  it("an error once the hash exists never drops the ledger entry nor goes back to the form", async () => {
    const real = ledger.patchSend.getMockImplementation()!;
    ledger.patchSend.mockImplementation((m, id, patch) => {
      if (patch.mainHash) throw new Error("storage exploded");
      return real(m, id, patch);
    });
    try {
      await setup();
      await typeAmount("10");
      await userEvent.click(continuar());
      expect(await screen.findByText("No hemos podido registrar tu transacción.")).toBeInTheDocument();
      // the hash is on screen even though the ledger write failed
      expect(screen.getByRole("link", { name: /Ver en el explorador/ })).toHaveAttribute("href", expect.stringContaining(MAIN_HASH));
      expect(loadSends(MEMBER).map((e) => e.intentId)).toEqual([INTENT_ID]);
      expect(screen.queryByRole("button", { name: "Continuar" })).not.toBeInTheDocument();
      ledger.patchSend.mockImplementation(real);
      await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
      await screen.findByText("Propina enviada");
      expect(send).toHaveBeenCalledTimes(1);
      expect(attachTxAction).toHaveBeenCalledWith(INTENT_ID, "main", MAIN_HASH);
    } finally {
      ledger.patchSend.mockImplementation(real);
    }
  });

  it("an intent-creation throw returns to the form and signs nothing", async () => {
    createTipIntentAction.mockRejectedValue(new Error("offline"));
    await setup();
    await typeAmount("10");
    await userEvent.click(continuar());
    expect(await screen.findByText("No se pudo preparar la propina. Inténtalo de nuevo.")).toBeInTheDocument();
    expect(send).not.toHaveBeenCalled();
    expect(continuar()).toBeEnabled();
  });

  it("clears the ledger once confirmed", async () => {
    await setup();
    await typeAmount("10");
    await userEvent.click(continuar());
    await screen.findByText("Propina enviada");
    expect(loadSends(MEMBER)).toEqual([]);
  });

  it("keeps the ledger entry when attach fails, then retries attach without signing again", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      setupAttachFailures(4);
      await setup();
      await typeAmount("10");
      await userEvent.click(continuar());
      await vi.advanceTimersByTimeAsync(8000);
      expect(await screen.findByText("No hemos podido registrar tu transacción.")).toBeInTheDocument();
      expect(screen.getAllByRole("link", { name: /Ver en el explorador/ })).toHaveLength(1);
      expect(loadSends(MEMBER)[0]).toMatchObject({ mainHash: MAIN_HASH });
      await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
      await screen.findByText("Propina enviada");
      expect(send).toHaveBeenCalledTimes(1);
      expect(createTipIntentAction).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("aborts when the connected account changed after Continuar", async () => {
    createTipIntentAction.mockImplementation(async () => {
      account.address = "0x9999999999999999999999999999999999999999";
      return { ok: true, intent };
    });
    await setup();
    await typeAmount("10");
    await userEvent.click(continuar());
    expect((await screen.findAllByText("Conecta la wallet 0x1111…1111 para enviar.")).length).toBeGreaterThan(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("closing while verifying asks first", async () => {
    verifyIntentAction.mockReset().mockResolvedValue({ status: "pending" });
    const onOpenChange = vi.fn();
    await setup({ onOpenChange });
    await typeAmount("10");
    await userEvent.click(continuar());
    await screen.findByText(/Verificando/);
    await userEvent.keyboard("{Escape}");
    expect(await screen.findByText("¿Cerrar? Si ya firmaste, la propina se seguirá verificando.")).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
    await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cerrar" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("closing during the signature: a late hash is recorded and attached, and nothing else is requested", async () => {
    let resolveMain!: (h: string) => void;
    send.mockReset().mockImplementationOnce(() => new Promise((r) => (resolveMain = r)));
    const first = await setup();
    await typeAmount("10");
    await userEvent.click(continuar());
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(loadSends(MEMBER)[0]?.inFlight).toEqual(expect.any(Number));
    first.unmount();
    resolveMain(MAIN_HASH);
    await waitFor(() => expect(attachTxAction).toHaveBeenCalledWith(INTENT_ID, "main", MAIN_HASH));
    await new Promise((r) => setTimeout(r, 20));
    expect(send).toHaveBeenCalledTimes(1);
    const entry = loadSends(MEMBER)[0]!;
    expect(entry.mainHash).toBe(MAIN_HASH);
    expect(entry.inFlight).toBeUndefined();
  });
});

const seed = (over: Record<string, unknown> = {}) =>
  upsertSend(MEMBER, {
    intentId: INTENT_ID,
    chainId: 84532,
    token: "USDC",
    targetType: "message",
    targetId: MESSAGE,
    feeRequired: false,
    createdAt: Date.now(),
    intent,
    ...over,
  } as never);

describe("TipDialog leftovers (Review Focus 4)", () => {
  it("a fee-era entry on 59141 is discarded: the dialog opens on the form and the entry leaves localStorage", async () => {
    seed({ chainId: 59141, feeRequired: true, feeHash: `0x${"fe".repeat(32)}`, feeAttached: true, intent: { ...intent, chainId: 59141, feeAmount: "100000", platformAddress: "0x4444444444444444444444444444444444444444" } });
    await setup();
    expect(screen.getByLabelText("Importe")).toBeInTheDocument();
    expect(screen.queryByText(/ya está pagada/)).not.toBeInTheDocument();
    expect(loadSends(MEMBER)).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });

  it("an in-flight entry on a disabled network does not block the form", async () => {
    seed({ chainId: 421614, inFlight: Date.now(), intent: { ...intent, chainId: 421614 } });
    await setup({ cfg: config({ enabledChainIds: [84532] }) });
    expect(screen.getByLabelText("Importe")).toBeInTheDocument();
    expect(loadSends(MEMBER)).toEqual([]);
  });
});

describe("TipDialog expiry and in-flight (F3b-R5)", () => {
  it("never signs when the fresh intent is about to expire", async () => {
    createTipIntentAction.mockResolvedValue({ ok: true, intent: { ...intent, expiresAt: new Date(Date.now() + 60_000).toISOString() } });
    await setup();
    await typeAmount("10");
    await userEvent.click(continuar());
    expect(await screen.findByText(/La operación ha caducado/)).toBeInTheDocument();
    expect(send).not.toHaveBeenCalled();
    expect(loadSends(MEMBER)).toEqual([]);
  });

  it("a permanent attach error stops retrying, drops the entry and keeps the explorer link", async () => {
    attachTxAction.mockReset().mockResolvedValue({ ok: false, code: "intent_expired", error: "Esta propina ha caducado. Crea una nueva." });
    await setup();
    await typeAmount("10");
    await userEvent.click(continuar());
    expect(await screen.findByText("Esta propina ha caducado. Crea una nueva.")).toBeInTheDocument();
    expect(attachTxAction).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole("link", { name: /Ver en el explorador/ })).toHaveLength(1);
    expect(loadSends(MEMBER)).toEqual([]);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("reopening while a signature is pending shows the pending state, not a form", async () => {
    seed({ inFlight: Date.now() });
    mount();
    expect(screen.getByText("Tienes una firma pendiente en tu wallet. Complétala o recházala antes de continuar.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Importe")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Comprobar de nuevo" }));
    expect(screen.getByText(/Tienes una firma pendiente/)).toBeInTheDocument();
    window.localStorage.clear();
    await userEvent.click(screen.getByRole("button", { name: "Comprobar de nuevo" }));
    expect(await screen.findByLabelText("Importe")).toBeInTheDocument();
  });

  it("an old in-flight marker (over 10 minutes) is ignored", async () => {
    seed({ inFlight: Date.now() - 11 * 60_000 });
    await setup();
    expect(screen.getByLabelText("Importe")).toBeInTheDocument();
  });

  it("no new intent while an unfinished entry appeared for the target after opening", async () => {
    await setup();
    await typeAmount("10");
    seed({ inFlight: Date.now() });
    await userEvent.click(continuar());
    expect(await screen.findByText(/Tienes una firma pendiente/)).toBeInTheDocument();
    expect(createTipIntentAction).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});

describe("TipDialog balance", () => {
  it("shows an inline error and disables Continuar when the amount exceeds the chosen asset's balance", async () => {
    balances.map = { "USDC:84532": 9_000_000n, "ETH:84532": E };
    await setup();
    await typeAmount("10");
    expect(screen.getByTestId("balance-error")).toHaveTextContent("Saldo insuficiente: necesitas 10 USDC y tienes 9.");
    expect(continuar()).toBeDisabled();
  });

  it("asks for ETH for gas when a USDC payment has no ETH on that network", async () => {
    balances.map = { "USDC:84532": 50_000_000n, "ETH:84532": 0n };
    await setup();
    await typeAmount("10");
    expect(screen.getByTestId("balance-error")).toHaveTextContent("Necesitas algo de ETH en Base Sepolia para el gas.");
    expect(continuar()).toBeDisabled();
  });

  it("an unreadable balance never blocks", async () => {
    await setup();
    await typeAmount("10");
    expect(screen.queryByTestId("balance-error")).not.toBeInTheDocument();
    expect(continuar()).toBeEnabled();
  });

  it("signs nothing when the signing-time preflight finds the balance short", async () => {
    preflight.mockResolvedValue("No tienes suficiente USDC en Base Sepolia para la propina: necesitas 10 USDC y tienes 9. No se ha enviado nada.");
    await setup();
    await typeAmount("10");
    await userEvent.click(continuar());
    expect(await screen.findByText(/No tienes suficiente USDC/)).toBeInTheDocument();
    expect(send).not.toHaveBeenCalled();
    expect(loadSends(MEMBER)).toHaveLength(0);
  });
});
