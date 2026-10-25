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
import type { TreasuryRaffle } from "@/lib/treasury/raffles";
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
  payoutLinked: false,
  rejectedAt: null,
  cancelledAt: null,
  unexplainedOutflow: false,
  ...over,
});

const approved = (over: Partial<TreasuryWithdrawal> = {}) =>
  row({ status: "approved", approvedAt: "2026-10-18T12:00:00Z", expiresAt: "2026-11-01T12:00:00Z", approvedByLabel: "@tes", amountUsdc: 8_000_000n, ...over });

const drawnRaffle = (over: Partial<TreasuryRaffle> = {}): TreasuryRaffle => ({
  id: "r1", title: "Sorteo de otoño", status: "drawn", prizeToken: "USDC", prizeAmount: 6_000_000n, prizeValueUsd6: 6_000_000n,
  mode: "equal", closesAt: "2026-10-01T00:00:00Z", entries: 2, totalWeight: 2n, winnerMemberId: "w", winnerLabel: "@ana",
  winnerAddress: "0x1234567890abcdef1234567890abcdef12345678", drawnAt: "2026-10-02T00:00:00Z", unpaid: false, payoutTxHash: null,
  payoutRecordedAt: null, paidAt: null, cancelReason: null, createdByLabel: "@tes", createdAt: "2026-09-30T00:00:00Z", paidLate: false, drawRefused: null, unexplainedOutflow: false, ...over,
});

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
    expect(screen.queryByRole("button", { name: "Marcar como pagada" })).toBeNull();
  });

  it("with a linked payout candidate (F4c-R6): Rechazar is disabled and says why up front", () => {
    render(<WithdrawalsTable kind="approved" rows={[approved({ payoutLinked: true })]} meId={null} bannedIds={[]} />);
    expect(screen.getByRole("button", { name: "Rechazar" })).toBeDisabled();
    expect(screen.getByText("Hay un pago detectado pendiente de verificar.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Marcar como pagada" })).toBeEnabled();
  });

  it("without a candidate Rechazar is enabled and no warning shows", () => {
    render(<WithdrawalsTable kind="approved" rows={[approved()]} meId={null} bannedIds={[]} />);
    expect(screen.getByRole("button", { name: "Rechazar" })).toBeEnabled();
    expect(screen.queryByText(/pago detectado pendiente/)).toBeNull();
  });

  it("with an unexplained USDC outflow to the wallet: the reject dialog warns and asks for confirmation (P1)", async () => {
    render(<WithdrawalsTable kind="approved" rows={[approved({ unexplainedOutflow: true })]} meId={null} bannedIds={[]} />);
    await userEvent.click(screen.getByRole("button", { name: "Rechazar" }));
    const dialog = screen.getByRole("dialog", { name: "Rechazar retirada" });
    expect(within(dialog).getByText(/Hay una salida de USDC a esta wallet sin explicar/)).toBeInTheDocument();
    expect(within(dialog).getByRole("checkbox")).toBeInTheDocument();
  });

  it("a pending request's reject dialog never asks for that confirmation", async () => {
    render(<WithdrawalsTable kind="pending" rows={[row({ unexplainedOutflow: true })]} meId={null} bannedIds={[]} />);
    await userEvent.click(screen.getByRole("button", { name: "Rechazar" }));
    expect(within(screen.getByRole("dialog")).queryByRole("checkbox")).toBeNull();
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
          row({ id: "b", status: "rejected", rejectReason: "Sin fondos", rejectedAt: "2026-10-17T09:00:00Z" }),
          row({ id: "c", status: "cancelled", cancelledAt: "2026-10-16T08:00:00Z" }),
        ]}
        meId={null}
        bannedIds={[]}
      />,
    );
    expect(screen.getByText("Pagada · 8 USDC")).toBeInTheDocument();
    expect(screen.getByText("Rechazada")).toBeInTheDocument();
    expect(screen.getByText(/Sin fondos/)).toBeInTheDocument();
    expect(screen.getByText("Cancelada")).toBeInTheDocument();
    expect(screen.getByText(/Rechazada el 17 oct 2026/)).toBeInTheDocument();
    expect(screen.getByText(/Cancelada el 16 oct 2026/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Aprobar|Rechazar|Marcar/ })).toBeNull();
  });

  it("flags a payout above the fixed amount as «Pagado de más», with the difference (F4c minor #3)", () => {
    render(
      <WithdrawalsTable
        kind="recent"
        rows={[
          row({ id: "a", status: "paid", amountUsdc: 8_000_000n, payoutAmount: 9_500_000n, paidAt: "2026-10-18T00:00:00Z" }),
          row({ id: "b", memberLabel: "@bea", status: "paid", amountUsdc: 8_000_000n, payoutAmount: 8_000_000n, paidAt: "2026-10-18T00:00:00Z" }),
        ]}
        meId={null}
        bannedIds={[]}
      />,
    );
    const [over, exact] = screen.getAllByRole("listitem");
    expect(within(over!).getByText("Pagado de más: 1,5 USDC")).toBeInTheDocument();
    expect(within(exact!).queryByText(/Pagado de más/)).toBeNull();
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

  it.each(["/", "/foro/dao", "/foro/dao/", "/foro/dao/tesoreriax", "/foro/x/dao/tesoreria", "/dao/tesoreria"])("%s is not the panel: no query", async (p) => {
    const c = client("0");
    expect(await isHiddenTreasuryPage(c as never, p)).toBe(false);
    expect(c.rpc).not.toHaveBeenCalled();
  });

  it.each(["/foro/dao/tesoreria", "/foro/dao/tesoreria/", "/foro/dao/tesoreria/algo"])("%s is hidden without MANAGE_TREASURY", async (p) => {
    expect(await isHiddenTreasuryPage(client("8") as never, p)).toBe(true);
  });

  it("is visible with MANAGE_TREASURY (256) or ADMINISTRATOR (512)", async () => {
    expect(await isHiddenTreasuryPage(client("256") as never, "/foro/dao/tesoreria")).toBe(false);
    expect(await isHiddenTreasuryPage(client("512") as never, "/foro/dao/tesoreria")).toBe(false);
  });

  it("only active members get the 404; any error fails open", async () => {
    expect(await isHiddenTreasuryPage(client("0", "banned") as never, "/foro/dao/tesoreria")).toBe(false);
    expect(await isHiddenTreasuryPage(client(null, "active", { message: "x" }) as never, "/foro/dao/tesoreria")).toBe(false);
    expect(await isHiddenTreasuryPage(client("abc") as never, "/foro/dao/tesoreria")).toBe(false);
  });
});

