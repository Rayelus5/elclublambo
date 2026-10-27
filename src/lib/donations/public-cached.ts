import "server-only";
import { cacheLife } from "next/cache";
import type { ChainId } from "@/lib/economy/networks";
import { getPublicDonationOverview } from "./public-queries";
import { getSafeBalances } from "./safe-balances";

/**
 * The public, indexable donate page is open to anonymous visitors and crawlers: its shared reads (the Safe's on-chain
 * balances, the donation totals) are served from a short server cache so a burst of views costs one Supabase query and
 * one round of RPC calls a minute, not one per view. `expire` under 5 minutes keeps them out of the build's prerender
 * (no RPC at build time; they resolve at request time inside their <Suspense>). The club's /donar page keeps its live
 * reads. Per-user reads (session, my donations) are never cached here. Base units travel as text.
 */
export const PUBLIC_DONATE_CACHE = { stale: 60, revalidate: 60, expire: 120 } as const;

export type CachedSafeBalance = { chainId: ChainId; usdc: string | null; eth: string | null };

export async function getCachedSafeBalances(): Promise<CachedSafeBalance[]> {
  "use cache";
  cacheLife(PUBLIC_DONATE_CACHE);
  const balances = await getSafeBalances();
  return balances.map((b) => ({ chainId: b.chainId, usdc: b.usdc === null ? null : b.usdc.toString(), eth: b.eth === null ? null : b.eth.toString() }));
}

/** Throws (nothing is cached) when the read fails; the page shows its own notice. */
export async function getCachedPublicDonationOverview(): Promise<{ totalUsd6: string; donationCount: number }> {
  "use cache";
  cacheLife(PUBLIC_DONATE_CACHE);
  const o = await getPublicDonationOverview();
  return { totalUsd6: o.totalUsd6.toString(), donationCount: o.donationCount };
}
