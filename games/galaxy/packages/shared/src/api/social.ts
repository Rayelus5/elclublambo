import type { PlayerLook } from './cosmetics';
import { z } from 'zod';
import { type Tier, TIERS } from '../gacha/types';
import type { ClanColor, ClanEmblem } from '../clans/rules';
import type { SeasonTier } from '../progress/season';
import type { SeasonReward } from '../progress/season-route';
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
  /**
   * The General tab only (2026-11-21), from the same aggregate as the score: the season's runs that counted (finished,
   * not suspicious, long enough; group runs too) and the deepest layer among them. Points an admin, a mission or a gift
   * added are not runs: a player with only those has 0 and 0. Absent in the other tabs.
   */
  runs?: number;
  bestDepth?: number;
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
  /** What the season's close pays (the live `seasonRoute.closing`), so the leaderboard can show it. */
  closing: SeasonClosing;
}

/**
 * The prizes of a season's close (GDD §13.1): each player gets their tier's reward (Bronce to Estelar), and the first
 * `podiumSize` places get the podium's on top (with a trophy for the station).
 */
export interface SeasonClosing {
  tiers: SeasonReward[];
  podium: SeasonReward;
  podiumSize: number;
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
  /**
   * Plan «skins», part D: the probes they show (up to PROBE_SHOWCASE_MAX, in their order) and every probe they have,
   * each with its level, its skin and its starting weapon (null: the base one). Only what they earned: nothing locked.
   */
  probes?: { showcase: ProfileProbe[]; all: ProfileProbe[] };
}

/** A probe on a profile (plan «skins», part D). */
export interface ProfileProbe {
  id: string;
  level: number;
  skin: string | null;
  variant: string | null;
}

/** How many probes a profile shows in its showcase. */
export const PROBE_SHOWCASE_MAX = 3;
/** The showcase a player chooses: up to three of their probes, each once, in order. */
export const profileProbesSchema = z
  .object({
    probes: z
      .array(z.string().regex(/^[a-z0-9-]{1,32}$/))
      .max(PROBE_SHOWCASE_MAX)
      .refine((ids) => new Set(ids).size === ids.length, { message: 'showcase_twice' }),
  })
  .strict();
export type ProfileProbesRequest = z.infer<typeof profileProbesSchema>;

export interface PublicCollectionPage {
  items: PublicGalaxy[];
  next?: string;
  counts: Record<Tier, number>;
}

/**
 * `season`: an admin's preview of another season's leaderboard (the panel's «Temporadas», 2026-11-22): its season
 * info as it will look, with nobody on it yet.
 */
export const leaderboardQuerySchema = z
  .object({ tab: z.enum(LEADER_TABS).default('general'), season: z.string().regex(/^[a-z0-9-]{1,32}$/).optional() })
  .strict();
export type LeaderboardQuery = z.infer<typeof leaderboardQuerySchema>;

// ---------------------------------------------------------------------------------------------------------------------
// Past seasons (plan «temporadas como fichas», histórico para jugadores, 2026-11-22): every closed season with its
// podium and its numbers, and its final General ranking as it closed.

/** What a season was, frozen at its close (`season_archive.stats`). */
export interface SeasonStats {
  players: number;
  runs: number;
  kills: number;
  cores: number;
  extractions: number;
  maxDepth: number;
  /** The sector and the probe played most (ids), null without runs. */
  topSector: string | null;
  topProbe: string | null;
  /** How many players finished in each tier. */
  tiers: Record<SeasonTier, number>;
}

/** A place on a past season's podium (the first three by rank). */
export interface PastPodiumPlace extends PlayerLook {
  rank: number;
  username: string;
  score: number;
}

/** A closed season in the history, newest first. */
export interface PastSeason {
  id: string;
  name: string;
  startsAt: string;
  /** When it ended (or closed, if that came first). */
  endsAt: string;
  players: number;
  podium: PastPodiumPlace[];
  /** Null for the seasons closed before their numbers were kept. */
  stats: SeasonStats | null;
}

export interface SeasonsHistory {
  seasons: PastSeason[];
}

/** A row of a past season's final ranking: the General tab as it closed (`value` is the score), with its tier. */
export interface PastRow extends LeaderRow {
  tier: SeasonTier | null;
  /** Won the podium's prize (an account that cannot win prizes keeps its rank without it). */
  podium: boolean;
}

/** A closed season's final ranking, a page at a time, with the viewer's row and the season's numbers. */
export interface SeasonResults {
  season: PastSeason & {
    /** Its tiers and what its close paid, from its record (empty and null for a season closed before records). */
    tiers: number[];
    closing: SeasonClosing | null;
  };
  rows: PastRow[];
  /** The viewer's row, also outside this page; null when they did not rank. */
  me: PastRow | null;
  /** The rows shown in all (players banned since are left out). */
  total: number;
  /** Where the next page starts, or null after the last. */
  next: number | null;
}

/** A page of a past season's ranking: from `offset`, `limit` rows (by default, as many as the season's table showed). */
export const seasonResultsQuerySchema = z
  .object({
    offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
    limit: z.coerce.number().int().min(1).max(500).optional(),
  })
  .strict();

export const publicCollectionQuerySchema = z
  .object({
    tier: z.enum(TIERS).optional(),
    sort: z.enum(['new', 'rarity']).default('rarity'),
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(60).default(30),
  })
  .strict();
export type PublicCollectionQuery = z.infer<typeof publicCollectionQuerySchema>;
