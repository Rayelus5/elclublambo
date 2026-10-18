import "server-only";
import type { ChainId } from "@/lib/economy/networks";
import type { ReconcileRun } from "@/components/treasury/reconcile-panel";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Latest reconciliation of a chain. dao_reconciliations has no member-facing policy, so this reads with the service
 * role: the caller MUST have checked MANAGE_TREASURY first (the page does, before rendering the panel).
 */
export async function getLastReconciliation(chain: ChainId): Promise<ReconcileRun | null> {
  const { data, error } = await createAdminClient()
    .from("dao_reconciliations")
    .select("ran_at, ledger_value:ledger_value::text, pending_value:pending_value::text, onchain_balance:onchain_balance::text, effective_diff:effective_diff::text")
    .eq("chain_id", chain)
    .order("ran_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ ran_at: string; ledger_value: string; pending_value: string; onchain_balance: string; effective_diff: string }>();
  if (error || !data) return null;
  return {
    ranAt: data.ran_at,
    ledgerValue: data.ledger_value,
    pendingValue: data.pending_value,
    onchainBalance: data.onchain_balance,
    diff: data.effective_diff,
  };
}
