import { randomBytes } from 'node:crypto';
import { ENGINE_VERSION } from '@galaxy/engine';
import {
  disintegrateYield,
  drawFinish,
  FINISHES,
  generateGalaxy,
  TIERS,
  validateFusion,
  type CollectionPage,
  type Finish,
  type GachaConfig,
  type GalaxiesConfig,
  type GalaxyDetail,
  type GalaxySummary,
  type Tier,
  type Wallet,
  type LabConfig,
  relicLevelCost,
  relicRefund,
  type RelicsConfig,
} from '@galaxy/shared';
import { type Kysely, type Selectable, sql } from 'kysely';
import { z } from 'zod';
import type { ConfigReader } from '../config/reader';
import type { DB, GalaxiesTable } from '../db/schema';
import { credit, debit, getWallet } from '../economy/wallet';
import { HttpError } from '../errors';
import { accountLabEffects } from '../lab/levels';

// The collection (GDD §8.5): owned galaxies, paged with a keyset cursor; disintegration into dust and fusion of
// `fusion.count` same-tier galaxies into one of the next tier. Both are idempotent operations (routes.ts) and lock
// the galaxies they consume, so a galaxy is never spent twice.
export type CollectionDeps = { db: Kysely<DB>; config: ConfigReader };

export const listQuerySchema = z
  .object({
    tier: z.enum(TIERS).optional(),
    type: z.string().regex(/^[a-z_]{1,24}$/).optional(),
    palette: z.string().regex(/^[a-z_]{1,24}$/).optional(),
    finish: z.enum(FINISHES).optional(),
    sort: z.enum(['new', 'rarity']).default('new'),
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(60).default(30),
  })
  .strict();
export type ListQuery = z.infer<typeof listQuerySchema>;

type Row = Selectable<GalaxiesTable>;
const SUMMARY = ['id', 'seed', 'tier', 'finish', 'traits', 'name', 'designation', 'featured', 'level', 'created_at', 'score'] as const;

/** `equipped`: whether a galaxy sits in a hangar slot (as a selectable column). */
const equippedColumn = sql<boolean>`exists (select 1 from galaxy.loadouts l where l.galaxy_id = galaxy.galaxies.id)`.as('equipped');

export function summary(r: Pick<Row, (typeof SUMMARY)[number]> & { equipped?: boolean }): GalaxySummary {
  return {
    id: r.id,
    seed: String(r.seed),
    tier: TIERS[r.tier]!,
    finish: r.finish as Finish,
    traits: r.traits,
    name: r.name,
    designation: r.designation,
    featured: r.featured,
    level: r.level,
    createdAt: new Date(r.created_at).toISOString(),
    equipped: r.equipped === true,
  };
}

type Cursor = { id: string };
const encode = (c: Cursor) => Buffer.from(JSON.stringify(c)).toString('base64url');
function decode(raw: string): Cursor {
  try {
    const c = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Cursor;
    if (typeof c.id !== 'string') throw new Error('cursor');
    return c;
  } catch {
    throw new HttpError(400, 'invalid_input');
  }
}

export async function listGalaxies(deps: CollectionDeps, ownerId: string, q: ListQuery): Promise<CollectionPage> {
  const { db } = deps;
  let query = db
    .selectFrom('galaxy.galaxies')
    .select([...SUMMARY, equippedColumn])
    .where('owner_id', '=', ownerId)
    .where('disintegrated_at', 'is', null);
  if (q.tier) query = query.where('tier', '=', TIERS.indexOf(q.tier));
  if (q.finish) query = query.where('finish', '=', q.finish);
  if (q.type) query = query.where(sql<string>`traits->>'galaxy_type'`, '=', q.type);
  if (q.palette) query = query.where(sql<string>`traits->>'palette'`, '=', q.palette);
  if (q.cursor) {
    // The cursor is the last row's id: the boundary is that row's own stored values, compared in SQL. Exact for
    // REAL scores and microsecond timestamps, which do not survive a round trip through JSON text.
    const { id } = decode(q.cursor);
    const at = sql`(select g.tier, g.score, g.created_at, g.id from galaxy.galaxies g where g.id = ${id}::uuid and g.owner_id = ${ownerId}::uuid)`;
    query =
      q.sort === 'rarity'
        ? query.where(sql<boolean>`(tier, score, id) < (select b.tier, b.score, b.id from ${at} as b)`)
        : query.where(sql<boolean>`(created_at, id) < (select b.created_at, b.id from ${at} as b)`);
  }
  query =
    q.sort === 'rarity'
      ? query.orderBy('tier', 'desc').orderBy('score', 'desc').orderBy('id', 'desc')
      : query.orderBy('created_at', 'desc').orderBy('id', 'desc');
  const rows = await query.limit(q.limit + 1).execute();
  const page = rows.slice(0, q.limit);
  const last = page[page.length - 1];
  const next = rows.length > q.limit && last ? encode({ id: last.id }) : undefined;
  const counted = await db
    .selectFrom('galaxy.galaxies')
    .select(['tier', sql<number>`count(*)::int`.as('n')])
    .where('owner_id', '=', ownerId)
    .where('disintegrated_at', 'is', null)
    .groupBy('tier')
    .execute();
  const counts = Object.fromEntries(TIERS.map((t) => [t, 0])) as Record<Tier, number>;
  for (const c of counted) counts[TIERS[c.tier]!] = c.n;
  const { fusion } = await deps.config.get('galaxies');
  const lab = await accountLabEffects(db, ownerId, await deps.config.get('lab'));
  return { items: page.map(summary), ...(next ? { next } : {}), counts, fusion: { count: fusion.count, dust: fusion.dust.map((d) => fusionDust(d, lab.fusion)) } };
}

