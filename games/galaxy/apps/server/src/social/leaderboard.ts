import { type AccountConfig, type Leaderboard, type LeaderRow, type LeaderTab, levelOf, type SeasonConfig, seasonOpen } from '@galaxy/shared';
import { type Kysely, sql } from 'kysely';
import type { ConfigReader } from '../config/reader';
import type { DB } from '../db/schema';

// The season leaderboard (GDD §14.1; M5a), read from the season's finished runs that are not suspicious:
// - General: the score (points per layer, per Core and for extracting);
// - Profundidad: the deepest layer;
// - Purgas: the Cores purged.
// Equal values share a competition rank. Among them, whoever got there first comes first: the last run that scored,
// or the first that reached the deepest layer. Then the name decides. Banned accounts are left out. The whole ranking
// is kept 30 s per season and tab, so a busy screen does not add the runs up on every read.

export type SocialDeps = { db: Kysely<DB>; config: ConfigReader; now: () => Date };

export interface Ranked {
  accountId: string;
  username: string;
  value: number;
  rank: number;
  xp: number;
}

const TTL_MS = 30_000;
const cache = new Map<string, { at: number; rows: Ranked[] }>();

/** Forget every cached ranking (tests that add runs and read at once). */
export function invalidateLeaderboard(): void {
  cache.clear();
}

export async function ranking(db: Kysely<DB>, cfg: SeasonConfig, tab: LeaderTab): Promise<Ranked[]> {
  const key = JSON.stringify([cfg.id, cfg.startsAt, cfg.endsAt, cfg.points, tab]);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.rows;
  const points = sql`(r.depth * ${cfg.points.layer}::int + r.boss_kills * ${cfg.points.core}::int + case when r.outcome = 'extracted' then ${cfg.points.extraction}::int else 0 end)`;
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
  cache.set(key, { at: Date.now(), rows: out });
  return out;
}

const row = (r: Ranked, account: AccountConfig): LeaderRow => ({ rank: r.rank, username: r.username, level: levelOf(r.xp, account).level, value: r.value });

export async function leaderboard(deps: SocialDeps, viewerId: string, tab: LeaderTab): Promise<Leaderboard> {
  const [cfg, account] = await Promise.all([deps.config.get('season'), deps.config.get('account')]);
  if (!seasonOpen(cfg, deps.now())) return { season: null, tab, rows: [], me: null, total: 0 };
  const ranked = await ranking(deps.db, cfg, tab);
  const mine = ranked.find((r) => r.accountId === viewerId);
  return {
    season: { id: cfg.id, name: cfg.name, startsAt: cfg.startsAt, endsAt: cfg.endsAt, tiers: [...cfg.tiers] },
    tab,
    rows: ranked.slice(0, cfg.top).map((r) => row(r, account)),
    me: mine ? row(mine, account) : null,
    total: ranked.length,
  };
}
