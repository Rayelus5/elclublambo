import { type CatalogView, catalogEntries, type ConfigValue } from '@galaxy/shared';
import { type Kysely, sql } from 'kysely';
import type { DB } from '../db/schema';
import { credit } from '../economy/wallet';
import { HttpError } from '../errors';
import { grantCosmetics } from '../cosmetics/service';

// The ECN Catalogue (GDD §12.3; M7b). What an account has found is read from the galaxies it holds and the ones it
// pulled (a pull stays found after a trade or a disintegration); each share of the album pays its reward once.

type CatalogConfig = ConfigValue<'catalog'>;

async function found(db: Kysely<DB>, accountId: string): Promise<Set<string>> {
  const { rows } = await sql<{ kind: string; value: string }>`
    with mine as (
      select g.traits, g.finish from galaxy.galaxies g where g.owner_id = ${accountId}
      union all
      select g.traits, g.finish from galaxy.gacha_pulls p join galaxy.galaxies g on g.id = p.galaxy_id where p.account_id = ${accountId}
    )
    select distinct 'galaxy_type' as kind, traits->>'galaxy_type' as value from mine
    union select distinct 'palette', traits->>'palette' from mine
    union select distinct 'phenomenon', traits->>'phenomenon' from mine
    union select distinct 'finish', finish from mine`.execute(db);
  return new Set(rows.filter((r) => r.value).map((r) => `${r.kind}:${r.value}`));
}

export async function catalogView(db: Kysely<DB>, cfg: CatalogConfig, accountId: string): Promise<CatalogView> {
  const [have, claims] = await Promise.all([found(db, accountId), db.selectFrom('galaxy.catalog_claims').select('percent').where('account_id', '=', accountId).execute()]);
  const entries = catalogEntries().map((e) => ({ ...e, found: have.has(`${e.kind}:${e.value}`) }));
  const n = entries.filter((e) => e.found).length;
  const percent = Math.floor((n / entries.length) * 100);
  const claimed = new Set(claims.map((c) => c.percent));
  return {
    entries,
    found: n,
    total: entries.length,
    percent,
    rewards: [...cfg.rewards].sort((a, b) => a.percent - b.percent).map((r) => ({ percent: r.percent, reward: r.reward, reached: percent >= r.percent, claimed: claimed.has(r.percent) })),
  };
}

/** Collects the reward of a share of the album (once) that the account has reached. */
export async function claimCatalog(trx: Kysely<DB>, cfg: CatalogConfig, accountId: string, percent: number, key: string): Promise<void> {
  const r = cfg.rewards.find((x) => x.percent === percent);
  if (!r) throw new HttpError(404, 'catalog_reward_not_found');
  const view = await catalogView(trx, cfg, accountId);
  if (view.percent < percent) throw new HttpError(409, 'mission_not_ready');
  const won = await trx.insertInto('galaxy.catalog_claims').values({ account_id: accountId, percent }).onConflict((oc) => oc.doNothing()).returning('percent').executeTakeFirst();
  if (!won) throw new HttpError(409, 'already_claimed');
  for (const cur of ['coins', 'dust', 'signal'] as const) {
    const n = r.reward[cur];
    if (n > 0) await credit(trx, accountId, cur, n, 'catalog', { percent }, key);
  }
  await grantCosmetics(trx, accountId, r.reward);
}
