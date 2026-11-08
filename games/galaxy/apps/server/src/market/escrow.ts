import { type Kysely, sql } from 'kysely';
import type { DB } from '../db/schema';

// Where a galaxy is held (M5c-1, M5c-2): equipped in the hangar, on a pedestal of the planetarium, for sale in the market
// or offered in a swap.
// A galaxy held one way cannot be spent another: each check runs after its caller locked the galaxy rows, as a fresh
// statement, so it sees what committed meanwhile.

export async function isEquipped(trx: Kysely<DB>, ids: string[]): Promise<boolean> {
  const row = await trx.selectFrom('galaxy.loadouts').select('slot').where('galaxy_id', 'in', ids).limit(1).executeTakeFirst();
  return row !== undefined;
}

export async function isExhibited(trx: Kysely<DB>, ids: string[]): Promise<boolean> {
  const row = await trx.selectFrom('galaxy.exhibits').select('slot').where('galaxy_id', 'in', ids).limit(1).executeTakeFirst();
  return row !== undefined;
}

/** For sale right now: an active listing that has not expired (an expired one frees the galaxy without a job). */
export async function isListed(trx: Kysely<DB>, ids: string[]): Promise<boolean> {
  const row = await trx
    .selectFrom('galaxy.market_listings')
    .select('id')
    .where('galaxy_id', 'in', ids)
    .where('status', '=', 'active')
    .where('expires_at', '>', sql<Date>`now()`)
    .limit(1)
    .executeTakeFirst();
  return row !== undefined;
}

/** Offered by its owner in an open trade that has not expired (M5c-2); `except` leaves one trade out. */
export async function isTraded(trx: Kysely<DB>, ids: string[], except: string | null = null): Promise<boolean> {
  let q = trx
    .selectFrom('galaxy.trades')
    .select('id')
    .where('status', '=', 'open')
    .where('expires_at', '>', sql<Date>`now()`)
    .where((eb) => eb.or([eb.and([eb('a_galaxy', 'in', ids), eb('a_offered', '=', true)]), eb.and([eb('b_galaxy', 'in', ids), eb('b_offered', '=', true)])]));
  if (except) q = q.where('id', '!=', except);
  return (await q.limit(1).executeTakeFirst()) !== undefined;
}

export type Hold = 'equipped' | 'exhibited' | 'listed' | 'traded';

/**
 * Frees a galaxy from every hold (M6a revoke, M6c-2 revert): out of the loadout and the planetarium, its active listing
 * cancelled and any open trade that names it cancelled. Says which holds it had. The caller has locked the galaxy.
 */
export async function releaseHolds(trx: Kysely<DB>, galaxyId: string): Promise<Hold[]> {
  const held: Hold[] = [];
  if (Number((await trx.deleteFrom('galaxy.loadouts').where('galaxy_id', '=', galaxyId).executeTakeFirst()).numDeletedRows) > 0) held.push('equipped');
  if (Number((await trx.deleteFrom('galaxy.exhibits').where('galaxy_id', '=', galaxyId).executeTakeFirst()).numDeletedRows) > 0) held.push('exhibited');
  const listed = await trx.updateTable('galaxy.market_listings').set({ status: 'cancelled' }).where('galaxy_id', '=', galaxyId).where('status', '=', 'active').executeTakeFirst();
  if (Number(listed.numUpdatedRows) > 0) held.push('listed');
  const traded = await trx
    .updateTable('galaxy.trades')
    .set({ status: 'cancelled', closed_at: sql<Date>`now()` })
    .where('status', '=', 'open')
    .where((eb) => eb.or([eb('a_galaxy', '=', galaxyId), eb('b_galaxy', '=', galaxyId)]))
    .executeTakeFirst();
  if (Number(traded.numUpdatedRows) > 0) held.push('traded');
  return held;
}

/** `traded`, as a selectable column of galaxy.galaxies. */
export const tradedColumn = sql<boolean>`exists (select 1 from galaxy.trades t where t.status = 'open' and t.expires_at > now() and ((t.a_galaxy = galaxy.galaxies.id and t.a_offered) or (t.b_galaxy = galaxy.galaxies.id and t.b_offered)))`.as(
  'traded',
);

/** `listed`, as a selectable column of galaxy.galaxies. */
export const listedColumn = sql<boolean>`exists (select 1 from galaxy.market_listings m where m.galaxy_id = galaxy.galaxies.id and m.status = 'active' and m.expires_at > now())`.as(
  'listed',
);
