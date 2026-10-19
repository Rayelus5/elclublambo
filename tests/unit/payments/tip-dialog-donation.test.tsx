import { render, screen, waitFor } from "@testing-library/react";
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

const attachTxAction = vi.hoisted(() => vi.fn());
const verifyIntentAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/payments/tip-actions", () => ({ createTipIntentAction: vi.fn(), attachTxAction, verifyIntentAction }));
vi.mock("@/lib/bounties/actions", () => ({ createBountyPaymentIntentAction: vi.fn() }));
const createDonationIntentAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/treasury/actions", () => ({ createDonationIntentAction }));
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/browser", () => ({ createBrowserClient: () => ({ rpc }) }));

import { EconomyProvider } from "@/components/payments/economy-provider";
import { TipDialog } from "@/components/payments/tip-dialog";
import type { EconomyConfig } from "@/lib/economy/config";
import { loadSends, upsertSend } from "@/lib/payments/pending-sends";

const SESSION = "0x1111111111111111111111111111111111111111";
const PLATFORM = "0x4444444444444444444444444444444444444444";
const SAFE = "0x5555555555555555555555555555555555555555";
const FEE_HASH = `0x${"fe".repeat(32)}`;
const MAIN_HASH = `0x${"aa".repeat(32)}`;
const MEMBER = "99999999-9999-4999-8999-999999999999";
const INTENT_ID = "11111111-1111-4111-8111-111111111111";

const config = (safe: string | null = SAFE): EconomyConfig => ({
  activeChainId: 59141,
  minFeeBps: 100,
  withdrawalsEnabled: { 59144: false, 59141: false }, weightedRafflesEnabled: { 59144: false, 59141: false },
  chains: { 59144: { safe: null, platform: null }, 59141: { safe, platform: PLATFORM } },
});

function setup(cfg: EconomyConfig = config()) {
  return render(
    <EconomyProvider config={cfg} wallet={SESSION} memberId={MEMBER}>
      <TipDialog mode={{ kind: "donation" }} open onOpenChange={() => {}} />
    </EconomyProvider>,
  );
}

const intent = {
  id: INTENT_ID,
  chainId: 59141,
  token: "USDC" as const,
  amount: "10000000",
  feeAmount: "100000",
  recipientAddress: SAFE,
  platformAddress: PLATFORM,
  expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
};

const continuar = () => screen.getByRole("button", { name: "Continuar" });
const amountBox = () => screen.getByLabelText("Importe");
const ACK =
  "Entiendo que es una donación sin esperar nada a cambio, que el fondo se invierte con riesgo y que las retiradas dependen de la disponibilidad y de la decisión del tesorero.";
const ack = () => userEvent.click(screen.getByRole("checkbox", { name: ACK }));
const DONE = "Donación registrada.";
const FINALITY_NOTE = "Tus participaciones se acreditarán cuando el bloque se finalice (puede tardar horas).";

beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ data: { chainId: 59141, sharePriceUsd6: "2000000" }, error: null });
  window.localStorage.clear();
  account.address = SESSION;
  account.chainId = 59141;
  account.isConnected = true;
  send.mockReset().mockResolvedValueOnce(FEE_HASH).mockResolvedValueOnce(MAIN_HASH);
  createDonationIntentAction.mockReset().mockResolvedValue({ ok: true, intent });
  attachTxAction.mockReset().mockResolvedValue({ ok: true });
  verifyIntentAction.mockReset().mockResolvedValue({ status: "pending_finality", ledgerId: "l1" });
});

