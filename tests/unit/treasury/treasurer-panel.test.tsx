import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
  quoteWithdrawalAction: vi.fn(),
  approveWithdrawalAction: vi.fn(),
  rejectWithdrawalAction: vi.fn(),
  markWithdrawalPaidAction: vi.fn(),
  setWithdrawalsEnabledAction: vi.fn(),
}));
vi.mock("@/lib/treasury/withdrawal-actions", () => actions);
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), notFound: vi.fn() }));

import { TreasuryAlerts } from "@/components/treasury/treasurer/treasury-alerts";
import { WithdrawalsTable } from "@/components/treasury/treasurer/withdrawals-table";
import { isHiddenTreasuryPage } from "@/lib/treasury/guard";
import { treasuryAlerts } from "@/lib/treasury/panel";
import type { TreasuryWithdrawal } from "@/lib/treasury/withdrawals";

const UNIT = 10n ** 18n;
const NOW = new Date("2026-10-19T12:00:00Z");

const row = (over: Partial<TreasuryWithdrawal> = {}): TreasuryWithdrawal => ({
  id: "w1",
  memberId: "m1",
  memberLabel: "@ana",
  wallet: "0x1234567890abcdef1234567890abcdef12345678",
  shares: 5n * UNIT,
  positionShares: 20n * UNIT,
  status: "pending",
  createdAt: "2026-10-18T10:00:00Z",
  approvedAt: null,
  expiresAt: null,
  approvedByLabel: null,
  selfApproved: false,
  amountUsdc: null,
  estimateUsd6: 12_500_000n,
  lastExpiredAt: null,
  rejectReason: null,
  payoutTxHash: null,
  payoutAmount: null,
  payoutRecordedAt: null,
  paidAt: null,
  ...over,
});

const approved = (over: Partial<TreasuryWithdrawal> = {}) =>
  row({ status: "approved", approvedAt: "2026-10-18T12:00:00Z", expiresAt: "2026-11-01T12:00:00Z", approvedByLabel: "@tes", amountUsdc: 8_000_000n, ...over });

beforeEach(() => Object.values(actions).forEach((f) => f.mockReset()));

describe("WithdrawalsTable · pending", () => {
  it("shows member, short wallet with copy, % of position, USD estimate, date and the buttons", () => {
    render(<WithdrawalsTable kind="pending" rows={[row()]} meId="other" bannedIds={[]} />);
    const item = screen.getByRole("listitem");
    expect(within(item).getByText("@ana")).toBeInTheDocument();
    expect(within(item).getByText("0x1234…5678")).toBeInTheDocument();
    expect(within(item).getByRole("button", { name: /Copiar/ })).toBeInTheDocument();
    expect(within(item).getByText("25 % de su posición")).toBeInTheDocument();
    expect(within(item).getByText("≈ 12,5 USD")).toBeInTheDocument();
    expect(within(item).getByText(/18 oct 2026/)).toBeInTheDocument();
    expect(within(item).getByRole("button", { name: "Aprobar" })).toBeInTheDocument();
    expect(within(item).getByRole("button", { name: "Rechazar" })).toBeInTheDocument();
    expect(within(item).queryByText("Tu solicitud")).toBeNull();
    expect(within(item).queryByText("Miembro baneado")).toBeNull();
  });

  it("marks the treasurer's own request, a banned member and an expired approval", () => {
    render(
      <WithdrawalsTable kind="pending" rows={[row({ memberId: "me", lastExpiredAt: "2026-10-17T00:00:00Z" }), row({ id: "w2", memberId: "bad" })]} meId="me" bannedIds={["bad"]} />,
    );
    expect(screen.getByText("Tu solicitud")).toBeInTheDocument();
    expect(screen.getByText("Miembro baneado")).toBeInTheDocument();
    expect(screen.getByText("Caducada · pendiente de nueva aprobación")).toBeInTheDocument();
  });

  it("opens the approve dialog", async () => {
    actions.quoteWithdrawalAction.mockReturnValue(new Promise(() => {}));
    render(<WithdrawalsTable kind="pending" rows={[row()]} meId={null} bannedIds={[]} />);
    await userEvent.click(screen.getByRole("button", { name: "Aprobar" }));
    expect(screen.getByRole("dialog", { name: "Aprobar retirada" })).toBeInTheDocument();
    expect(actions.quoteWithdrawalAction).toHaveBeenCalledWith("w1");
  });

  it("says when there is nothing pending", () => {
    render(<WithdrawalsTable kind="pending" rows={[]} meId={null} bannedIds={[]} />);
    expect(screen.getByText("No hay retiradas pendientes.")).toBeInTheDocument();
  });
});

