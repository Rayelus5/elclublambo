import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const cancelBountyAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/bounties/actions", () => ({ cancelBountyAction }));
vi.mock("@/components/payments/tip-dialog", () => ({
  TipDialog: ({ mode, recipient, open }: { mode: { bountyId: string; token: string; minAmount: bigint; chainId: number; solverId: string }; recipient: { id: string }; open: boolean }) =>
    open ? (
      <div role="dialog" aria-label="Pago" data-bounty={mode.bountyId} data-token={mode.token} data-min={String(mode.minAmount)} data-chain={mode.chainId} data-solver={mode.solverId} data-recipient={recipient.id} />
    ) : null,
}));

import type { EconomyConfig } from "@/lib/economy/config";
import { BountyCard } from "@/components/chat/bounty-card";
import { EconomyProvider } from "@/components/payments/economy-provider";
import { upsertSend } from "@/lib/payments/pending-sends";
import type { BountyDetail } from "@/lib/bounties/queries";

const CH = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const B = "11111111-1111-4111-8111-111111111111";
const SOLUTION = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-10-20T12:00:00Z");
const DAY = 86_400_000;
const solver = { id: "33333333-3333-4333-8333-333333333333", handle: "ana_l", displayName: "Ana", walletAddress: "0x2222222222222222222222222222222222222222", avatarPath: null };

const detail = (over: Partial<BountyDetail> = {}): BountyDetail => ({
  messageId: B,
  token: "USDC",
  amount: 25_000_000n,
  chainId: 84532,
  status: "open",
  solutionMessageId: null,
  solverId: null,
  solutionMarkedAt: null,
  payDeadline: null,
  paidTipId: null,
  ...over,
});
const marked = (over: Partial<BountyDetail> = {}) =>
  detail({ status: "solution_marked", solutionMessageId: SOLUTION, solverId: solver.id, solutionMarkedAt: NOW.toISOString(), payDeadline: new Date(NOW.getTime() + 3 * DAY).toISOString(), ...over });

function setup(over: Partial<React.ComponentProps<typeof BountyCard>> = {}) {
  const onChanged = vi.fn();
  render(<BountyCard messageId={B} channelId={CH} bounty={detail()} isAuthor={false} solver={null} now={NOW} onChanged={onChanged} {...over} />);
  return { onChanged, user: userEvent.setup() };
}

beforeEach(() => {
  cancelBountyAction.mockReset().mockResolvedValue({ ok: true });
});

