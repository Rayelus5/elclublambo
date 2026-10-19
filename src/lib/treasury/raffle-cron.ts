import "server-only";
import type { Address, Hex, PublicClient } from "viem";
import type { ChainId } from "@/lib/economy/networks";
import { rpcErrorCode } from "@/lib/errors";
import { chainClient } from "@/lib/payments/chain-client";
import { verifyTransfer, type VerifyResult } from "@/lib/payments/verify";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PrizeToken } from "@/lib/treasury/raffles";
import { safeAddressOf } from "@/lib/treasury/snapshot";

/** What a drawn raffle's payout must be: the prize token from the chain's Safe to the winner, at least the prize. */
export type PrizeTarget = { chain: ChainId; safe: Address; token: PrizeToken; winner: string; prize: bigint; drawnAt: Date };

/** A draw that did not happen this run: draw_raffle's refusal code, "retry" (a transient database error) or "draw_failed" (a thrown error). */
export type RefusedDraw = { raffleId: string; code: string };

export type RaffleReport =
  | {
      closed: number;
      voided: number;
      drawn: number;
      pending: number;
      recorded: number;
      paid: number;
      reverted: number;
      unpaidNotices: number;
      /** Recorded prize payouts still awaiting finality after this run's finalize step. */
      awaitingFinality: number;
      refusedDraws: RefusedDraw[];
    }
  | "failed";

type Db = ReturnType<typeof createAdminClient>;
type Ok = Extract<VerifyResult, { status: "ok" }>;

/** Verification errors that mean a linked outflow is not (any more) a payment of that prize (as for withdrawals). */
const CANDIDATE_PERMANENT = new Set(["tx_failed", "tx_mismatch", "tx_too_old"]);
/** record_raffle_payout refusals that will never change for that transfer and raffle. */
const RECORD_PERMANENT = new Set(["tx_mismatch", "tx_already_used", "tx_too_old"]);
/** At finality only these revert: the payout as recorded no longer exists. */
const FINAL_PERMANENT = new Set(["tx_failed", "tx_mismatch"]);

const isPrizeToken = (v: unknown): v is PrizeToken => v === "USDC" || v === "WETH";

/**
 * Verifies a prize payout with the withdrawal rules: receipt success, a Transfer log of the official prize token
 * contract (USDC, or WETH from addressesFor), from the Safe, to the winner, paying at least the prize (`atLeast`),
 * TIP_CONFIRMATIONS, not mined before drawn_at − 120 s. No upper bound: a late payment is still a payment. With
 * `preferLogIndex` (a linked candidate's or the recorded log), that log wins when it qualifies.
 */
export function verifyPrizePayout(t: PrizeTarget, txHash: `0x${string}`, preferLogIndex?: number): Promise<VerifyResult> {
  return verifyTransfer({
    chain: t.chain,
    token: t.token,
    txHash,
    from: t.safe,
    to: t.winner,
    amount: t.prize,
    atLeast: true,
    notBefore: t.drawnAt,
    ...(preferLogIndex === undefined ? {} : { preferLogIndex }),
  });
}

/** The p_payout object record_raffle_payout expects, from a verified transfer (blockTime must be ISO 8601). */
export function prizePayload(r: Ok, txHash: string, winner: string, token: PrizeToken) {
  return {
    txHash,
    logIndex: r.logIndex,
    blockNumber: r.blockNumber.toString(),
    blockTime: r.blockTimestamp.toISOString(),
    to: winner,
    token,
    amount: r.value.toString(),
  };
}

export type DrawBlock = { number: bigint; hash: Hex; timestamp: bigint; parentTimestamp: bigint };

/**
 * The draw block of a raffle closing at `at`: the first block whose timestamp is past `at` and whose parent's is not,
 * searched (binary search, about log2(finalized) + 2 block reads) among the blocks up to `finalized`. Null when
 * `finalized` itself is not past `at` (the draw block is not final yet), or when even block 0 is past it. Times
 * compare in milliseconds against `at` (block timestamps are whole seconds), exactly as SQL compares them with the
 * raffle's closes_at. RPC errors propagate.
 */
