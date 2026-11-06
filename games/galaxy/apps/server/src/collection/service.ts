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
  type GalaxyDetail,
  type GalaxySummary,
  type Tier,
  type Wallet,
} from '@galaxy/shared';
import { type Kysely, type Selectable, sql } from 'kysely';
import { z } from 'zod';
import type { ConfigReader } from '../config/reader';
import type { DB, GalaxiesTable } from '../db/schema';
import { credit, debit, getWallet } from '../economy/wallet';
import { HttpError } from '../errors';

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

function summary(r: Pick<Row, (typeof SUMMARY)[number]>): GalaxySummary {
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

export async function listGalaxies(db: Kysely<DB>, ownerId: string, q: ListQuery): Promise<CollectionPage> {
  let query = db
    .selectFrom('galaxy.galaxies')
    .select(SUMMARY)
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
  return { items: page.map(summary), ...(next ? { next } : {}), counts };
}

export async function galaxyDetail(db: Kysely<DB>, ownerId: string, id: string): Promise<GalaxyDetail> {
  const r = await db
    .selectFrom('galaxy.galaxies')
    .select([...SUMMARY, 'origin', 'lineage', 'dna'])
    .where('id', '=', id)
    .where('owner_id', '=', ownerId)
    .where('disintegrated_at', 'is', null)
    .executeTakeFirst();
  if (!r) throw new HttpError(404, 'galaxy_not_found');
  return { ...summary(r), origin: r.origin, lineage: r.lineage, dna: r.dna };
}

export async function disintegrate(
  deps: CollectionDeps,
  trx: Kysely<DB>,
  ownerId: string,
  id: string,
  opKey: string,
): Promise<{ dust: number; wallet: Wallet }> {
  const cfg = await deps.config.get('galaxies');
  const gone = await trx
    .updateTable('galaxy.galaxies')
    .set({ disintegrated_at: new Date() })
    .where('id', '=', id)
    .where('owner_id', '=', ownerId)
    .where('disintegrated_at', 'is', null)
    .returning(['tier', 'finish'])
    .executeTakeFirst();
  if (!gone) throw new HttpError(404, 'galaxy_not_found');
  const dust = disintegrateYield(gone.tier, gone.finish as Finish, cfg);
  if (dust > 0) await credit(trx, ownerId, 'dust', dust, 'disintegrate', { galaxy: id }, opKey);
  return { dust, wallet: await getWallet(trx, ownerId) };
}

export async function fuse(
  deps: CollectionDeps,
  trx: Kysely<DB>,
  ownerId: string,
  ids: string[],
  opKey: string,
): Promise<{ galaxy: GalaxySummary; wallet: Wallet }> {
  const [cfg, gacha] = await Promise.all([deps.config.get('galaxies'), deps.config.get('gacha')]);
  // Lock the parents in a fixed order so concurrent operations on the same galaxies cannot deadlock.
  const parents = await trx
    .selectFrom('galaxy.galaxies')
    .select(['id', 'tier'])
    .where('id', 'in', ids)
    .where('owner_id', '=', ownerId)
    .where('disintegrated_at', 'is', null)
    .orderBy('id')
    .forUpdate()
    .execute();
  if (parents.length !== ids.length) throw new HttpError(409, 'invalid_fusion');
  const recipe = validateFusion(parents, cfg);
  if ('error' in recipe) throw new HttpError(409, 'invalid_fusion');
  if (recipe.dust > 0) await debit(trx, ownerId, 'dust', recipe.dust, 'fusion', { parents: ids }, opKey);
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
