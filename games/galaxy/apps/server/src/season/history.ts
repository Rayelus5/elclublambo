import {
  type AccountConfig,
  closingInfo,
  levelOf,
  parseConfig,
  type PastPodiumPlace,
  type PastRow,
  type PastSeason,
  SEASON_TIERS,
  seasonConfigOf,
  type SeasonResults,
  type SeasonsHistory,
  type SeasonStats,
  type SeasonTier,
} from '@galaxy/shared';
import { type Kysely, sql } from 'kysely';
import type { DB } from '../db/schema';
import { HttpError } from '../errors';

// The past seasons for players (plan «temporadas como fichas», histórico para jugadores, 2026-11-22; GDD §13.1, §14.1):
// every closed season with the first three of its final ranking and the numbers frozen at its close, and a closed
// season's final ranking (the General tab as it closed, from season_results) a page at a time, with the viewer's row
// even outside the page, its tiers and what its close paid (from its record). A final ranking never changes: it is
// computed once per season and kept for a long while (only so a player banned since stops showing); the looks and
// levels beside it are read fresh, like the live leaderboard's.

/** How long a season's final ranking is kept (a ban since its close shows within this). */
const FINALS_TTL_MS = 15 * 60_000;
/** How many seasons' final rankings are kept at once. */
const FINALS_MAX = 24;
/** How many closed seasons the history lists. */
const HISTORY_MAX = 100;

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const text = (v: unknown) => (typeof v === 'string' && v !== '' ? v : null);

/** The numbers frozen at a close (`season_archive.stats`), read leniently; null for a season closed before them. */
export function seasonStatsOf(raw: unknown): SeasonStats | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const tiers = (r['tiers'] && typeof r['tiers'] === 'object' ? r['tiers'] : {}) as Record<string, unknown>;
  return {
    players: num(r['players']),
    runs: num(r['runs']),
    kills: num(r['kills']),
    cores: num(r['cores']),
    extractions: num(r['extractions']),
    maxDepth: num(r['maxDepth']),
    topSector: text(r['topSector']),
    topProbe: text(r['topProbe']),
    tiers: Object.fromEntries(SEASON_TIERS.map((t) => [t, num(tiers[t])])) as Record<SeasonTier, number>,
  };
}

/** A page of `rows` from `offset`, and where the next one starts (null after the last). */
export function pageOf<T>(rows: readonly T[], offset: number, limit: number): { rows: T[]; next: number | null } {
  const page = rows.slice(offset, offset + limit);
  return { rows: page, next: offset + limit < rows.length ? offset + limit : null };
}

/**
 * Values computed once per key and kept `ttlMs` (reads at once share one computation; a failed one is forgotten), at
 * most `max` keys (the oldest goes first).
 */
export function createFinalsCache<T>(opts: { ttlMs: number; max?: number; now?: () => number }) {
  const max = opts.max ?? FINALS_MAX;
  const now = opts.now ?? Date.now;
  const entries = new Map<string, { at: number; value: Promise<T> }>();
  return {
    get(key: string, compute: () => Promise<T>): Promise<T> {
      const hit = entries.get(key);
      if (hit && now() - hit.at < opts.ttlMs) return hit.value;
      entries.delete(key);
      const entry = { at: now(), value: compute() };
      entries.set(key, entry);
      while (entries.size > max) entries.delete(entries.keys().next().value!);
      entry.value.catch(() => {
        if (entries.get(key) === entry) entries.delete(key);
      });
      return entry.value;
    },
  };
}

/** A row of a final ranking as it is kept (the looks and the level are read fresh for the rows shown). */
interface FinalRow {
  accountId: string;
  username: string;
  rank: number;
  score: number;
  tier: SeasonTier | null;
  podium: boolean;
}

const finals = createFinalsCache<FinalRow[]>({ ttlMs: FINALS_TTL_MS });

/** Accounts not banned now (a ban shows in the hall of fame and the history alike). */
const notBanned = sql<boolean>`(a.banned_until is null or a.banned_until <= now())`;

/** A season's final ranking: by rank, and among equals whoever won the podium's prize, then by name. */
function finalRanking(db: Kysely<DB>, season: string): Promise<FinalRow[]> {
  return finals.get(season, async () => {
    const rows = await db
      .selectFrom('galaxy.season_results as r')
      .innerJoin('galaxy.accounts as a', 'a.id', 'r.account_id')
      .select(['r.account_id', 'a.username', 'r.rank', 'r.score', 'r.tier', 'r.podium'])
      .where('r.season', '=', season)
      .where(notBanned)
      .orderBy('r.rank')
      .orderBy('r.podium', 'desc')
      .orderBy('a.username')
      .execute();
    return rows.map((r) => ({ accountId: r.account_id, username: r.username, rank: r.rank, score: r.score, tier: r.tier as SeasonTier | null, podium: r.podium }));
  });
}

type ArchiveRow = { season: string; name: string; starts_at: Date; ends_at: Date; closed_at: Date; players: number; stats: unknown };

