import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const account = vi.hoisted(() => ({ address: undefined as string | undefined, chainId: undefined as number | undefined, isConnected: false }));
const switchChain = vi.hoisted(() => vi.fn());
vi.mock("@/lib/treasury/actions", () => ({ createDonationIntentAction: vi.fn() }));
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

const createTipIntentAction = vi.hoisted(() => vi.fn());
const attachTxAction = vi.hoisted(() => vi.fn());
const verifyIntentAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/payments/tip-actions", () => ({ createTipIntentAction, attachTxAction, verifyIntentAction }));

import { EconomyProvider } from "@/components/payments/economy-provider";
import { TipDialog } from "@/components/payments/tip-dialog";
import type { EconomyConfig } from "@/lib/economy/config";
import { loadSends, upsertSend } from "@/lib/payments/pending-sends";

const SESSION = "0x1111111111111111111111111111111111111111";
const PLATFORM = "0x4444444444444444444444444444444444444444";
const RECIPIENT_WALLET = "0x2222222222222222222222222222222222222222";
const FEE_HASH = `0x${"fe".repeat(32)}`;
const MAIN_HASH = "0x" + "aa".repeat(32);
const MEMBER = "99999999-9999-4999-8999-999999999999";
const INTENT_ID = "11111111-1111-4111-8111-111111111111";

const recipient = { id: "22222222-2222-4222-8222-222222222222", handle: "ana_l", displayName: "Ana", walletAddress: RECIPIENT_WALLET, avatarPath: null };

const config = (over: Partial<EconomyConfig> = {}): EconomyConfig => ({
  activeChainId: 59141,
  minFeeBps: 100,
  chains: { 59144: { safe: null, platform: null }, 59141: { safe: null, platform: PLATFORM } },
  ...over,
});

function setup(opts: { onOpenChange?: (o: boolean) => void; cfg?: EconomyConfig; wallet?: string; recipient?: typeof recipient; target?: Parameters<typeof TipDialog>[0]["target"] } = {}) {
  return render(
    <EconomyProvider config={opts.cfg ?? config()} wallet={opts.wallet ?? SESSION} memberId={MEMBER}>
      <TipDialog target={opts.target ?? { type: "message", messageId: "33333333-3333-4333-8333-333333333333" }} recipient={opts.recipient ?? recipient} open onOpenChange={opts.onOpenChange ?? (() => {})} />
    </EconomyProvider>,
  );
}

const intent = {
  id: INTENT_ID,
  chainId: 59141,
  token: "USDC" as const,
  amount: "10000000",
  feeAmount: "100000",
  recipientAddress: RECIPIENT_WALLET,
  platformAddress: PLATFORM,
  expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
};

const continuar = () => screen.getByRole("button", { name: "Continuar" });
async function typeAmount(v: string) {
  await userEvent.type(screen.getByLabelText("Importe"), v);
}

beforeEach(() => {
  window.localStorage.clear();
  account.address = SESSION;
  account.chainId = 59141;
  account.isConnected = true;
  switchChain.mockReset();
  openAppKit.mockReset();
  send.mockReset().mockResolvedValueOnce(FEE_HASH).mockResolvedValueOnce(MAIN_HASH);
  createTipIntentAction.mockReset().mockResolvedValue({ ok: true, intent });
  attachTxAction.mockReset().mockResolvedValue({ ok: true });
  verifyIntentAction.mockReset().mockResolvedValue({ status: "confirmed", tipId: "t1" });
});