export async function firstBlockAfter(
  client: Pick<PublicClient, "getBlock">,
  at: Date,
  finalized: bigint,
): Promise<DrawBlock | null> {
  const atMs = BigInt(at.getTime());
  const seen = new Map<bigint, { hash: Hex; timestamp: bigint }>();
  const read = async (n: bigint) => {
    let b = seen.get(n);
    if (!b) {
      const block = await client.getBlock({ blockNumber: n });
      b = { hash: block.hash as Hex, timestamp: block.timestamp };
      seen.set(n, b);
    }
    return b;
  };
  const after = (ts: bigint) => ts * 1000n > atMs;

  if (finalized < 1n || !after((await read(finalized)).timestamp)) return null;
  if (after((await read(0n)).timestamp)) return null;
  // invariant: block lo is not past `at`, block hi is
  let lo = 0n;
  let hi = finalized;
  while (hi - lo > 1n) {
    const mid = (lo + hi) / 2n;
    if (after((await read(mid)).timestamp)) hi = mid;
    else lo = mid;
  }
  const b = await read(hi);
  const parent = await read(lo);
  return { number: hi, hash: b.hash, timestamp: b.timestamp, parentTimestamp: parent.timestamp };
}

const iso = (seconds: bigint) => new Date(Number(seconds) * 1000).toISOString();

async function finalizedBlock(chain: ChainId): Promise<bigint | null> {
  try {
    const block = await chainClient(chain).getBlock({ blockTag: "finalized" });
    return block.number ?? null;
  } catch (e) {
    console.error("[treasury] finalized block unavailable", chain, e);
    return null;
  }
}

/**
 * Cron step per chain: close_due_raffles snapshots the weights of every raffle past its close (or voids it when nobody
 * can win), then each closed raffle is drawn with the first block after its close, once that block is finalized (the
 * seed is revealed only then). A missing finalized block, a draw block not yet final, a refused draw or any error
 * leaves the raffle pending for the next run. Every draw error is reported per raffle (`refused`); a refusal by
 * draw_raffle is also stored for the treasurer's «Avisos» (record_raffle_draw_refusal keeps one per raffle and code),
 * while a transient database error ("retry") or a thrown error ("draw_failed": chain read, bad data) is only reported.
 * The close and the list throw (the step is reported as failed).
 */
export async function drawDueRaffles(
  chain: ChainId,
): Promise<{ closed: number; voided: number; drawn: number; pending: number; refused: RefusedDraw[] }> {
  const db = createAdminClient();
  const { data: closedData, error: closeError } = await db.rpc("close_due_raffles", { p_chain: chain });
  if (closeError) throw new Error(`close_due_raffles failed: ${closeError.message}`);
  const c = (closedData ?? {}) as { closed?: unknown; voided?: unknown };
  const result = {
    closed: Number(c.closed ?? 0) || 0,
    voided: Number(c.voided ?? 0) || 0,
    drawn: 0,
    pending: 0,
    refused: [] as RefusedDraw[],
  };

  const { data, error } = await db.rpc("raffles_awaiting_draw", { p_chain: chain });
  if (error) throw new Error(`raffles_awaiting_draw failed: ${error.message}`);
  const rows = (data ?? []) as { raffle_id: string; closes_at: string }[];
  if (rows.length === 0) return result;

  const fin = await finalizedBlock(chain);
  if (fin === null) {
    result.pending += rows.length;
    return result;
  }
  const client = chainClient(chain);
  for (const row of rows) {
    try {
      const closesAt = new Date(row.closes_at);
      if (Number.isNaN(closesAt.getTime())) throw new Error(`bad closes_at ${row.closes_at}`);
      const b = await firstBlockAfter(client, closesAt, fin);
      if (!b) {
        result.pending++;
        continue;
      }
      const { data: res, error: drawError } = await db.rpc("draw_raffle", {
        p_raffle: row.raffle_id,
        p_block: { number: b.number.toString(), hash: b.hash, timestamp: iso(b.timestamp), parentTimestamp: iso(b.parentTimestamp) },
      });
      if (drawError) {
        console.error("[treasury] draw_raffle failed", row.raffle_id, drawError.message);
        const code = rpcErrorCode(drawError);
        result.refused.push({ raffleId: row.raffle_id, code });
        if (code !== "retry") await recordRefusal(db, row.raffle_id, code);
        result.pending++;
        continue;
      }
      if ((res as { status?: unknown } | null)?.status === "drawn") result.drawn++;
    } catch (e) {
      console.error("[treasury] raffle draw failed", row.raffle_id, e);
      result.refused.push({ raffleId: row.raffle_id, code: "draw_failed" });
      result.pending++;
    }
  }
  return result;
}

/** Stores a refused draw for the treasurer's «Avisos»; a failure is logged (the cron report still lists it). */
async function recordRefusal(db: Db, raffle: string, code: string): Promise<void> {
  const { error } = await db.rpc("record_raffle_draw_refusal", { p_raffle: raffle, p_code: code });
  if (error) console.error("[treasury] record_raffle_draw_refusal failed", raffle, error.message);
}

type CandidateRow = {
  raffle_id: string;
  tx_hash: string;
  log_index: number;
  token: string;
  winner_address: string;
  prize_amount: string;
  drawn_at: string;
};