const pastOf = (a: ArchiveRow, podium: PastPodiumPlace[]): PastSeason => ({
  id: a.season,
  name: a.name,
  startsAt: a.starts_at.toISOString(),
  // A season replaced before its end closed then.
  endsAt: new Date(Math.min(a.ends_at.getTime(), a.closed_at.getTime())).toISOString(),
  players: a.players,
  podium,
  stats: seasonStatsOf(a.stats),
});

/** Every closed season, newest first, with the first three of its final ranking and its numbers. */
export async function seasonsHistory(db: Kysely<DB>): Promise<SeasonsHistory> {
  const archive = await db
    .selectFrom('galaxy.season_archive')
    .select(['season', 'name', 'starts_at', 'ends_at', 'closed_at', 'players', 'stats'])
    .orderBy('ends_at', 'desc')
    .limit(HISTORY_MAX)
    .execute();
  if (archive.length === 0) return { seasons: [] };
  const { rows } = await sql<{ season: string; username: string; rank: number; score: number; avatar: string | null; frame: string | null }>`
    select t.season, t.username, t.rank, t.score, t.avatar, t.frame from (
      select r.season, a.username, r.rank, r.score, a.avatar, a.frame,
        row_number() over (partition by r.season order by r.rank, r.podium desc, a.username) as place
      from galaxy.season_results r
      join galaxy.accounts a on a.id = r.account_id
      where r.season in (${sql.join(archive.map((a) => a.season))}) and r.rank <= 3 and ${notBanned}
    ) t
    where t.place <= 3
    order by t.season, t.place`.execute(db);
  return {
    seasons: archive.map((a) =>
      pastOf(
        a,
        rows.filter((p) => p.season === a.season).map((p) => ({ rank: p.rank, username: p.username, score: p.score, avatar: p.avatar, frame: p.frame })),
      ),
    ),
  };
}

/** What a closed season's record says: its tiers, the rows its table showed and what its close paid. */
async function recordOf(db: Kysely<DB>, a: ArchiveRow): Promise<{ tiers: number[]; top: number | null; closing: SeasonResults['season']['closing'] }> {
  const r = await db.selectFrom('galaxy.seasons').select(['rules', 'route']).where('id', '=', a.season).executeTakeFirst();
  if (!r) return { tiers: [], top: null, closing: null };
  try {
    const season = seasonConfigOf({ id: a.season, name: a.name, startsAt: a.starts_at.toISOString(), endsAt: a.ends_at.toISOString(), rules: (r.rules ?? {}) as object });
    return { tiers: [...season.tiers], top: season.top, closing: closingInfo(parseConfig('seasonRoute', r.route ?? {}).closing) };
  } catch {
    // A record that no longer reads: the ranking still shows, without its tiers and prizes.
    return { tiers: [], top: null, closing: null };
  }
}

/** The avatar, frame and level of the accounts shown, read fresh. */
async function looksOf(db: Kysely<DB>, ids: string[], account: AccountConfig): Promise<Map<string, { avatar: string | null; frame: string | null; level: number }>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .selectFrom('galaxy.accounts as a')
    .leftJoin('galaxy.account_xp as x', 'x.account_id', 'a.id')
    .select(['a.id', 'a.avatar', 'a.frame', 'x.xp'])
    .where('a.id', 'in', ids)
    .execute();
  return new Map(rows.map((r) => [r.id, { avatar: r.avatar, frame: r.frame, level: levelOf(Number(r.xp ?? 0), account).level }]));
}

/**
 * A closed season's final ranking from `offset`: `limit` rows, or as many as its table showed (its record's `top`, or
 * `fallbackTop` without one), with the viewer's row and the season's tiers, closing prizes and numbers.
 */
export async function seasonResults(
  db: Kysely<DB>,
  season: string,
  viewerId: string,
  query: { offset: number; limit?: number },
  account: AccountConfig,
  fallbackTop: number,
): Promise<SeasonResults> {
  const a = await db.selectFrom('galaxy.season_archive').select(['season', 'name', 'starts_at', 'ends_at', 'closed_at', 'players', 'stats']).where('season', '=', season).executeTakeFirst();
  if (!a) throw new HttpError(404, 'season_not_found');
  const [record, ranked] = await Promise.all([recordOf(db, a), finalRanking(db, season)]);
  const page = pageOf(ranked, query.offset, query.limit ?? record.top ?? fallbackTop);
  const mine = ranked.find((r) => r.accountId === viewerId) ?? null;
  const top = ranked.slice(0, 3);
  const looks = await looksOf(db, [...new Set([...top, ...page.rows, ...(mine ? [mine] : [])].map((r) => r.accountId))], account);
  const row = (r: FinalRow): PastRow => {
    const l = looks.get(r.accountId);
    return { rank: r.rank, username: r.username, level: l?.level ?? 1, value: r.score, avatar: l?.avatar ?? null, frame: l?.frame ?? null, tier: r.tier, podium: r.podium };
  };
  const podium = top.map((r) => ({ rank: r.rank, username: r.username, score: r.score, avatar: looks.get(r.accountId)?.avatar ?? null, frame: looks.get(r.accountId)?.frame ?? null }));
  return {
    season: { ...pastOf(a, podium), tiers: record.tiers, closing: record.closing },
    rows: page.rows.map(row),
    me: mine ? row(mine) : null,
    total: ranked.length,
    next: page.next,
  };
}
