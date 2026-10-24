import "server-only";
import { appChainIds, type ChainId } from "@/lib/economy/networks";
import { chainClient } from "@/lib/payments/chain-client";
import { safeError } from "@/lib/security/redact";
import { createAdminClient } from "@/lib/supabase/admin";

export type ClubSafeStatus = "ok" | "not_deployed" | "not_configured" | "network";

const CACHE_MS = 10 * 60 * 1000;
const okUntil = new Map<ChainId, number>();

/** Test hook: forgets cached "ok" results. */
export function resetClubSafeCache(): void {
  okUntil.clear();
}

/**
 * The club Safe on this network exists: chains.safe_address is set and has contract code that is not an EIP-7702
 * delegation designator (0xef0100...). Only "ok" is cached (10 minutes, server memory): a Safe that appears later is
 * noticed on the next call, and a failure is never remembered.
 */
export async function verifyClubSafe(chain: ChainId): Promise<ClubSafeStatus> {
  const until = okUntil.get(chain);
  if (until !== undefined && until > Date.now()) return "ok";

  const { data, error } = await createAdminClient().from("chains").select("safe_address").eq("chain_id", chain).maybeSingle<{ safe_address: string | null }>();
  if (error) {
    console.error("[club-safe] chains read failed", chain, safeError(error.message));
    return "network";
  }
  const safe = data?.safe_address;
  if (!safe) return "not_configured";

  try {
    const code = await chainClient(chain).getCode({ address: safe as `0x${string}` });
    const hex = (code ?? "0x").toLowerCase();
    if (hex === "0x" || hex.startsWith("0xef0100")) return "not_deployed";
    okUntil.set(chain, Date.now() + CACHE_MS);
    return "ok";
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
