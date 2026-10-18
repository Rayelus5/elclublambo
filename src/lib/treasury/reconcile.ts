import "server-only";
import { erc20Abi } from "viem";
import { NETWORKS, type ChainId } from "@/lib/economy/networks";
import { chainClient } from "@/lib/payments/chain-client";
import { createAdminClient } from "@/lib/supabase/admin";

export type ReconcileResult = {
  /** dao_state.value_usdc: credited donations only. */
  ledgerValue: bigint;
  /** Donations already in the Safe but still waiting for finality. */
  pendingValue: bigint;
  onchainBalance: bigint;
  /** Effective diff = onchain - ledger - pending. Positive: funds in the Safe outside the ledger (direct transfers). */
  diff: bigint;
  /** onchain - ledger. */
  rawDiff: bigint;
  id: string;
};

const big = (v: unknown): bigint => {
  if (typeof v !== "string" || !/^-?\d+$/.test(v)) throw new Error("record_reconciliation returned a malformed result");
  return BigInt(v);
};

/**
 * Reads the Safe's on-chain USDC balance and records the run. The ledger and pending values are read inside the RPC (one
 * snapshot) and the RPC notifies MANAGE_TREASURY holders when the effective diff is nonzero and changed. Never changes
 * the ledger. `actor` is the member who asked, null for cron. Any read error throws: nothing is ever defaulted to 0.
 */
export async function reconcile(chain: ChainId, actor: string | null): Promise<ReconcileResult> {
  const db = createAdminClient();

  const { data: cfg, error: cfgError } = await db
    .from("chain_config")
    .select("safe_address")
    .eq("chain_id", chain)
    .maybeSingle<{ safe_address: string | null }>();
  if (cfgError) throw new Error(`chain_config read failed: ${cfgError.message}`);
  if (!cfg?.safe_address) throw new Error("safe_not_configured");

  const onchainBalance = (await chainClient(chain).readContract({
    address: NETWORKS[chain].usdc,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [cfg.safe_address as `0x${string}`],
  })) as bigint;

  const { data, error } = await db.rpc("record_reconciliation", {
    p_chain: chain,
    p_onchain: onchainBalance.toString(),
    p_actor: actor,
  });
  if (error || !data || typeof data !== "object") throw new Error(`record_reconciliation failed: ${error?.message ?? "no result"}`);
  const r = data as Record<string, unknown>;
  if (typeof r.id !== "string") throw new Error("record_reconciliation returned no id");

  return {
    ledgerValue: big(r.ledgerValue),
    pendingValue: big(r.pendingValue),
    onchainBalance,
    diff: big(r.diff),
    rawDiff: big(r.rawDiff),
    id: r.id,
  };
}