describe("TipDialog donation mode: form", () => {
  it("is titled as a donation, shows the Safe as recipient and links to the DAO guide", () => {
    setup();
    expect(screen.getByRole("heading", { name: "Donar a la DAO" })).toBeInTheDocument();
    expect(screen.getByText("Tesorería de la DAO (Safe)")).toBeInTheDocument();
    expect(screen.getByText("0x5555…5555")).toBeInTheDocument();
    expect(screen.getByText(/MODO PRUEBA/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /¿Cómo funciona\?/ })).toHaveAttribute("href", "/guia/dao");
  });

  it("locks the token to USDC and has no anonymous option", () => {
    setup();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.getByTestId("locked-token")).toHaveTextContent("USDC");
    expect(screen.queryByRole("checkbox", { name: /anónima/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/anónima/i)).not.toBeInTheDocument();
  });

  it("requires at least 1 USDC and at most 1000000", async () => {
    setup();
    await userEvent.type(amountBox(), "0,99");
    expect(screen.getByText("El importe debe estar entre 1 y 1000000 USDC.")).toBeInTheDocument();
    expect(continuar()).toBeDisabled();
    await userEvent.clear(amountBox());
    await userEvent.type(amountBox(), "1000001");
    expect(continuar()).toBeDisabled();
    await userEvent.clear(amountBox());
    await userEvent.type(amountBox(), "1");
    await ack();
    expect(continuar()).toBeEnabled();
  });

  it("keeps Continuar disabled until the legal acknowledgement is ticked, even with a valid amount", async () => {
    setup();
    await userEvent.type(amountBox(), "10");
    expect(screen.getByRole("checkbox", { name: ACK })).not.toBeChecked();
    expect(continuar()).toBeDisabled();
    await ack();
    expect(continuar()).toBeEnabled();
    await ack();
    expect(continuar()).toBeDisabled();
  });

  it("estimates the participaciones at the current value per participación", async () => {
    setup();
    await userEvent.type(amountBox(), "10");
    expect(await screen.findByText("≈ 5 participaciones al valor actual (el número exacto se fija al acreditar)")).toBeInTheDocument();
    expect(rpc).toHaveBeenCalledWith("dao_overview");
  });

  it("shows no estimate line when dao_overview fails", async () => {
    rpc.mockReset().mockResolvedValue({ data: null, error: { message: "boom" } });
    setup();
    await userEvent.type(amountBox(), "10");
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(screen.queryByText(/participaciones al valor actual/)).not.toBeInTheDocument();
  });

  it("shows the current value per participación next to the estimate (R7: USD)", async () => {
    setup();
    await userEvent.type(amountBox(), "10");
    await screen.findByText(/participaciones al valor actual/);
    expect(screen.getByTestId("share-price")).toHaveTextContent("Valor por participación: 2 USD");
  });

  it("estimates at 1 USD per participación while nobody holds shares (R9)", async () => {
    rpc.mockReset().mockResolvedValue({ data: { chainId: 59141, totalShares: "0", sharePriceUsd6: "0" }, error: null });
    setup();
    await userEvent.type(amountBox(), "10");
    expect(await screen.findByText("≈ 10 participaciones al valor actual (el número exacto se fija al acreditar)")).toBeInTheDocument();
    expect(screen.getByTestId("share-price")).toHaveTextContent("Valor por participación: 1 USD");
  });

  it("hides the estimate when shares exist but the price is 0", async () => {
    rpc.mockReset().mockResolvedValue({ data: { chainId: 59141, totalShares: "5000000000000000000", sharePriceUsd6: "0" }, error: null });
    setup();
    await userEvent.type(amountBox(), "10");
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(screen.queryByText(/participaciones al valor actual/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("share-price")).not.toBeInTheDocument();
  });

  it("ignores an overview of another chain", async () => {
    rpc.mockReset().mockResolvedValue({ data: { chainId: 59144, sharePriceUsd6: "2000000" }, error: null });
    setup();
    await userEvent.type(amountBox(), "10");
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(screen.queryByText(/participaciones al valor actual/)).not.toBeInTheDocument();
  });

  it("drops the ≈ for dust", async () => {
    rpc.mockReset().mockResolvedValue({ data: { chainId: 59141, sharePriceUsd6: "900000000000" }, error: null });
    setup();
    await userEvent.type(amountBox(), "1");
    expect(await screen.findByText("< 0,01 participaciones al valor actual (el número exacto se fija al acreditar)")).toBeInTheDocument();
  });

  it("explains when the active network has no Safe, and cannot continue", async () => {
    setup(config(null));
    expect(screen.getByText("La tesorería aún no tiene Safe configurada en esta red.")).toBeInTheDocument();
    await userEvent.type(amountBox(), "10");
    expect(continuar()).toBeDisabled();
    expect(createDonationIntentAction).not.toHaveBeenCalled();
  });
});