describe("TipDialog form", () => {
  it("shows no donation acknowledgement on a tip", () => {
    setup();
    expect(screen.queryByRole("checkbox", { name: /donación sin esperar nada/ })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Propina anónima/ })).toBeInTheDocument();
  });

  it("shows the network, the recipient, the anonymous note and the guide link", () => {
    setup();
    expect(screen.getByText(/MODO PRUEBA/)).toBeInTheDocument();
    expect(screen.getByText("@ana_l")).toBeInTheDocument();
    expect(screen.getByText("0x2222…2222")).toBeInTheDocument();
    expect(screen.getByText("Solo se oculta en el foro: en la blockchain la transacción es pública.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /¿Cómo funciona\?/ })).toHaveAttribute("href", "/guia/propinas");
  });

  it("disables Continuar with a reason when the amount is out of range", async () => {
    setup();
    await typeAmount("0,001");
    expect(continuar()).toBeDisabled();
    expect(screen.getByText(/entre 0,01 y 100000 USDC/)).toBeInTheDocument();
  });

  it("computes the total as amount + fee, with the minimum as floor", async () => {
    setup();
    await typeAmount("100");
    expect(screen.getByText(/Mínimo 1 %/)).toBeInTheDocument();
    expect(screen.getByTestId("tip-total")).toHaveTextContent("101 USDC");
    expect(continuar()).toBeEnabled();
  });

  it("blocks when there is a fee and the platform has no wallet on this network", async () => {
    setup({ cfg: config({ chains: { 59144: { safe: null, platform: null }, 59141: { safe: null, platform: null } } }) });
    await typeAmount("10");
    expect(screen.getByText("La plataforma aún no tiene wallet configurada en esta red.")).toBeInTheDocument();
    expect(continuar()).toBeDisabled();
  });

  it("blocks tipping oneself", async () => {
    setup({ recipient: { ...recipient, walletAddress: SESSION } });
    await typeAmount("10");
    expect(screen.getByText(/No puedes enviarte una propina/)).toBeInTheDocument();
    expect(continuar()).toBeDisabled();
  });
});

