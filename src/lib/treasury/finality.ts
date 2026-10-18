import "server-only";
import type { ChainId } from "@/lib/economy/networks";
import { chainClient } from "@/lib/payments/chain-client";

/**
 * How far Linea's `finalized` block trails real time, in seconds (measured 2026-10-18: ~6 h on Linea Sepolia, ~2 h on
 * Linea). A donation is credited once its block is finalized, so this is roughly how long a fresh donation waits.
 * Null when the RPC is unavailable: callers just omit the estimate.
 */
export async function finalityLagSeconds(chain: ChainId, nowSeconds = Math.floor(Date.now() / 1000)): Promise<number | null> {
  try {
    const block = await chainClient(chain).getBlock({ blockTag: "finalized" });
    return Math.max(0, nowSeconds - Number(block.timestamp));
  } catch {
    return null;
  }
}

/** The lag plus the moment it was measured, as the /dao page hands it to DaoOverview. */
export async function finalitySnapshot(chain: ChainId): Promise<{ lagSeconds: number | null; nowSeconds: number }> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return { lagSeconds: await finalityLagSeconds(chain, nowSeconds), nowSeconds };
}
