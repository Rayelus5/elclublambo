import { describe, expect, it, vi } from "vitest";
import {
  estimateUsdc,
  getTreasuryWithdrawals,
  parsePercent,
  sharesForBps,
  withdrawalLabel,
  type MyWithdrawal,
} from "@/lib/treasury/withdrawals";

const base: MyWithdrawal = {
  id: "w1",
  status: "pending",
  shares: 10n ** 18n,
  amountUsdc: null,
  approvedAt: null,
  expiresAt: null,
  payoutRecorded: false,
  payoutTxHash: null,
  rejectReason: null,
  lastExpiredAt: null,
  createdAt: "2026-10-19T10:00:00.000Z",
};

describe("parsePercent", () => {
  it.each([
    ["12,5", 1250],
    ["12.5", 1250],
    ["12", 1200],
    ["0,01", 1],
    ["100", 10000],
    [" 7,25 ", 725],
  ])("%j -> %i bps", (text, bps) => {
    expect(parsePercent(text)).toBe(bps);
  });
  it.each(["0", "0,00", "100,01", "1,234", "abc", "", "-5", "1e2", "12,", ",5", "101"])("%j -> null", (text) => {
    expect(parsePercent(text)).toBeNull();
  });
});

describe("sharesForBps", () => {
  it("returns every share at 10000 bps (no rounding dust left behind)", () => {
    expect(sharesForBps(10n ** 19n, 10000)).toBe(10n ** 19n);
    expect(sharesForBps(3n, 10000)).toBe(3n);
  });
  it("floors the proportional part below 10000", () => {
    expect(sharesForBps(10n ** 19n, 1250)).toBe(125n * 10n ** 16n);
    expect(sharesForBps(3n, 5000)).toBe(1n);
  });
});

describe("estimateUsdc", () => {
  it("shares · price / 10^18, floored", () => {
    expect(estimateUsdc(4n * 10n ** 18n, 2_000000n)).toBe(8_000000n);
    expect(estimateUsdc(1n, 2_000000n)).toBe(0n);
  });
});

describe("withdrawalLabel", () => {
  it.each([
    [{ status: "pending" }, "Pendiente"],
    [{ status: "pending", lastExpiredAt: "2026-10-18T00:00:00Z" }, "Caducada · pendiente de nueva aprobación"],
    [{ status: "approved" }, "Aprobada"],
    [{ status: "approved", payoutRecorded: true }, "Pago detectado · esperando finalidad"],
    [{ status: "paid", payoutRecorded: true }, "Pagada"],
    [{ status: "rejected" }, "Rechazada"],
    [{ status: "cancelled" }, "Cancelada"],
  ] as const)("%j -> %s", (over, label) => {
    expect(withdrawalLabel({ ...base, ...over })).toBe(label);
  });
});

describe("getTreasuryWithdrawals", () => {
  it("camel-cases treasury_withdrawals and parses amounts as bigint", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          id: "w1", member_id: "m1", member_label: "@ana", wallet: "0xabc", shares: "4000000000000000000",
          position_shares: "5000000000000000000", status: "approved", created_at: "c", approved_at: "a", expires_at: "e",
          approved_by_label: "@tesorero", self_approved: false, amount_usdc: "8000000", estimate_usd6: "8100000",
          last_expired_at: null, reject_reason: null, payout_tx_hash: null, payout_amount: null, payout_recorded_at: null,
          paid_at: null, payout_linked: true, rejected_at: "2026-10-17T00:00:00Z", cancelled_at: null, unexplained_outflow: true,
        },
        {
          id: "w2", member_id: "m2", member_label: "@bea", wallet: "0xdef", shares: "1", position_shares: "1",
          status: "weird", created_at: "c",
        },
      ],
      error: null,
    });
    const rows = await getTreasuryWithdrawals({ rpc } as never);
    expect(rpc).toHaveBeenCalledWith("treasury_withdrawals");
    expect(rows).toEqual([
      {
        id: "w1", memberId: "m1", memberLabel: "@ana", wallet: "0xabc", shares: 4n * 10n ** 18n,
        positionShares: 5n * 10n ** 18n, status: "approved", createdAt: "c", approvedAt: "a", expiresAt: "e",
        approvedByLabel: "@tesorero", selfApproved: false, amountUsdc: 8_000000n, estimateUsd6: 8_100000n,
        lastExpiredAt: null, rejectReason: null, payoutTxHash: null, payoutAmount: null, payoutRecordedAt: null, paidAt: null, payoutLinked: true, rejectedAt: "2026-10-17T00:00:00Z", cancelledAt: null, unexplainedOutflow: true,
      },
    ]);
  });

  it("throws on an RPC error (forbidden for non-treasurers)", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "forbidden" } });
    await expect(getTreasuryWithdrawals({ rpc } as never)).rejects.toThrow("forbidden");
  });
});
