import "server-only";
import type { Address } from "viem";
import type { ChainId } from "@/lib/economy/networks";
import { chainClient } from "@/lib/payments/chain-client";
import { verifyTransfer, type VerifyResult } from "@/lib/payments/verify";
import { createAdminClient } from "@/lib/supabase/admin";
import { safeAddressOf } from "@/lib/treasury/snapshot";

/** What an approved withdrawal's payout must be: USDC from the chain's Safe to the destination, at least the fixed amount. */
export type PayoutTarget = { chain: ChainId; safe: Address; destination: string; amountLocked: bigint; approvedAt: Date };

type Db = ReturnType<typeof createAdminClient>;
type Ok = Extract<VerifyResult, { status: "ok" }>;

/** A not-found payout is only believed after it persisted this long (a lagging RPC node must not revert a real payment). */
const NOT_FOUND_GRACE_MS = 30 * 60_000;
/** Verification errors that mean a linked outflow is not (any more) a payment to that request. */
const CANDIDATE_PERMANENT = new Set(["tx_failed", "tx_mismatch", "tx_too_old"]);
/** record_withdrawal_payout refusals that will never change for that transfer and request. */
const RECORD_PERMANENT = new Set(["tx_mismatch", "tx_already_used", "tx_too_old"]);
/** At finality only these revert (plan): the payout as recorded no longer exists. */
const FINAL_PERMANENT = new Set(["tx_failed", "tx_mismatch"]);

/**
 * Verifies a withdrawal payout with the donation rules (receipt success, official USDC Transfer log, from the Safe, to the
 * destination, TIP_CONFIRMATIONS, not mined before approved_at − 120 s), except that the log may pay more than the
 * fixed amount (`atLeast`). The upper bound of the window (approved_at + 14 days) is enforced by SQL.
 */
export function verifyPayout(t: PayoutTarget, txHash: `0x${string}`): Promise<VerifyResult> {
  return verifyTransfer({
    chain: t.chain,
    token: "USDC",
    txHash,
    from: t.safe,
    to: t.destination,
    amount: t.amountLocked,
    atLeast: true,
    notBefore: t.approvedAt,
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
 * Cron step 1 per chain: the scan linked these Safe outflows to approved, unpaid requests. Each is verified on chain
 * and recorded with a null actor (no longer a liability from its block on). A candidate that fails for good (or the
 * record refuses for good) is unlinked, which alerts the treasurers once and lets the request be rejected or expire;
 * a pending or unreachable verification leaves it for the next run. Read errors throw (the cron reports "failed").
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
      const r = await verifyPayout(target, c.tx_hash as `0x${string}`);
      if (r.status === "pending") continue;
      if (r.status === "error") {
        if (CANDIDATE_PERMANENT.has(r.code)) await unlink(db, c, "failed");
        else if (r.code === "tx_not_found") await unlink(db, c, "not_found"); // SQL waits 30 min after the scan
        continue;
      }
      const { data: res, error: recError } = await db.rpc("record_withdrawal_payout", {
        p_request: c.request_id,
        p_safe: safe,
        p_payout: payoutPayload(r, c.tx_hash, c.destination),
        p_actor: null,
      });
      if (recError) {
        console.error("[treasury] record_withdrawal_payout failed", c.request_id, recError.message);
        if (RECORD_PERMANENT.has(recError.message)) await unlink(db, c, "failed");
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
 * liability again); tx_not_found reverts only once the payout was recorded more than 30 minutes ago. Anything else,
 * and every row while the finalized block is unknown, stays pending.
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
    if (r.code === "tx_not_found" && Date.now() - new Date(row.payout_recorded_at).getTime() > NOT_FOUND_GRACE_MS) return revert();
    return "pending";
  }
  if (r.status !== "ok") return "pending";
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

/** Global cron step after every chain's detection (Review Focus 4): lapsed approvals go back to pending. */
export async function expireWithdrawalApprovals(): Promise<number> {
  const { data, error } = await createAdminClient().rpc("expire_withdrawal_approvals");
  if (error) throw new Error(`expire_withdrawal_approvals failed: ${error.message}`);
  return Number(data ?? 0);
}