async function unlink(db: Db, c: CandidateRow, reason: "failed" | "not_found"): Promise<void> {
  const { error } = await db.rpc("unlink_raffle_candidate", {
    p_raffle: c.raffle_id,
    p_tx_hash: c.tx_hash,
    p_log_index: c.log_index,
    p_reason: reason,
  });
  if (error) console.error("[treasury] unlink_raffle_candidate failed", c.raffle_id, error.message);
}

/** The candidate's not-found mark: `missing` sets it and answers whether it is 30 minutes old; `!missing` clears it. */
async function candidateMissing(db: Db, c: CandidateRow, missing: boolean): Promise<boolean> {
  const { data, error } = await db.rpc("raffle_candidate_missing", {
    p_raffle: c.raffle_id,
    p_tx_hash: c.tx_hash,
    p_log_index: c.log_index,
    p_missing: missing,
  });
  if (error) {
    console.error("[treasury] raffle_candidate_missing failed", c.raffle_id, error.message);
    return false;
  }
  return data === true;
}

/**
 * Cron step per chain (as detectWithdrawalPayouts): the scan linked these Safe outflows to drawn raffles without a
 * payout. Each is verified (preferring its own log) and recorded with a null actor (no longer a liability from its
 * block on). A permanent failure, or a permanent record refusal, unlinks the candidate (one alert, unless the other
 * kind recorded that outflow: 20261019400005 re-links it); a not-found only once its first mark is 30 minutes old; an
 * ok verification clears the mark. A pending or unreachable verification waits for the next run. Read errors throw.
 */
export async function detectRafflePayouts(chain: ChainId): Promise<{ recorded: number }> {
  const db = createAdminClient();
  const safe = await safeAddressOf(db, chain);
  if (!safe) return { recorded: 0 };
  const { data, error } = await db.rpc("raffle_payout_candidates", { p_chain: chain });
  if (error) throw new Error(`raffle_payout_candidates failed: ${error.message}`);

  let recorded = 0;
  const done = new Set<string>();
  for (const c of (data ?? []) as CandidateRow[]) {
    if (done.has(c.raffle_id) || !isPrizeToken(c.token)) continue;
    try {
      const target: PrizeTarget = {
        chain,
        safe,
        token: c.token,
        winner: c.winner_address,
        prize: BigInt(c.prize_amount),
        drawnAt: new Date(c.drawn_at),
      };
      const r = await verifyPrizePayout(target, c.tx_hash as `0x${string}`, c.log_index);
      if (r.status === "pending") continue;
      if (r.status === "error") {
        if (CANDIDATE_PERMANENT.has(r.code)) await unlink(db, c, "failed");
        else if (r.code === "tx_not_found" && (await candidateMissing(db, c, true))) await unlink(db, c, "not_found");
        continue;
      }
      await candidateMissing(db, c, false);
      const { data: res, error: recError } = await db.rpc("record_raffle_payout", {
        p_raffle: c.raffle_id,
        p_safe: safe,
        p_payout: prizePayload(r, c.tx_hash, c.winner_address, c.token),
        p_actor: null,
      });
      if (recError) {
        console.error("[treasury] record_raffle_payout failed", c.raffle_id, recError.message);
        if (RECORD_PERMANENT.has(rpcErrorCode(recError))) await unlink(db, c, "failed");
        continue;
      }
      done.add(c.raffle_id);
      if ((res as { status?: unknown } | null)?.status === "recorded") recorded++;
    } catch (e) {
      console.error("[treasury] prize payout detection failed", c.raffle_id, e);
    }
  }
  return { recorded };
}

type AwaitingRow = {
  raffle_id: string;
  tx_hash: string;
  token: string;
  winner_address: string;
  prize_amount: string;
  drawn_at: string;
  payout_block: string;
  /** The recorded payout log: finality re-verifies that log (as withdrawals since 20261019300007). */
  payout_log_index: number;
};

async function payoutMissing(db: Db, raffle: string, missing: boolean): Promise<boolean> {
  const { data, error } = await db.rpc("raffle_payout_missing", { p_raffle: raffle, p_missing: missing });
  if (error) {
    console.error("[treasury] raffle_payout_missing failed", raffle, error.message);
    return false;
  }
  return data === true;
}

/**
 * Cron step per chain (as finalizeWithdrawalPayouts): recorded prize payouts at or below the finalized block are
 * re-verified (the recorded log) and the raffle is marked paid (finalize_raffle_payout). tx_failed / tx_mismatch
 * revert the payout (the prize is owed again); tx_not_found reverts only once it persisted 30 minutes from its first
 * mark, and an ok verification clears the mark. Anything else, and every row while the finalized block is unknown,
 * stays pending: a lagging RPC never reverts a real payout.
 */
