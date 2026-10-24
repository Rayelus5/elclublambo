import { render, screen } from "@testing-library/react";
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
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const send = vi.hoisted(() => vi.fn());
vi.mock("@/lib/payments/use-send-transfer", () => ({ useSendTransfer: () => ({ send }) }));
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
const createDonationIntentAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/donations/actions", () => ({ createDonationIntentAction, setDonorVisibleAction: vi.fn() }));
const attachTxAction = vi.hoisted(() => vi.fn());
const verifyIntentAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/payments/tip-actions", () => ({ attachTxAction, verifyIntentAction, createTipIntentAction: vi.fn() }));

import { DonateDialog } from "@/components/donations/donate-dialog";
import { EconomyProvider } from "@/components/payments/economy-provider";
import type { EconomyConfig } from "@/lib/economy/config";
import type { ChainId } from "@/lib/economy/networks";

const SESSION = "0x1111111111111111111111111111111111111111";
const SAFE = "0x380f2e12081995359e2ab88e3c31c6b227904234";
const MEMBER = "99999999-9999-4999-8999-999999999999";
const HASH = "0x" + "aa".repeat(32);
const E = 10n ** 18n;

const config: EconomyConfig = {
  enabledChainIds: [84532, 421614],
  safes: { 84532: SAFE, 421614: SAFE },
  legacyDaoEnabled: false,
  legacy: { activeChainId: 59141, withdrawalsEnabled: { 59144: false, 59141: false }, weightedRafflesEnabled: { 59144: false, 59141: false }, chains: { 59144: { safe: null, platform: null }, 59141: { safe: null, platform: null } } },
};

const intent = {
  id: "11111111-1111-4111-8111-111111111111",
  chainId: 84532,
  token: "USDC" as const,
  amount: "5000000",
  feeAmount: "0",
  recipientAddress: SAFE,
  platformAddress: null,
  expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
};

function mount(chains: readonly ChainId[] = [84532, 421614]) {
  return render(
    <EconomyProvider config={config} wallet={SESSION} memberId={MEMBER}>
      <DonateDialog open onOpenChange={() => {}} chains={chains} />
    </EconomyProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  account.address = SESSION;
  account.chainId = 84532;
  account.isConnected = true;
  balances.map = { "USDC:84532": 100_000_000n, "ETH:84532": E, "USDC:421614": 0n, "ETH:421614": 0n };
  preflight.mockReset().mockResolvedValue(null);
  send.mockReset().mockResolvedValue(HASH);
  createDonationIntentAction.mockReset().mockResolvedValue({ ok: true, intent });
  attachTxAction.mockReset().mockResolvedValue({ ok: true });
  verifyIntentAction.mockReset().mockResolvedValue({ status: "confirmed", donationId: "d1" });
});

describe("DonateDialog", () => {
  it("offers only the assets of the networks in `chains` (Review Focus 2: no Safe, no assets)", async () => {
    mount([84532]);
    const radios = await screen.findAllByRole("radio");
    expect(radios).toHaveLength(2);
    for (const r of radios) expect(r).toHaveAccessibleName(/Base Sepolia/);
    expect(screen.queryByRole("radio", { name: /Arbitrum Sepolia/ })).not.toBeInTheDocument();
  });

  it("shows the exact custody notice and the anonymous checkbox", async () => {
    mount();
    expect(await screen.findByText("ElClub. no custodia fondos: va directo a la Safe del club. Donar no da derechos económicos.")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Donar de forma anónima" })).toBeInTheDocument();
  });

  it("creates the intent with the chosen asset, signs one transfer to the Safe, attaches it and says it is recorded", async () => {
    mount();
    await userEvent.click(screen.getByRole("radio", { name: /USDC.*Base Sepolia/ }));
    await userEvent.type(screen.getByLabelText("Importe"), "5");
    await userEvent.click(screen.getByRole("checkbox", { name: "Donar de forma anónima" }));
    await userEvent.click(screen.getByRole("button", { name: "Continuar" }));
    expect(await screen.findByText("Donación registrada")).toBeInTheDocument();
    expect(createDonationIntentAction).toHaveBeenCalledWith({ chainId: 84532, token: "USDC", amount: "5", anonymous: true });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]).toMatchObject({ chain: 84532, token: "USDC", to: SAFE, amount: 5_000_000n });
    expect(attachTxAction).toHaveBeenCalledWith(intent.id, "main", HASH);
  });

  it("refuses to sign an intent whose recipient is not the club Safe", async () => {
    createDonationIntentAction.mockResolvedValue({ ok: true, intent: { ...intent, recipientAddress: "0x" + "bb".repeat(20) } });
    mount();
    await userEvent.click(screen.getByRole("radio", { name: /USDC.*Base Sepolia/ }));
    await userEvent.type(screen.getByLabelText("Importe"), "5");
    await userEvent.click(screen.getByRole("button", { name: "Continuar" }));
    expect(await screen.findByText("Los datos del envío no coinciden. Recarga la página.")).toBeInTheDocument();
    expect(send).not.toHaveBeenCalled();
  });

  it("with price_unavailable says it was received and is waiting for a price (Review Focus 1)", async () => {
    verifyIntentAction.mockResolvedValue({ status: "pending", reason: "price_unavailable" });
    mount();
    await userEvent.click(screen.getByRole("radio", { name: /USDC.*Base Sepolia/ }));
    await userEvent.type(screen.getByLabelText("Importe"), "5");
    await userEvent.click(screen.getByRole("button", { name: "Continuar" }));
    expect(await screen.findByText("Recibida. Esperando precio para registrarla.")).toBeInTheDocument();
    expect(screen.queryByText("Donación registrada")).not.toBeInTheDocument();
  });

  it("shows the server's refusal (safe_not_deployed) and signs nothing", async () => {
    createDonationIntentAction.mockResolvedValue({ ok: false, code: "safe_not_deployed", error: "La Safe del club aún no existe en esa red." });
    mount();
    await userEvent.click(screen.getByRole("radio", { name: /USDC.*Base Sepolia/ }));
    await userEvent.type(screen.getByLabelText("Importe"), "5");
    await userEvent.click(screen.getByRole("button", { name: "Continuar" }));
    expect(await screen.findByText("La Safe del club aún no existe en esa red.")).toBeInTheDocument();
    expect(send).not.toHaveBeenCalled();
  });

  it("with no network available says donations are not open yet", () => {
    mount([]);
    expect(screen.getByText("Donaciones aún no disponibles")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continuar" })).not.toBeInTheDocument();
  });
});