/** The configs a galaxy's detail needs (read by the caller: inside an operation they must not take a second connection). */
export interface DetailConfigs {
  galaxies: GalaxiesConfig;
  lab: LabConfig;
  relics: RelicsConfig;
}

export async function galaxyDetail(deps: CollectionDeps, ownerId: string, id: string): Promise<GalaxyDetail> {
  const [galaxies, lab, relics] = await Promise.all([deps.config.get('galaxies'), deps.config.get('lab'), deps.config.get('relics')]);
  return detailOf(deps.db, ownerId, id, { galaxies, lab, relics });
}

async function detailOf(db: Kysely<DB>, ownerId: string, id: string, cfgs: DetailConfigs): Promise<GalaxyDetail> {
  const r = await db
    .selectFrom('galaxy.galaxies')
    .select([...SUMMARY, equippedColumn, 'origin', 'lineage', 'dna', 'level_dust'])
    .where('id', '=', id)
    .where('owner_id', '=', ownerId)
    .where('disintegrated_at', 'is', null)
    .executeTakeFirst();
  if (!r) throw new HttpError(404, 'galaxy_not_found');
  // Parents were consumed by the fusion (disintegrated), so they are read regardless of that, but only the owner's.
  const parents = r.lineage.length
    ? await db
        .selectFrom('galaxy.galaxies')
        .select(['id', 'name', 'designation', 'tier'])
        .where('id', 'in', r.lineage)
        .where('owner_id', '=', ownerId)
        .execute()
    : [];
  const byId = new Map(parents.map((p) => [p.id, p]));
  const lineage = r.lineage.flatMap((pid) => {
    const p = byId.get(pid);
    return p ? [{ id: p.id, name: p.name, designation: p.designation, tier: TIERS[p.tier]! }] : [];
  });
  const lab = await accountLabEffects(db, ownerId, cfgs.lab);
  const next = relicLevelCost(r.level, cfgs.relics);
  const refund = relicRefund(r.level_dust, cfgs.relics);
  return {
    ...summary(r),
    origin: r.origin,
    lineage,
    dna: r.dna,
    dust: disintegrationDust(disintegrateYield(r.tier, r.finish as Finish, cfgs.galaxies), lab.disintegrate) + refund,
    levelUp: next === null ? null : { dust: next },
    refund,
  };
}

/**
 * Buys a galaxy's next level (GDD §8.4 bis, M4c-1), naming it: 404 for one that is not the owner's or is gone, 409
 * relic_maxed at 10 and relic_changed with a stale view; the dust is recorded in level_dust for the refund.
 */
export async function levelUpGalaxy(cfgs: DetailConfigs, trx: Kysely<DB>, ownerId: string, id: string, level: number, opKey: string): Promise<{ galaxy: GalaxyDetail; wallet: Wallet }> {
  const row = await trx
    .selectFrom('galaxy.galaxies')
    .select(['level'])
    .where('id', '=', id)
    .where('owner_id', '=', ownerId)
    .where('disintegrated_at', 'is', null)
    .forUpdate()
    .executeTakeFirst();
  if (!row) throw new HttpError(404, 'galaxy_not_found');
  const cost = relicLevelCost(row.level, cfgs.relics);
  if (cost === null) throw new HttpError(409, 'relic_maxed');
  if (level !== row.level + 1) throw new HttpError(409, 'relic_changed');
  if (cost > 0) await debit(trx, ownerId, 'dust', cost, 'relic_level', { galaxy: id, level }, opKey);
  await trx
    .updateTable('galaxy.galaxies')
    .set((eb) => ({ level, level_dust: eb('level_dust', '+', cost) }))
    .where('id', '=', id)
    .execute();
  return { galaxy: await detailOf(trx, ownerId, id, cfgs), wallet: await getWallet(trx, ownerId) };
}

