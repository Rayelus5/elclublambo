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
  detectRafflePayouts,
  drawDueRaffles,
  finalizeRafflePayouts,
  firstBlockAfter,
  notifyUnpaidRaffles,
  runRaffleSteps,
  verifyPrizePayout,
} from "@/lib/treasury/raffle-cron";

const WINNER = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";
const H1 = `0x${"a1".repeat(32)}`;
const H2 = `0x${"b2".repeat(32)}`;
const DRAWN = "2026-10-19T10:00:00.000Z";
const TS = new Date("2026-10-19T10:05:00.000Z");
const ok = (over: Record<string, unknown> = {}) => ({ status: "ok", logIndex: 3, value: 5_500000n, blockNumber: 140n, blockTimestamp: TS, ...over });
const hashOf = (n: bigint) => `0x${n.toString(16).padStart(64, "0")}`;

type Reply = { data?: unknown; error?: { message: string; code?: string } | null };
let replies: Record<string, Reply | ((args: Record<string, unknown>) => Reply)> = {};
const calls = (name: string) => rpc.mock.calls.filter((c) => c[0] === name).map((c) => c[1] as Record<string, unknown>);

/** A fake chain: block n has timestamp ts[n] (seconds); `finalized` is the finalized tag. */
function chain(ts: number[], finalized = ts.length - 1) {
  return vi.fn(async (args: { blockNumber?: bigint; blockTag?: string }) => {
    const n = args.blockTag === "finalized" ? BigInt(finalized) : args.blockNumber!;
    const t = ts[Number(n)];
    if (t === undefined) throw new Error(`no block ${n}`);
    return { number: n, hash: hashOf(n), timestamp: BigInt(t) };
  });
}

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

describe("verifyPrizePayout", () => {
  it("verifies the prize token from the Safe to the winner, at least the prize, not before the draw", async () => {
    await verifyPrizePayout({ chain: 59141, safe: SAFE, token: "WETH", winner: WINNER, prize: 10n ** 16n, drawnAt: new Date(DRAWN) }, H1 as `0x${string}`);
    expect(verifyTransfer).toHaveBeenCalledWith({
      chain: 59141, token: "WETH", txHash: H1, from: SAFE, to: WINNER, amount: 10n ** 16n, atLeast: true, notBefore: new Date(DRAWN),
    });
    await verifyPrizePayout({ chain: 59141, safe: SAFE, token: "USDC", winner: WINNER, prize: 1n, drawnAt: new Date(DRAWN) }, H1 as `0x${string}`, 4);
    expect(verifyTransfer).toHaveBeenLastCalledWith(expect.objectContaining({ token: "USDC", preferLogIndex: 4 }));
  });
});

describe("firstBlockAfter", () => {
  const TSS = [10, 10, 11, 13, 13, 20];
  it("finds the first block whose time is past `at` and whose parent's is not", async () => {
    const client = { getBlock: chain(TSS) };
    expect(await firstBlockAfter(client as never, new Date(13_000), 5n)).toEqual({ number: 5n, hash: hashOf(5n), timestamp: 20n, parentTimestamp: 13n });
    expect(await firstBlockAfter(client as never, new Date(10_000), 5n)).toEqual({ number: 2n, hash: hashOf(2n), timestamp: 11n, parentTimestamp: 10n });
    expect(await firstBlockAfter(client as never, new Date(12_500), 5n)).toEqual({ number: 3n, hash: hashOf(3n), timestamp: 13n, parentTimestamp: 11n });
  });
  it("is null while the finalized block is not past `at` (the draw block is not final yet)", async () => {
    expect(await firstBlockAfter({ getBlock: chain(TSS) } as never, new Date(20_000), 5n)).toBeNull();
    expect(await firstBlockAfter({ getBlock: chain(TSS) } as never, new Date(13_000), 4n)).toBeNull();
  });
  it("compares at millisecond precision (a close at 12.999 s is before a block at 13 s)", async () => {
    expect(await firstBlockAfter({ getBlock: chain(TSS) } as never, new Date(12_999), 5n)).toMatchObject({ number: 3n });
    expect(await firstBlockAfter({ getBlock: chain(TSS) } as never, new Date(13_001), 5n)).toMatchObject({ number: 5n });
  });
  it("uses a bounded number of block reads (binary search)", async () => {
    const ts = Array.from({ length: 1 << 16 }, (_, i) => 1000 + 2 * i);
    const getBlockFake = chain(ts);
    const r = await firstBlockAfter({ getBlock: getBlockFake } as never, new Date((1000 + 2 * 40_000) * 1000 + 1), BigInt(ts.length - 1));
    expect(r).toMatchObject({ number: 40_001n, parentTimestamp: BigInt(1000 + 2 * 40_000) });
    expect(getBlockFake.mock.calls.length).toBeLessThanOrEqual(20);
  });
  it("is null when even the genesis block is past `at` (no parent to prove the boundary)", async () => {
    expect(await firstBlockAfter({ getBlock: chain([50, 60]) } as never, new Date(1_000), 1n)).toBeNull();
  });
});

