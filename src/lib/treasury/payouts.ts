import "server-only";
import type { Address } from "viem";
import type { ChainId } from "@/lib/economy/networks";
import { rpcErrorCode } from "@/lib/errors";
import { chainClient } from "@/lib/payments/chain-client";
import { verifyTransfer, type VerifyResult } from "@/lib/payments/verify";
import { createAdminClient } from "@/lib/supabase/admin";
import { safeAddressOf } from "@/lib/treasury/snapshot";

/** What an approved withdrawal's payout must be: USDC from the chain's Safe to the destination, at least the fixed amount. */
export type PayoutTarget = { chain: ChainId; safe: Address; destination: string; amountLocked: bigint; approvedAt: Date };

type Db = ReturnType<typeof createAdminClient>;
type Ok = Extract<VerifyResult, { status: "ok" }>;

/** Verification errors that mean a linked outflow is not (any more) a payment to that request. */
const CANDIDATE_PERMANENT = new Set(["tx_failed", "tx_mismatch", "tx_too_old"]);
/** record_withdrawal_payout refusals that will never change for that transfer and request. */
const RECORD_PERMANENT = new Set(["tx_mismatch", "tx_already_used", "tx_too_old"]);
/** At finality only these revert (plan): the payout as recorded no longer exists. */
const FINAL_PERMANENT = new Set(["tx_failed", "tx_mismatch"]);

/**
 * Verifies a withdrawal payout with the donation rules (receipt success, official USDC Transfer log, from the Safe, to the
 * destination, TIP_CONFIRMATIONS, not mined before approved_at − 120 s), except that the log may pay more than the
 * fixed amount (`atLeast`). The upper bound of the window (approved_at + 14 days) is enforced by SQL. With
 * `preferLogIndex` (a linked candidate's log), that log wins when it qualifies, so the recorded log is the linked one.
 */
export function verifyPayout(t: PayoutTarget, txHash: `0x${string}`, preferLogIndex?: number): Promise<VerifyResult> {
  return verifyTransfer({
    chain: t.chain,
    token: "USDC",
    txHash,
    from: t.safe,
    to: t.destination,
    amount: t.amountLocked,
    atLeast: true,
    notBefore: t.approvedAt,
    ...(preferLogIndex === undefined ? {} : { preferLogIndex }),
  });
}

/** The p_payout object record_withdrawal_payout expects, from a verified transfer. */
export function payoutPayload(r: Ok, txHash: string, destination: string) {
  return {
    txHash,
    logIndex: r.logIndex,
    blockNumber: r.blockNumber.toString(),
    blockTime: r.blockTimestamp.toISOString(),
    to: destination,
    amount: r.value.toString(),
  };
}

type CandidateRow = {
  request_id: string;
  tx_hash: string;
  log_index: number;
  destination: string;
  amount_usdc_locked: string;
  approved_at: string;
};

async function unlink(db: Db, c: CandidateRow, reason: "failed" | "not_found"): Promise<void> {
  const { error } = await db.rpc("unlink_withdrawal_candidate", {
    p_request: c.request_id,
    p_tx_hash: c.tx_hash,
    p_log_index: c.log_index,
    p_reason: reason,
  });
  if (error) console.error("[treasury] unlink_withdrawal_candidate failed", c.request_id, error.message);
}

/**
 * The candidate's not-found mark (as donation_missing): `missing` sets it on the first not-found and answers whether it
 * is at least 30 minutes old; `!missing` (an ok verification) clears it. False on an RPC error (nothing is unlinked).
 */
async function candidateMissing(db: Db, c: CandidateRow, missing: boolean): Promise<boolean> {
  const { data, error } = await db.rpc("withdrawal_candidate_missing", {
    p_request: c.request_id,
    p_tx_hash: c.tx_hash,
    p_log_index: c.log_index,
    p_missing: missing,
  });
  if (error) {
    console.error("[treasury] withdrawal_candidate_missing failed", c.request_id, error.message);
    return false;
  }
  return data === true;
}

