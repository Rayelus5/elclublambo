import "server-only";
import { appChainIds, type ChainId } from "@/lib/economy/networks";
import { chainClient } from "@/lib/payments/chain-client";
import { safeError } from "@/lib/security/redact";
import { createAdminClient } from "@/lib/supabase/admin";

export type ClubSafeStatus = "ok" | "not_deployed" | "not_configured" | "network";

const OK_MS = 10 * 60 * 1000;
/** A missing Safe is remembered briefly: every page and action would otherwise hit the RPC, and a deploy shows up soon. */
const MISSING_MS = 60 * 1000;
const cache = new Map<ChainId, { status: "ok" | "not_deployed" | "not_configured"; until: number }>();

/** Test hook: forgets every cached result. */
export function resetClubSafeCache(): void {
  cache.clear();
}

function remember(chain: ChainId, status: "ok" | "not_deployed" | "not_configured"): typeof status {
  cache.set(chain, { status, until: Date.now() + (status === "ok" ? OK_MS : MISSING_MS) });
  return status;
}

/**
 * The club Safe on this network exists: chains.safe_address is set and has contract code that is not an EIP-7702
 * delegation designator (0xef0100...). Cached in server memory: "ok" for 10 minutes, "not_deployed" / "not_configured"
 * for 60 s (a Safe deployed later is noticed within a minute). A read or RPC failure ("network") is never remembered.
 */
export async function verifyClubSafe(chain: ChainId): Promise<ClubSafeStatus> {
  const hit = cache.get(chain);
  if (hit && hit.until > Date.now()) return hit.status;

  const { data, error } = await createAdminClient().from("chains").select("safe_address").eq("chain_id", chain).maybeSingle<{ safe_address: string | null }>();
  if (error) {
    console.error("[club-safe] chains read failed", chain, safeError(error.message));
    return "network";
  }
  const safe = data?.safe_address;
  if (!safe) return remember(chain, "not_configured");

  try {
    const code = await chainClient(chain).getCode({ address: safe as `0x${string}` });
    const hex = (code ?? "0x").toLowerCase();
    if (hex === "0x" || hex.startsWith("0xef0100")) return remember(chain, "not_deployed");
    return remember(chain, "ok");
  } catch (e) {
    console.error("[club-safe] getCode failed", chain, safeError(e));
    return "network";
  }
}

/** The build's networks whose Safe is deployed: the only ones that offer assets to donate. */
export async function donationChains(): Promise<ChainId[]> {
  const chains = appChainIds();
  const results = await Promise.all(chains.map((c) => verifyClubSafe(c)));
  return chains.filter((_, i) => results[i] === "ok");
}
