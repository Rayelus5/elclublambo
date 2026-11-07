/**
 * Diminishing returns (GDD §8.6): cap · (1 − Π(1 − v/cap)). One small bonus counts almost in full; each further bonus
 * of the same category counts for less, and the total never reaches past the cap. Negative values count as 0.
 */
export function diminish(values: readonly number[], cap: number): number {
  if (!(cap > 0)) return 0;
  let keep = 1;
  for (const v of values) {
    if (!(v > 0)) continue;
    keep *= v >= cap ? 0 : 1 - v / cap;
  }
  return cap * (1 - keep);
}
