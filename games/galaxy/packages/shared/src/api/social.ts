import { z } from 'zod';
import { type Tier, TIERS } from '../gacha/types';
import type { ClanColor, ClanEmblem } from '../clans/rules';
import type { SeasonTier } from '../progress/season';
import type { PublicGalaxy } from './planetarium';

// The social API (GDD §14.1, §14.2, §12.1; M5a): the season leaderboard with its tabs, public profiles and public
// collections. Nothing private travels: no balances, loadout, probe or session.

export const LEADER_TABS = ['general', 'depth', 'purges', 'clans'] as const;
export type LeaderTab = (typeof LEADER_TABS)[number];

export interface LeaderRow {
  /** Competition rank: equal values share it. */
  rank: number;
  username: string;
  level: number;
  /** The tab's value: the score, the deepest layer or the Cores purged in the season. */
  value: number;
}

/** A clan in the Clanes tab (M5b-1): the season points of its current members, added up. */
export interface ClanRow {
  rank: number;
  tag: string;
  name: string;
  emblem: ClanEmblem;
  color: ClanColor;
  members: number;
  value: number;
}

export interface SeasonInfo {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string;
  /** The score of each tier, Bronce to Estelar. */
  tiers: number[];
}

export interface Leaderboard {
  /** null: no season is open. */
  season: SeasonInfo | null;
  tab: LeaderTab;
  rows: LeaderRow[];
  /** The viewer's row, also outside the top; null without points. */
  me: LeaderRow | null;
  /** How many players (clans, in the Clanes tab) have points in the season. */
  total: number;
  /** The Clanes tab (M5b-1): the clans instead of `rows`, and the viewer's clan (null when not in one with points). */
  clans?: ClanRow[];
  myClan?: ClanRow | null;
}

export interface Profile {
  username: string;
  /** When the account was created (ISO). */
  since: string;
  level: number;
  /** This season's standing, or null when no season is open or it has no points. */
  season: { score: number; rank: number; tier: SeasonTier | null; maxDepth: number; purges: number; extractions: number } | null;
  /** All-time records from runs that are not suspicious. */
  records: { maxDepth: number; purges: number; runs: number };
  collection: { total: number; counts: Record<Tier, number> };
  planetarium: { prestige: number; exhibits: number; cover: PublicGalaxy | null };
  /** Their clan (M5b-1), or null. */
  clan: { tag: string; name: string; emblem: ClanEmblem; color: ClanColor } | null;
}

export interface PublicCollectionPage {
  items: PublicGalaxy[];
  next?: string;
  counts: Record<Tier, number>;
}

export const leaderboardQuerySchema = z.object({ tab: z.enum(LEADER_TABS).default('general') }).strict();
export type LeaderboardQuery = z.infer<typeof leaderboardQuerySchema>;

export const publicCollectionQuerySchema = z
  .object({
    tier: z.enum(TIERS).optional(),
    sort: z.enum(['new', 'rarity']).default('rarity'),
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(60).default(30),
  })
  .strict();
export type PublicCollectionQuery = z.infer<typeof publicCollectionQuerySchema>;
