import type { SeasonConfig, TournamentFilters, TournamentMetric } from '@galaxy/shared';
import { type Kysely, type RawBuilder, sql } from 'kysely';
import type { DB } from '../db/schema';
import { runPointsSql } from '../social/leaderboard';

// A tournament's ranking (plan «temporadas como fichas», part 5; GDD §13.3), always computed by the server from runs:
// the runs of its entrants (not left, not disqualified, not banned nor out of the leaderboard) that finished in
// [max(joined_at, starts_at), ends_at) — for `season_points`, from the season's start — and are not suspicious, last
// the account's minimum, pass its filters and were not discarded in its review. Only runs count, never missions or
// adjustments. Ties go to whoever got there first, then the name: every place is its own, so each has its prize. The
// whole ranking is kept 30 s per tournament and dropped when a run of one of its entrants finishes.

/** What the ranking needs of a tournament. */
export interface TournamentScoring {
  id: string;
  startsAt: string;
  endsAt: string;
  metric: TournamentMetric;
  filters: TournamentFilters;
}

/** A live entrant with what it scored (0 without a run that counts) and its place (null without a score). */
export interface RankedEntrant {
  accountId: string;
  username: string;
  avatar: string | null;
  frame: string | null;
  /** The account can win prizes (galaxy.accounts.prize_eligible). */
  eligible: boolean;
  value: number;
  /** Its runs that count. */
  runs: number;
  /** When it reached its score (the tie-break), or null. */
  reached: string | null;
  rank: number | null;
}

export interface TournamentRanking {
  /** Those with a score, in order, ranked 1, 2, 3… */
  rows: RankedEntrant[];
  /** Every live entrant, with or without a score. */
  entrants: Map<string, RankedEntrant>;
}

/**
 * Each measure as SQL over the counted runs `c` of one entrant (`c.pts` is a run's season points): its value and when
 * it was reached. A sum is reached by the last run that added to it; a best (one run's points, the deepest layer) by
 * the first run that gave it.
 */
export function metricExpressions(metric: TournamentMetric): { value: string; reached: string } {
  const firstBest = (col: string) => `(array_agg(c.finished_at order by ${col} desc nulls last, c.finished_at asc) filter (where c.id is not null))[1]`;
  switch (metric) {
    case 'points':
    case 'season_points':
      return { value: 'coalesce(sum(c.pts), 0)', reached: 'max(c.finished_at) filter (where c.pts > 0)' };
    case 'best_run':
      return { value: 'coalesce(max(c.pts), 0)', reached: firstBest('c.pts') };
    case 'kills':
      return { value: 'coalesce(sum(c.kills), 0)', reached: 'max(c.finished_at) filter (where c.kills > 0)' };
    case 'cores':
      return { value: 'coalesce(sum(c.boss_kills), 0)', reached: 'max(c.finished_at) filter (where c.boss_kills > 0)' };
    case 'runs':
      return { value: 'count(c.id)', reached: 'max(c.finished_at)' };
    case 'extractions':
      return { value: "count(c.id) filter (where c.outcome = 'extracted')", reached: "max(c.finished_at) filter (where c.outcome = 'extracted')" };
    case 'depth':
      return { value: 'coalesce(max(c.depth), 0)', reached: firstBest('c.depth') };
  }
}

/** The filters as conditions on `galaxy.runs r` (the level is checked when signing up, never on the runs). */
export function filterSql(f: TournamentFilters): RawBuilder<unknown> {
  const parts: RawBuilder<unknown>[] = [];
  if (f.sector) parts.push(sql`and r.sector = ${f.sector}`);
  if (f.probe) parts.push(sql`and r.probe = ${f.probe}`);
  if (f.mode === 'solo') parts.push(sql`and r.coop_run_id is null`);
  if (f.mode === 'coop') parts.push(sql`and r.coop_run_id is not null`);
  return parts.length === 0 ? sql`` : sql.join(parts, sql` `);
}

/**
 * The counted runs of a tournament's live entrants, with each run's points (`pts`), as a subquery. The one place the
 * rules of what counts live: the ranking, the review's queue and a player's «tus partidas» all read it.
 */
