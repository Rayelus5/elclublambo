import {
  type Achievement,
  type Frame,
  isoWeekOf,
  type Mission,
  type MissionCounts,
  type MissionPeriodView,
  type MissionsView,
  type MissionStat,
  pickMissions,
  seasonOpen,
} from '@galaxy/shared';
import { type Kysely, sql } from 'kysely';
import type { ConfigReader } from '../config/reader';
import type { DB } from '../db/schema';
import { madridDay, nextMadridMidnight } from '../economy/day';
import { credit } from '../economy/wallet';
import { HttpError } from '../errors';
import { invalidateLeaderboard } from '../social/leaderboard';

// Missions and achievements (GDD §12.1, §12.3, §14.1; M7a). What a run, a pull, a fusion, a disintegration or the
// refinery does is counted where it happens (countStats, in the same transaction); the day's and the week's missions are
// drawn the same for everyone; collecting pays once (a guarded update), in the ledger, and adds its season points.

type Periods = { daily: { period: string; list: Mission[]; endsAt: Date }; weekly: { period: string; list: Mission[]; endsAt: Date }; season: { period: string; list: Mission[] } | null };

/** What counting and collecting read from the live config: read it before a transaction, never inside one. */
export type MissionConfigs = Awaited<ReturnType<typeof missionConfigs>>;
export async function missionConfigs(config: ConfigReader) {
  const [missions, achievements, season] = await Promise.all([config.get('missions'), config.get('achievements'), config.get('season')]);
  return { missions, achievements: achievements.list as Achievement[], season };
}

function periodsOf(c: MissionConfigs, now: Date): Periods {
  const day = madridDay(now);
  const week = isoWeekOf(day);
  const midnight = nextMadridMidnight(now);
  // The week ends at the Monday midnight after today.
  let weekEnd = midnight;
  while (isoWeekOf(madridDay(weekEnd)) === week) weekEnd = nextMadridMidnight(weekEnd);
  return {
    daily: { period: `d:${day}`, list: pickMissions(c.missions.daily.pool as Mission[], c.missions.daily.count, `d:${day}`), endsAt: midnight },
    weekly: { period: `w:${week}`, list: pickMissions(c.missions.weekly.pool as Mission[], c.missions.weekly.count, `w:${week}`), endsAt: weekEnd },
    season: seasonOpen(c.season, now) ? { period: `s:${c.season.id}`, list: c.missions.season as Mission[] } : null,
  };
}

const grow = (stat: MissionStat, table: 'galaxy.mission_progress' | 'galaxy.achievement_progress', amount: number) =>
  stat === 'depth' ? sql<number>`greatest(${sql.ref(`${table}.progress`)}, ${amount})` : sql<number>`${sql.ref(`${table}.progress`)} + ${amount}`;

/** Adds what just happened to the account's missions of now and its achievements (in the caller's transaction). */
export async function countStats(trx: Kysely<DB>, c: MissionConfigs, accountId: string, counts: MissionCounts, now: Date): Promise<void> {
  const stats = (Object.keys(counts) as MissionStat[]).filter((k) => (counts[k] ?? 0) > 0);
  if (stats.length === 0) return;
  const p = periodsOf(c, now);
  for (const period of [p.daily, p.weekly, p.season]) {
    if (!period) continue;
    for (const m of period.list) {
      const amount = counts[m.stat];
      if (!amount || amount <= 0) continue;
      await trx
        .insertInto('galaxy.mission_progress')
        .values({ account_id: accountId, period: period.period, mission: m.id, progress: amount, updated_at: now })
        .onConflict((oc) => oc.columns(['account_id', 'period', 'mission']).doUpdateSet({ progress: grow(m.stat, 'galaxy.mission_progress', amount), updated_at: now }))
        .execute();
    }
  }
  for (const a of c.achievements) {
    const amount = counts[a.stat];
    if (!amount || amount <= 0) continue;
    await trx
      .insertInto('galaxy.achievement_progress')
      .values({ account_id: accountId, achievement: a.id, progress: amount, updated_at: now })
      .onConflict((oc) => oc.columns(['account_id', 'achievement']).doUpdateSet({ progress: grow(a.stat, 'galaxy.achievement_progress', amount), updated_at: now }))
      .execute();
    await trx
      .updateTable('galaxy.achievement_progress')
      .set({ unlocked_at: now })
      .where('account_id', '=', accountId)
      .where('achievement', '=', a.id)
      .where('unlocked_at', 'is', null)
      .where('progress', '>=', a.target)
      .execute();
  }
}