describe("TipDialog donation mode: signing", () => {
  it("creates the donation intent, signs fee then main to the Safe, ends on the finality copy and clears the ledger", async () => {
    setup();
    await userEvent.type(amountBox(), "10");
    await ack();
    await userEvent.click(continuar());
    await screen.findByText(DONE);
    // The finality explanation is small print at the very bottom, after the close button.
    const note = screen.getByText(FINALITY_NOTE);
    const close = screen.getAllByRole("button", { name: "Cerrar" }).find((b) => b.getAttribute("data-slot") === "button")!;
    expect(close.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(createDonationIntentAction).toHaveBeenCalledWith({ amount: "10", feeBps: 100, acknowledged: true });
    expect(send).toHaveBeenNthCalledWith(1, { chain: 59141, token: "USDC", to: PLATFORM, amount: 100000n, account: SESSION });
    expect(send).toHaveBeenNthCalledWith(2, { chain: 59141, token: "USDC", to: SAFE, amount: 10000000n, account: SESSION });
    expect(attachTxAction).toHaveBeenNthCalledWith(1, INTENT_ID, "fee", FEE_HASH);
    expect(attachTxAction).toHaveBeenNthCalledWith(2, INTENT_ID, "main", MAIN_HASH);
    expect(verifyIntentAction).toHaveBeenCalledTimes(1);
    expect(loadSends(MEMBER)).toEqual([]);
  });

  it("a donation the immediate settle already credited says so (M4)", async () => {
    verifyIntentAction.mockReset().mockResolvedValue({ status: "confirmed", ledgerId: "l1" });
    setup();
    await userEvent.type(amountBox(), "10");
    await ack();
    await userEvent.click(continuar());
    await screen.findByText("Donación acreditada.");
    expect(screen.queryByText(DONE)).toBeNull();
    expect(screen.queryByText(FINALITY_NOTE)).toBeNull();
  });

  it("keeps the main hash in the ledger under targetType 'dao' before the server is told", async () => {
    attachTxAction.mockReset().mockImplementation(async () => {
      throw new Error("offline");
    });
    setup();
    await userEvent.type(amountBox(), "10");
    await ack();
    await userEvent.click(continuar());
    await screen.findByText("No hemos podido registrar tu transacción.", {}, { timeout: 10_000 });
    const [entry] = loadSends(MEMBER);
    expect(entry).toMatchObject({ targetType: "dao", targetId: "dao", feeHash: FEE_HASH, intentId: INTENT_ID });
  }, 15_000);

  it("refuses to sign an intent whose recipient is not the configured Safe", async () => {
    createDonationIntentAction.mockReset().mockResolvedValue({ ok: true, intent: { ...intent, recipientAddress: "0x9999999999999999999999999999999999999999" } });
    setup();
    await userEvent.type(amountBox(), "10");
    await ack();
    await userEvent.click(continuar());
    await screen.findByText("Los datos del envío no coinciden. Recarga la página.");
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses an intent whose amount differs from the one shown", async () => {
    createDonationIntentAction.mockReset().mockResolvedValue({ ok: true, intent: { ...intent, amount: "99000000" } });
    setup();
    await userEvent.type(amountBox(), "10");
    await ack();
    await userEvent.click(continuar());
    await screen.findByText("Los datos del envío no coinciden. Recarga la página.");
    expect(send).not.toHaveBeenCalled();
  });

  it("resumes a paid fee for the same intent, signing only the main transfer", async () => {
    upsertSend(MEMBER, {
      intentId: INTENT_ID,
      chainId: 59141,
      token: "USDC",
      targetType: "dao",
      targetId: "dao",
      feeRequired: true,
      feeHash: FEE_HASH,
      feeAttached: true,
      createdAt: Date.now(),
      intent,
    });
    send.mockReset().mockResolvedValueOnce(MAIN_HASH);
    setup();
    expect(screen.getByText("La comisión ya está pagada. Falta firmar la donación.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Firmar la donación" }));
    await screen.findByText(DONE);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ chain: 59141, token: "USDC", to: SAFE, amount: 10000000n, account: SESSION });
    expect(createDonationIntentAction).not.toHaveBeenCalled();
  });
});