export async function finalizeRafflePayouts(chain: ChainId): Promise<{ paid: number; reverted: number; pending: number }> {
  const result = { paid: 0, reverted: 0, pending: 0 };
  const db = createAdminClient();
  const safe = await safeAddressOf(db, chain);
  if (!safe) return result;
  const { data, error } = await db.rpc("raffles_awaiting_finality", { p_chain: chain });
  if (error) throw new Error(`raffles_awaiting_finality failed: ${error.message}`);
  const rows = (data ?? []) as AwaitingRow[];
  if (rows.length === 0) return result;

  const fin = await finalizedBlock(chain);
  for (const row of rows) {
    let outcome: keyof typeof result = "pending";
    try {
      if (fin !== null && isPrizeToken(row.token) && BigInt(row.payout_block) <= fin) outcome = await finalizeRow(db, chain, safe, row, fin);
    } catch (e) {
      console.error("[treasury] prize payout finalization failed", row.raffle_id, e);
    }
    result[outcome]++;
  }
  return result;
}

async function finalizeRow(db: Db, chain: ChainId, safe: Address, row: AwaitingRow, fin: bigint): Promise<"paid" | "reverted" | "pending"> {
  const target: PrizeTarget = {
    chain,
    safe,
    token: row.token as PrizeToken,
    winner: row.winner_address,
    prize: BigInt(row.prize_amount),
    drawnAt: new Date(row.drawn_at),
  };
  const r = await verifyPrizePayout(target, row.tx_hash as `0x${string}`, row.payout_log_index);

  const revert = async (): Promise<"reverted" | "pending"> => {
    const { error } = await db.rpc("revert_raffle_payout", { p_raffle: row.raffle_id });
    if (error) {
      console.error("[treasury] revert_raffle_payout failed", row.raffle_id, error.message);
      return "pending";
    }
    return "reverted";
  };

  if (r.status === "error") {
    if (FINAL_PERMANENT.has(r.code)) return revert();
    if (r.code === "tx_not_found" && (await payoutMissing(db, row.raffle_id, true))) return revert();
    return "pending";
  }
  if (r.status !== "ok") return "pending";
  await payoutMissing(db, row.raffle_id, false);
  // only the recorded log pays; another qualifying log of the same tx is left to a human (no automatic revert)
  if (r.logIndex !== row.payout_log_index) {
    console.error("[treasury] prize payout log changed at finality", row.raffle_id, row.payout_log_index, r.logIndex);
    return "pending";
  }
  // finality is judged on the receipt's current block (a reorged-and-remined tx still verifies by hash)
  if (r.blockNumber > fin) return "pending";

  const { data, error } = await db.rpc("finalize_raffle_payout", {
    p_raffle: row.raffle_id,
    p_safe: safe,
    p_finalized_block: fin.toString(),
  });
  if (error) {
    console.error("[treasury] finalize_raffle_payout failed", row.raffle_id, error.message);
    return "pending";
  }
  const status = (data as { status?: unknown } | null)?.status;
  return status === "paid" || status === "already" ? "paid" : "pending";
}

/** Cron step per chain: treasury_notice raffle_unpaid, once per raffle drawn 14+ days ago without a payout. */
export async function notifyUnpaidRaffles(chain: ChainId): Promise<number> {
  const { data, error } = await createAdminClient().rpc("notify_unpaid_raffles", { p_chain: chain });
  if (error) throw new Error(`notify_unpaid_raffles failed: ${error.message}`);
  return Number(data ?? 0) || 0;
}

/**
 * The cron's raffle steps for one chain: draw (close + draw) → detect payouts → finalize payouts → unpaid notices. Each
 * is isolated (one failing never skips the others); any failure makes the whole report "failed", like `payouts`.
 */
export async function runRaffleSteps(chain: ChainId): Promise<RaffleReport> {
  const step = <T>(name: string, run: () => Promise<T>) =>
    run().catch((e: unknown) => {
      console.error(`[treasury] raffle ${name} failed`, chain, e);
      return null;
    });
  const draw = await step("draw", () => drawDueRaffles(chain));
  const detected = await step("payout detection", () => detectRafflePayouts(chain));
  const finalized = await step("payout finalization", () => finalizeRafflePayouts(chain));
  const unpaid = await step("unpaid notices", () => notifyUnpaidRaffles(chain));
  if (!draw || !detected || !finalized || unpaid === null) return "failed";
  const { refused, ...counts } = draw;
  return {
    ...counts,
    ...detected,
    paid: finalized.paid,
    reverted: finalized.reverted,
    unpaidNotices: unpaid,
    awaitingFinality: finalized.pending,
    refusedDraws: refused,
  };
}