export async function missionsView(db: Kysely<DB>, c: MissionConfigs, accountId: string, now: Date): Promise<MissionsView> {
  const p = periodsOf(c, now);
  const periods = [p.daily.period, p.weekly.period, ...(p.season ? [p.season.period] : [])];
  const [rows, achievements, cosmetics, account] = await Promise.all([
    db.selectFrom('galaxy.mission_progress').select(['period', 'mission', 'progress', 'claimed_at']).where('account_id', '=', accountId).where('period', 'in', periods).execute(),
    db.selectFrom('galaxy.achievement_progress').select(['achievement', 'progress', 'unlocked_at', 'claimed_at']).where('account_id', '=', accountId).execute(),
    db.selectFrom('galaxy.cosmetics').select(['kind', 'value']).where('account_id', '=', accountId).orderBy('created_at').execute(),
    db.selectFrom('galaxy.accounts').select(['title', 'frame']).where('id', '=', accountId).executeTakeFirstOrThrow(),
  ]);
  let ready = 0;
  const view = (period: string, list: Mission[], endsAt: Date | null): MissionPeriodView => ({
    period,
    endsAt: endsAt ? endsAt.toISOString() : null,
    missions: list.map((m) => {
      const r = rows.find((x) => x.period === period && x.mission === m.id);
      const progress = Number(r?.progress ?? 0);
      const claimed = !!r?.claimed_at;
      if (!claimed && progress >= m.target) ready++;
      return { id: m.id, name: m.name, stat: m.stat, target: m.target, progress: Math.min(progress, m.target), claimed, reward: m.reward };
    }),
  });
  const daily = view(p.daily.period, p.daily.list, p.daily.endsAt);
  const weekly = view(p.weekly.period, p.weekly.list, p.weekly.endsAt);
  const season = p.season ? view(p.season.period, p.season.list, null) : null;
  return {
    daily,
    weekly,
    season,
    achievements: c.achievements.map((a) => {
      const r = achievements.find((x) => x.achievement === a.id);
      const unlocked = !!r?.unlocked_at;
      const claimed = !!r?.claimed_at;
      if (unlocked && !claimed) ready++;
      return { id: a.id, name: a.name, description: a.description, tier: a.tier, target: a.target, progress: Math.min(Number(r?.progress ?? 0), a.target), unlocked, claimed, reward: a.reward };
    }),
    ready,
    cosmetics: {
      titles: cosmetics.filter((x) => x.kind === 'title').map((x) => x.value),
      frames: cosmetics.filter((x) => x.kind === 'frame').map((x) => x.value as Frame),
      title: account.title,
      frame: (account.frame as Frame | null) ?? null,
    },
  };
}

async function pay(trx: Kysely<DB>, accountId: string, reward: { coins?: number; dust?: number; signal?: number; xp?: number; points?: number }, reason: 'mission' | 'achievement', ref: unknown, key: string, season: { id: string; open: boolean }, now: Date) {
  for (const cur of ['coins', 'dust', 'signal'] as const) {
    const n = reward[cur] ?? 0;
    if (n > 0) await credit(trx, accountId, cur, n, reason, ref, key);
  }
  if ((reward.xp ?? 0) > 0) {
    await trx
      .insertInto('galaxy.account_xp')
      .values({ account_id: accountId, xp: reward.xp!, updated_at: now })
      .onConflict((oc) => oc.column('account_id').doUpdateSet({ xp: sql`galaxy.account_xp.xp + ${reward.xp!}`, updated_at: now }))
      .execute();
  }
  if ((reward.points ?? 0) > 0 && season.open) {
    await trx.insertInto('galaxy.season_adjustments').values({ account_id: accountId, season: season.id, points: reward.points!, source: reason }).execute();
  }
}

