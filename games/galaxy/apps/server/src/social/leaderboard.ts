import { type AccountConfig, type ClanColor, type ClanEmblem, type ClanRow, type GroupRow, type Leaderboard, type LeaderRow, type LeaderTab, levelOf, type SeasonConfig, seasonOpen } from '@galaxy/shared';
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
const cache = new Map<string, { at: number; generation: number; rows: Promise<unknown> }>();
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
export function cachedRanking<T = Ranked[]>(key: string, compute: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.generation === generation && Date.now() - hit.at < TTL_MS) return hit.rows as Promise<T>;
  const entry = { at: Date.now(), generation, rows: compute() };
  cache.set(key, entry);
  entry.rows.catch(() => {
    if (cache.get(key) === entry) cache.delete(key);
  });
  return entry.rows;
}

type SoloTab = Exclude<LeaderTab, 'clans' | 'groups'>;

export function ranking(db: Kysely<DB>, cfg: SeasonConfig, tab: SoloTab, minRunSeconds: number): Promise<Ranked[]> {
  const key = JSON.stringify([cfg.id, cfg.startsAt, cfg.endsAt, cfg.points, cfg.capPerMinute, minRunSeconds, tab]);
  return cachedRanking(key, () => computeRanking(db, cfg, tab, minRunSeconds));
}

