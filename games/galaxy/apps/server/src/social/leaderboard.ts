import { type AccountConfig, type Leaderboard, type LeaderRow, type LeaderTab, levelOf, type SeasonConfig, seasonOpen } from '@galaxy/shared';
import { type Kysely, sql } from 'kysely';
import type { ConfigReader } from '../config/reader';
import type { DB } from '../db/schema';

// The season leaderboard (GDD §14.1; M5a), read from the season's finished runs that are not suspicious:
// - General: the score (points per layer, per Core and for extracting);
// - Profundidad: the deepest layer;
// - Purgas: the Cores purged.
// Equal values share a competition rank. Among them, whoever got there first comes first: the last run that scored,
// or the first that reached the deepest layer. Then the name decides. Banned accounts are left out, and so are runs
// shorter than the account's minimum. The whole ranking is kept 30 s per season and tab (one aggregate shared by the
// reads meanwhile), and every finished run clears it.

export type SocialDeps = { db: Kysely<DB>; config: ConfigReader; now: () => Date };

export interface Ranked {
  accountId: string;
  username: string;
  value: number;
  rank: number;
  xp: number;
}

const TTL_MS = 30_000;
/** The promise of each ranking (reads at once share one aggregate), with the generation it was asked in. */
const cache = new Map<string, { at: number; generation: number; rows: Promise<Ranked[]> }>();
let generation = 0;

/** Forget every cached ranking: a run finished, so what was computed (or is being computed) before it is old. */
export function invalidateLeaderboard(): void {
  generation++;
  cache.clear();
}

/**
 * The ranking under `key`, computed once per 30 s and shared by the reads that arrive meanwhile. An aggregate still in
 * flight when the cache is invalidated answers its own callers but is never kept; a failed one is forgotten.
 */
export function cachedRanking(key: string, compute: () => Promise<Ranked[]>): Promise<Ranked[]> {
  const hit = cache.get(key);
  if (hit && hit.generation === generation && Date.now() - hit.at < TTL_MS) return hit.rows;
  const entry = { at: Date.now(), generation, rows: compute() };
  cache.set(key, entry);
  entry.rows.catch(() => {
    if (cache.get(key) === entry) cache.delete(key);
  });
  return entry.rows;
}

export function ranking(db: Kysely<DB>, cfg: SeasonConfig, tab: LeaderTab, minRunSeconds: number): Promise<Ranked[]> {
  const key = JSON.stringify([cfg.id, cfg.startsAt, cfg.endsAt, cfg.points, cfg.capPerMinute, minRunSeconds, tab]);
  return cachedRanking(key, () => computeRanking(db, cfg, tab, minRunSeconds));
}

async function computeRanking(db: Kysely<DB>, cfg: SeasonConfig, tab: LeaderTab, minRunSeconds: number): Promise<Ranked[]> {
  // Each run's points, never more than the cap per minute it lasted (packages/shared seasonPoints).
  const points = sql`least(r.depth * ${cfg.points.layer}::int + r.boss_kills * ${cfg.points.core}::int + case when r.outcome = 'extracted' then ${cfg.points.extraction}::int else 0 end, (r.seconds * ${cfg.capPerMinute}::int) / 60)`;
  const value =
    tab === 'general' ? sql`sum(${points})` : tab === 'depth' ? sql`max(r.depth)` : sql`sum(r.boss_kills)`;
  const reached =
    tab === 'general'
      ? sql`max(r.finished_at)`
      : tab === 'depth'
        ? sql`(array_agg(r.finished_at order by r.depth desc, r.finished_at asc))[1]`
        : sql`max(r.finished_at) filter (where r.boss_kills > 0)`;
  const { rows } = await sql<{ id: string; username: string; value: number; xp: string }>`
    select t.id, t.username, t.value, t.xp from (
      select a.id, a.username, (${value})::int as value, ${reached} as reached, coalesce(max(x.xp), 0) as xp
      from galaxy.runs r
      join galaxy.accounts a on a.id = r.account_id
      left join galaxy.account_xp x on x.account_id = a.id
      where r.finished_at >= ${new Date(cfg.startsAt)} and r.finished_at < ${new Date(cfg.endsAt)}
        and not r.suspicious
        and r.seconds >= ${minRunSeconds}::int
        and (a.banned_until is null or a.banned_until <= now())
      group by a.id, a.username
    ) t
    where t.value > 0
    order by t.value desc, t.reached asc, t.username asc`.execute(db);
  const out: Ranked[] = [];
  rows.forEach((r, i) => {
    const prev = out[i - 1];
    out.push({ accountId: r.id, username: r.username, value: r.value, rank: prev && prev.value === r.value ? prev.rank : i + 1, xp: Number(r.xp) });
  });
  return out;
}

const row = (r: Ranked, account: AccountConfig): LeaderRow => ({ rank: r.rank, username: r.username, level: levelOf(r.xp, account).level, value: r.value });

export async function leaderboard(deps: SocialDeps, viewerId: string, tab: LeaderTab): Promise<Leaderboard> {
  const [cfg, account] = await Promise.all([deps.config.get('season'), deps.config.get('account')]);
  if (!seasonOpen(cfg, deps.now())) return { season: null, tab, rows: [], me: null, total: 0 };
  const ranked = await ranking(deps.db, cfg, tab, account.minRunSeconds);
  const mine = ranked.find((r) => r.accountId === viewerId);
  return {
    season: { id: cfg.id, name: cfg.name, startsAt: cfg.startsAt, endsAt: cfg.endsAt, tiers: [...cfg.tiers] },
    tab,
    rows: ranked.slice(0, cfg.top).map((r) => row(r, account)),
    me: mine ? row(mine, account) : null,
    total: ranked.length,
  };
}