describe("WithdrawalsTable · approved", () => {
  it("shows amount, expiry, the self-approval badge and the actions", () => {
    render(<WithdrawalsTable kind="approved" rows={[approved({ selfApproved: true })]} meId={null} bannedIds={[]} />);
    const item = screen.getByRole("listitem");
    expect(within(item).getByText("Aprobada · 8 USDC")).toBeInTheDocument();
    expect(within(item).getByText(/Caduca el 1 nov 2026/)).toBeInTheDocument();
    expect(within(item).getByText("Autoaprobada")).toBeInTheDocument();
    expect(within(item).getByRole("button", { name: "Marcar como pagada" })).toBeInTheDocument();
    expect(within(item).getByRole("button", { name: "Rechazar" })).toBeInTheDocument();
  });

  it("with a payout recorded: waits for finality and hides Rechazar", () => {
    render(
      <WithdrawalsTable kind="approved" rows={[approved({ payoutRecordedAt: "2026-10-19T00:00:00Z", payoutTxHash: `0x${"a".repeat(64)}`, payoutAmount: 8_000_000n })]} meId={null} bannedIds={[]} />,
    );
    expect(screen.getByText("Pago detectado · esperando finalidad")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Rechazar" })).toBeNull();
    expect(screen.getByRole("button", { name: "Marcar como pagada" })).toBeInTheDocument();
  });

  it("flags a banned member (they can still be paid)", () => {
    render(<WithdrawalsTable kind="approved" rows={[approved()]} meId={null} bannedIds={["m1"]} />);
    expect(screen.getByText("Miembro baneado")).toBeInTheDocument();
  });
});

describe("WithdrawalsTable · recent", () => {
  it("lists closed requests with their outcome and no actions", () => {
    render(
      <WithdrawalsTable
        kind="recent"
        rows={[
          row({ id: "a", status: "paid", amountUsdc: 8_000_000n, payoutAmount: 8_000_000n, paidAt: "2026-10-18T00:00:00Z" }),
          row({ id: "b", status: "rejected", rejectReason: "Sin fondos" }),
          row({ id: "c", status: "cancelled" }),
        ]}
        meId={null}
        bannedIds={[]}
      />,
    );
    expect(screen.getByText("Pagada · 8 USDC")).toBeInTheDocument();
    expect(screen.getByText("Rechazada")).toBeInTheDocument();
    expect(screen.getByText(/Sin fondos/)).toBeInTheDocument();
    expect(screen.getByText("Cancelada")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Aprobar|Rechazar|Marcar/ })).toBeNull();
  });
});

