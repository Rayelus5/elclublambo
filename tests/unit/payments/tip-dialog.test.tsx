import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const account = vi.hoisted(() => ({ address: undefined as string | undefined, chainId: undefined as number | undefined, isConnected: false }));
const switchChain = vi.hoisted(() => vi.fn());
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

const SESSION = "0x1111111111111111111111111111111111111111";
const PLATFORM = "0x4444444444444444444444444444444444444444";
const RECIPIENT_WALLET = "0x2222222222222222222222222222222222222222";
const FEE_HASH = `0x${"fe".repeat(32)}`;
const MAIN_HASH = `0x${"ma".replace(/[^0-9a-f]/g, "a").repeat(32)}`;
const INTENT_ID = "11111111-1111-4111-8111-111111111111";

const recipient = { id: "22222222-2222-4222-8222-222222222222", handle: "ana_l", displayName: "Ana", walletAddress: RECIPIENT_WALLET, avatarPath: null };

const config = (over: Partial<EconomyConfig> = {}): EconomyConfig => ({
  activeChainId: 59141,
  minFeeBps: 100,
  chains: { 59144: { safe: null, platform: null }, 59141: { safe: null, platform: PLATFORM } },
  ...over,
});

function setup(opts: { cfg?: EconomyConfig; wallet?: string; recipient?: typeof recipient; target?: Parameters<typeof TipDialog>[0]["target"] } = {}) {
  return render(
    <EconomyProvider config={opts.cfg ?? config()} wallet={opts.wallet ?? SESSION}>
      <TipDialog target={opts.target ?? { type: "message", messageId: "33333333-3333-4333-8333-333333333333" }} recipient={opts.recipient ?? recipient} open onOpenChange={() => {}} />
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
  expiresAt: "2026-10-19T00:00:00Z",
};

const continuar = () => screen.getByRole("button", { name: "Continuar" });
async function typeAmount(v: string) {
  await userEvent.type(screen.getByLabelText("Importe"), v);
}

beforeEach(() => {
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
    expect(send).toHaveBeenNthCalledWith(1, { chain: 59141, token: "USDC", to: PLATFORM, amount: 100000n });
    expect(send).toHaveBeenNthCalledWith(2, { chain: 59141, token: "USDC", to: RECIPIENT_WALLET, amount: 10000000n });
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