/**
 * Cron step 1 per chain: the scan linked these Safe outflows to approved, unpaid requests. Each is verified on chain
 * (preferring its own log) and recorded with a null actor (no longer a liability from its block on). A candidate that
 * fails for good (or the record refuses for good) is unlinked, which alerts the treasurers once and lets the request be
 * rejected or expire. A not-found only unlinks once it persisted 30 minutes from its first mark; an ok verification
 * clears the mark. A pending or unreachable verification leaves it for the next run. Read errors throw.
 */
export async function detectWithdrawalPayouts(chain: ChainId): Promise<{ recorded: number }> {
  const db = createAdminClient();
  const safe = await safeAddressOf(db, chain);
  if (!safe) return { recorded: 0 };
  const { data, error } = await db.rpc("withdrawal_payout_candidates", { p_chain: chain });
  if (error) throw new Error(`withdrawal_payout_candidates failed: ${error.message}`);

  let recorded = 0;
  const done = new Set<string>();
  for (const c of (data ?? []) as CandidateRow[]) {
    if (done.has(c.request_id)) continue;
    try {
      const target: PayoutTarget = {
        chain,
        safe,
        destination: c.destination,
        amountLocked: BigInt(c.amount_usdc_locked),
        approvedAt: new Date(c.approved_at),
      };
      const r = await verifyPayout(target, c.tx_hash as `0x${string}`, c.log_index);
      if (r.status === "pending") continue;
      if (r.status === "error") {
        if (CANDIDATE_PERMANENT.has(r.code)) await unlink(db, c, "failed");
        else if (r.code === "tx_not_found" && (await candidateMissing(db, c, true))) await unlink(db, c, "not_found");
        continue;
      }
      await candidateMissing(db, c, false);
      const { data: res, error: recError } = await db.rpc("record_withdrawal_payout", {
        p_request: c.request_id,
        p_safe: safe,
        p_payout: payoutPayload(r, c.tx_hash, c.destination),
        p_actor: null,
      });
      if (recError) {
        console.error("[treasury] record_withdrawal_payout failed", c.request_id, recError.message);
        if (RECORD_PERMANENT.has(rpcErrorCode(recError))) await unlink(db, c, "failed");
        continue;
      }
      done.add(c.request_id);
      if ((res as { status?: unknown } | null)?.status === "recorded") recorded++;
    } catch (e) {
      console.error("[treasury] payout detection failed", c.request_id, e);
    }
  }
  return { recorded };
}

type AwaitingRow = {
  request_id: string;
  tx_hash: string;
  destination: string;
  amount_usdc_locked: string;
  approved_at: string;
  payout_block: string;
  payout_recorded_at: string;
};

/**
 * Cron step 2 per chain: recorded payouts at or below the finalized block are re-verified and burned
 * (finalize_withdrawal). tx_failed / tx_mismatch revert the payout (the request is approved again, its amount a
 * liability again); tx_not_found reverts only once it persisted 30 minutes from its first mark
 * (withdrawal_payout_missing), and any ok verification clears the mark. Anything else, and every row while the
 * finalized block is unknown, stays pending.
 */
export async function finalizeWithdrawalPayouts(chain: ChainId): Promise<{ paid: number; reverted: number; pending: number }> {
  const result = { paid: 0, reverted: 0, pending: 0 };
  const db = createAdminClient();
  const safe = await safeAddressOf(db, chain);
  if (!safe) return result;
  const { data, error } = await db.rpc("withdrawals_awaiting_finality", { p_chain: chain });
  if (error) throw new Error(`withdrawals_awaiting_finality failed: ${error.message}`);
  const rows = (data ?? []) as AwaitingRow[];
  if (rows.length === 0) return result;

  let fin: bigint | null = null;
  try {
    const block = await chainClient(chain).getBlock({ blockTag: "finalized" });
    fin = block.number;
  } catch (e) {
    console.error("[treasury] finalized block unavailable", chain, e);
  }

  for (const row of rows) {
    let outcome: keyof typeof result = "pending";
    try {
      if (fin !== null && fin !== undefined && BigInt(row.payout_block) <= fin) outcome = await finalizeRow(db, chain, safe, row, fin);
    } catch (e) {
      console.error("[treasury] payout finalization failed", row.request_id, e);
    }
    result[outcome]++;
  }
  return result;
}

