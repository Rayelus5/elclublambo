import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import type { ChainId } from "@/lib/economy/networks";
import { inspectTransfer, type InspectResult } from "./inspect";
import { getProfileByAddress } from "./queries";

/**
 * A non-final read of readFinal, handed to its caller outside the cache: `readFinal` throws so nothing is stored, and
 * leaves the fresh result here (keyed `chain:hash`) for the caller to take (read-and-delete), so a pending or error view
 * still costs a single inspection. Capped so entries never collected (a throw the caller did not see) cannot pile up.
 */
const stash = new Map<string, InspectResult>();
const STASH_MAX = 1_000;

export const receiptKey = (chain: ChainId, hash: string) => `${chain}:${hash}`;

export function takeStashed(key: string): InspectResult | undefined {
  const r = stash.get(key);
  stash.delete(key);
  return r;
}

export class NotFinal extends Error {}

/**
 * Only a FINAL payment is cached (the chain no longer changes it): anything else is stashed and throws, so nothing is
 * stored. cacheLife/cacheTag run only on the final branch (conditional lifetimes are allowed; one call per run).
 */
export async function readFinal(chain: ChainId, hash: `0x${string}`): Promise<Extract<InspectResult, { status: "ok" }>> {
  "use cache";
  const r = await inspectTransfer(chain, hash);
  if (r.status !== "ok" || !r.final) {
    if (stash.size >= STASH_MAX) stash.clear();
    stash.set(receiptKey(chain, hash), r);
    throw new NotFinal();
  }
  cacheLife("max");
  cacheTag(`pay-receipt:${chain}:${hash}`);
  return r;
}

/** The receipt names its recipient: a profile lookup for a final receipt, cached for a minute (a profile can change). */
export const RECEIPT_PROFILE_CACHE = { stale: 60, revalidate: 60, expire: 120 } as const;

export async function getCachedProfileByAddress(address: string): Promise<{ alias: string; displayName: string | null } | null> {
  "use cache";
  cacheLife(RECEIPT_PROFILE_CACHE);
  return getProfileByAddress(address.toLowerCase());
}
