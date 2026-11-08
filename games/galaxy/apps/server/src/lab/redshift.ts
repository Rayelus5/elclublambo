import { type AccountConfig, levelOf, type RedshiftConfig, type RedshiftView } from '@galaxy/shared';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema';
import { HttpError } from '../errors';
import type { RunsDeps } from '../runs/hangar';
import { accountXp } from '../social/progress';
import { lockStation, settleStation } from '../station/service';
import { labLevels } from './levels';

// The prestige «Corrimiento al rojo» on the server (GDD §12.5; M7e-2). Taking a rank, under the station's lock: the
// refinery is settled first (the Laboratorio's station nodes change its rate), then the Laboratorio's nodes are deleted
// and its room goes back to level 0 (to be repaired again); the rank goes up and its title is earned. The bonus is read
// at every run's start (runs/service.ts).

type Db = Kysely<DB>;

/** The account's rank (0 without one). */
export async function redshiftRank(db: Db, accountId: string): Promise<number> {
  return (await db.selectFrom('galaxy.redshift').select('rank').where('account_id', '=', accountId).executeTakeFirst())?.rank ?? 0;
}

export async function redshiftView(db: Db, cfg: RedshiftConfig, account: AccountConfig, accountId: string): Promise<RedshiftView> {
  const [rank, xp, levels] = await Promise.all([redshiftRank(db, accountId), accountXp(db, accountId), labLevels(db, accountId)]);
  const level = levelOf(xp, account).level;
  const lab = Object.values(levels).reduce((a, b) => a + b, 0);
  const top = rank >= cfg.maxRank;
  const needed = top ? null : cfg.labLevels[rank]!;
  return {
    rank,
    maxRank: cfg.maxRank,
    minLevel: cfg.minLevel,
    level,
    labLevels: lab,
    needed,
    eligible: !top && level >= cfg.minLevel && lab >= needed!,
    bonus: { xp: cfg.bonus.xp * rank, luck: cfg.bonus.luck * rank },
    next: top ? null : { xp: cfg.bonus.xp * (rank + 1), luck: cfg.bonus.luck * (rank + 1), title: cfg.titles[rank] ?? null },
  };
}

/** Takes the next rank when everything is met; the view is read again under the lock, so a stale button cannot. */
export async function takeRedshift(deps: RunsDeps, trx: Db, cfg: RedshiftConfig, account: AccountConfig, accountId: string): Promise<RedshiftView> {
  await lockStation(trx, accountId);
  const v = await redshiftView(trx, cfg, account, accountId);
  if (!v.eligible) throw new HttpError(409, 'redshift_not_ready');
  await settleStation(deps, trx, accountId);
  const now = deps.now();
  await trx.deleteFrom('galaxy.lab_nodes').where('account_id', '=', accountId).execute();
  await trx.updateTable('galaxy.station_rooms').set({ level: 0, updated_at: now }).where('account_id', '=', accountId).where('room', '=', 'lab').execute();
  await trx
    .insertInto('galaxy.redshift')
    .values({ account_id: accountId, rank: v.rank + 1, updated_at: now })
    .onConflict((oc) => oc.column('account_id').doUpdateSet({ rank: v.rank + 1, updated_at: now }))
    .execute();
  if (v.next?.title) await trx.insertInto('galaxy.cosmetics').values({ account_id: accountId, kind: 'title', value: v.next.title }).onConflict((oc) => oc.doNothing()).execute();
  return redshiftView(trx, cfg, account, accountId);
}
