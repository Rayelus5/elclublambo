import "server-only";
import { isChainId, type ChainId } from "@/lib/economy/networks";
import { chainClient } from "@/lib/payments/chain-client";
import { verifyTransfer, type VerifyResult } from "@/lib/payments/verify";
import { createAdminClient } from "@/lib/supabase/admin";

export type SettleResult = { credited: number; reverted: number; pending: number };
export type SettleOptions = { memberId?: string; ledgerId?: string; limit?: number };

const MAX_PER_CALL = 20;
/** Errors that mean the payment no longer exists as claimed. tx_not_found is only reachable once the row is final. */
const PERMANENT = new Set(["tx_failed", "tx_mismatch", "tx_not_found"]);

type LedgerRow = { id: string; chain_id: number; intent_id: string; block_number: string };
type IntentRow = {
  chain_id: number;
  member_id: string;
  amount: string;
  fee_amount: string;
  recipient_address: string;
  platform_address: string | null;
  main_tx_hash: string | null;
  fee_tx_hash: string | null;
  created_at: string;
};

type Outcome = "credited" | "reverted" | "pending";
type Ok = Extract<VerifyResult, { status: "ok" }>;

/**
 * Settles `pending_finality` donations (phase 2): once the chain's finalized block is at or past the donation's block,
 * the payment is re-verified and credited, or reverted when it permanently no longer verifies. Transient and RPC errors
 * leave the rows untouched. At most 20 rows per call (cap), oldest first.
 */
export async function settlePendingDonations(chain?: ChainId, opts: SettleOptions = {}): Promise<SettleResult> {
  const result: SettleResult = { credited: 0, reverted: 0, pending: 0 };
  const db = createAdminClient();
  const limit = Math.max(1, Math.min(MAX_PER_CALL, Math.floor(opts.limit ?? MAX_PER_CALL)));

  let q = db
    .from("dao_ledger")
    .select("id, chain_id, intent_id, block_number:block_number::text")
    .eq("status", "pending_finality");
  if (chain !== undefined) q = q.eq("chain_id", chain);
  if (opts.memberId) q = q.eq("member_id", opts.memberId);
  if (opts.ledgerId) q = q.eq("id", opts.ledgerId);
  const { data, error } = await q.order("created_at", { ascending: true }).limit(limit);
  if (error) {
    console.error("[treasury] settle query failed", error.message);
    return result;
  }
  const rows = ((data ?? []) as unknown as LedgerRow[]).filter((r) => isChainId(r.chain_id));

  const finalized = new Map<number, bigint | null>();
  const finalizedOf = async (id: ChainId): Promise<bigint | null> => {
    if (!finalized.has(id)) {
      try {
        const block = await chainClient(id).getBlock({ blockTag: "finalized" });
        finalized.set(id, block.number);
      } catch (e) {
        console.error("[treasury] finalized block unavailable", id, e);
        finalized.set(id, null);
      }
    }
    return finalized.get(id) ?? null;
  };

  for (const row of rows) {
    let outcome: Outcome = "pending";
    try {
      const fin = await finalizedOf(row.chain_id as ChainId);
      if (fin !== null && BigInt(row.block_number) <= fin) outcome = await settleRow(db, row, fin);
    } catch (e) {
      console.error("[treasury] settle failed", row.id, e);
    }
    result[outcome]++;
  }
  return result;
}

async function settleRow(db: ReturnType<typeof createAdminClient>, row: LedgerRow, fin: bigint): Promise<Outcome> {
  const { data: i } = await db
    .from("payment_intents")
    .select("chain_id, member_id, amount:amount::text, fee_amount:fee_amount::text, recipient_address, platform_address, main_tx_hash, fee_tx_hash, created_at")
    .eq("id", row.intent_id)
    .maybeSingle<IntentRow>();
  if (!i || !i.main_tx_hash) return "pending";
  const { data: payer } = await db.from("members").select("wallet_address").eq("id", i.member_id).maybeSingle<{ wallet_address: string }>();
  if (!payer) return "pending";

  const chain = row.chain_id as ChainId;
  const base = { chain, token: "USDC" as const, from: payer.wallet_address, notBefore: new Date(i.created_at), confirmations: 1 };
  const fee = BigInt(i.fee_amount);
  if (fee > 0n && (!i.platform_address || !i.fee_tx_hash)) return "pending";

  const results: VerifyResult[] = [];
  if (fee > 0n) {
    results.push(await verifyTransfer({ ...base, txHash: i.fee_tx_hash as `0x${string}`, to: i.platform_address as string, amount: fee }));
  }
  results.push(await verifyTransfer({ ...base, txHash: i.main_tx_hash as `0x${string}`, to: i.recipient_address, amount: BigInt(i.amount) }));

  // A permanent error on either transfer reverts: the payment as claimed no longer exists.
  if (results.some((r) => r.status === "error" && PERMANENT.has(r.code))) {
    const { error } = await db.rpc("revert_donation", { p_ledger: row.id });
    if (error) {
      console.error("[treasury] revert_donation failed", row.id, error.message);
      return "pending";
    }
    return "reverted";
  }
  if (!results.every((r): r is Ok => r.status === "ok")) return "pending";

  // Finality is judged on the receipts' current blocks (a reorged-and-remined tx still verifies by hash).
  const block = results.reduce((m, r) => (r.blockNumber > m ? r.blockNumber : m), 0n);
  if (block > fin) return "pending";

  const { error } = await db.rpc("credit_donation", { p_ledger: row.id });
  if (error) {
    console.error("[treasury] credit_donation failed", row.id, error.message);
    return "pending";
  }
  return "credited";
}
