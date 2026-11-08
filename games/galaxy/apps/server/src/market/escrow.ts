import { type Kysely, sql } from 'kysely';
import type { DB } from '../db/schema';

// Where a galaxy is held (M5c-1): equipped in the hangar, on a pedestal of the planetarium, or for sale in the market.
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

/** `listed`, as a selectable column of galaxy.galaxies. */
export const listedColumn = sql<boolean>`exists (select 1 from galaxy.market_listings m where m.galaxy_id = galaxy.galaxies.id and m.status = 'active' and m.expires_at > now())`.as(
  'listed',
);
