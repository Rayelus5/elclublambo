import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const verifyTransfer = vi.fn();
vi.mock("@/lib/payments/verify", () => ({ verifyTransfer: (...a: unknown[]) => verifyTransfer(...a) }));

const getBlock = vi.fn();
vi.mock("@/lib/payments/chain-client", () => ({ chainClient: () => ({ getBlock: (...a: unknown[]) => getBlock(...a) }) }));

const SAFE = "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc";
let safe: string | null = SAFE;
vi.mock("@/lib/treasury/snapshot", () => ({ safeAddressOf: async () => safe }));

const rpc = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: (...a: unknown[]) => rpc(...a) }) }));

import {
  detectWithdrawalPayouts,
  expireWithdrawalApprovals,
  finalizeWithdrawalPayouts,
  scanCursorTime,
  verifyPayout,
} from "@/lib/treasury/payouts";

const DEST = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";
const H1 = `0x${"a1".repeat(32)}`;
const H2 = `0x${"b2".repeat(32)}`;
const APPROVED = "2026-10-19T10:00:00.000Z";
const TS = new Date("2026-10-19T10:05:00.000Z");
const ok = (over: Record<string, unknown> = {}) => ({ status: "ok", logIndex: 3, value: 8_500000n, blockNumber: 140n, blockTimestamp: TS, ...over });

type Reply = { data?: unknown; error?: { message: string } | null };
let replies: Record<string, Reply | ((args: Record<string, unknown>) => Reply)> = {};
const calls = (name: string) => rpc.mock.calls.filter((c) => c[0] === name).map((c) => c[1] as Record<string, unknown>);

beforeEach(() => {
  vi.clearAllMocks();
  safe = SAFE;
  replies = {};
  rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    const r = replies[name];
    const v = typeof r === "function" ? r(args) : r;
    return { data: v?.data ?? null, error: v?.error ?? null };
  });
  verifyTransfer.mockResolvedValue(ok());
  getBlock.mockResolvedValue({ number: 150n });
});

describe("verifyPayout", () => {
  it("verifies a USDC transfer from the Safe to the destination for at least the fixed amount, not before approval", async () => {
    await verifyPayout({ chain: 59141, safe: SAFE, destination: DEST, amountLocked: 8_000000n, approvedAt: new Date(APPROVED) }, H1 as `0x${string}`);
    expect(verifyTransfer).toHaveBeenCalledWith({
      chain: 59141, token: "USDC", txHash: H1, from: SAFE, to: DEST, amount: 8_000000n, atLeast: true, notBefore: new Date(APPROVED),
    });
  });
  it("passes a preferred log index through (minor 2: the linked candidate's log wins when it qualifies)", async () => {
    await verifyPayout({ chain: 59141, safe: SAFE, destination: DEST, amountLocked: 1n, approvedAt: new Date(APPROVED) }, H1 as `0x${string}`, 7);
    expect(verifyTransfer).toHaveBeenCalledWith(expect.objectContaining({ preferLogIndex: 7, atLeast: true }));
  });
});

describe("scanCursorTime (ruling F4c-R5)", () => {
  it("is the block time of the scan cursor", async () => {
    replies.dao_scan_from = { data: 140 };
    getBlock.mockResolvedValue({ number: 140n, timestamp: 1_800_000_000n });
    expect(await scanCursorTime(59141)).toEqual(new Date(1_800_000_000_000));
    expect(calls("dao_scan_from")).toEqual([{ p_chain: 59141 }]);
    expect(getBlock).toHaveBeenCalledWith({ blockNumber: 140n });
  });
  it("is null without a cursor, on a read error or when the block cannot be read", async () => {
    replies.dao_scan_from = { data: null };
    expect(await scanCursorTime(59141)).toBeNull();
    replies.dao_scan_from = { error: { message: "db down" } };
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await scanCursorTime(59141)).toBeNull();
    replies.dao_scan_from = { data: "140" };
    getBlock.mockRejectedValue(new Error("rpc down"));
    expect(await scanCursorTime(59141)).toBeNull();
    err.mockRestore();
  });
});

