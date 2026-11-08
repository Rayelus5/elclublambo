import { type GalaxySummary, levelOf, prestige, type Profile, type PublicCollectionPage, type PublicCollectionQuery, seasonOpen, seasonTier, type Tier, TIERS } from '@galaxy/shared';
import { type Kysely, sql } from 'kysely';
import { listGalaxies } from '../collection/service';
import type { DB } from '../db/schema';
import { HttpError } from '../errors';
import { coverOf, exhibitsOf, publicGalaxy } from '../planetarium/service';
import { ranking, type SocialDeps } from './leaderboard';
import { accountXp } from './progress';

// Public profiles and collections (GDD §14.2, §12.1; M5a): anyone signed in sees a player's level, season standing,
// records, collection by rarity and planetarium, and can browse their galaxies. Nothing private: no balances,
// loadout, probe or session.

async function accountNamed(db: Kysely<DB>, username: string): Promise<{ id: string; username: string; created_at: Date }> {
  const row = await db.selectFrom('galaxy.accounts').select(['id', 'username', 'created_at']).where('username', '=', username).executeTakeFirst();
  if (!row) throw new HttpError(404, 'profile_not_found');
  return { id: row.id, username: row.username, created_at: new Date(row.created_at) };
}

export async function profileOf(deps: SocialDeps, username: string): Promise<Profile> {
  const { db } = deps;
  const owner = await accountNamed(db, username);
  const [account, season, planetarium] = await Promise.all([deps.config.get('account'), deps.config.get('season'), deps.config.get('planetarium')]);

  let standing: Profile['season'] = null;
  if (seasonOpen(season, deps.now())) {
    const mine = (await ranking(db, season, 'general', account.minRunSeconds)).find((r) => r.accountId === owner.id);
    if (mine) {
      const s = await db
        .selectFrom('galaxy.runs')
        .select([
          sql<number>`coalesce(max(depth), 0)::int`.as('maxDepth'),
          sql<number>`coalesce(sum(boss_kills), 0)::int`.as('purges'),
          sql<number>`(count(*) filter (where outcome = 'extracted'))::int`.as('extractions'),
        ])
        .where('account_id', '=', owner.id)
        .where('finished_at', '>=', new Date(season.startsAt))
        .where('finished_at', '<', new Date(season.endsAt))
        .where('suspicious', '=', false)
        .where('seconds', '>=', account.minRunSeconds)
        .executeTakeFirstOrThrow();
      standing = { score: mine.value, rank: mine.rank, tier: seasonTier(mine.value, season), ...s };
    }
  }

  const records = await db
    .selectFrom('galaxy.runs')
    .select([sql<number>`coalesce(max(depth), 0)::int`.as('maxDepth'), sql<number>`coalesce(sum(boss_kills), 0)::int`.as('purges'), sql<number>`count(*)::int`.as('runs')])
    .where('account_id', '=', owner.id)
    .where('finished_at', 'is not', null)
    .where('suspicious', '=', false)
    .where('seconds', '>=', account.minRunSeconds)
    .executeTakeFirstOrThrow();

  const counted = await db
    .selectFrom('galaxy.galaxies')
    .select(['tier', sql<number>`count(*)::int`.as('n')])
    .where('owner_id', '=', owner.id)
    .where('disintegrated_at', 'is', null)
    .groupBy('tier')
    .execute();
  const counts = Object.fromEntries(TIERS.map((t) => [t, 0])) as Record<Tier, number>;
  for (const c of counted) counts[TIERS[c.tier]!] = c.n;

  const shown = (await exhibitsOf(db, owner.id, planetarium.slots)).filter((g): g is GalaxySummary => g !== null);
  return {
    username: owner.username,
    since: owner.created_at.toISOString(),
    level: levelOf(await accountXp(db, owner.id), account).level,
    season: standing,
    records,
    collection: { total: Object.values(counts).reduce((a, b) => a + b, 0), counts },
    planetarium: { prestige: prestige(shown, planetarium), exhibits: shown.length, cover: coverOf(shown, planetarium) },
  };
}

/** A player's galaxies as anyone may see them, paged like the owner's collection. */
export async function publicCollection(deps: SocialDeps, username: string, q: PublicCollectionQuery): Promise<PublicCollectionPage> {
  const owner = await accountNamed(deps.db, username);
  const page = await listGalaxies({ db: deps.db, config: deps.config }, owner.id, q);
  return { items: page.items.map(publicGalaxy), ...(page.next ? { next: page.next } : {}), counts: page.counts };
}
