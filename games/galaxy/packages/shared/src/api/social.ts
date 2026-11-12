import type { PlayerLook } from './cosmetics';
import { z } from 'zod';
import { type Tier, TIERS } from '../gacha/types';
import type { ClanColor, ClanEmblem } from '../clans/rules';
import type { SeasonTier } from '../progress/season';
import type { PublicGalaxy } from './planetarium';

// The social API (GDD §14.1, §14.2, §12.1; M5a): the season leaderboard with its tabs, public profiles and public
// collections. Nothing private travels: no balances, loadout, probe or session.

export const LEADER_TABS = ['general', 'depth', 'purges', 'clans', 'groups'] as const;
export type LeaderTab = (typeof LEADER_TABS)[number];

export interface LeaderRow extends PlayerLook {
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

/**
 * A group in the En grupo tab (multiplayer plan, phase 7): its best run of the season (deepest layer, then Cores, then
 * the fastest), with its players in their slots' order.
 */
export interface GroupRow {
  rank: number;
  players: { username: string; probe: string; skin?: string | null }[];
  depth: number;
  cores: number;
  seconds: number;
  outcome: 'extracted' | 'died' | 'interrupted';
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
  /** The En grupo tab (phase 7): the groups instead of `rows`, and the viewer's best group (null without one). */
  groups?: GroupRow[];
  myGroup?: GroupRow | null;
}

export interface Profile {
  username: string;
  /** When the account was created (ISO). */
  since: string;
  level: number;
  /** The experience into their level and what the next one asks for (null at the top). */
  xp?: { into: number; next: number | null };
  /** This season's standing, or null when no season is open or it has no points. */
  season: { score: number; rank: number; tier: SeasonTier | null; maxDepth: number; purges: number; extractions: number } | null;
  /** All-time records from runs that are not suspicious. */
  records: { maxDepth: number; purges: number; runs: number };
  collection: { total: number; counts: Record<Tier, number> };
  planetarium: { prestige: number; exhibits: number; cover: PublicGalaxy | null };
  /** Their clan (M5b-1), or null. */
  clan: { tag: string; name: string; emblem: ClanEmblem; color: ClanColor } | null;
  /** The title and the frame they chose (M7a), null when none. */
  title?: string | null;
  frame?: string | null;
  /** Nov plan C2: their avatar (null: the drawing from their name) and the galaxy shown as their banner (C4). */
  avatar?: string | null;
  banner?: PublicGalaxy | null;
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
