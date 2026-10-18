import "server-only";
import { erc20Abi } from "viem";
import { NETWORKS, type ChainId } from "@/lib/economy/networks";
import { chainClient } from "@/lib/payments/chain-client";
import { createAdminClient } from "@/lib/supabase/admin";

export type ReconcileResult = { ledgerValue: bigint; onchainBalance: bigint; diff: bigint; id: string };

/**
 * Compares the ledger value with the Safe's on-chain USDC balance and records the run (notifying MANAGE_TREASURY
 * holders on a mismatch, in SQL). diff = onchain - ledger: positive means funds in the Safe that are not in the
 * ledger (direct transfers). Never changes the ledger. `actor` is the member who asked, null for cron.
 */
export async function reconcile(chain: ChainId, actor: string | null): Promise<ReconcileResult> {
  const db = createAdminClient();

  const { data: cfg } = await db.from("chain_config").select("safe_address").eq("chain_id", chain).maybeSingle<{ safe_address: string | null }>();
  if (!cfg?.safe_address) throw new Error("safe_not_configured");

  const { data: state } = await db
    .from("dao_state")
    .select("value_usdc:value_usdc::text")
    .eq("chain_id", chain)
    .maybeSingle<{ value_usdc: string }>();
  const ledgerValue = BigInt(state?.value_usdc ?? "0");

  const onchainBalance = (await chainClient(chain).readContract({
    address: NETWORKS[chain].usdc,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [cfg.safe_address as `0x${string}`],
  })) as bigint;

  const { data: id, error } = await db.rpc("record_reconciliation", {
    p_chain: chain,
    p_ledger: ledgerValue.toString(),
    p_onchain: onchainBalance.toString(),
    p_actor: actor,
  });
  if (error || typeof id !== "string") throw new Error(`record_reconciliation failed: ${error?.message ?? "no id"}`);

  return { ledgerValue, onchainBalance, diff: onchainBalance - ledgerValue, id };
}
