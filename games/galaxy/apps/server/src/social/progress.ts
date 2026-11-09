import { type AccountConfig, levelOf, type RunProgressInput, type RunResult, runXp, type SeasonConfig, seasonOpen, seasonPoints } from '@galaxy/shared';
import { type Kysely, sql } from 'kysely';
import type { DB } from '../db/schema';

// The account's progress from a run (GDD §12.1, §14.1; M5a): experience for every run that is not suspicious, added in
// the finishing transaction, and the season points it adds while the season is open (the leaderboard reads those
// from the runs themselves). A suspicious run gives neither.

export async function accountXp(db: Kysely<DB>, accountId: string): Promise<number> {
  const row = await db.selectFrom('galaxy.account_xp').select('xp').where('account_id', '=', accountId).executeTakeFirst();
  return Number(row?.xp ?? 0);
}

export async function accountLevel(db: Kysely<DB>, accountId: string, cfg: AccountConfig): Promise<number> {
  return levelOf(await accountXp(db, accountId), cfg).level;
}

export async function creditRunProgress(
  trx: Kysely<DB>,
  accountId: string,
  run: RunProgressInput & { suspicious: boolean },
  cfg: { account: AccountConfig; season: SeasonConfig },
  now: Date,
  /** Co-op (multiplayer plan): the season points scaled by the number of players. */
  pointsFactor = 1,
): Promise<RunResult['progress']> {
  const gained = run.suspicious ? 0 : runXp(run, cfg.account);
  let total: number;
  if (gained > 0) {
    const row = await trx
      .insertInto('galaxy.account_xp')
      .values({ account_id: accountId, xp: gained, updated_at: now })
      .onConflict((oc) => oc.column('account_id').doUpdateSet({ xp: sql`galaxy.account_xp.xp + ${gained}`, updated_at: now }))
      .returning('xp')
      .executeTakeFirstOrThrow();
    total = Number(row.xp);
  } else {
    total = await accountXp(trx, accountId);
  }
  const level = levelOf(total, cfg.account).level;
  return {
    xp: gained,
    level,
    levelUp: level > levelOf(total - gained, cfg.account).level,
    points: !run.suspicious && seasonOpen(cfg.season, now) ? Math.floor(seasonPoints(run, cfg.season, cfg.account.minRunSeconds) * pointsFactor) : 0,
  };
}