describe("BountyCard", () => {
  it("shows the amount and token in mono, and the network", () => {
    setup();
    const amount = screen.getByText("25 USDC");
    expect(amount).toHaveClass("font-mono");
    expect(screen.getByText("Base Sepolia")).toBeInTheDocument();
  });

  it.each([
    [detail({ status: "open" }), "Abierto"],
    [marked(), "Solución elegida · quedan 3 días para pagar"],
    [marked({ payDeadline: new Date(NOW.getTime() + 36 * 3600_000).toISOString() }), "Solución elegida · quedan 2 días para pagar"],
    [marked({ payDeadline: new Date(NOW.getTime() + DAY).toISOString() }), "Solución elegida · queda 1 día para pagar"],
    [marked({ payDeadline: new Date(NOW.getTime() + 3600_000).toISOString() }), "Solución elegida · queda 1 día para pagar"],
    [marked({ status: "paid" }), "Pagado"],
    [marked({ status: "paid_late" }), "Pagado tarde"],
    [marked({ status: "unpaid", payDeadline: new Date(NOW.getTime() - DAY).toISOString() }), "Impagado"],
    [detail({ status: "expired" }), "Expirado"],
    [detail({ status: "cancelled" }), "Cancelado"],
    [marked({ status: "removed" }), "Retirado por moderación"],
    [marked({ status: "solver_unavailable" }), "Solucionador no disponible"],
  ])("renders the chip %#", (bounty, text) => {
    setup({ bounty });
    expect(screen.getByTestId("bounty-status")).toHaveTextContent(new RegExp(`^${text}$`));
  });

  it("lets everyone jump to the solution once one is marked", () => {
    setup({ bounty: marked() });
    expect(screen.getByRole("link", { name: "Ver solución" })).toHaveAttribute("href", `/c/${CH}?m=${SOLUTION}&thread=${B}`);
  });

  it("has no solution link before a solution exists", () => {
    setup();
    expect(screen.queryByRole("link", { name: "Ver solución" })).not.toBeInTheDocument();
  });

  it("shows no author actions to other members", () => {
    setup({ bounty: marked(), solver });
    expect(screen.queryByRole("button", { name: "Pagar bounty" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancelar bounty" })).not.toBeInTheDocument();
  });

  it("offers the author Cancelar bounty only while open", () => {
    setup({ isAuthor: true });
    expect(screen.getByRole("button", { name: "Cancelar bounty" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pagar bounty" })).not.toBeInTheDocument();
  });

  it.each(["expired", "cancelled"] as const)("offers the author nothing on a %s bounty", (status) => {
    setup({ isAuthor: true, bounty: detail({ status }) });
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it.each(["solution_marked", "unpaid"] as const)("offers the author Pagar bounty when %s, and not Cancelar", (status) => {
    setup({ isAuthor: true, solver, bounty: marked({ status }) });
    expect(screen.getByRole("button", { name: "Pagar bounty" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancelar bounty" })).not.toBeInTheDocument();
  });

  it.each(["removed", "solver_unavailable"] as const)("offers the author nothing on a %s bounty (payment impossible, no mark)", (status) => {
    setup({ isAuthor: true, solver, bounty: marked({ status }) });
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it.each(["paid", "paid_late"] as const)("offers nothing to pay on a %s bounty (paid exactly once)", (status) => {
    setup({ isAuthor: true, solver, bounty: marked({ status }) });
    expect(screen.queryByRole("button", { name: "Pagar bounty" })).not.toBeInTheDocument();
  });

  describe("a payment under way after the status changed (N1, F3c-R7)", () => {
    const MEMBER = "99999999-9999-4999-8999-999999999999";
    const intent = { id: "i-1", chainId: 84532, token: "USDC" as const, amount: "25000000", feeAmount: "0", recipientAddress: solver.walletAddress, platformAddress: null, expiresAt: new Date(Date.now() + 20 * 3600_000).toISOString() };
    const base = { intentId: "i-1", chainId: 84532, token: "USDC" as const, targetType: "bounty" as const, targetId: B, feeRequired: false, createdAt: Date.now(), intent };
    const cfg: EconomyConfig = { enabledChainIds: [8453, 42161], safes: {}, legacyDaoEnabled: false, legacy: { activeChainId: 59141, withdrawalsEnabled: { 59144: false, 59141: false }, weightedRafflesEnabled: { 59144: false, 59141: false }, chains: { 59144: { safe: null, platform: null }, 59141: { safe: null, platform: null } } } };
    function renderWith(bounty: BountyDetail) {
      render(
        <EconomyProvider config={cfg} wallet={solver.walletAddress} memberId={MEMBER}>
          <BountyCard messageId={B} channelId={CH} bounty={bounty} isAuthor solver={solver} now={NOW} />
        </EconomyProvider>,
      );
    }
    beforeEach(() => window.localStorage.clear());

    it("a fee-era leftover (fee paid, main never signed) no longer offers to complete the payment", async () => {
      upsertSend(MEMBER, { ...base, feeRequired: true, feeHash: `0x${"fe".repeat(32)}` } as never);
      renderWith(marked({ status: "solver_unavailable" }));
      await new Promise((r) => setTimeout(r, 10));
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });

    it.each(["removed", "solver_unavailable"] as const)("a %s bounty with a signature in flight offers Pagar bounty", async (status) => {
      upsertSend(MEMBER, { ...base, inFlight: Date.now() });
      renderWith(marked({ status }));
      expect(await screen.findByRole("button", { name: "Pagar bounty" })).toBeInTheDocument();
    });

    it.each(["removed", "solver_unavailable"] as const)("a %s bounty with nothing pending still offers no new payment", async (status) => {
      renderWith(marked({ status }));
      await new Promise((r) => setTimeout(r, 10));
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });

    it("an entry for another bounty does not count", async () => {
      upsertSend(MEMBER, { ...base, targetId: "other", inFlight: Date.now() });
      renderWith(marked({ status: "solver_unavailable" }));
      await new Promise((r) => setTimeout(r, 10));
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });
  });

  it("Pagar bounty opens the payment dialog in bounty mode for the solver", async () => {
    const { user } = setup({ isAuthor: true, solver, bounty: marked({ chainId: 8453 }) });
    await user.click(screen.getByRole("button", { name: "Pagar bounty" }));
    const dialog = screen.getByRole("dialog", { name: "Pago" });
    expect(dialog).toHaveAttribute("data-bounty", B);
    expect(dialog).toHaveAttribute("data-token", "USDC");
    expect(dialog).toHaveAttribute("data-min", "25000000");
    expect(dialog).toHaveAttribute("data-chain", "8453");
    expect(dialog).toHaveAttribute("data-recipient", solver.id);
    expect(dialog).toHaveAttribute("data-solver", solver.id);
  });

  it("cancels only after a confirmation and then reports the change", async () => {
    const { user, onChanged } = setup({ isAuthor: true });
    await user.click(screen.getByRole("button", { name: "Cancelar bounty" }));
    expect(cancelBountyAction).not.toHaveBeenCalled();
    await user.click(await screen.findByRole("button", { name: "Sí, cancelar bounty" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(cancelBountyAction).toHaveBeenCalledWith(B);
  });

  it("keeps the confirmation open with the server error when the cancel is refused", async () => {
    cancelBountyAction.mockResolvedValue({ ok: false, code: "already_marked", error: "Este bounty ya tiene una solución elegida y no se puede cambiar ni cancelar." });
    const { user, onChanged } = setup({ isAuthor: true });
    await user.click(screen.getByRole("button", { name: "Cancelar bounty" }));
    await user.click(await screen.findByRole("button", { name: "Sí, cancelar bounty" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("ya tiene una solución elegida");
    expect(onChanged).not.toHaveBeenCalled();
  });
});