async function payoutMissing(db: Db, request: string, missing: boolean): Promise<boolean> {
  const { data, error } = await db.rpc("withdrawal_payout_missing", { p_request: request, p_missing: missing });
  if (error) {
    console.error("[treasury] withdrawal_payout_missing failed", request, error.message);
    return false;
  }
  return data === true;
}

async function finalizeRow(db: Db, chain: ChainId, safe: Address, row: AwaitingRow, fin: bigint): Promise<"paid" | "reverted" | "pending"> {
  const target: PayoutTarget = {
    chain,
    safe,
    destination: row.destination,
    amountLocked: BigInt(row.amount_usdc_locked),
    approvedAt: new Date(row.approved_at),
  };
  const r = await verifyPayout(target, row.tx_hash as `0x${string}`);

  const revert = async (): Promise<"reverted" | "pending"> => {
    const { error } = await db.rpc("revert_withdrawal_payout", { p_request: row.request_id });
    if (error) {
      console.error("[treasury] revert_withdrawal_payout failed", row.request_id, error.message);
      return "pending";
    }
    return "reverted";
  };

  if (r.status === "error") {
    if (FINAL_PERMANENT.has(r.code)) return revert();
    // a lagging node must not revert a real payout: only a not-found persisting 30 min from its first mark
    if (r.code === "tx_not_found" && (await payoutMissing(db, row.request_id, true))) return revert();
    return "pending";
  }
  if (r.status !== "ok") return "pending";
  await payoutMissing(db, row.request_id, false);
  // Finality is judged on the receipt's current block (a reorged-and-remined tx still verifies by hash).
  if (r.blockNumber > fin) return "pending";

  const { data, error } = await db.rpc("finalize_withdrawal", {
    p_request: row.request_id,
    p_safe: safe,
    p_finalized_block: fin.toString(),
  });
  if (error) {
    console.error("[treasury] finalize_withdrawal failed", row.request_id, error.message);
    return "pending";
  }
  const status = (data as { status?: unknown } | null)?.status;
  return status === "paid" || status === "already" ? "paid" : "pending";
}

/**
 * Ruling F4c-R5: the block time of the scan cursor (dao_scan_state.last_block), i.e. how far the Safe's outflows have
 * been linked. Null without a cursor or when it cannot be read: that chain's approvals do not expire this run.
 */
export async function scanCursorTime(chain: ChainId): Promise<Date | null> {
  try {
    const { data, error } = await createAdminClient().rpc("dao_scan_from", { p_chain: chain });
    if (error) {
      console.error("[treasury] dao_scan_from failed", chain, error.message);
      return null;
    }
    if (data === null || data === undefined || !/^\d+$/.test(String(data))) return null;
    const block = await chainClient(chain).getBlock({ blockNumber: BigInt(String(data)) });
    return new Date(Number(block.timestamp) * 1000);
  } catch (e) {
    console.error("[treasury] scan cursor block unavailable", chain, e);
    return null;
  }
}

/**
 * Cron step after every chain's detection (Review Focus 4): the chain's lapsed approvals go back to pending, but only
 * those whose whole payout window (+120 s) the scan has covered (`scannedThrough`, ruling F4c-R5).
 */
export async function expireWithdrawalApprovals(chain: ChainId, scannedThrough: Date): Promise<number> {
  const { data, error } = await createAdminClient().rpc("expire_withdrawal_approvals", {
    p_chain: chain,
    p_scanned_through: scannedThrough.toISOString(),
  });
  if (error) throw new Error(`expire_withdrawal_approvals failed: ${error.message}`);
  return Number(data ?? 0);
}
