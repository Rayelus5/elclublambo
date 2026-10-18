// Pure data shaping for the /dao charts (hand-rolled SVG in src/components/treasury/dao-charts.tsx).
import type { HistoryEntry, RankingEntry } from "@/lib/treasury/queries";

export interface DonutSlice {
  key: string;
  label: string;
  bps: number;
  color: string;
}

/** Five slices at most plus "Resto": beyond that a donut stops being readable (the ranking table has every row). */
const MAX_SLICES = 5;
const COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];
const REST_COLOR = "var(--chart-rest)";

/**
 * Ranking (largest first, share in bps, floor-divided) -> donut slices summing to 10 000 bps. The remainder of the
 * floor division and every member past the fifth go to "Resto". Hidden donors are told apart by rank ("#2 Anónimo").
 */
export function donutSlices(entries: readonly RankingEntry[]): DonutSlice[] {
  if (entries.length === 0) return [];
  const top = entries.slice(0, MAX_SLICES).map((e, i) => ({
    key: `r${e.rank}`,
    label: e.memberId === null ? `#${e.rank} ${e.label}` : e.label,
    bps: e.shareBps,
    color: COLORS[i]!,
  }));
  const rest = 10000 - top.reduce((sum, s) => sum + s.bps, 0);
  return rest > 0 ? [...top, { key: "rest", label: "Resto", bps: rest, color: REST_COLOR }] : top;
}

export interface BalancePoint {
  at: string;
  /** Whole USDC as a float: only for plotting, never for money. */
  usdc: number;
}

const toUsdc = (units: bigint) => Number(units) / 1e6;

/**
 * Treasury balance over the shown history (dao_history, newest first). Walks back from the current ledger value so the
 * line ends on today's balance even when older credits are not in the page: the first point is what the treasury held
 * just before the oldest shown credit.
 */
export function balanceSeries(history: readonly HistoryEntry[], valueUsdc: bigint): BalancePoint[] {
  if (history.length === 0) return [];
  const oldestFirst = [...history].reverse();
  let before = valueUsdc - history.reduce((sum, h) => sum + h.amount, 0n);
  if (before < 0n) before = 0n;
  const points: BalancePoint[] = [{ at: oldestFirst[0]!.creditedAt, usdc: toUsdc(before) }];
  let running = before;
  for (const h of oldestFirst) {
    running += h.amount;
    points.push({ at: h.creditedAt, usdc: toUsdc(running) });
  }
  return points;
}
