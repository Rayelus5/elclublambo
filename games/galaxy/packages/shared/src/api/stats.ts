import { z } from 'zod';

// Live statistics for admins (GDD §16.6; M6d-2): players connected, runs over time, each currency's flows, pulls and
// rarities against the expected ones, market volume, and what waits for review — over the last 24 hours (by hour) or 7
// or 30 days (by UTC day), each section also as CSV.

export const STATS_PERIODS = ['24h', '7d', '30d'] as const;
export type StatsPeriod = (typeof STATS_PERIODS)[number];
export const STATS_SECTIONS = ['runs', 'currencies', 'pulls', 'market', 'groups'] as const;
export type StatsSection = (typeof STATS_SECTIONS)[number];

export const adminStatsQuerySchema = z.object({ period: z.enum(STATS_PERIODS).default('24h') }).strict();
export const adminStatsCsvQuerySchema = z.object({ period: z.enum(STATS_PERIODS).default('24h'), section: z.enum(STATS_SECTIONS) }).strict();

export interface StatsFlow {
  reason: string;
  in: number;
  out: number;
}

export interface AdminStats {
  period: StatsPeriod;
  from: string;
  to: string;
  players: { online: number; sockets: number; newAccounts: number; activeAccounts: number };
  /**
   * Runs started in each bucket (an hour for 24h, a UTC day otherwise), oldest first, empty ones included; of the ones
   * not finished, `open` can still finish (younger than runs.expireHours) and `unfinished` never will.
   */
  runs: { buckets: { at: string; count: number }[]; outcomes: { extracted: number; died: number; abandoned: number; open: number; unfinished: number } };
  currencies: { currency: string; in: number; out: number; byReason: StatsFlow[] }[];
  /** Pulls by tier (0 common … 4 legendary) with the expected share from the live gacha config. */
  pulls: { total: number; tiers: { tier: number; count: number; expected: number }[] };
  market: { listed: number; sold: number; coins: number; commission: number; tradesDone: number; tradesCancelled: number };
  /**
   * Group runs that ended in the period (multiplayer plan, phase 7): how many, the players in them, how they ended, the
   * average layer reached, and its players who left on purpose or were flagged idle (`coop_idle`).
   */
  groups: { runs: number; players: number; extracted: number; died: number; interrupted: number; avgDepth: number; abandons: number; idle: number };
  pending: { alerts: number; reports: number };
}
