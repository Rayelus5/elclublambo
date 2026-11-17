// What a pull costs (GDD §9; the 5-pull 2026-11-17, the owner: «tiradas de 5»). With coins each size has its own
// price from the live config (`gacha.costs`: x1, x5, x10, the bigger ones cheaper per scan); with signals it is
// `signals` per scan, whatever the size; the free one is the daily x1. The server charges with this and the web shows it.

/** The pull sizes there are. */
export const PULL_COUNTS = [1, 5, 10] as const;
export type PullCount = (typeof PULL_COUNTS)[number];

export interface PullCosts {
  coins: number;
  coinsFive: number;
  coinsTen: number;
  signals: number;
}

export function pullCost(costs: PullCosts, count: PullCount, pay: 'coins' | 'signal' | 'free'): number {
  if (pay === 'free') return 0;
  if (pay === 'signal') return costs.signals * count;
  return count === 10 ? costs.coinsTen : count === 5 ? costs.coinsFive : costs.coins;
}

/**
 * The size that costs least per scan with this way of paying, marked «Mejor precio» in the scanner; null when no size
 * saves anything (signals, or an admin who set no discount).
 */
export function bestValue(costs: PullCosts, pay: 'coins' | 'signal'): PullCount | null {
  const perScan = (n: PullCount) => pullCost(costs, n, pay) / n;
  let best: PullCount | null = null;
  for (const n of PULL_COUNTS) if (perScan(n) < perScan(1) && (best === null || perScan(n) < perScan(best))) best = n;
  return best;
}