describe("drawDueRaffles", () => {
  it("closes, then draws each awaiting raffle with the first block after its close, as ISO strings", async () => {
    replies.close_due_raffles = { data: { closed: 2, voided: 1 } };
    replies.raffles_awaiting_draw = { data: [{ raffle_id: "r1", closes_at: "1970-01-01T00:00:13+00:00" }] };
    replies.draw_raffle = { data: { status: "drawn", winnerPosition: 1 } };
    getBlock.mockImplementation(chain([10, 10, 11, 13, 13, 20], 5));
    expect(await drawDueRaffles(59141)).toEqual({ closed: 2, voided: 1, drawn: 1, pending: 0, refused: [] });
    expect(calls("close_due_raffles")).toEqual([{ p_chain: 59141 }]);
    expect(calls("raffles_awaiting_draw")).toEqual([{ p_chain: 59141 }]);
    expect(getBlock).toHaveBeenCalledWith({ blockTag: "finalized" });
    expect(calls("draw_raffle")).toEqual([
      {
        p_raffle: "r1",
        p_block: { number: "5", hash: hashOf(5n), timestamp: "1970-01-01T00:00:20.000Z", parentTimestamp: "1970-01-01T00:00:13.000Z" },
      },
    ]);
  });
  it("does not draw while the finalized block precedes the draw block", async () => {
    replies.close_due_raffles = { data: { closed: 0, voided: 0 } };
    replies.raffles_awaiting_draw = { data: [{ raffle_id: "r1", closes_at: "1970-01-01T00:00:13+00:00" }] };
    getBlock.mockImplementation(chain([10, 10, 11, 13, 13, 20], 4));
    expect(await drawDueRaffles(59141)).toEqual({ closed: 0, voided: 0, drawn: 0, pending: 1, refused: [] });
    expect(calls("draw_raffle")).toEqual([]);
  });
  it("without a finalized block everything awaiting stays pending", async () => {
    replies.raffles_awaiting_draw = { data: [{ raffle_id: "r1", closes_at: "1970-01-01T00:00:13+00:00" }, { raffle_id: "r2", closes_at: "1970-01-01T00:00:14+00:00" }] };
    getBlock.mockRejectedValue(new Error("rpc down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await drawDueRaffles(59141)).toEqual({ closed: 0, voided: 0, drawn: 0, pending: 2, refused: [] });
    expect(calls("draw_raffle")).toEqual([]);
    err.mockRestore();
  });
  it("a refused draw (draw_block_invalid) or an 'already' answer is not counted as drawn; the next raffle still runs", async () => {
    replies.raffles_awaiting_draw = {
      data: [
        { raffle_id: "r1", closes_at: "1970-01-01T00:00:13+00:00" },
        { raffle_id: "r2", closes_at: "1970-01-01T00:00:10+00:00" },
        { raffle_id: "r3", closes_at: "1970-01-01T00:00:11+00:00" },
      ],
    };
    replies.draw_raffle = (a) =>
      a.p_raffle === "r1" ? { error: { message: "draw_block_invalid" } } : a.p_raffle === "r2" ? { data: { status: "already" } } : { data: { status: "drawn" } };
    getBlock.mockImplementation(chain([10, 10, 11, 13, 13, 20], 5));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    // r1 refused: pending for the next run; r2 'already' (a concurrent caller drew it): neither drawn here nor pending
    expect(await drawDueRaffles(59141)).toEqual({ closed: 0, voided: 0, drawn: 1, pending: 1, refused: [{ raffleId: "r1", code: "draw_block_invalid" }] });
    expect(calls("draw_raffle").map((c) => c.p_raffle)).toEqual(["r1", "r2", "r3"]);
    // the refusal is stored for the treasurer's «Avisos» (SQL keeps one per raffle and code)
    expect(calls("record_raffle_draw_refusal")).toEqual([{ p_raffle: "r1", p_code: "draw_block_invalid" }]);
    err.mockRestore();
  });
  it("reports every draw error per raffle; stores refusals but not transient failures", async () => {
    replies.raffles_awaiting_draw = {
      data: [
        { raffle_id: "r1", closes_at: "1970-01-01T00:00:13+00:00" },
        { raffle_id: "r2", closes_at: "1970-01-01T00:00:13+00:00" },
        { raffle_id: "r3", closes_at: "1970-01-01T00:00:13+00:00" },
        { raffle_id: "r4", closes_at: "not a date" },
      ],
    };
    replies.draw_raffle = (a) =>
      a.p_raffle === "r1"
        ? { error: { message: "invalid_state" } }
        : a.p_raffle === "r2"
          ? { error: { message: "deadlock detected", code: "40P01" } }
          : { error: { message: "something new" } };
    replies.record_raffle_draw_refusal = (a) => (a.p_raffle === "r1" ? { error: { message: "db down" } } : { data: true });
    getBlock.mockImplementation(chain([10, 10, 11, 13, 13, 20], 5));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await drawDueRaffles(59141)).toEqual({
      closed: 0,
      voided: 0,
      drawn: 0,
      pending: 4,
      refused: [
        { raffleId: "r1", code: "invalid_state" },
        { raffleId: "r2", code: "retry" },
        { raffleId: "r3", code: "unknown" },
        { raffleId: "r4", code: "draw_failed" },
      ],
    });
    // a deadlock or a thrown error (chain read, bad data) is retried next run without an alert; a failing store is logged
    expect(calls("record_raffle_draw_refusal")).toEqual([
      { p_raffle: "r1", p_code: "invalid_state" },
      { p_raffle: "r3", p_code: "unknown" },
    ]);
    expect(err).toHaveBeenCalledWith("[treasury] record_raffle_draw_refusal failed", "r1", "db down");
    err.mockRestore();
  });
  it("throws when the close or the list fails (the cron reports raffles as failed)", async () => {
    replies.close_due_raffles = { error: { message: "db down" } };
    await expect(drawDueRaffles(59141)).rejects.toThrow(/db down/);
    replies.close_due_raffles = { data: { closed: 0, voided: 0 } };
    replies.raffles_awaiting_draw = { error: { message: "db down 2" } };
    await expect(drawDueRaffles(59141)).rejects.toThrow(/db down 2/);
  });
  it("with nothing awaiting it reads no block", async () => {
    replies.close_due_raffles = { data: { closed: 0, voided: 1 } };
    replies.raffles_awaiting_draw = { data: [] };
    expect(await drawDueRaffles(59141)).toEqual({ closed: 0, voided: 1, drawn: 0, pending: 0, refused: [] });
    expect(getBlock).not.toHaveBeenCalled();
  });
});

const candidate = (raffle: string, tx: string, over: Record<string, unknown> = {}) => ({
  raffle_id: raffle, tx_hash: tx, log_index: 3, token: "USDC", winner_address: WINNER, prize_amount: "5000000", drawn_at: DRAWN, ...over,
});

describe("detectRafflePayouts", () => {
  it("records a verified candidate with p_actor null, the verified value and the prize token", async () => {
    replies.raffle_payout_candidates = { data: [candidate("r1", H1, { token: "WETH", prize_amount: "10000000000000000" })] };
    replies.record_raffle_payout = { data: { status: "recorded" } };
    verifyTransfer.mockResolvedValue(ok({ value: 105n * 10n ** 14n }));
    expect(await detectRafflePayouts(59141)).toEqual({ recorded: 1 });
    expect(verifyTransfer).toHaveBeenCalledWith(
      expect.objectContaining({ token: "WETH", txHash: H1, from: SAFE, to: WINNER, amount: 10n ** 16n, atLeast: true, preferLogIndex: 3, notBefore: new Date(DRAWN) }),
    );
    expect(calls("raffle_candidate_missing")).toEqual([{ p_raffle: "r1", p_tx_hash: H1, p_log_index: 3, p_missing: false }]);
    expect(calls("record_raffle_payout")).toEqual([
      {
        p_raffle: "r1",
        p_safe: SAFE,
        p_actor: null,
        p_payout: { txHash: H1, logIndex: 3, blockNumber: "140", blockTime: TS.toISOString(), to: WINNER, token: "WETH", amount: "10500000000000000" },
      },
    ]);
  });
  it.each(["tx_failed", "tx_mismatch", "tx_too_old"])("a permanent %s unlinks the candidate as failed", async (code) => {
    replies.raffle_payout_candidates = { data: [candidate("r1", H1)] };
    verifyTransfer.mockResolvedValue({ status: "error", code });
    expect(await detectRafflePayouts(59141)).toEqual({ recorded: 0 });
    expect(calls("unlink_raffle_candidate")).toEqual([{ p_raffle: "r1", p_tx_hash: H1, p_log_index: 3, p_reason: "failed" }]);
    expect(calls("record_raffle_payout")).toEqual([]);
  });
  it("pending and rpc_unavailable keep the candidate linked", async () => {
    replies.raffle_payout_candidates = { data: [candidate("r1", H1), candidate("r2", H2)] };
    verifyTransfer.mockResolvedValueOnce({ status: "pending" }).mockResolvedValueOnce({ status: "error", code: "rpc_unavailable" });
    expect(await detectRafflePayouts(59141)).toEqual({ recorded: 0 });
    expect(calls("unlink_raffle_candidate")).toEqual([]);
    expect(calls("raffle_candidate_missing")).toEqual([]);
  });
  it("tx_not_found marks first and unlinks only once the mark is 30 minutes old", async () => {
    replies.raffle_payout_candidates = { data: [candidate("r1", H1)] };
    verifyTransfer.mockResolvedValue({ status: "error", code: "tx_not_found" });
    replies.raffle_candidate_missing = { data: false };
    await detectRafflePayouts(59141);
    expect(calls("raffle_candidate_missing")).toEqual([{ p_raffle: "r1", p_tx_hash: H1, p_log_index: 3, p_missing: true }]);
    expect(calls("unlink_raffle_candidate")).toEqual([]);
    replies.raffle_candidate_missing = { data: true };
    await detectRafflePayouts(59141);
    expect(calls("unlink_raffle_candidate")).toEqual([{ p_raffle: "r1", p_tx_hash: H1, p_log_index: 3, p_reason: "not_found" }]);
  });
  it.each(["tx_mismatch", "tx_already_used", "tx_too_old"])("a record refused with %s unlinks the candidate", async (code) => {
    replies.raffle_payout_candidates = { data: [candidate("r1", H1)] };
    replies.record_raffle_payout = { error: { message: code } };
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await detectRafflePayouts(59141)).toEqual({ recorded: 0 });
    expect(calls("unlink_raffle_candidate")).toEqual([{ p_raffle: "r1", p_tx_hash: H1, p_log_index: 3, p_reason: "failed" }]);
    err.mockRestore();
  });
  it("transient record refusals (safe_changed, invalid_state, a deadlock) unlink nothing", async () => {
    replies.raffle_payout_candidates = { data: [candidate("r1", H1), candidate("r2", H2), candidate("r3", H2, { log_index: 4 })] };
    replies.record_raffle_payout = (a) => ({
      error: a.p_raffle === "r1" ? { message: "safe_changed" } : a.p_raffle === "r2" ? { message: "invalid_state" } : { message: "tx_mismatch", code: "40P01" },
    });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await detectRafflePayouts(59141)).toEqual({ recorded: 0 });
    expect(calls("unlink_raffle_candidate")).toEqual([]);
    err.mockRestore();
  });
  it("stops at the first recorded candidate of a raffle; skips rows with an unknown token", async () => {
    replies.raffle_payout_candidates = { data: [candidate("r1", H1), candidate("r1", H2), candidate("r2", H2, { token: "ETH" })] };
    replies.record_raffle_payout = { data: { status: "recorded" } };
    expect(await detectRafflePayouts(59141)).toEqual({ recorded: 1 });
    expect(calls("record_raffle_payout").map((c) => c.p_raffle)).toEqual(["r1"]);
  });
  it("does nothing without a Safe; throws when the candidates cannot be read", async () => {
    safe = null;
    expect(await detectRafflePayouts(59141)).toEqual({ recorded: 0 });
    expect(rpc).not.toHaveBeenCalled();
    safe = SAFE;
    replies.raffle_payout_candidates = { error: { message: "db down" } };
    await expect(detectRafflePayouts(59141)).rejects.toThrow(/db down/);
  });
});