const candidate = (request: string, tx: string, over: Record<string, unknown> = {}) => ({
  request_id: request, tx_hash: tx, log_index: 3, destination: DEST, amount_usdc_locked: "8000000", approved_at: APPROVED, ...over,
});

describe("detectWithdrawalPayouts", () => {
  it("records a verified candidate with p_actor null and the verified value, log, block and time", async () => {
    replies.withdrawal_payout_candidates = { data: [candidate("r1", H1)] };
    replies.record_withdrawal_payout = { data: { status: "recorded" } };
    expect(await detectWithdrawalPayouts(59141)).toEqual({ recorded: 1 });
    expect(calls("withdrawal_payout_candidates")).toEqual([{ p_chain: 59141 }]);
    expect(verifyTransfer).toHaveBeenCalledWith(
      expect.objectContaining({ txHash: H1, from: SAFE, to: DEST, amount: 8_000000n, atLeast: true, preferLogIndex: 3 }),
    );
    // an ok verification clears any not-found mark on the candidate
    expect(calls("withdrawal_candidate_missing")).toEqual([{ p_request: "r1", p_tx_hash: H1, p_log_index: 3, p_missing: false }]);
    expect(calls("record_withdrawal_payout")).toEqual([
      {
        p_request: "r1",
        p_safe: SAFE,
        p_actor: null,
        p_payout: { txHash: H1, logIndex: 3, blockNumber: "140", blockTime: TS.toISOString(), to: DEST, amount: "8500000" },
      },
    ]);
  });

  it("a pending verification records nothing and unlinks nothing", async () => {
    replies.withdrawal_payout_candidates = { data: [candidate("r1", H1)] };
    verifyTransfer.mockResolvedValue({ status: "pending" });
    expect(await detectWithdrawalPayouts(59141)).toEqual({ recorded: 0 });
    expect(calls("record_withdrawal_payout")).toEqual([]);
    expect(calls("unlink_withdrawal_candidate")).toEqual([]);
  });

  it("rpc_unavailable keeps the candidate linked", async () => {
    replies.withdrawal_payout_candidates = { data: [candidate("r1", H1)] };
    verifyTransfer.mockResolvedValue({ status: "error", code: "rpc_unavailable" });
    expect(await detectWithdrawalPayouts(59141)).toEqual({ recorded: 0 });
    expect(calls("unlink_withdrawal_candidate")).toEqual([]);
  });

  it.each(["tx_failed", "tx_mismatch", "tx_too_old"])("a permanent %s unlinks the candidate as failed", async (code) => {
    replies.withdrawal_payout_candidates = { data: [candidate("r1", H1)] };
    verifyTransfer.mockResolvedValue({ status: "error", code });
    expect(await detectWithdrawalPayouts(59141)).toEqual({ recorded: 0 });
    expect(calls("unlink_withdrawal_candidate")).toEqual([{ p_request: "r1", p_tx_hash: H1, p_log_index: 3, p_reason: "failed" }]);
    expect(calls("record_withdrawal_payout")).toEqual([]);
  });

  it("a first tx_not_found only marks the candidate as missing: no unlink", async () => {
    replies.withdrawal_payout_candidates = { data: [candidate("r1", H1)] };
    verifyTransfer.mockResolvedValue({ status: "error", code: "tx_not_found" });
    replies.withdrawal_candidate_missing = { data: false };
    await detectWithdrawalPayouts(59141);
    expect(calls("withdrawal_candidate_missing")).toEqual([{ p_request: "r1", p_tx_hash: H1, p_log_index: 3, p_missing: true }]);
    expect(calls("unlink_withdrawal_candidate")).toEqual([]);
  });

  it("a tx_not_found 30+ minutes after the mark unlinks as not_found", async () => {
    replies.withdrawal_payout_candidates = { data: [candidate("r1", H1)] };
    verifyTransfer.mockResolvedValue({ status: "error", code: "tx_not_found" });
    replies.withdrawal_candidate_missing = { data: true };
    await detectWithdrawalPayouts(59141);
    expect(calls("unlink_withdrawal_candidate")).toEqual([{ p_request: "r1", p_tx_hash: H1, p_log_index: 3, p_reason: "not_found" }]);
  });

  it("a failing mark RPC unlinks nothing", async () => {
    replies.withdrawal_payout_candidates = { data: [candidate("r1", H1)] };
    verifyTransfer.mockResolvedValue({ status: "error", code: "tx_not_found" });
    replies.withdrawal_candidate_missing = { data: true, error: { message: "invalid_state" } };
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await detectWithdrawalPayouts(59141);
    expect(calls("unlink_withdrawal_candidate")).toEqual([]);
    err.mockRestore();
  });

  it("a retryable record error (deadlock) is not mistaken for a permanent refusal (rpcErrorCode)", async () => {
    replies.withdrawal_payout_candidates = { data: [candidate("r1", H1)] };
    replies.record_withdrawal_payout = { error: { message: "tx_mismatch", code: "40P01" } as { message: string } };
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await detectWithdrawalPayouts(59141);
    expect(calls("unlink_withdrawal_candidate")).toEqual([]);
    err.mockRestore();
  });

  it.each(["tx_mismatch", "tx_already_used", "tx_too_old"])("a record refused with %s unlinks the candidate", async (code) => {
    replies.withdrawal_payout_candidates = { data: [candidate("r1", H1)] };
    replies.record_withdrawal_payout = { error: { message: code } };
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await detectWithdrawalPayouts(59141)).toEqual({ recorded: 0 });
    expect(calls("unlink_withdrawal_candidate")).toEqual([{ p_request: "r1", p_tx_hash: H1, p_log_index: 3, p_reason: "failed" }]);
    err.mockRestore();
  });

  it("a record refused for a transient reason (safe_changed, invalid_state) unlinks nothing", async () => {
    replies.withdrawal_payout_candidates = { data: [candidate("r1", H1), candidate("r2", H2)] };
    replies.record_withdrawal_payout = (a) => ({ error: { message: a.p_request === "r1" ? "safe_changed" : "invalid_state" } });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await detectWithdrawalPayouts(59141)).toEqual({ recorded: 0 });
    expect(calls("unlink_withdrawal_candidate")).toEqual([]);
    err.mockRestore();
  });

  it("stops at the first recorded candidate of a request and goes on with the next request", async () => {
    replies.withdrawal_payout_candidates = { data: [candidate("r1", H1), candidate("r1", H2), candidate("r2", H2, { log_index: 5 })] };
    replies.record_withdrawal_payout = (a) => ({ data: { status: a.p_request === "r1" ? "recorded" : "already" } });
    expect(await detectWithdrawalPayouts(59141)).toEqual({ recorded: 1 });
    expect(calls("record_withdrawal_payout").map((c) => c.p_request)).toEqual(["r1", "r2"]);
  });

  it("a throwing verification of one candidate does not stop the others", async () => {
    replies.withdrawal_payout_candidates = { data: [candidate("r1", H1), candidate("r2", H2)] };
    replies.record_withdrawal_payout = { data: { status: "recorded" } };
    verifyTransfer.mockRejectedValueOnce(new Error("boom"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await detectWithdrawalPayouts(59141)).toEqual({ recorded: 1 });
    err.mockRestore();
  });

  it("does nothing without a Safe", async () => {
    safe = null;
    expect(await detectWithdrawalPayouts(59141)).toEqual({ recorded: 0 });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("throws when the candidates cannot be read (the cron reports the step as failed)", async () => {
    replies.withdrawal_payout_candidates = { error: { message: "db down" } };
    await expect(detectWithdrawalPayouts(59141)).rejects.toThrow(/db down/);
  });
});

const awaiting = (request: string, block: number, over: Record<string, unknown> = {}) => ({
  request_id: request, tx_hash: H1, destination: DEST, amount_usdc_locked: "8000000", approved_at: APPROVED,
  payout_block: String(block), payout_recorded_at: new Date().toISOString(), payout_log_index: 3, ...over,
});

describe("finalizeWithdrawalPayouts", () => {
  it("a payout above the finalized block is not verified and stays pending", async () => {
    replies.withdrawals_awaiting_finality = { data: [awaiting("r1", 151)] };
    expect(await finalizeWithdrawalPayouts(59141)).toEqual({ paid: 0, reverted: 0, pending: 1 });
    expect(getBlock).toHaveBeenCalledWith({ blockTag: "finalized" });
    expect(verifyTransfer).not.toHaveBeenCalled();
    expect(calls("finalize_withdrawal")).toEqual([]);
  });

  it("at finality re-verifies and calls finalize_withdrawal with the Safe and the finalized block", async () => {
    replies.withdrawals_awaiting_finality = { data: [awaiting("r1", 150)] };
    replies.finalize_withdrawal = { data: { status: "paid" } };
    expect(await finalizeWithdrawalPayouts(59141)).toEqual({ paid: 1, reverted: 0, pending: 0 });
    expect(verifyTransfer).toHaveBeenCalledWith(expect.objectContaining({ txHash: H1, from: SAFE, to: DEST, amount: 8_000000n, atLeast: true }));
    expect(calls("finalize_withdrawal")).toEqual([{ p_request: "r1", p_safe: SAFE, p_finalized_block: "150" }]);
  });

  it("final review minor 1: the recorded log is the one re-verified (preferLogIndex)", async () => {
    replies.withdrawals_awaiting_finality = { data: [awaiting("r1", 140, { payout_log_index: 3 })] };
    replies.finalize_withdrawal = { data: { status: "paid" } };
    expect(await finalizeWithdrawalPayouts(59141)).toEqual({ paid: 1, reverted: 0, pending: 0 });
    expect(verifyTransfer).toHaveBeenCalledWith(expect.objectContaining({ txHash: H1, preferLogIndex: 3 }));
  });

  it("final review minor 1: when only another log of the tx qualifies, nothing burns (pending, no revert)", async () => {
    replies.withdrawals_awaiting_finality = { data: [awaiting("r1", 140, { payout_log_index: 7 })] };
    replies.finalize_withdrawal = { data: { status: "paid" } };
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await finalizeWithdrawalPayouts(59141)).toEqual({ paid: 0, reverted: 0, pending: 1 });
    expect(calls("finalize_withdrawal")).toEqual([]);
    expect(calls("revert_withdrawal_payout")).toEqual([]);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it("a re-verified receipt now past the finalized block (reorged and re-mined) stays pending", async () => {
    replies.withdrawals_awaiting_finality = { data: [awaiting("r1", 140)] };
    verifyTransfer.mockResolvedValue(ok({ blockNumber: 151n }));
    expect(await finalizeWithdrawalPayouts(59141)).toEqual({ paid: 0, reverted: 0, pending: 1 });
    expect(calls("finalize_withdrawal")).toEqual([]);
  });

  it.each(["tx_mismatch", "tx_failed"])("%s reverts the payout", async (code) => {
    replies.withdrawals_awaiting_finality = { data: [awaiting("r1", 140)] };
    verifyTransfer.mockResolvedValue({ status: "error", code });
    expect(await finalizeWithdrawalPayouts(59141)).toEqual({ paid: 0, reverted: 1, pending: 0 });
    expect(calls("revert_withdrawal_payout")).toEqual([{ p_request: "r1" }]);
    expect(calls("finalize_withdrawal")).toEqual([]);
  });

  it("a first tx_not_found (however old the record) only sets the mark: no revert", async () => {
    verifyTransfer.mockResolvedValue({ status: "error", code: "tx_not_found" });
    replies.withdrawals_awaiting_finality = { data: [awaiting("r1", 140, { payout_recorded_at: "2026-01-01T00:00:00.000Z" })] };
    replies.withdrawal_payout_missing = { data: false };
    expect(await finalizeWithdrawalPayouts(59141)).toEqual({ paid: 0, reverted: 0, pending: 1 });
    expect(calls("withdrawal_payout_missing")).toEqual([{ p_request: "r1", p_missing: true }]);
    expect(calls("revert_withdrawal_payout")).toEqual([]);
  });

  it("a tx_not_found 30+ minutes after the first mark reverts", async () => {
    verifyTransfer.mockResolvedValue({ status: "error", code: "tx_not_found" });
    replies.withdrawals_awaiting_finality = { data: [awaiting("r1", 140)] };
    replies.withdrawal_payout_missing = { data: true };
    expect(await finalizeWithdrawalPayouts(59141)).toEqual({ paid: 0, reverted: 1, pending: 0 });
    expect(calls("revert_withdrawal_payout")).toEqual([{ p_request: "r1" }]);
  });

  it("a failing mark RPC keeps the payout pending", async () => {
    verifyTransfer.mockResolvedValue({ status: "error", code: "tx_not_found" });
    replies.withdrawals_awaiting_finality = { data: [awaiting("r1", 140)] };
    replies.withdrawal_payout_missing = { data: true, error: { message: "invalid_state" } };
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await finalizeWithdrawalPayouts(59141)).toEqual({ paid: 0, reverted: 0, pending: 1 });
    expect(calls("revert_withdrawal_payout")).toEqual([]);
    err.mockRestore();
  });

  it("an ok verification clears the mark (also when the receipt is now past finality)", async () => {
    replies.withdrawals_awaiting_finality = { data: [awaiting("r1", 140)] };
    verifyTransfer.mockResolvedValue(ok({ blockNumber: 151n }));
    await finalizeWithdrawalPayouts(59141);
    expect(calls("withdrawal_payout_missing")).toEqual([{ p_request: "r1", p_missing: false }]);
  });

  it.each([{ status: "pending" }, { status: "error", code: "rpc_unavailable" }, { status: "error", code: "tx_too_old" }])(
    "anything else (%j) stays pending",
    async (res) => {
      replies.withdrawals_awaiting_finality = { data: [awaiting("r1", 140)] };
      verifyTransfer.mockResolvedValue(res);
      expect(await finalizeWithdrawalPayouts(59141)).toEqual({ paid: 0, reverted: 0, pending: 1 });
      expect(calls("revert_withdrawal_payout")).toEqual([]);
    },
  );

  it("a finalize error or a pending answer counts as pending", async () => {
    replies.withdrawals_awaiting_finality = { data: [awaiting("r1", 140), awaiting("r2", 141)] };
    replies.finalize_withdrawal = (a) => (a.p_request === "r1" ? { error: { message: "safe_changed" } } : { data: { status: "pending" } });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await finalizeWithdrawalPayouts(59141)).toEqual({ paid: 0, reverted: 0, pending: 2 });
    err.mockRestore();
  });

  it("without a finalized block (RPC down) everything stays pending and nothing is verified", async () => {
    replies.withdrawals_awaiting_finality = { data: [awaiting("r1", 1)] };
    getBlock.mockRejectedValue(new Error("rpc down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await finalizeWithdrawalPayouts(59141)).toEqual({ paid: 0, reverted: 0, pending: 1 });
    expect(verifyTransfer).not.toHaveBeenCalled();
    err.mockRestore();
  });

  it("with nothing awaiting finality it reads no block", async () => {
    replies.withdrawals_awaiting_finality = { data: [] };
    expect(await finalizeWithdrawalPayouts(59141)).toEqual({ paid: 0, reverted: 0, pending: 0 });
    expect(getBlock).not.toHaveBeenCalled();
  });
});

describe("expireWithdrawalApprovals", () => {
  it("expires one chain's lapsed approvals up to the scanned-through time and returns the count", async () => {
    replies.expire_withdrawal_approvals = { data: 2 };
    expect(await expireWithdrawalApprovals(59141, new Date("2026-10-19T12:00:00.000Z"))).toBe(2);
    expect(calls("expire_withdrawal_approvals")).toEqual([{ p_chain: 59141, p_scanned_through: "2026-10-19T12:00:00.000Z" }]);
  });
  it("throws on an RPC error", async () => {
    replies.expire_withdrawal_approvals = { error: { message: "db down" } };
    await expect(expireWithdrawalApprovals(59141, new Date())).rejects.toThrow(/db down/);
  });
});