describe("TipDialog wallet check", () => {
  it("offers to connect a wallet when none is connected", async () => {
    account.isConnected = false;
    account.address = undefined;
    account.chainId = undefined;
    setup();
    await typeAmount("10");
    expect(continuar()).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Conectar wallet" }));
    expect(openAppKit).toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("signs nothing when the connected address is not the session wallet", async () => {
    account.address = "0x9999999999999999999999999999999999999999";
    setup();
    await typeAmount("10");
    expect(screen.getByText("Conecta la wallet 0x1111…1111 para enviar.")).toBeInTheDocument();
    expect(continuar()).toBeDisabled();
    expect(createTipIntentAction).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("shows a switch button on the wrong chain and only switches on click", async () => {
    account.chainId = 59144;
    setup();
    await typeAmount("10");
    expect(switchChain).not.toHaveBeenCalled();
    expect(continuar()).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Cambiar a Linea Sepolia" }));
    expect(switchChain).toHaveBeenCalledWith({ chainId: 59141 });
  });
});

describe("TipDialog signing and verification", () => {
  it("signs fee then main, attaching each hash, then shows the explorer links", async () => {
    setup();
    await typeAmount("10");
    await userEvent.click(continuar());
    await screen.findByText("Propina enviada");

    expect(createTipIntentAction).toHaveBeenCalledWith({
      targetType: "message",
      targetId: "33333333-3333-4333-8333-333333333333",
      token: "USDC",
      amount: "10",
      feeBps: 100,
      anonymous: false,
    });
    expect(send).toHaveBeenNthCalledWith(1, { chain: 59141, token: "USDC", to: PLATFORM, amount: 100000n, account: SESSION });
    expect(send).toHaveBeenNthCalledWith(2, { chain: 59141, token: "USDC", to: RECIPIENT_WALLET, amount: 10000000n, account: SESSION });
    expect(attachTxAction).toHaveBeenNthCalledWith(1, INTENT_ID, "fee", FEE_HASH);
    expect(attachTxAction).toHaveBeenNthCalledWith(2, INTENT_ID, "main", MAIN_HASH);
    const links = screen.getAllByRole("link", { name: /Ver en el explorador/ });
    expect(links.map((l) => l.getAttribute("href"))).toEqual([
      `https://sepolia.lineascan.build/tx/${FEE_HASH}`,
      `https://sepolia.lineascan.build/tx/${MAIN_HASH}`,
    ]);
  });

  it("sends a profile tip with the profile target and anonymous flag", async () => {
    setup({ target: { type: "profile" } });
    await typeAmount("10");
    await userEvent.click(screen.getByRole("checkbox", { name: /Propina anónima/ }));
    await userEvent.click(continuar());
    await screen.findByText("Propina enviada");
    expect(createTipIntentAction).toHaveBeenCalledWith(expect.objectContaining({ targetType: "profile", targetId: recipient.id, anonymous: true }));
  });

  it("makes a single transfer when there is no fee", async () => {
    send.mockReset().mockResolvedValueOnce(MAIN_HASH);
    createTipIntentAction.mockResolvedValue({ ok: true, intent: { ...intent, feeAmount: "0", platformAddress: null } });
    setup({ cfg: config({ minFeeBps: 0 }) });
    await typeAmount("10");
    await userEvent.click(continuar());
    await screen.findByText("Propina enviada");
    expect(send).toHaveBeenCalledTimes(1);
    expect(attachTxAction).toHaveBeenCalledTimes(1);
    expect(attachTxAction).toHaveBeenCalledWith(INTENT_ID, "main", MAIN_HASH);
  });

  it("returns to the form when the wallet rejects the signature", async () => {
    send.mockReset().mockRejectedValue(Object.assign(new Error("User rejected the request."), { code: 4001 }));
    setup();
    await typeAmount("10");
    await userEvent.click(continuar());
    expect(await screen.findByText("Has cancelado la firma.")).toBeInTheDocument();
    expect(screen.getByLabelText("Importe")).toHaveValue("10");
    expect(attachTxAction).not.toHaveBeenCalled();
  });

  it("shows the server error when the intent is refused, and signs nothing", async () => {
    createTipIntentAction.mockResolvedValue({ ok: false, code: "not_found", error: "No existe o no puedes verlo." });
    setup();
    await typeAmount("10");
    await userEvent.click(continuar());
    expect(await screen.findByText("No existe o no puedes verlo.")).toBeInTheDocument();
    expect(send).not.toHaveBeenCalled();
  });

  it("polls while pending and then confirms", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      verifyIntentAction.mockReset().mockResolvedValueOnce({ status: "pending" }).mockResolvedValueOnce({ status: "confirmed", tipId: "t1" });
      setup();
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
      setup();
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
    setup();
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
      setup();
      await typeAmount("10");
      await userEvent.click(continuar());
      await screen.findByText(/Verificando/);
      await vi.advanceTimersByTimeAsync(3100);
      expect(verifyIntentAction).toHaveBeenCalledTimes(2);
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.getByText(/Verificando/)).toBeInTheDocument();
      expect(loadSends(MEMBER).map((e) => e.intentId)).toEqual([INTENT_ID]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a definitive failure ends the flow and drops the ledger entry", async () => {
    verifyIntentAction.mockReset().mockResolvedValue({ status: "failed", code: "tx_failed", error: "La transacción falló en la red." });
    setup();
    await typeAmount("10");
    await userEvent.click(continuar());
    await screen.findByText("La transacción falló en la red.");
    expect(loadSends(MEMBER)).toEqual([]);
  });
});

describe("TipDialog tip intent check (M1)", () => {
  it.each([
    ["another chain", { chainId: 59144 }],
    ["another amount", { amount: "20000000" }],
    ["another fee", { feeAmount: "999" }],
  ])("refuses to sign a returned intent with %s", async (_label, over) => {
    createTipIntentAction.mockReset().mockResolvedValue({ ok: true, intent: { ...intent, ...over } });
    setup();
    await typeAmount("10");
    await userEvent.click(continuar());
    expect(await screen.findByText(/no coincide|ha cambiado|Cambia tu wallet/i)).toBeInTheDocument();
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
    setup();
    await typeAmount("10");
    await userEvent.click(continuar());
    expect(await screen.findByText(/No se pudo enviar la transacción/)).toBeInTheDocument();
    expect(continuar()).toBeEnabled();
  });

  it("an intent-creation throw returns to the form and signs nothing", async () => {
    createTipIntentAction.mockRejectedValue(new Error("offline"));
    setup();
    await typeAmount("10");
    await userEvent.click(continuar());
    expect(await screen.findByText("No se pudo preparar la propina. Inténtalo de nuevo.")).toBeInTheDocument();
    expect(send).not.toHaveBeenCalled();
    expect(continuar()).toBeEnabled();
  });

  it("writes each hash to the ledger and clears it once confirmed", async () => {
    setup();
    await typeAmount("10");
    await userEvent.click(continuar());
    await screen.findByText("Propina enviada");
    expect(loadSends(MEMBER)).toEqual([]);
  });

  it("keeps the ledger entry when attach fails, then retries attach without signing again", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      setupAttachFailures(4);
      setup();
      await typeAmount("10");
      await userEvent.click(continuar());
      await vi.advanceTimersByTimeAsync(8000);
      expect(await screen.findByText("No hemos podido registrar tu transacción.")).toBeInTheDocument();
      expect(screen.getAllByRole("link", { name: /Ver en el explorador/ })).toHaveLength(2);
      expect(loadSends(MEMBER)[0]).toMatchObject({ feeHash: FEE_HASH, mainHash: MAIN_HASH, feeAttached: true });
      await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
      await screen.findByText("Propina enviada");
      expect(send).toHaveBeenCalledTimes(2);
      expect(createTipIntentAction).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fee paid and main rejected: resumes the same intent and signs only the main", async () => {
    send.mockReset().mockResolvedValueOnce(FEE_HASH).mockRejectedValueOnce(Object.assign(new Error("rejected"), { code: 4001 })).mockResolvedValueOnce(MAIN_HASH);
    setup();
    await typeAmount("10");
    await userEvent.click(continuar());
    expect(await screen.findByText("La comisión ya está pagada. Falta firmar la propina.")).toBeInTheDocument();
    expect(screen.getByText("Si cancelas, la comisión enviada no se devolverá y la propina no se acreditará.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continuar" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Firmar la propina" }));
    await screen.findByText("Propina enviada");
    expect(createTipIntentAction).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(3);
    expect(send).toHaveBeenLastCalledWith({ chain: 59141, token: "USDC", to: RECIPIENT_WALLET, amount: 10000000n, account: SESSION });
    expect(attachTxAction).toHaveBeenLastCalledWith(INTENT_ID, "main", MAIN_HASH);
  });

  it("Cancelar on the resume state drops the ledger entry and closes", async () => {
    send.mockReset().mockResolvedValueOnce(FEE_HASH).mockRejectedValueOnce(Object.assign(new Error("rejected"), { code: 4001 }));
    const onOpenChange = vi.fn();
    setup({ onOpenChange });
    await typeAmount("10");
    await userEvent.click(continuar());
    await userEvent.click(await screen.findByRole("button", { name: "Cancelar" }));
    expect(loadSends(MEMBER)).toEqual([]);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("a reopened dialog resumes from the ledger instead of a fresh form", async () => {
    upsertSend(MEMBER, {
      intentId: INTENT_ID,
      chainId: 59141,
      token: "USDC",
      targetType: "message",
      targetId: "33333333-3333-4333-8333-333333333333",
      feeRequired: true,
      feeHash: FEE_HASH,
      feeAttached: true,
      createdAt: Date.now() - 60_000,
      intent,
    });
    send.mockReset().mockResolvedValueOnce(MAIN_HASH);
    setup();
    expect(screen.getByText("La comisión ya está pagada. Falta firmar la propina.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Firmar la propina" }));
    await screen.findByText("Propina enviada");
    expect(send).toHaveBeenCalledTimes(1);
    expect(createTipIntentAction).not.toHaveBeenCalled();
  });

  it("does not resume an entry for another target", () => {
    upsertSend(MEMBER, {
      intentId: INTENT_ID,
      chainId: 59141,
      token: "USDC",
      targetType: "message",
      feeRequired: true,
      feeHash: FEE_HASH,
      intent,
      targetId: "44444444-4444-4444-8444-444444444444",
      createdAt: Date.now(),
    });
    setup();
    expect(screen.getByLabelText("Importe")).toBeInTheDocument();
  });

  it("refuses to sign when the intent recipient is not the shown one", async () => {
    createTipIntentAction.mockResolvedValue({ ok: true, intent: { ...intent, recipientAddress: "0x5555555555555555555555555555555555555555" } });
    setup();
    await typeAmount("10");
    await userEvent.click(continuar());
    expect(await screen.findByText("Los datos del envío no coinciden. Recarga la página.")).toBeInTheDocument();
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses to sign when the platform address is not the configured one", async () => {
    createTipIntentAction.mockResolvedValue({ ok: true, intent: { ...intent, platformAddress: "0x5555555555555555555555555555555555555555" } });
    setup();
    await typeAmount("10");
    await userEvent.click(continuar());
    expect(await screen.findByText("Los datos del envío no coinciden. Recarga la página.")).toBeInTheDocument();
    expect(send).not.toHaveBeenCalled();
  });

  it("aborts when the connected account changed after Continuar", async () => {
    createTipIntentAction.mockImplementation(async () => {
      account.address = "0x9999999999999999999999999999999999999999";
      return { ok: true, intent };
    });
    setup();
    await typeAmount("10");
    await userEvent.click(continuar());
    // Both the form error and the wallet notice say it.
    expect((await screen.findAllByText("Conecta la wallet 0x1111…1111 para enviar.")).length).toBeGreaterThan(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("closing while verifying asks first", async () => {
    verifyIntentAction.mockReset().mockResolvedValue({ status: "pending" });
    const onOpenChange = vi.fn();
    setup({ onOpenChange });
    await typeAmount("10");
    await userEvent.click(continuar());
    await screen.findByText(/Verificando/);
    await userEvent.keyboard("{Escape}");
    expect(await screen.findByText("¿Cerrar? Si ya firmaste, la propina se seguirá verificando.")).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
    await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cerrar" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

const seed = (over: Record<string, unknown> = {}) =>
  upsertSend(MEMBER, {
    intentId: INTENT_ID,
    chainId: 59141,
    token: "USDC",
    targetType: "message",
    targetId: "33333333-3333-4333-8333-333333333333",
    feeRequired: true,
    feeHash: FEE_HASH,
    feeAttached: true,
    createdAt: Date.now(),
    intent,
    ...over,
  } as never);

describe("TipDialog expiry, abort and in-flight (F3b-R5)", () => {
  it("a leftover whose intent has under 10 minutes left is not resumed and is dropped", async () => {
    seed({ intent: { ...intent, expiresAt: new Date(Date.now() + 5 * 60_000).toISOString() } });
    setup();
    expect(screen.getByText("La operación ha caducado y no se puede completar. La comisión enviada no se puede reutilizar.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Firmar la propina" })).not.toBeInTheDocument();
    await waitFor(() => expect(loadSends(MEMBER)).toEqual([]));
    expect(send).not.toHaveBeenCalled();
  });

  it("never signs when the fresh intent is about to expire", async () => {
    createTipIntentAction.mockResolvedValue({ ok: true, intent: { ...intent, expiresAt: new Date(Date.now() + 60_000).toISOString() } });
    setup();
    await typeAmount("10");
    await userEvent.click(continuar());
    expect(await screen.findByText(/La operación ha caducado/)).toBeInTheDocument();
    expect(send).not.toHaveBeenCalled();
    expect(loadSends(MEMBER)).toEqual([]);
  });

  it("a permanent attach error stops retrying, drops the entry and keeps the explorer link", async () => {
    attachTxAction.mockReset().mockResolvedValue({ ok: false, code: "intent_expired", error: "Esta propina ha caducado. Crea una nueva." });
    setup();
    await typeAmount("10");
    await userEvent.click(continuar());
    expect(await screen.findByText("Esta propina ha caducado. Crea una nueva.")).toBeInTheDocument();
    expect(attachTxAction).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole("link", { name: /Ver en el explorador/ })).toHaveLength(1);
    expect(loadSends(MEMBER)).toEqual([]);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("closing aborts the flow: a late fee hash is recorded and attached but the main is never requested", async () => {
    let resolveFee!: (h: string) => void;
    send.mockReset().mockImplementationOnce(() => new Promise((r) => (resolveFee = r)));
    const first = setup();
    await typeAmount("10");
    await userEvent.click(continuar());
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(loadSends(MEMBER)[0]?.inFlight).toEqual(expect.any(Number));
    first.unmount();
    resolveFee(FEE_HASH);
    await waitFor(() => expect(attachTxAction).toHaveBeenCalledWith(INTENT_ID, "fee", FEE_HASH));
    await new Promise((r) => setTimeout(r, 20));
    expect(send).toHaveBeenCalledTimes(1);
    const entry = loadSends(MEMBER)[0]!;
    expect(entry.feeHash).toBe(FEE_HASH);
    expect(entry.inFlight).toBeUndefined();
    setup();
    expect(screen.getByText("La comisión ya está pagada. Falta firmar la propina.")).toBeInTheDocument();
  });

  it("reopening while a signature is pending shows the pending state, not a form", async () => {
    seed({ feeHash: undefined, feeAttached: undefined, inFlight: Date.now() });
    setup();
    expect(screen.getByText("Tienes una firma pendiente en tu wallet. Complétala o recházala antes de continuar.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Importe")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Comprobar de nuevo" }));
    expect(screen.getByText(/Tienes una firma pendiente/)).toBeInTheDocument();
    // The request settled meanwhile: checking again releases the dialog.
    window.localStorage.clear();
    await userEvent.click(screen.getByRole("button", { name: "Comprobar de nuevo" }));
    expect(await screen.findByLabelText("Importe")).toBeInTheDocument();
  });

  it("an old in-flight marker (over 10 minutes) is ignored", () => {
    seed({ feeHash: undefined, feeAttached: undefined, inFlight: Date.now() - 11 * 60_000 });
    setup();
    expect(screen.getByLabelText("Importe")).toBeInTheDocument();
  });

  it("no new intent while an unfinished entry appeared for the target after opening", async () => {
    setup();
    await typeAmount("10");
    seed({ feeHash: undefined, feeAttached: undefined, inFlight: Date.now() });
    await userEvent.click(continuar());
    expect(await screen.findByText(/Tienes una firma pendiente/)).toBeInTheDocument();
    expect(createTipIntentAction).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("the resume screen shows the network, the recipient and what is left to send", () => {
    seed();
    setup();
    expect(screen.getByText(/MODO PRUEBA/)).toBeInTheDocument();
    expect(screen.getByText("@ana_l")).toBeInTheDocument();
    expect(screen.getByTestId("resume-amount")).toHaveTextContent("Falta: 10 USDC para @ana_l");
  });

  it("on the wrong chain the resume screen offers the switch button and blocks signing", async () => {
    account.chainId = 59144;
    seed();
    setup();
    expect(screen.getByRole("button", { name: "Firmar la propina" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Cambiar a Linea Sepolia" }));
    expect(switchChain).toHaveBeenCalledWith({ chainId: 59141 });
  });
});
