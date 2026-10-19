/**
 * F5 security review S2: the forum layout re-verifies a member's pending payments and settles their own donations
 * after every server render. Each run costs RPC reads (receipts, the finalized block, a Safe valuation), so a member
 * reloading in a loop with junk intents attached would multiply the spend on the RPC key. At most one background
 * recheck per member per window per server process (same approach as `shouldSettleFromView`); the cron settles the rest.
 */
export const RECHECK_EVERY_MS = 30_000;
export const MAX_TRACKED_MEMBERS = 5_000;

const lastRecheck = new Map<string, number>();

export function shouldRecheckMember(memberId: string, now = Date.now()): boolean {
  const last = lastRecheck.get(memberId);
  if (last !== undefined && now - last < RECHECK_EVERY_MS) return false;
  if (lastRecheck.size >= MAX_TRACKED_MEMBERS) {
    for (const [id, t] of lastRecheck) if (now - t >= RECHECK_EVERY_MS) lastRecheck.delete(id);
    // Still full (a burst of distinct members inside one window): drop the oldest entries (insertion order).
    for (const id of lastRecheck.keys()) {
      if (lastRecheck.size < MAX_TRACKED_MEMBERS) break;
      lastRecheck.delete(id);
    }
  }
  lastRecheck.delete(memberId);
  lastRecheck.set(memberId, now);
  return true;
}

/** Tests only. */
export function resetRecheckThrottle(): void {
  lastRecheck.clear();
}
