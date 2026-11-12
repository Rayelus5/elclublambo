import { type ClanColor, type ClanEmblem, type GalaxySummary, levelOf, prestige, type Profile, type PublicGalaxy, type PublicCollectionPage, type PublicCollectionQuery, seasonOpen, seasonTier, type Tier, TIERS } from '@galaxy/shared';
import { type Kysely, sql } from 'kysely';
import { listGalaxies, summary } from '../collection/service';
import type { DB } from '../db/schema';
import { HttpError } from '../errors';
import { coverOf, exhibitsOf, publicGalaxy } from '../planetarium/service';
import { ranking, type SocialDeps } from './leaderboard';
import { profileProbes } from './probes';
import { accountXp } from './progress';

// Public profiles and collections (GDD §14.2, §12.1; M5a): anyone signed in sees a player's level, season standing,
// records, collection by rarity and planetarium, and can browse their galaxies. Nothing private: no balances,
// loadout, probe or session.

export async function accountNamed(
  db: Kysely<DB>,
  username: string,
): Promise<{ id: string; username: string; created_at: Date; title: string | null; frame: string | null; avatar: string | null; banner: string | null }> {
  const row = await db.selectFrom('galaxy.accounts').select(['id', 'username', 'created_at', 'title', 'frame', 'avatar', 'banner']).where('username', '=', username).where('deleted_at', 'is', null).executeTakeFirst();
  if (!row) throw new HttpError(404, 'profile_not_found');
  return { id: row.id, username: row.username, created_at: new Date(row.created_at), title: row.title, frame: row.frame, avatar: row.avatar, banner: row.banner };
}

/** Their banner galaxy (Nov plan C2/C4), only while it is still theirs and alive. */
async function bannerOf(db: Kysely<DB>, ownerId: string, banner: string | null): Promise<PublicGalaxy | null> {
  if (!banner) return null;
  const g = await db
    .selectFrom('galaxy.galaxies')
    .select(['id', 'seed', 'tier', 'finish', 'traits', 'name', 'designation', 'featured', 'level', 'created_at', 'score'])
    .where('id', '=', banner)
    .where('owner_id', '=', ownerId)
    .where('disintegrated_at', 'is', null)
    .executeTakeFirst();
  return g ? publicGalaxy(summary(g)) : null;
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
          // Records are solo (multiplayer plan): group runs have their own ranking.
          sql<number>`coalesce(max(depth) filter (where coop_run_id is null), 0)::int`.as('maxDepth'),
          sql<number>`coalesce(sum(boss_kills) filter (where coop_run_id is null), 0)::int`.as('purges'),
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
    .select([
      sql<number>`coalesce(max(depth) filter (where coop_run_id is null), 0)::int`.as('maxDepth'),
      sql<number>`coalesce(sum(boss_kills) filter (where coop_run_id is null), 0)::int`.as('purges'),
      sql<number>`count(*)::int`.as('runs'),
    ])
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
  const clan = await db
    .selectFrom('galaxy.clan_members as m')
    .innerJoin('galaxy.clans as c', 'c.id', 'm.clan_id')
    .select(['c.tag', 'c.name', 'c.emblem', 'c.color'])
    .where('m.account_id', '=', owner.id)
    .executeTakeFirst();
  const lvl = levelOf(await accountXp(db, owner.id), account);
  return {
    username: owner.username,
    since: owner.created_at.toISOString(),
    level: lvl.level,
    xp: { into: lvl.into, next: lvl.next },
    season: standing,
    records,
    collection: { total: Object.values(counts).reduce((a, b) => a + b, 0), counts },
    planetarium: { prestige: prestige(shown, planetarium), exhibits: shown.length, cover: coverOf(shown, planetarium) },
    clan: clan ? { tag: clan.tag, name: clan.name, emblem: clan.emblem as ClanEmblem, color: clan.color as ClanColor } : null,
    title: owner.title,
    frame: owner.frame,
    avatar: owner.avatar,
    banner: await bannerOf(db, owner.id, owner.banner),
    probes: await profileProbes(deps, owner.id),
  };
}

/** A player's galaxies as anyone may see them, paged like the owner's collection. */
export async function publicCollection(deps: SocialDeps, username: string, q: PublicCollectionQuery): Promise<PublicCollectionPage> {
  const owner = await accountNamed(deps.db, username);
  const page = await listGalaxies({ db: deps.db, config: deps.config }, owner.id, q);
  return { items: page.items.map(publicGalaxy), ...(page.next ? { next: page.next } : {}), counts: page.counts };
}