describe("treasuryAlerts + TreasuryAlerts", () => {
  it("lists approvals expiring within 48 h, not later ones nor those with a payout", () => {
    const soon = approved({ id: "s", expiresAt: "2026-10-20T12:00:00Z" });
    const later = approved({ id: "l", expiresAt: "2026-10-30T12:00:00Z" });
    const paying = approved({ id: "p", expiresAt: "2026-10-20T00:00:00Z", payoutRecordedAt: "2026-10-19T00:00:00Z" });
    const a = treasuryAlerts({ withdrawals: [soon, later, paying], safeUsdc: 100_000_000n, unexplained: 0, now: NOW });
    expect(a.expiring.map((e) => e.id)).toEqual(["s"]);
    render(<TreasuryAlerts alerts={a} />);
    expect(screen.getByText("Caduca pronto: @ana · 8 USDC")).toBeInTheDocument();
    expect(screen.queryByText("Sin avisos.")).toBeNull();
  });

  it("warns when approved, unpaid amounts exceed the Safe's USDC", () => {
    const a = treasuryAlerts({ withdrawals: [approved(), approved({ id: "w2", amountUsdc: 5_000_000n })], safeUsdc: 10_000_000n, unexplained: 0, now: NOW });
    expect(a.underfunded).toEqual({ reserved: 13_000_000n, safeUsdc: 10_000_000n });
    render(<TreasuryAlerts alerts={a} />);
    expect(screen.getByText("Pagos aprobados sin USDC suficiente en la Safe")).toBeInTheDocument();
  });

  it("does not count approvals with a recorded payout as reserved", () => {
    const a = treasuryAlerts({ withdrawals: [approved({ payoutRecordedAt: "2026-10-19T00:00:00Z" })], safeUsdc: 1n, unexplained: 0, now: NOW });
    expect(a.underfunded).toBeNull();
  });

  it("links the unexplained outflows to their section", () => {
    const a = treasuryAlerts({ withdrawals: [], safeUsdc: null, unexplained: 2, now: NOW });
    render(<TreasuryAlerts alerts={a} />);
    const link = screen.getByRole("link", { name: /2 salidas sin explicar/ });
    expect(link).toHaveAttribute("href", "#sin-explicar");
  });

  it("says «Sin avisos.» when there are none, and ignores the Safe balance when unknown", () => {
    const a = treasuryAlerts({ withdrawals: [approved()], safeUsdc: null, unexplained: 0, now: NOW });
    expect(a.underfunded).toBeNull();
    render(<TreasuryAlerts alerts={a} />);
    expect(screen.getByText("Sin avisos.")).toBeInTheDocument();
  });
});

describe("isHiddenTreasuryPage (proxy guard)", () => {
  const client = (perms: unknown, status: unknown = "active", permsError: unknown = null) => ({
    rpc: vi.fn(async (fn: string) => {
      if (fn === "my_permissions") return { data: perms, error: permsError };
      if (fn === "my_membership_status") return { data: status, error: null };
      throw new Error(`unexpected rpc ${fn}`);
    }),
  });

  it.each(["/", "/dao", "/dao/", "/dao/tesoreriax", "/x/dao/tesoreria"])("%s is not the panel: no query", async (p) => {
    const c = client("0");
    expect(await isHiddenTreasuryPage(c as never, p)).toBe(false);
    expect(c.rpc).not.toHaveBeenCalled();
  });

  it.each(["/dao/tesoreria", "/dao/tesoreria/", "/dao/tesoreria/algo"])("%s is hidden without MANAGE_TREASURY", async (p) => {
    expect(await isHiddenTreasuryPage(client("8") as never, p)).toBe(true);
  });

  it("is visible with MANAGE_TREASURY (256) or ADMINISTRATOR (512)", async () => {
    expect(await isHiddenTreasuryPage(client("256") as never, "/dao/tesoreria")).toBe(false);
    expect(await isHiddenTreasuryPage(client("512") as never, "/dao/tesoreria")).toBe(false);
  });

  it("only active members get the 404; any error fails open", async () => {
    expect(await isHiddenTreasuryPage(client("0", "banned") as never, "/dao/tesoreria")).toBe(false);
    expect(await isHiddenTreasuryPage(client(null, "active", { message: "x" }) as never, "/dao/tesoreria")).toBe(false);
    expect(await isHiddenTreasuryPage(client("abc") as never, "/dao/tesoreria")).toBe(false);
  });
});