/** Collects a mission of now (once) whose goal is reached. */
export async function claimMission(trx: Kysely<DB>, c: MissionConfigs, accountId: string, period: string, id: string, key: string, now: Date): Promise<void> {
  const p = periodsOf(c, now);
  const found = [p.daily, p.weekly, p.season].find((x) => x?.period === period);
  const mission = found?.list.find((m) => m.id === id);
  if (!found || !mission) throw new HttpError(404, 'mission_not_found');
  const row = await trx.selectFrom('galaxy.mission_progress').select(['progress', 'claimed_at']).where('account_id', '=', accountId).where('period', '=', period).where('mission', '=', id).forUpdate().executeTakeFirst();
  if (row?.claimed_at) throw new HttpError(409, 'already_claimed');
  if (!row || Number(row.progress) < mission.target) throw new HttpError(409, 'mission_not_ready');
  await trx.updateTable('galaxy.mission_progress').set({ claimed_at: now }).where('account_id', '=', accountId).where('period', '=', period).where('mission', '=', id).where('claimed_at', 'is', null).execute();
  await pay(trx, accountId, mission.reward, 'mission', { period, mission: id }, key, { id: c.season.id, open: seasonOpen(c.season, now) }, now);
  if (mission.reward.points > 0) invalidateLeaderboard();
}

/** Collects a reached achievement (once): its signals and points, and its title or frame to choose. */
export async function claimAchievement(trx: Kysely<DB>, c: MissionConfigs, accountId: string, id: string, key: string, now: Date): Promise<void> {
  const a = c.achievements.find((x) => x.id === id);
  if (!a) throw new HttpError(404, 'mission_not_found');
  const row = await trx.selectFrom('galaxy.achievement_progress').select(['unlocked_at', 'claimed_at']).where('account_id', '=', accountId).where('achievement', '=', id).forUpdate().executeTakeFirst();
  if (row?.claimed_at) throw new HttpError(409, 'already_claimed');
  if (!row?.unlocked_at) throw new HttpError(409, 'mission_not_ready');
  await trx.updateTable('galaxy.achievement_progress').set({ claimed_at: now }).where('account_id', '=', accountId).where('achievement', '=', id).where('claimed_at', 'is', null).execute();
  await pay(trx, accountId, { signal: a.reward.signal, points: a.reward.points }, 'achievement', { achievement: id }, key, { id: c.season.id, open: seasonOpen(c.season, now) }, now);
  for (const [kind, value] of [['title', a.reward.title], ['frame', a.reward.frame]] as const) {
    if (value) await trx.insertInto('galaxy.cosmetics').values({ account_id: accountId, kind, value }).onConflict((oc) => oc.doNothing()).execute();
  }
  if (a.reward.points > 0) invalidateLeaderboard();
}

/** Chooses the title and the frame shown on the profile (null: none), among the earned ones. */
export async function setCosmetics(db: Kysely<DB>, accountId: string, req: { title: string | null; frame: Frame | null }): Promise<void> {
  const owned = await db.selectFrom('galaxy.cosmetics').select(['kind', 'value']).where('account_id', '=', accountId).execute();
  if (req.title && !owned.some((o) => o.kind === 'title' && o.value === req.title)) throw new HttpError(409, 'cosmetic_locked');
  if (req.frame && !owned.some((o) => o.kind === 'frame' && o.value === req.frame)) throw new HttpError(409, 'cosmetic_locked');
  await db.updateTable('galaxy.accounts').set({ title: req.title, frame: req.frame }).where('id', '=', accountId).execute();
}
