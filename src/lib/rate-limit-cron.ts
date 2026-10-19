import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Cron step: sweeps the rate-limit hits whose window ended long ago (SQL prune_rate_limits, service role only).
 * Throws on any failure so the route reports `rateLimits: "failed"`.
 */
export async function pruneRateLimits(): Promise<{ deleted: number }> {
  const { data, error } = await createAdminClient().rpc("prune_rate_limits");
  if (error) throw new Error(`prune_rate_limits failed: ${error.message}`);
  const deleted = (data as { deleted?: unknown } | null)?.deleted;
  if (typeof deleted !== "number" || !Number.isInteger(deleted) || deleted < 0) {
    throw new Error("prune_rate_limits returned an unexpected payload");
  }
  return { deleted };
}