async function computeRanking(db: Kysely<DB>, cfg: SeasonConfig, tab: SoloTab, minRunSeconds: number): Promise<Ranked[]> {
  // Each run's points, never more than the cap per minute it lasted (packages/shared seasonPoints).
  // A co-op run's points are scaled by the players it started with (multiplayer plan: runs.points_factor).
  const points = sql`floor(least(r.depth * ${cfg.points.layer}::int + r.boss_kills * ${cfg.points.core}::int + case when r.outcome = 'extracted' then ${cfg.points.extraction}::int else 0 end, (r.seconds * ${cfg.capPerMinute}::int) / 60) * r.points_factor)::int`;
  // Group records live in the group ranking only: depth and purges count solo runs.
  const soloOnly = tab === 'general' ? sql`` : sql`and r.coop_run_id is null`;
  const value =
    tab === 'general' ? sql`sum(r.pts)` : tab === 'depth' ? sql`max(r.depth)` : sql`sum(r.boss_kills)`;
  // The season's runs, and in General the points an admin added or took away this season (M6d-4; depth 0, no cores).
  const adjustments =
    tab === 'general'
      ? sql`union all select s.account_id, s.points, 0, 0, s.created_at from galaxy.season_adjustments s where s.season = ${cfg.id}`
      : sql``;
  const reached =
    tab === 'general'
      ? sql`max(r.finished_at)`
      : tab === 'depth'
        ? sql`(array_agg(r.finished_at order by r.depth desc, r.finished_at asc))[1]`
        : sql`max(r.finished_at) filter (where r.boss_kills > 0)`;
  const { rows } = await sql<{ id: string; username: string; value: number; xp: string }>`
    select t.id, t.username, t.value, t.xp from (
      select a.id, a.username, (${value})::int as value, ${reached} as reached, coalesce(max(x.xp), 0) as xp
      from (
        select r.account_id, ${points} as pts, r.depth, r.boss_kills, r.finished_at
        from galaxy.runs r
        where r.finished_at >= ${new Date(cfg.startsAt)} and r.finished_at < ${new Date(cfg.endsAt)}
          and not r.suspicious
          and r.seconds >= ${minRunSeconds}::int
          ${soloOnly}
        ${adjustments}
      ) r
      join galaxy.accounts a on a.id = r.account_id
      left join galaxy.account_xp x on x.account_id = a.id
      where (a.banned_until is null or a.banned_until <= now())
        and not a.leaderboard_excluded
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

/** A group's best run of the season, with who played it (account ids, in slot order). */
export interface RankedGroup extends GroupRow {
  members: string[];
}

/**
 * The En grupo tab (multiplayer plan, phase 7): every group run that ended in the season and lasted the minimum, its
 * players all on the leaderboard (not banned nor excluded); each group (the same players, in any slots) keeps its best
 * run: the deepest layer, then the most Cores, then the fastest, then the first. Equal layer and Cores share a rank.
 */
export function groupRanking(db: Kysely<DB>, cfg: SeasonConfig, minRunSeconds: number): Promise<RankedGroup[]> {
  const key = JSON.stringify([cfg.id, cfg.startsAt, cfg.endsAt, minRunSeconds, 'groups']);
  return cachedRanking(key, async () => {
    const { rows } = await sql<{ id: string; players: unknown; depth: number; cores: number; ticks: number; outcome: GroupRow['outcome'] | null; members: string[]; names: string[] }>`
      select c.id, c.players, c.depth, coalesce(c.boss_kills, 0)::int as cores, c.ticks, c.outcome,
        array_agg(r.account_id::text order by r.slot) as members, array_agg(a.username order by r.slot) as names
      from galaxy.coop_runs c
      join galaxy.runs r on r.coop_run_id = c.id
      join galaxy.accounts a on a.id = r.account_id
      where c.state <> 'running' and c.depth > 0
        and c.ended_at >= ${new Date(cfg.startsAt)} and c.ended_at < ${new Date(cfg.endsAt)}
        and c.ticks >= ${minRunSeconds * 60}::int
      group by c.id
      having bool_and((a.banned_until is null or a.banned_until <= now()) and not a.leaderboard_excluded)
      order by c.depth desc, cores desc, c.ticks asc, c.ended_at asc`.execute(db);
    const seen = new Set<string>();
    const out: RankedGroup[] = [];
    for (const r of rows) {
      const team = [...r.members].sort().join(',');
      if (seen.has(team)) continue;
      seen.add(team);
      const probes = Array.isArray(r.players) ? (r.players as { probe?: unknown; skin?: unknown }[]) : [];
      const prev = out[out.length - 1];
      out.push({
        rank: prev && prev.depth === r.depth && prev.cores === r.cores ? prev.rank : out.length + 1,
        players: r.names.map((username, i) => ({
          username,
          probe: typeof probes[i]?.probe === 'string' ? (probes[i]!.probe as string) : 'lumen',
          skin: typeof probes[i]?.skin === 'string' ? (probes[i]!.skin as string) : null,
        })),
        depth: r.depth,
        cores: r.cores,
        seconds: Math.round(r.ticks / 60),
        outcome: r.outcome ?? 'interrupted',
        members: r.members,
      });
    }
    return out;
  });
}

const groupRow = ({ members: _members, ...g }: RankedGroup): GroupRow => g;

/** A clan with its current members' season points added up (rank null without points). */
export interface RankedClan {
  id: string;
  tag: string;
  name: string;
  emblem: ClanEmblem;
  color: ClanColor;
  open: boolean;
  members: number;
  value: number;
  rank: number | null;
  createdAt: Date;
}

/**
 * Every clan, ranked by the season points of its current members (GDD §14.1; M5b-1): read from the General ranking
 * (cached), so a clan's score moves with its members' runs and with who is in it now. Equal scores share a rank; the
 * older clan comes first.
 */
export async function clanRanking(db: Kysely<DB>, season: SeasonConfig, account: AccountConfig, now: Date): Promise<RankedClan[]> {
  const points = seasonOpen(season, now) ? new Map((await ranking(db, season, 'general', account.minRunSeconds)).map((r) => [r.accountId, r.value])) : new Map<string, number>();
  const rows = await db
    .selectFrom('galaxy.clans as c')
    .leftJoin('galaxy.clan_members as m', 'm.clan_id', 'c.id')
    .select(['c.id', 'c.tag', 'c.name', 'c.emblem', 'c.color', 'c.open', 'c.created_at', 'm.account_id'])
    .execute();
  const byId = new Map<string, RankedClan>();
  for (const r of rows) {
    const c = byId.get(r.id) ?? { id: r.id, tag: r.tag, name: r.name, emblem: r.emblem as ClanEmblem, color: r.color as ClanColor, open: r.open, members: 0, value: 0, rank: null, createdAt: new Date(r.created_at) };
    if (r.account_id) {
      c.members++;
      c.value += points.get(r.account_id) ?? 0;
    }
    byId.set(r.id, c);
  }
  const out = [...byId.values()].sort((a, b) => b.value - a.value || a.createdAt.getTime() - b.createdAt.getTime() || a.tag.localeCompare(b.tag));
  out.forEach((c, i) => {
    if (c.value <= 0) return;
    const prev = out[i - 1];
    c.rank = prev && prev.value === c.value && prev.rank !== null ? prev.rank : i + 1;
  });
  return out;
}

export const clanRow = (c: RankedClan): ClanRow => ({ rank: c.rank ?? 0, tag: c.tag, name: c.name, emblem: c.emblem, color: c.color, members: c.members, value: c.value });

const row = (r: Ranked, account: AccountConfig, looks: Map<string, { avatar: string | null; frame: string | null }> = new Map()): LeaderRow => ({
  rank: r.rank,
  username: r.username,
  level: levelOf(r.xp, account).level,
  value: r.value,
  avatar: looks.get(r.accountId)?.avatar ?? null,
  frame: looks.get(r.accountId)?.frame ?? null,
});

/** The avatar and frame of the accounts shown (Nov plan C2), read fresh: the ranking itself is cached. */
async function looksOf(db: SocialDeps['db'], ids: string[]): Promise<Map<string, { avatar: string | null; frame: string | null }>> {
  if (ids.length === 0) return new Map();
  const rows = await db.selectFrom('galaxy.accounts').select(['id', 'avatar', 'frame']).where('id', 'in', ids).execute();
  return new Map(rows.map((r) => [r.id, { avatar: r.avatar, frame: r.frame }]));
}

export async function leaderboard(deps: SocialDeps, viewerId: string, tab: LeaderTab): Promise<Leaderboard> {
  const [cfg, account] = await Promise.all([deps.config.get('season'), deps.config.get('account')]);
  if (!seasonOpen(cfg, deps.now())) return { season: null, tab, rows: [], me: null, total: 0 };
  const info = { id: cfg.id, name: cfg.name, startsAt: cfg.startsAt, endsAt: cfg.endsAt, tiers: [...cfg.tiers] };
  if (tab === 'clans') {
    const clans = (await clanRanking(deps.db, cfg, account, deps.now())).filter((c) => c.rank !== null);
    const own = await deps.db.selectFrom('galaxy.clan_members').select('clan_id').where('account_id', '=', viewerId).executeTakeFirst();
    const mine = own ? clans.find((c) => c.id === own.clan_id) : undefined;
    return { season: info, tab, rows: [], me: null, total: clans.length, clans: clans.slice(0, cfg.top).map(clanRow), myClan: mine ? clanRow(mine) : null };
  }
  if (tab === 'groups') {
    const groups = await groupRanking(deps.db, cfg, account.minRunSeconds);
    const mine = groups.find((g) => g.members.includes(viewerId));
    return { season: info, tab, rows: [], me: null, total: groups.length, groups: groups.slice(0, cfg.top).map(groupRow), myGroup: mine ? groupRow(mine) : null };
  }
  const ranked = await ranking(deps.db, cfg, tab, account.minRunSeconds);
  const mine = ranked.find((r) => r.accountId === viewerId);
  const top = ranked.slice(0, cfg.top);
  const looks = await looksOf(deps.db, [...top.map((r) => r.accountId), ...(mine ? [mine.accountId] : [])]);
  return {
    season: info,
    tab,
    rows: top.map((r) => row(r, account, looks)),
    me: mine ? row(mine, account, looks) : null,
    total: ranked.length,
  };
}