const awaiting = (raffle: string, block: number, over: Record<string, unknown> = {}) => ({
  raffle_id: raffle, tx_hash: H1, token: "USDC", winner_address: WINNER, prize_amount: "5000000", drawn_at: DRAWN,
  payout_block: String(block), payout_log_index: 3, ...over,
});

describe("finalizeRafflePayouts", () => {
  it("at finality re-verifies the recorded log and calls finalize_raffle_payout", async () => {
    replies.raffles_awaiting_finality = { data: [awaiting("r1", 150, { token: "WETH", prize_amount: "10000000000000000" })] };
    replies.finalize_raffle_payout = { data: { status: "paid" } };
    expect(await finalizeRafflePayouts(59141)).toEqual({ paid: 1, reverted: 0, pending: 0 });
    expect(verifyTransfer).toHaveBeenCalledWith(expect.objectContaining({ token: "WETH", txHash: H1, amount: 10n ** 16n, preferLogIndex: 3, atLeast: true }));
    expect(calls("finalize_raffle_payout")).toEqual([{ p_raffle: "r1", p_safe: SAFE, p_finalized_block: "150" }]);
    expect(calls("raffle_payout_missing")).toEqual([{ p_raffle: "r1", p_missing: false }]);
  });
  it("a payout above the finalized block is not verified", async () => {
    replies.raffles_awaiting_finality = { data: [awaiting("r1", 151)] };
    expect(await finalizeRafflePayouts(59141)).toEqual({ paid: 0, reverted: 0, pending: 1 });
    expect(verifyTransfer).not.toHaveBeenCalled();
  });
  it.each(["tx_failed", "tx_mismatch"])("%s reverts the payout", async (code) => {
    replies.raffles_awaiting_finality = { data: [awaiting("r1", 140)] };
    verifyTransfer.mockResolvedValue({ status: "error", code });
    expect(await finalizeRafflePayouts(59141)).toEqual({ paid: 0, reverted: 1, pending: 0 });
    expect(calls("revert_raffle_payout")).toEqual([{ p_raffle: "r1" }]);
    expect(calls("finalize_raffle_payout")).toEqual([]);
  });
  it("tx_not_found reverts only once the payout's mark is 30 minutes old", async () => {
    replies.raffles_awaiting_finality = { data: [awaiting("r1", 140)] };
    verifyTransfer.mockResolvedValue({ status: "error", code: "tx_not_found" });
    replies.raffle_payout_missing = { data: false };
    expect(await finalizeRafflePayouts(59141)).toEqual({ paid: 0, reverted: 0, pending: 1 });
    expect(calls("raffle_payout_missing")).toEqual([{ p_raffle: "r1", p_missing: true }]);
    replies.raffle_payout_missing = { data: true };
    expect(await finalizeRafflePayouts(59141)).toEqual({ paid: 0, reverted: 1, pending: 0 });
  });
  it.each([{ status: "pending" }, { status: "error", code: "rpc_unavailable" }, { status: "error", code: "tx_too_old" }])(
    "anything else (%j) stays pending",
    async (res) => {
      replies.raffles_awaiting_finality = { data: [awaiting("r1", 140)] };
      verifyTransfer.mockResolvedValue(res);
      expect(await finalizeRafflePayouts(59141)).toEqual({ paid: 0, reverted: 0, pending: 1 });
      expect(calls("revert_raffle_payout")).toEqual([]);
    },
  );
  it("another log of the tx qualifying, or a receipt now past finality, burns nothing", async () => {
    replies.raffles_awaiting_finality = { data: [awaiting("r1", 140, { payout_log_index: 7 }), awaiting("r2", 140)] };
    verifyTransfer.mockResolvedValueOnce(ok({ logIndex: 3 })).mockResolvedValueOnce(ok({ blockNumber: 151n }));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await finalizeRafflePayouts(59141)).toEqual({ paid: 0, reverted: 0, pending: 2 });
    expect(calls("finalize_raffle_payout")).toEqual([]);
    expect(calls("revert_raffle_payout")).toEqual([]);
    err.mockRestore();
  });
  it("without a finalized block nothing is verified; with nothing awaiting no block is read", async () => {
    replies.raffles_awaiting_finality = { data: [awaiting("r1", 1)] };
    getBlock.mockRejectedValue(new Error("rpc down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await finalizeRafflePayouts(59141)).toEqual({ paid: 0, reverted: 0, pending: 1 });
    expect(verifyTransfer).not.toHaveBeenCalled();
    err.mockRestore();
    getBlock.mockClear();
    replies.raffles_awaiting_finality = { data: [] };
    expect(await finalizeRafflePayouts(59141)).toEqual({ paid: 0, reverted: 0, pending: 0 });
    expect(getBlock).not.toHaveBeenCalled();
  });
});

describe("notifyUnpaidRaffles / runRaffleSteps", () => {
  it("notifyUnpaidRaffles returns the count; throws on error", async () => {
    replies.notify_unpaid_raffles = { data: 2 };
    expect(await notifyUnpaidRaffles(59141)).toBe(2);
    expect(calls("notify_unpaid_raffles")).toEqual([{ p_chain: 59141 }]);
    replies.notify_unpaid_raffles = { error: { message: "db down" } };
    await expect(notifyUnpaidRaffles(59141)).rejects.toThrow(/db down/);
  });
  it("runs draw → detect → finalize → unpaid and merges the counts", async () => {
    replies.close_due_raffles = { data: { closed: 1, voided: 0 } };
    replies.raffles_awaiting_draw = { data: [] };
    replies.raffle_payout_candidates = { data: [] };
    replies.raffles_awaiting_finality = { data: [] };
    replies.notify_unpaid_raffles = { data: 1 };
    expect(await runRaffleSteps(59141)).toEqual({ closed: 1, voided: 0, drawn: 0, pending: 0, recorded: 0, paid: 0, reverted: 0, unpaidNotices: 1, awaitingFinality: 0, refusedDraws: [], failed: [] });
    const order = rpc.mock.calls.map((c) => c[0]);
    expect(order).toEqual(["close_due_raffles", "raffles_awaiting_draw", "raffle_payout_candidates", "raffles_awaiting_finality", "notify_unpaid_raffles"]);
  });
  it("reports the payouts still awaiting finality and the refused draws", async () => {
    replies.close_due_raffles = { data: { closed: 0, voided: 0 } };
    replies.raffles_awaiting_draw = { data: [{ raffle_id: "r9", closes_at: "1970-01-01T00:00:13+00:00" }] };
    replies.draw_raffle = { error: { message: "draw_block_invalid" } };
    replies.raffle_payout_candidates = { data: [] };
    // two recorded payouts: one past the finalized block (stays), one whose verification is pending
    replies.raffles_awaiting_finality = { data: [awaiting("r1", 999), awaiting("r2", 100)] };
    verifyTransfer.mockResolvedValue({ status: "pending" });
    replies.notify_unpaid_raffles = { data: 0 };
    getBlock.mockImplementation(chain([10, 10, 11, 13, 13, 20], 5));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const report = await runRaffleSteps(59141);
    expect(report).toMatchObject({ awaitingFinality: 2, paid: 0, refusedDraws: [{ raffleId: "r9", code: "draw_block_invalid" }] });
    err.mockRestore();
  });
  it("M3: a failing later step keeps the draw's refusals and the finality count", async () => {
    replies.close_due_raffles = { data: { closed: 0, voided: 0 } };
    replies.raffles_awaiting_draw = { data: [{ raffle_id: "r9", closes_at: "1970-01-01T00:00:13+00:00" }] };
    replies.draw_raffle = { error: { message: "draw_block_invalid" } };
    replies.raffle_payout_candidates = { error: { message: "db down" } };
    replies.raffles_awaiting_finality = { data: [awaiting("r1", 999)] };
    replies.notify_unpaid_raffles = { error: { message: "db down" } };
    getBlock.mockImplementation(chain([10, 10, 11, 13, 13, 20], 5));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await runRaffleSteps(59141)).toEqual({
      failed: ["detect", "unpaid"],
      closed: 0,
      voided: 0,
      drawn: 0,
      pending: 1,
      refusedDraws: [{ raffleId: "r9", code: "draw_block_invalid" }],
      paid: 0,
      reverted: 0,
      awaitingFinality: 1,
    });
    err.mockRestore();
  });
  it("a failing sub-step is named in the report but the others still run", async () => {
    replies.close_due_raffles = { error: { message: "db down" } };
    replies.raffle_payout_candidates = { data: [] };
    replies.raffles_awaiting_finality = { data: [] };
    replies.notify_unpaid_raffles = { data: 0 };
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    // M3: the report keeps what the other steps returned and names the failed one
    expect(await runRaffleSteps(59141)).toEqual({ failed: ["draw"], recorded: 0, paid: 0, reverted: 0, awaitingFinality: 0, unpaidNotices: 0 });
    expect(calls("raffle_payout_candidates")).toHaveLength(1);
    expect(calls("raffles_awaiting_finality")).toHaveLength(1);
    expect(calls("notify_unpaid_raffles")).toHaveLength(1);
    err.mockRestore();
  });
});