/** The Laboratorio's Reciclaje (M4b-2): more dust for disintegrating, rounded down. */
const disintegrationDust = (base: number, push: number) => Math.floor(base * (1 + push) + 1e-9);
/** The Laboratorio's Fusión estable (M4b-2): less dust for fusing, rounded up. */
const fusionDust = (base: number, discount: number) => Math.ceil(base * (1 - discount) - 1e-9);

async function isEquipped(trx: Kysely<DB>, ids: string[]): Promise<boolean> {
  const row = await trx.selectFrom('galaxy.loadouts').select('slot').where('galaxy_id', 'in', ids).limit(1).executeTakeFirst();
  return row !== undefined;
}

// Disintegrate and fuse run inside an operation's transaction: the config they need is read by the route BEFORE it
// (reading it through the pool inside would take a second connection).
export async function disintegrate(
  { cfg, lab, relics }: { cfg: GalaxiesConfig; lab: LabConfig; relics: RelicsConfig },
  trx: Kysely<DB>,
  ownerId: string,
  id: string,
  opKey: string,
): Promise<{ dust: number; wallet: Wallet }> {
  const gone = await trx
    .updateTable('galaxy.galaxies')
    .set({ disintegrated_at: new Date() })
    .where('id', '=', id)
    .where('owner_id', '=', ownerId)
    .where('disintegrated_at', 'is', null)
    .returning(['tier', 'finish', 'level_dust'])
    .executeTakeFirst();
  if (!gone) throw new HttpError(404, 'galaxy_not_found');
  // Checked after taking the row (a fresh statement sees a loadout committed meanwhile): equipped relics stay.
  if (await isEquipped(trx, [id])) throw new HttpError(409, 'galaxy_equipped');
  const dust = disintegrationDust(disintegrateYield(gone.tier, gone.finish as Finish, cfg), (await accountLabEffects(trx, ownerId, lab)).disintegrate);
  if (dust > 0) await credit(trx, ownerId, 'dust', dust, 'disintegrate', { galaxy: id }, opKey);
  // Half the dust put into its levels comes back (GDD §8.4 bis).
  const refund = relicRefund(gone.level_dust, relics);
  if (refund > 0) await credit(trx, ownerId, 'dust', refund, 'relic_refund', { galaxy: id }, opKey);
  return { dust: dust + refund, wallet: await getWallet(trx, ownerId) };
}

export async function fuse(
  { cfg, gacha, lab, relics }: { cfg: GalaxiesConfig; gacha: GachaConfig; lab: LabConfig; relics: RelicsConfig },
  trx: Kysely<DB>,
  ownerId: string,
  ids: string[],
  opKey: string,
): Promise<{ galaxy: GalaxySummary; wallet: Wallet }> {
  // Lock the parents in a fixed order so concurrent operations on the same galaxies cannot deadlock.
  const parents = await trx
    .selectFrom('galaxy.galaxies')
    .select(['id', 'tier', 'level_dust'])
    .where('id', 'in', ids)
    .where('owner_id', '=', ownerId)
    .where('disintegrated_at', 'is', null)
    .orderBy('id')
    .forUpdate()
    .execute();
  if (parents.length !== ids.length) throw new HttpError(409, 'invalid_fusion');
  if (await isEquipped(trx, ids)) throw new HttpError(409, 'galaxy_equipped');
  const recipe = validateFusion(parents, cfg);
  if ('error' in recipe) throw new HttpError(409, 'invalid_fusion');
  const dust = fusionDust(recipe.dust, (await accountLabEffects(trx, ownerId, lab)).fusion);
  if (dust > 0) await debit(trx, ownerId, 'dust', dust, 'fusion', { parents: ids }, opKey);
  // Half the dust put into the parents' levels comes back (GDD §8.4 bis), each parent rounded down.
  const refund = parents.reduce((sum, p) => sum + relicRefund(p.level_dust, relics), 0);
  if (refund > 0) await credit(trx, ownerId, 'dust', refund, 'relic_refund', { parents: ids }, opKey);
  await trx.updateTable('galaxy.galaxies').set({ disintegrated_at: new Date() }).where('id', 'in', ids).execute();
  const fusionSeed = randomBytes(8).readBigUInt64BE();
  const g = generateGalaxy(fusionSeed, recipe.tier);
  const finish = drawFinish(fusionSeed, gacha);
  const row = await trx
    .insertInto('galaxy.galaxies')
    .values({
      owner_id: ownerId,
      seed: g.seed.toString(),
      engine_version: ENGINE_VERSION,
      traits: JSON.stringify(g.traits),
      dna: g.dna,
      name: g.name,
      designation: g.designation,
      tier: recipe.tier,
      score: g.score,
      finish,
      origin: 'fusion',
      lineage: ids,
    })
    .returning(SUMMARY)
    .executeTakeFirstOrThrow();
  return { galaxy: summary(row), wallet: await getWallet(trx, ownerId) };
}
