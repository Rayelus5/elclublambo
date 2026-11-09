import {
  type ExhibitsRequest,
  type GalaxySummary,
  type PlanetariumCard,
  type PlanetariumConfig,
  type PlanetariumView,
  type PlanetariumVisit,
  planetariumBonus,
  prestige,
  type PublicGalaxy,
} from '@galaxy/shared';
import { type Kysely, sql } from 'kysely';
import { summary } from '../collection/service';
import type { ConfigReader } from '../config/reader';
import type { DB } from '../db/schema';
import { inTransaction } from '../db/tx';
import { HttpError } from '../errors';
import { isListed, isTraded } from '../market/escrow';

// The planetarium (GDD §10.5, §14.2; M4c-2): the galaxies a player exhibits, one per pedestal, add prestige and a small
// experience bonus; anyone signed in visits a planetarium by name and sees only what it exhibits; a visit counts once
// per visitor and UTC day, never one's own; the featured list shows other planetariums with something on display.

export type PlanetariumDeps = { db: Kysely<DB>; config: ConfigReader };

const COLUMNS = ['id', 'seed', 'tier', 'finish', 'traits', 'name', 'designation', 'featured', 'level', 'created_at', 'score'] as const;

/** The live galaxies on an account's pedestals, in order (only the pedestals there are). */
export async function exhibitsOf(db: Kysely<DB>, accountId: string, slots: number): Promise<(GalaxySummary | null)[]> {
  const rows = await db
    .selectFrom('galaxy.exhibits as e')
    .innerJoin('galaxy.galaxies as g', 'g.id', 'e.galaxy_id')
    .select(['e.slot', ...COLUMNS.map((c) => `g.${c}` as const), sql<boolean>`exists (select 1 from galaxy.loadouts l where l.galaxy_id = g.id)`.as('equipped')])
    .where('e.account_id', '=', accountId)
    .where('g.owner_id', '=', accountId)
    .where('g.disintegrated_at', 'is', null)
    .execute();
  const out: (GalaxySummary | null)[] = Array.from({ length: slots }, () => null);
  for (const r of rows) if (r.slot <= slots) out[r.slot - 1] = summary({ ...r, exhibited: true });
  return out;
}

/** What a run snapshots at its start: the bonus of what is on display now. */
export async function planetariumXp(db: Kysely<DB>, accountId: string, cfg: PlanetariumConfig): Promise<number> {
  const shown = (await exhibitsOf(db, accountId, cfg.slots)).filter((g): g is GalaxySummary => g !== null);
  return planetariumBonus(prestige(shown, cfg), cfg);
}

/** A galaxy as a visitor sees it: the card and its level, nothing about the owner's account. */
export function publicGalaxy(g: GalaxySummary): PublicGalaxy {
  return { id: g.id, seed: g.seed, tier: g.tier, finish: g.finish, traits: g.traits, name: g.name, designation: g.designation, featured: g.featured, level: g.level };
}

/** The most prestigious galaxy on display (the first one among equals), as anyone may see it. */
export function coverOf(shown: GalaxySummary[], cfg: PlanetariumConfig): PublicGalaxy | null {
  const best = shown.reduce<GalaxySummary | null>((b, g) => (b === null || prestige([g], cfg) > prestige([b], cfg) ? g : b), null);
  return best && publicGalaxy(best);
}

async function visitsOf(db: Kysely<DB>, ownerId: string): Promise<number> {
  const row = await db.selectFrom('galaxy.planetarium_visits').select(sql<number>`count(*)::int`.as('n')).where('owner_id', '=', ownerId).executeTakeFirstOrThrow();
  return row.n;
}

/**
 * Other planetariums with something on display (not banned), by prestige, the newest account first among equals;
 * each with its most prestigious galaxy as the cover.
 */
