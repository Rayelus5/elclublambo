import "server-only";
import { schedulePushDispatch } from "@/lib/push/schedule";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Cron step: freezes the tallies of the polls whose close has passed, notifies their voters and seals the ballots
 * (SQL close_due_polls). Throws on any failure so the route reports `polls: "failed"`.
 */
export async function finalizeDuePolls(): Promise<{ finalized: number }> {
  const { data, error } = await createAdminClient().rpc("close_due_polls");
  if (error) throw new Error(`close_due_polls failed: ${error.message}`);
  const finalized = (data as { finalized?: unknown } | null)?.finalized;
  if (typeof finalized !== "number" || !Number.isInteger(finalized) || finalized < 0) {
    throw new Error("close_due_polls returned an unexpected payload");
  }
  if (finalized > 0) schedulePushDispatch();
  return { finalized };
}
