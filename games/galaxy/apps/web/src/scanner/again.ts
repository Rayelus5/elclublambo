import { pullCost, type PullCosts, type PullCount } from '@galaxy/shared';

// «¡Escanear otra!» (Nov plan A1): the scan the summary offers again. Same count (1, 5 or 10), same scanner, paid the
// same way; the daily free scan is never asked twice (it falls back to signals, then coins), and what is missing is
// said instead of sending the player anywhere.

export type Again = { count: PullCount; pay: 'signal' | 'coins'; cost: number; currency: 'coins' | 'signal'; missing: number };

export function againPlan(count: PullCount, lastPay: 'free' | 'signal' | 'coins', costs: PullCosts, signals: number, coins: number): Again {
  const bySignals = pullCost(costs, count, 'signal');
  const byCoins = pullCost(costs, count, 'coins');
  const pay: Again['pay'] = lastPay === 'coins' ? 'coins' : lastPay === 'signal' ? 'signal' : signals >= bySignals || coins < byCoins ? 'signal' : 'coins';
  const cost = pay === 'signal' ? bySignals : byCoins;
  const have = pay === 'signal' ? signals : coins;
  return { count, pay, cost, currency: pay === 'signal' ? 'signal' : 'coins', missing: Math.max(0, cost - have) };
}