async function featuredFor(db: Kysely<DB>, viewerId: string, cfg: PlanetariumConfig): Promise<PlanetariumCard[]> {
  const points = sql<number>`((${sql.val(cfg.points.tiers)}::int[])[g.tier + 1] + case when g.finish = 'normal' then 0 else ${cfg.points.finish}::int end)`;
  const top = await db
    .selectFrom('galaxy.exhibits as e')
    .innerJoin('galaxy.galaxies as g', 'g.id', 'e.galaxy_id')
    .innerJoin('galaxy.accounts as a', 'a.id', 'e.account_id')
    .select(['a.id', 'a.username', sql<number>`sum(${points})::int`.as('prestige'), sql<number>`count(*)::int`.as('exhibits')])
    .whereRef('g.owner_id', '=', 'e.account_id')
    .where('g.disintegrated_at', 'is', null)
    .where('e.slot', '<=', cfg.slots)
    .where('e.account_id', '<>', viewerId)
    .where((eb) => eb.or([eb('a.banned_until', 'is', null), eb('a.banned_until', '<=', sql<Date>`now()`)]))
    .groupBy(['a.id', 'a.username', 'a.created_at'])
    .orderBy('prestige', 'desc')
    .orderBy('a.created_at', 'desc')
    .orderBy('a.id')
    .limit(cfg.featured)
    .execute();
  return Promise.all(
    top.map(async (t) => {
      const shown = (await exhibitsOf(db, t.id, cfg.slots)).filter((g): g is GalaxySummary => g !== null);
      return { owner: t.username, prestige: t.prestige, exhibits: t.exhibits, cover: coverOf(shown, cfg) };
    }),
  );
}

export async function planetariumView(deps: PlanetariumDeps, accountId: string): Promise<PlanetariumView> {
  const cfg = await deps.config.get('planetarium');
  const exhibits = await exhibitsOf(deps.db, accountId, cfg.slots);
  const points = prestige(
    exhibits.filter((g): g is GalaxySummary => g !== null),
    cfg,
  );
  return {
    slots: cfg.slots,
    exhibits,
    prestige: points,
    bonus: planetariumBonus(points, cfg),
    cap: cfg.cap,
    visits: await visitsOf(deps.db, accountId),
    featured: await featuredFor(deps.db, accountId, cfg),
  };
}

/** Replaces what every pedestal holds: own live galaxies only, no more than the pedestals there are. */
export async function setExhibits(deps: PlanetariumDeps, accountId: string, req: ExhibitsRequest): Promise<PlanetariumView> {
  const cfg = await deps.config.get('planetarium');
  if (req.galaxies.length > cfg.slots) throw new HttpError(400, 'invalid_input');
  const ids = req.galaxies.filter((x): x is string => x !== null);
  await inTransaction(deps.db, async (trx) => {
    await sql`select pg_advisory_xact_lock(hashtextextended(${`planetarium:${accountId}`}, 0))`.execute(trx);
    if (ids.length > 0) {
      // Lock the chosen galaxies: a disintegration or fusion of one of them waits for this, then sees it exhibited.
      const live = await trx
        .selectFrom('galaxy.galaxies')
        .select('id')
        .where('id', 'in', ids)
        .where('owner_id', '=', accountId)
        .where('disintegrated_at', 'is', null)
        .orderBy('id')
        .forUpdate()
        .execute();
      if (live.length !== ids.length) throw new HttpError(404, 'galaxy_not_found');
      if (await isListed(trx, ids)) throw new HttpError(409, 'galaxy_listed');
      if (await isTraded(trx, ids)) throw new HttpError(409, 'galaxy_in_trade');
    }
    await trx.deleteFrom('galaxy.exhibits').where('account_id', '=', accountId).execute();
    const rows = req.galaxies.flatMap((g, i) => (g ? [{ account_id: accountId, slot: i + 1, galaxy_id: g }] : []));
    if (rows.length > 0) await trx.insertInto('galaxy.exhibits').values(rows).execute();
  });
  return planetariumView(deps, accountId);
}

/** A visit: what the owner exhibits, and the visit counted (once a day, never one's own). */
export async function visitPlanetarium(deps: PlanetariumDeps, visitorId: string, username: string): Promise<PlanetariumVisit> {
  const cfg = await deps.config.get('planetarium');
  const owner = await deps.db.selectFrom('galaxy.accounts').select(['id', 'username']).where('username', '=', username).executeTakeFirst();
  if (!owner) throw new HttpError(404, 'planetarium_not_found');
  if (owner.id !== visitorId) {
    await deps.db
      .insertInto('galaxy.planetarium_visits')
      .values({ owner_id: owner.id, visitor_id: visitorId })
      .onConflict((oc) => oc.columns(['owner_id', 'visitor_id', 'day']).doNothing())
      .execute();
  }
  const exhibits = await exhibitsOf(deps.db, owner.id, cfg.slots);
  return {
    owner: owner.username,
    exhibits: exhibits.map((g) => g && publicGalaxy(g)),
    prestige: prestige(
      exhibits.filter((g): g is GalaxySummary => g !== null),
      cfg,
    ),
    visits: await visitsOf(deps.db, owner.id),
  };
}
