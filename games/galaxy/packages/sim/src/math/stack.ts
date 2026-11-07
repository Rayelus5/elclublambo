/**
 * Diminishing returns (GDD §8.6): cap · (1 − Π(1 − v/cap)), computed as "each bonus fills its share of the room still
 * left under the cap". One bonus counts in full (exactly), each further bonus of the same category counts for less,
 * and the total never passes the cap. Negative values count as 0.
 */
export function diminish(values: readonly number[], cap: number): number {
  if (!(cap > 0)) return 0;
  let total = 0;
  for (const v of values) {
    if (!(v > 0)) continue;
    if (v >= cap) return cap;
    total = total === 0 ? v : total + ((cap - total) * v) / cap;
  }
  return Math.min(total, cap);
}