export function countedRunsSql(t: TournamentScoring, season: SeasonConfig, minRunSeconds: number): RawBuilder<unknown> {
  const from = t.metric === 'season_points' ? sql`${new Date(season.startsAt)}::timestamptz` : sql`greatest(e.joined_at, ${new Date(t.startsAt)}::timestamptz)`;
  return sql`
    select e.account_id, r.id, r.finished_at, r.kills, r.depth, r.boss_kills, r.outcome, r.coop_run_id, r.sector, r.probe, r.sim_version, ${runPointsSql(season)} as pts
    from galaxy.tournament_entries e
    join galaxy.runs r on r.account_id = e.account_id
    where e.tournament_id = ${t.id} and e.left_at is null and not e.disqualified
      and r.finished_at >= ${from} and r.finished_at < ${new Date(t.endsAt)}::timestamptz
      and not r.suspicious
      and r.seconds >= ${minRunSeconds}::int
      ${filterSql(t.filters)}
      and not exists (select 1 from galaxy.tournament_checks k where k.tournament_id = e.tournament_id and k.run_id = r.id and k.decision = 'discard')`;
}

/** Ranks the entrants with a score: the score, then who reached it first, then the name; 1, 2, 3… with no shared place. */
export function orderRanking(all: readonly RankedEntrant[]): RankedEntrant[] {
  const at = (r: RankedEntrant) => (r.reached ? Date.parse(r.reached) : Number.POSITIVE_INFINITY);
  return all
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value || at(a) - at(b) || (a.username < b.username ? -1 : a.username > b.username ? 1 : 0))
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

/** The ranking as it stands, straight from the database (the review and the results use it uncached). */
export async function computeTournamentRanking(db: Kysely<DB>, t: TournamentScoring, season: SeasonConfig, minRunSeconds: number): Promise<TournamentRanking> {
  const m = metricExpressions(t.metric);
  const { rows } = await sql<{ id: string; username: string; avatar: string | null; frame: string | null; eligible: boolean; value: string; reached: Date | null; runs: number }>`
    select a.id, a.username, a.avatar, a.frame, a.prize_eligible as eligible,
      (${sql.raw(m.value)})::bigint as value, ${sql.raw(m.reached)} as reached, count(c.id)::int as runs
    from galaxy.tournament_entries e
    join galaxy.accounts a on a.id = e.account_id
    left join (${countedRunsSql(t, season, minRunSeconds)}) c on c.account_id = e.account_id
    where e.tournament_id = ${t.id} and e.left_at is null and not e.disqualified
      and (a.banned_until is null or a.banned_until <= now())
      and not a.leaderboard_excluded
    group by a.id`.execute(db);
  const all: RankedEntrant[] = rows.map((r) => ({
    accountId: r.id,
    username: r.username,
    avatar: r.avatar,
    frame: r.frame,
    eligible: r.eligible,
    value: Number(r.value),
    runs: r.runs,
    reached: r.reached ? new Date(r.reached).toISOString() : null,
    rank: null,
  }));
  const ranked = orderRanking(all);
  const entrants = new Map(all.map((e) => [e.accountId, e]));
  for (const r of ranked) entrants.set(r.accountId, r);
  return { rows: ranked, entrants };
}

// ---------------------------------------------------------------------------------------------------------------------
// The cache: 30 s per tournament, one aggregate shared by the reads meanwhile.

const TTL_MS = 30_000;
const cache = new Map<string, { at: number; entrants: Set<string> | null; result: Promise<TournamentRanking> }>();

/**
 * The ranking under `key` (a tournament), computed once per 30 s and shared by the reads that arrive meanwhile. One
 * still in flight when it is invalidated answers its own callers but is never kept; a failed one is forgotten.
 */
export function cachedTournamentRanking(key: string, compute: () => Promise<TournamentRanking>): Promise<TournamentRanking> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.result;
  const entry: { at: number; entrants: Set<string> | null; result: Promise<TournamentRanking> } = { at: Date.now(), entrants: null, result: compute() };
  cache.set(key, entry);
  entry.result.then(
    (r) => {
      entry.entrants = new Set(r.entrants.keys());
    },
    () => {
      if (cache.get(key) === entry) cache.delete(key);
    },
  );
  return entry.result;
}

/**
 * A run of these accounts finished (or changed): every cached ranking they are entrants of is dropped, and those still
 * being computed (whose entrants are not known yet). Without accounts, every ranking (a ban, a mark, a sign-up).
 */
export function invalidateTournamentRankings(accounts?: readonly string[]): void {
  if (!accounts) {
    cache.clear();
    return;
  }
  for (const [key, entry] of cache) if (!entry.entrants || accounts.some((a) => entry.entrants!.has(a))) cache.delete(key);
}

/** One tournament's ranking is old (someone signed up, left or was disqualified; a check changed what counts). */
export function invalidateTournament(key: string): void {
  cache.delete(key);
}
