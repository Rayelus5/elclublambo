import { safeError } from "@/lib/security/redact";
import "server-only";
import { isChainId, type ChainId } from "@/lib/economy/networks";
import { chainClient } from "@/lib/payments/chain-client";
import { verifyTransfer, type VerifyResult } from "@/lib/payments/verify";
import { createAdminClient } from "@/lib/supabase/admin";
import { valueSafe, type SafeValuation } from "@/lib/treasury/snapshot";

export type SettleResult = { credited: number; reverted: number; pending: number };
export type SettleOptions = { memberId?: string; ledgerId?: string; limit?: number };

const MAX_PER_CALL = 20;
/** Errors that mean the payment no longer exists as claimed (tx_too_old: it was mined before the intent, F3d M5). */
const PERMANENT = new Set(["tx_failed", "tx_mismatch", "tx_too_old"]);

type Valuer = (chain: ChainId) => Promise<SafeValuation | null>;

type LedgerRow = { id: string; chain_id: number; intent_id: string; block_number: string; missing_since: string | null };
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
 *
 * Shares are issued at market NAV: the Safe is valued once per chain per call (lazily, only when a row is ready to
 * credit) and credit_donation gets that value and the block it was read at. No valuation (RPC or price down), a stale
 * read (`assets_stale`) or `invalid_state` keep the row pending for the next run; `shares_zero` keeps it pending for the
 * treasurer's review.
 */
export async function settlePendingDonations(chain?: ChainId, opts: SettleOptions = {}): Promise<SettleResult> {
  const result: SettleResult = { credited: 0, reverted: 0, pending: 0 };
  const db = createAdminClient();
  const limit = Math.max(1, Math.min(MAX_PER_CALL, Math.floor(opts.limit ?? MAX_PER_CALL)));

  let q = db
    .from("dao_ledger")
    .select("id, chain_id, intent_id, missing_since, block_number:block_number::text")
    .eq("status", "pending_finality");
  if (chain !== undefined) q = q.eq("chain_id", chain);
  if (opts.memberId) q = q.eq("member_id", opts.memberId);
  if (opts.ledgerId) q = q.eq("id", opts.ledgerId);
  const { data, error } = await q.order("created_at", { ascending: true }).limit(limit);
  if (error) {
    console.error("[treasury] settle query failed", safeError(error.message));
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
        console.error("[treasury] finalized block unavailable", id, safeError(e));
        finalized.set(id, null);
      }
    }
    return finalized.get(id) ?? null;
  };

  const valuations = new Map<number, Promise<SafeValuation | null>>();
  const valueOf: Valuer = (id) => {
    if (!valuations.has(id)) {
      valuations.set(
        id,
        valueSafe(id).catch((e) => {
          console.error("[treasury] valuation failed", id, safeError(e));
          return null;
        }),
      );
    }
    return valuations.get(id)!;
  };

  for (const row of rows) {
    let outcome: Outcome = "pending";
    try {
      const fin = await finalizedOf(row.chain_id as ChainId);
      if (fin !== null && BigInt(row.block_number) <= fin) outcome = await settleRow(db, row, fin, valueOf);
    } catch (e) {
      console.error("[treasury] settle failed", row.id, safeError(e));
    }
    result[outcome]++;
  }
  return result;
}

async function settleRow(db: ReturnType<typeof createAdminClient>, row: LedgerRow, fin: bigint, valueOf: Valuer): Promise<Outcome> {
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

  const revert = async (): Promise<Outcome> => {
    const { error } = await db.rpc("revert_donation", { p_ledger: row.id });
    if (error) {
      console.error("[treasury] revert_donation failed", row.id, safeError(error.message));
      return "pending";
    }
    return "reverted";
  };

  // A permanent error on either transfer reverts: the payment as claimed no longer exists.
  if (results.some((r) => r.status === "error" && PERMANENT.has(r.code))) return revert();
  // Not found is only believed after it persisted for 30 minutes (a lagging RPC node must not revert a real donation).
  if (results.some((r) => r.status === "error" && r.code === "tx_not_found")) {
    const { data: allowed, error } = await db.rpc("donation_missing", { p_ledger: row.id, p_missing: true });
    if (error) {
      console.error("[treasury] donation_missing failed", row.id, safeError(error.message));
      return "pending";
    }
    return allowed === true ? revert() : "pending";
  }
  if (!results.every((r): r is Ok => r.status === "ok")) return "pending";
  if (row.missing_since) {
    const { error } = await db.rpc("donation_missing", { p_ledger: row.id, p_missing: false });
    if (error) console.error("[treasury] clearing missing_since failed", row.id, safeError(error.message));
  }

  // Finality is judged on the receipts' current blocks (a reorged-and-remined tx still verifies by hash).
  const block = results.reduce((m, r) => (r.blockNumber > m ? r.blockNumber : m), 0n);
  if (block > fin) return "pending";

  // Review Focus 1: without a market valuation nothing is credited (no shares at a wrong price); the next run retries.
  const v = await valueOf(chain);
  if (!v) return "pending";
  const { error } = await db.rpc("credit_donation", {
    p_ledger: row.id,
    p_assets_usd6: v.assetsUsd6.toString(),
    p_assets_block: v.blockNumber.toString(),
    // F4d: open WETH prizes are liabilities valued at the price of this valuation (the credit-time price)
    p_eth_price_e8: v.priceE8.toString(),
  });
  if (error) {
    // shares_zero: too small for the fund's value, left pending for the treasurer. assets_stale / invalid_state: retried.
    if (error.message === "shares_zero") console.error("[treasury] shares_zero", row.id, safeError(error.message));
    else console.error("[treasury] credit_donation failed", row.id, safeError(error.message));
    return "pending";
  }
  return "credited";
}

const VIEW_SETTLE_EVERY_MS = 30_000;
let lastViewSettle = 0;

/**
 * Page views (/dao) settle opportunistically, but one credit re-renders every open /dao through DaoLive: at most one
 * view-triggered settlement per 30 s per server process (the cron and the donor's own navigation are not throttled).
 */
export function shouldSettleFromView(now = Date.now()): boolean {
  if (now - lastViewSettle < VIEW_SETTLE_EVERY_MS) return false;
  lastViewSettle = now;
  return true;
}
