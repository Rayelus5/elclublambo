import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { rpcErrorCode } from "@/lib/errors";
import { safeError } from "@/lib/security/redact";

/** Buckets a server action charges up front (F5-R2); their limits live in public.rate_limit_hit. */
export type PreHitBucket = "chain_verify" | "redeem_invite";

/**
 * Charges one hit of `bucket` to the session's member (or 'u:'||auth.uid() before membership) in its own transaction,
 * before work that fails often and costs something (on-chain verification, invite redemption). Must be called with the
 * caller's JWT client, never the service-role one. "error" is any other failure: each caller fails closed its own way.
 */
export async function hitRateLimit(supabase: SupabaseClient, bucket: PreHitBucket): Promise<"ok" | "rate_limited" | "error"> {
  try {
    const { error } = await supabase.rpc("rate_limit_hit", { p_bucket: bucket });
    if (!error) return "ok";
    if (rpcErrorCode(error) === "rate_limited") return "rate_limited";
    console.error("[rate-limit] pre-hit failed", bucket, safeError(error.message));
    return "error";
  } catch (e) {
    console.error("[rate-limit] pre-hit failed", bucket, safeError(e));
    return "error";
  }
}
