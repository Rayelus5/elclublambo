import "server-only";
import type { LegacyChainId } from "@/lib/legacy/linea";
import { legacyChainClient } from "@/lib/legacy/linea-client";

/**
 * How far Linea's `finalized` block trails real time, in seconds (measured 2026-10-18: ~6 h on Linea Sepolia, ~2 h on
 * Linea). A donation is credited once its block is finalized, so this is roughly how long a fresh donation waits.
 * Null when the RPC is unavailable: callers just omit the estimate.
 */
export async function finalityLagSeconds(chain: LegacyChainId, nowSeconds = Math.floor(Date.now() / 1000)): Promise<number | null> {
  try {
    const block = await legacyChainClient(chain).getBlock({ blockTag: "finalized" });
    return Math.max(0, nowSeconds - Number(block.timestamp));
  } catch {
    return null;
  }
}

/** How long a measured lag is reused per chain (it moves over hours): one RPC read per chain per minute per process. */
export const FINALITY_CACHE_MS = 60_000;

const lagCache = new Map<LegacyChainId, { lagSeconds: number | null; measuredAt: number }>();

/**
 * The lag plus the moment it was measured, as the /dao page hands it to DaoOverview. Cached per chain for
 * FINALITY_CACHE_MS, including an unavailable RPC (null), so reloading /dao never costs an RPC read per render (F5 S15).
 */
export async function finalitySnapshot(chain: LegacyChainId): Promise<{ lagSeconds: number | null; nowSeconds: number }> {
  const now = Date.now();
  const nowSeconds = Math.floor(now / 1000);
  const hit = lagCache.get(chain);
  if (hit && now - hit.measuredAt < FINALITY_CACHE_MS && now >= hit.measuredAt) return { lagSeconds: hit.lagSeconds, nowSeconds };
  const lagSeconds = await finalityLagSeconds(chain, nowSeconds);
  lagCache.set(chain, { lagSeconds, measuredAt: now });
  return { lagSeconds, nowSeconds };
}

/** Tests only. */
export function resetFinalityCache(): void {
  lagCache.clear();
}