describe("treasuryAlerts · raffles", () => {
  const base = { withdrawals: [], unexplained: 0, now: NOW };

  it("lists an unpaid prize with its title and prize", () => {
    const a = treasuryAlerts({ ...base, safeUsdc: 100_000_000n, safeWeth: 0n, raffles: [drawnRaffle({ unpaid: true }), drawnRaffle({ id: "r2", title: "Reciente" })] });
    expect(a.unpaidRaffles).toEqual([{ id: "r1", title: "Sorteo de otoño", prize: "6 USDC" }]);
    render(<TreasuryAlerts alerts={a} />);
    expect(screen.getByText("Premio impagado: Sorteo de otoño · 6 USDC")).toBeInTheDocument();
    expect(screen.queryByText("Sin avisos.")).toBeNull();
  });

  it("warns when unpaid USDC prizes plus approved withdrawals exceed the Safe's USDC", () => {
    const a = treasuryAlerts({ ...base, withdrawals: [approved()], safeUsdc: 10_000_000n, safeWeth: 0n, raffles: [drawnRaffle()] });
    expect(a.prizeUnderfunded).toEqual([{ token: "USDC", reserved: 14_000_000n, safe: 10_000_000n }]);
    render(<TreasuryAlerts alerts={a} />);
    expect(screen.getByText("Premios en USDC sin saldo suficiente en la Safe")).toBeInTheDocument();
  });

  it("warns when unpaid WETH prizes exceed the Safe's WETH, ignores recorded ones, unknown balances and open raffles", () => {
    const weth = drawnRaffle({ prizeToken: "WETH", prizeAmount: 10n ** 16n });
    expect(treasuryAlerts({ ...base, safeUsdc: 1n, safeWeth: 10n ** 15n, raffles: [weth] }).prizeUnderfunded).toEqual([
      { token: "WETH", reserved: 10n ** 16n, safe: 10n ** 15n },
    ]);
    const recorded = drawnRaffle({ prizeToken: "WETH", prizeAmount: 10n ** 16n, payoutRecordedAt: "2026-10-03T00:00:00Z", payoutTxHash: "0x" + "a".repeat(64) });
    expect(treasuryAlerts({ ...base, safeUsdc: 1n, safeWeth: 0n, raffles: [recorded] }).prizeUnderfunded).toEqual([]);
    expect(treasuryAlerts({ ...base, safeUsdc: 1n, safeWeth: null, raffles: [weth] }).prizeUnderfunded).toEqual([]);
    expect(treasuryAlerts({ ...base, safeUsdc: 1n, safeWeth: 0n, raffles: [drawnRaffle({ status: "open" })] }).prizeUnderfunded).toEqual([]);
  });

  it("counts open and closed WETH prizes in the WETH shortfall too (not paid, cancelled or void ones)", () => {
    const open = drawnRaffle({ id: "o", status: "open", prizeToken: "WETH", prizeAmount: 10n ** 16n, winnerMemberId: null, drawnAt: null });
    const closed = drawnRaffle({ id: "c", status: "closed", prizeToken: "WETH", prizeAmount: 2n * 10n ** 16n, winnerMemberId: null, drawnAt: null });
    const drawn = drawnRaffle({ id: "d", prizeToken: "WETH", prizeAmount: 3n * 10n ** 16n });
    const gone = ["paid", "cancelled", "void"].map((status, i) =>
      drawnRaffle({ id: `g${i}`, status: status as TreasuryRaffle["status"], prizeToken: "WETH", prizeAmount: 10n ** 18n }),
    );
    expect(treasuryAlerts({ ...base, safeUsdc: 1n, safeWeth: 5n * 10n ** 16n, raffles: [open, closed, drawn, ...gone] }).prizeUnderfunded).toEqual([
      { token: "WETH", reserved: 6n * 10n ** 16n, safe: 5n * 10n ** 16n },
    ]);
    expect(treasuryAlerts({ ...base, safeUsdc: 1n, safeWeth: 6n * 10n ** 16n, raffles: [open, closed, drawn] }).prizeUnderfunded).toEqual([]);
  });

  it("lists a closed raffle whose draw the cron could not make, with the reason, linked to the raffles", () => {
    const closed = drawnRaffle({ status: "closed", winnerMemberId: null, drawnAt: null, drawRefused: "draw_block_invalid" });
    const a = treasuryAlerts({ ...base, safeUsdc: 100_000_000n, safeWeth: 0n, raffles: [closed, drawnRaffle({ id: "r2", drawRefused: null })] });
    expect(a.refusedDraws).toEqual([{ id: "r1", title: "Sorteo de otoño", code: "draw_block_invalid" }]);
    render(<TreasuryAlerts alerts={a} />);
    expect(screen.getByRole("link", { name: "No se pudo hacer el sorteo: Sorteo de otoño" })).toHaveAttribute("href", "#sorteos");
    expect(screen.getByText(/Ese bloque no es el primero posterior al cierre\./)).toBeInTheDocument();
    expect(screen.queryByText("Sin avisos.")).toBeNull();
  });

  it("F4-R2: names the obligation whose unexplained outflow pauses credits, and says how to resolve it", () => {
    const a = treasuryAlerts({
      ...base,
      withdrawals: [approved({ unexplainedOutflow: true })],
      safeUsdc: 100_000_000n,
      safeWeth: 0n,
      raffles: [drawnRaffle({ id: "r9", title: "Sorteo de invierno", unexplainedOutflow: true }), drawnRaffle({ id: "r2" })],
    });
    expect(a.paused).toEqual([
      { id: "w1", kind: "withdrawal", who: "@ana", destination: "0x1234567890abcdef1234567890abcdef12345678" },
      { id: "r9", kind: "prize", who: "Sorteo de invierno", destination: "0x1234567890abcdef1234567890abcdef12345678" },
    ]);
    render(<TreasuryAlerts alerts={a} />);
    expect(
      screen.getByText("Créditos en pausa: hay una salida sin explicar a 0x1234…5678 mientras la retirada de @ana sigue pendiente de pago"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Créditos en pausa: hay una salida sin explicar a 0x1234…5678 mientras el premio de «Sorteo de invierno» sigue pendiente de pago"),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/una sola transferencia de al menos el importe/).length).toBe(2);
    expect(screen.getAllByText(/Si la salida no tiene que ver, añádele una nota/).length).toBe(2);
    // F4-R3: a combined payment is recorded on the other obligation with the same hash; a note does not resolve it
    expect(
      screen.getAllByText(/Si una sola transferencia pagó la retirada y el premio de ese miembro, usa «Marcar como pagado» en el premio con el mismo hash \(una nota no basta\)/)
        .length,
    ).toBe(2);
    expect(screen.queryByText(/añádele la nota en «Operaciones»/)).toBeNull();
  });

  it("a withdrawal whose payout is already recorded is not paused", () => {
    const rec = approved({ unexplainedOutflow: true, payoutRecordedAt: "2026-10-19T00:00:00Z", payoutTxHash: `0x${"a".repeat(64)}` });
    expect(treasuryAlerts({ ...base, withdrawals: [rec], safeUsdc: 100_000_000n }).paused).toEqual([]);
  });

  it("F4-R1: a scan stuck for 3 runs or 3 hours is an alert; a short gap is not", () => {
    const at = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
    const gap = (runs: number, since: string) => treasuryAlerts({ ...base, safeUsdc: 1n, scanGap: { runs, since } }).scanStuck;
    expect(gap(2, at(1))).toBeNull();
    expect(gap(3, at(1))).toEqual({ runs: 3, since: at(1) });
    expect(gap(1, at(3))).toEqual({ runs: 1, since: at(3) });
    expect(treasuryAlerts({ ...base, safeUsdc: 1n, scanGap: null }).scanStuck).toBeNull();
    render(<TreasuryAlerts alerts={treasuryAlerts({ ...base, safeUsdc: 1n, scanGap: { runs: 4, since: at(5) } })} />);
    expect(screen.getByText("El escaneo de la Safe está atascado")).toBeInTheDocument();
    expect(screen.getByText(/4 pasadas seguidas/)).toHaveTextContent(/las donaciones esperan para acreditarse/);
    expect(screen.getByText(/4 pasadas seguidas/)).toHaveTextContent(/Revisa el nodo RPC de Linea/);
  });

  it("stays at «Sin avisos.» with covered, recent prizes", () => {
    const a = treasuryAlerts({ ...base, safeUsdc: 100_000_000n, safeWeth: 0n, raffles: [drawnRaffle()] });
    expect(a.unpaidRaffles).toEqual([]);
    expect(a.prizeUnderfunded).toEqual([]);
    render(<TreasuryAlerts alerts={a} />);
    expect(screen.getByText("Sin avisos.")).toBeInTheDocument();
  });
});
