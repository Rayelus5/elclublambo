// In-memory token buckets (multiplayer plan): for the live side's frequent actions (room moves, invites), where a
// database round trip per hit (ratelimit.ts) would be too heavy. One process, so memory is enough; a key that is not
// used for a while is forgotten.

export class Buckets {
  private readonly buckets = new Map<string, { tokens: number; at: number }>();
  constructor(private readonly now: () => number = Date.now) {}

  /** One hit on `key`: `perSecond` refill, `burst` at most. False when it is over the rate. */
  take(key: string, perSecond: number, burst: number): boolean {
    const t = this.now();
    const b = this.buckets.get(key) ?? { tokens: burst, at: t };
    b.tokens = Math.min(burst, b.tokens + ((t - b.at) / 1000) * perSecond);
    b.at = t;
    if (this.buckets.size > 50_000) this.buckets.clear();
    if (b.tokens < 1) {
      this.buckets.set(key, b);
      return false;
    }
    b.tokens -= 1;
    this.buckets.set(key, b);
    return true;
  }
}
