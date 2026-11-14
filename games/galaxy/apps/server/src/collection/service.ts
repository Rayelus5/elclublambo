import { randomBytes } from 'node:crypto';
import { ENGINE_VERSION } from '@galaxy/engine';
import {
  type AutoFusionCandidate,
  type AutoFusionCriteria,
  type AutoFusionPreview,
  type AutoFusionResult,
  AUTO_FUSION_CAP,
  autoFusible,
  fusionOrder,
  planAutoFusion,
  disintegrateYield,
  drawFinish,
  FINISHES,
  generateGalaxy,
  TIERS,
  validateFusion,
  type CollectionPage,
  COLLECTION_SORTS,
  type CollectionSort,
  perTier,
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
import { type Kysely, type RawBuilder, type Selectable, sql } from 'kysely';
import { z } from 'zod';
import type { ConfigReader } from '../config/reader';
import type { DB, GalaxiesTable } from '../db/schema';
import { credit, debit, getWallet } from '../economy/wallet';
import { HttpError } from '../errors';
import type { WithLive } from '../realtime/notices';
import { accountLabEffects } from '../lab/levels';
import { isEquipped, isExhibited, isListed, isTraded, listedColumn, tradedColumn } from '../market/escrow';

// The collection (GDD §8.5): owned galaxies, paged with a keyset cursor; disintegration into dust and fusion of
// `fusion.count` same-tier galaxies into one of the next tier. Both are idempotent operations (routes.ts) and lock
// the galaxies they consume, so a galaxy is never spent twice.
/** `live`: the live hub, for an achievement's notice (real-time notices plan). */
export type CollectionDeps = { db: Kysely<DB>; config: ConfigReader } & WithLive;

export const listQuerySchema = z
  .object({
    tier: z.enum(TIERS).optional(),
    type: z.string().regex(/^[a-z_]{1,24}$/).optional(),
    palette: z.string().regex(/^[a-z_]{1,24}$/).optional(),
    /** A phenomenon, `any` (with one) or `none` (plan «escáner pro», part D: it decides relics most). */
    phenomenon: z.string().regex(/^[a-z_]{1,24}$/).optional(),
    finish: z.enum(FINISHES).optional(),
    /** Only locked galaxies (plan phase 2). */
    locked: z.enum(['true']).optional(),
    sort: z.enum(COLLECTION_SORTS).default('new'),
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(60).default(30),
  })
  .strict();
export type ListQuery = z.infer<typeof listQuerySchema>;

type Row = Selectable<GalaxiesTable>;
const SUMMARY = ['id', 'seed', 'tier', 'finish', 'traits', 'name', 'designation', 'featured', 'level', 'created_at', 'score', 'locked'] as const;

/** `equipped`: whether a galaxy sits in a hangar slot (as a selectable column). */
const equippedColumn = sql<boolean>`exists (select 1 from galaxy.loadouts l where l.galaxy_id = galaxy.galaxies.id)`.as('equipped');
/** `exhibited`: whether a galaxy stands on a pedestal of its owner's planetarium (M4c-2). */
const exhibitedColumn = sql<boolean>`exists (select 1 from galaxy.exhibits e where e.galaxy_id = galaxy.galaxies.id)`.as('exhibited');

export function summary(
  r: Pick<Row, Exclude<(typeof SUMMARY)[number], 'locked'>> & { locked?: boolean; equipped?: boolean; exhibited?: boolean; listed?: boolean; traded?: boolean },
): GalaxySummary {
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
    ...(r.exhibited === true ? { exhibited: true as const } : {}),
    ...(r.listed === true ? { listed: true as const } : {}),
    ...(r.traded === true ? { traded: true as const } : {}),
    ...(r.locked === true ? { locked: true as const } : {}),
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

/**
 * The keys a sort orders by (all in one direction), as SQL over a table reference `t` (the list's own table, or the
 * cursor's row). The star dust is what disintegrating would pay: the tier × finish yield of `galaxies.disintegrate`
 * plus the levels' refund (the lab's bonus multiplies every one alike, so it does not change the order).
 */
function sortKeys(sort: CollectionSort, t: string, galaxies: GalaxiesConfig, relics: RelicsConfig): { keys: RawBuilder<unknown>[]; desc: boolean } {
  const c = (col: string) => sql.ref(`${t}.${col}`);
  const tierYield = perTier(galaxies.disintegrate.tier);
  const fin = galaxies.disintegrate.finish;
  const dust = sql`(round((case ${c('tier')} ${sql.join(
    tierYield.map((v, i) => sql`when ${sql.lit(i)} then ${sql.lit(v)}::float8`),
    sql` `,
  )} else 0 end) * (case ${c('finish')} ${sql.join(
    FINISHES.map((f, i) => sql`when ${sql.lit(f)} then ${sql.lit(fin[i] ?? fin[fin.length - 1]!)}::float8`),
    sql` `,
  )} else ${sql.lit(fin[fin.length - 1]!)}::float8 end)) + floor(${c('level_dust')} * ${sql.lit(relics.refund)}::float8 + 1e-9))`;
  switch (sort) {
    case 'rarity':
      return { keys: [c('tier'), c('score'), c('id')], desc: true };
    case 'old':
      return { keys: [c('created_at'), c('id')], desc: false };
    case 'dust-desc':
      return { keys: [dust, c('id')], desc: true };
    case 'dust-asc':
      return { keys: [dust, c('id')], desc: false };
    case 'name-asc':
      return { keys: [c('name'), c('id')], desc: false };
    case 'name-desc':
      return { keys: [c('name'), c('id')], desc: true };
    default:
      return { keys: [c('created_at'), c('id')], desc: true };
  }
}

export async function listGalaxies(deps: CollectionDeps, ownerId: string, q: ListQuery): Promise<CollectionPage> {
  const { db } = deps;
  const [galaxiesCfg, relicsCfg] = await Promise.all([deps.config.get('galaxies'), deps.config.get('relics')]);
  const order = sortKeys(q.sort, 'galaxy.galaxies', galaxiesCfg, relicsCfg);
  let query = db
    .selectFrom('galaxy.galaxies')
    .select([...SUMMARY, equippedColumn, exhibitedColumn, listedColumn, tradedColumn])
    .where('owner_id', '=', ownerId)
    .where('disintegrated_at', 'is', null);
  if (q.tier) query = query.where('tier', '=', TIERS.indexOf(q.tier));
  if (q.finish) query = query.where('finish', '=', q.finish);
  if (q.type) query = query.where(sql<string>`traits->>'galaxy_type'`, '=', q.type);
  if (q.palette) query = query.where(sql<string>`traits->>'palette'`, '=', q.palette);
  if (q.phenomenon === 'any') query = query.where(sql<string>`coalesce(traits->>'phenomenon', 'none')`, '<>', 'none');
  else if (q.phenomenon) query = query.where(sql<string>`coalesce(traits->>'phenomenon', 'none')`, '=', q.phenomenon);
  if (q.locked) query = query.where('locked', '=', true);
  if (q.cursor) {
    // The cursor is the last row's id: the boundary is that row's own stored values, compared in SQL. Exact for
    // REAL scores and microsecond timestamps, which do not survive a round trip through JSON text.
    const { id } = decode(q.cursor);
    const at = sortKeys(q.sort, 'g', galaxiesCfg, relicsCfg);
    query = query.where(
      sql<boolean>`(${sql.join(order.keys)}) ${order.desc ? sql`<` : sql`>`} (select ${sql.join(at.keys)} from galaxy.galaxies g where g.id = ${id}::uuid and g.owner_id = ${ownerId}::uuid)`,
    );
  }
  for (const k of order.keys) query = query.orderBy(k as never, order.desc ? 'desc' : 'asc');
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
  const { fusion } = galaxiesCfg;
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
    .select([...SUMMARY, equippedColumn, exhibitedColumn, listedColumn, tradedColumn, 'origin', 'lineage', 'dna', 'level_dust'])
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
  // In escrow for the market (M5c-1): what the buyer sees is what it gets.
  if (await isListed(trx, [id])) throw new HttpError(409, 'galaxy_listed');
  if (await isTraded(trx, [id])) throw new HttpError(409, 'galaxy_in_trade');
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
    .returning(['tier', 'finish', 'level_dust', 'locked'])
    .executeTakeFirst();
  if (!gone) throw new HttpError(404, 'galaxy_not_found');
  // A locked galaxy stays (the operation's transaction undoes the update).
  if (gone.locked) throw new HttpError(409, 'galaxy_locked');
  // Checked after taking the row (a fresh statement sees a loadout or an exhibit committed meanwhile): equipped and
  // exhibited galaxies stay.
  if (await isEquipped(trx, [id])) throw new HttpError(409, 'galaxy_equipped');
  if (await isExhibited(trx, [id])) throw new HttpError(409, 'galaxy_exhibited');
  if (await isListed(trx, [id])) throw new HttpError(409, 'galaxy_listed');
  if (await isTraded(trx, [id])) throw new HttpError(409, 'galaxy_in_trade');
  const dust = disintegrationDust(disintegrateYield(gone.tier, gone.finish as Finish, cfg), (await accountLabEffects(trx, ownerId, lab)).disintegrate);
  if (dust > 0) await credit(trx, ownerId, 'dust', dust, 'disintegrate', { galaxy: id }, opKey);
  // Half the dust put into its levels comes back (GDD §8.4 bis).
  const refund = relicRefund(gone.level_dust, relics);
  if (refund > 0) await credit(trx, ownerId, 'dust', refund, 'relic_refund', { galaxy: id }, opKey);
  return { dust: dust + refund, wallet: await getWallet(trx, ownerId) };
}

/**
 * Desintegrar varias (the owner): every galaxy or none. Paid as if one by one (each rounded on its own), with the
 * relics' refunds; the rows are taken in id order (as the auto-fusion does) so two requests never deadlock. Without an
 * operation key it is the preview: the same checks and sum, nothing changed.
 */
export async function disintegrateMany(
  { cfg, lab, relics }: { cfg: GalaxiesConfig; lab: LabConfig; relics: RelicsConfig },
  trx: Kysely<DB>,
  ownerId: string,
  ids: readonly string[],
  opKey: string | null,
): Promise<{ count: number; dust: number; wallet?: Wallet }> {
  const rows = await trx
    .selectFrom('galaxy.galaxies')
    .select(['id', 'tier', 'finish', 'level_dust', 'locked'])
    .where('id', 'in', [...ids])
    .where('owner_id', '=', ownerId)
    .where('disintegrated_at', 'is', null)
    .orderBy('id')
    .$if(opKey !== null, (q) => q.forUpdate())
    .execute();
  if (rows.length !== ids.length) throw new HttpError(404, 'galaxy_not_found');
  if (rows.some((r) => r.locked)) throw new HttpError(409, 'galaxy_locked');
  if (await isEquipped(trx, [...ids])) throw new HttpError(409, 'galaxy_equipped');
  if (await isExhibited(trx, [...ids])) throw new HttpError(409, 'galaxy_exhibited');
  if (await isListed(trx, [...ids])) throw new HttpError(409, 'galaxy_listed');
  if (await isTraded(trx, [...ids])) throw new HttpError(409, 'galaxy_in_trade');
  const push = (await accountLabEffects(trx, ownerId, lab)).disintegrate;
  const dust = rows.reduce((n, r) => n + disintegrationDust(disintegrateYield(r.tier, r.finish as Finish, cfg), push), 0);
  const refund = rows.reduce((n, r) => n + relicRefund(r.level_dust, relics), 0);
  if (opKey === null) return { count: rows.length, dust: dust + refund };
  await trx.updateTable('galaxy.galaxies').set({ disintegrated_at: new Date() }).where('id', 'in', [...ids]).execute();
  if (dust > 0) await credit(trx, ownerId, 'dust', dust, 'disintegrate', { galaxies: [...ids] }, opKey);
  if (refund > 0) await credit(trx, ownerId, 'dust', refund, 'relic_refund', { galaxies: [...ids] }, opKey);
  return { count: rows.length, dust: dust + refund, wallet: await getWallet(trx, ownerId) };
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
    .select(['id', 'tier', 'level_dust', 'locked'])
    .where('id', 'in', ids)
    .where('owner_id', '=', ownerId)
    .where('disintegrated_at', 'is', null)
    .orderBy('id')
    .forUpdate()
    .execute();
  if (parents.length !== ids.length) throw new HttpError(409, 'invalid_fusion');
  if (parents.some((p) => p.locked)) throw new HttpError(409, 'galaxy_locked');
  if (await isEquipped(trx, ids)) throw new HttpError(409, 'galaxy_equipped');
  if (await isExhibited(trx, ids)) throw new HttpError(409, 'galaxy_exhibited');
  if (await isListed(trx, ids)) throw new HttpError(409, 'galaxy_listed');
  if (await isTraded(trx, ids)) throw new HttpError(409, 'galaxy_in_trade');
  const discount = (await accountLabEffects(trx, ownerId, lab)).fusion;
  const { galaxy } = await fuseLocked({ cfg, gacha, relics }, trx, ownerId, parents, discount, opKey);
  return { galaxy, wallet: await getWallet(trx, ownerId) };
}

/**
 * One fusion of parents already locked and checked by the caller (manual fusion, automatic fusion): the recipe, the
 * dust (with the Laboratorio's `discount`), the refund of their levels, and the new galaxy of the next tier.
 */
async function fuseLocked(
  { cfg, gacha, relics }: { cfg: GalaxiesConfig; gacha: GachaConfig; relics: RelicsConfig },
  trx: Kysely<DB>,
  ownerId: string,
  parents: { id: string; tier: number; level_dust: number }[],
  discount: number,
  opKey: string,
  ref: Record<string, unknown> = {},
): Promise<{ galaxy: GalaxySummary; score: number }> {
  const ids = parents.map((p) => p.id);
  const recipe = validateFusion(parents, cfg);
  if ('error' in recipe) throw new HttpError(409, 'invalid_fusion');
  const dust = fusionDust(recipe.dust, discount);
  if (dust > 0) await debit(trx, ownerId, 'dust', dust, 'fusion', { parents: ids, ...ref }, opKey);
  // Half the dust put into the parents' levels comes back (GDD §8.4 bis), each parent rounded down.
  const refund = parents.reduce((sum, p) => sum + relicRefund(p.level_dust, relics), 0);
  if (refund > 0) await credit(trx, ownerId, 'dust', refund, 'relic_refund', { parents: ids, ...ref }, opKey);
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
    .returning([...SUMMARY])
    .executeTakeFirstOrThrow();
  return { galaxy: summary(row), score: row.score };
}

/** The owner's live galaxies as the automatic fusion sees them (locked, rows first: `forUpdate` when it will fuse). */
async function autoCandidates(trx: Kysely<DB>, ownerId: string, lock: boolean) {
  let q = trx
    .selectFrom('galaxy.galaxies')
    .select(['id', 'tier', 'finish', 'level', 'level_dust', 'score', 'created_at', 'locked', 'traits', equippedColumn, exhibitedColumn, listedColumn, tradedColumn])
    .where('owner_id', '=', ownerId)
    .where('disintegrated_at', 'is', null)
    .orderBy('id');
  if (lock) q = q.forUpdate();
  const rows = await q.execute();
  return rows.map((r) => ({
    candidate: {
      id: r.id,
      tier: r.tier,
      finish: r.finish as Finish,
      level: r.level,
      score: r.score,
      createdAt: new Date(r.created_at).toISOString(),
      locked: r.locked,
      busy: r.equipped === true || r.exhibited === true || r.listed === true || r.traded === true,
      type: r.traits['galaxy_type'] ?? '',
      palette: r.traits['palette'] ?? '',
    } satisfies AutoFusionCandidate,
    level_dust: r.level_dust,
  }));
}

/**
 * The automatic fusion (plan phase 2): its preview, or the fusions themselves in this operation's transaction. Every
 * galaxy it may touch is locked first (in id order); then each tier from the lowest is spent in fusionOrder, groups of
 * `fusion.count` at a time, while the dust lasts and up to AUTO_FUSION_CAP; a new galaxy joins the next tier's pool
 * when the criteria let it (a special finish drawn is kept when finishes are kept).
 */
export async function autoFuse(
  { cfg, gacha, lab, relics }: { cfg: GalaxiesConfig; gacha: GachaConfig; lab: LabConfig; relics: RelicsConfig },
  trx: Kysely<DB>,
  ownerId: string,
  criteria: AutoFusionCriteria,
  preview: boolean,
  opKey: string,
): Promise<AutoFusionPreview | AutoFusionResult> {
  const discount = (await accountLabEffects(trx, ownerId, lab)).fusion;
  const recipe = { count: cfg.fusion.count, dust: cfg.fusion.dust.map((d) => fusionDust(d, discount)) };
  const wallet = await getWallet(trx, ownerId);
  const rows = await autoCandidates(trx, ownerId, !preview);
  if (preview) return planAutoFusion(rows.map((r) => r.candidate), criteria, recipe, wallet.dust);
  const lo = TIERS.indexOf(criteria.from);
  const hi = TIERS.indexOf(criteria.upTo);
  const pools = TIERS.map(() => [] as (AutoFusionCandidate & { level_dust: number })[]);
  for (const r of rows) if (autoFusible(r.candidate, criteria)) pools[r.candidate.tier]!.push({ ...r.candidate, level_dust: r.level_dust });
  const made: GalaxySummary[] = [];
  let fusions = 0;
  let spent = 0;
  let more = false;
  let dust = wallet.dust;
  for (let t = lo; t < hi; t++) {
    const pool = fusionOrder(pools[t]!);
    const cost = recipe.dust[t] ?? 0;
    for (let k = 0; k + recipe.count <= pool.length; k += recipe.count) {
      if (fusions >= AUTO_FUSION_CAP) {
        more = true;
        break;
      }
      if (cost > dust) break;
      const group = pool.slice(k, k + recipe.count);
      const { galaxy: g, score } = await fuseLocked({ cfg, gacha, relics }, trx, ownerId, group, discount, opKey, { auto: opKey });
      fusions++;
      spent += cost;
      // Refunds of the parents' levels only add dust: counting the cost alone never overspends.
      dust -= cost;
      made.push(g);
      const next: AutoFusionCandidate = {
        id: g.id,
        tier: TIERS.indexOf(g.tier),
        finish: g.finish,
        level: g.level,
        score,
        createdAt: g.createdAt,
        locked: false,
        busy: false,
        type: g.traits['galaxy_type'] ?? '',
        palette: g.traits['palette'] ?? '',
      };
      if (autoFusible(next, criteria)) pools[t + 1]!.push({ ...next, level_dust: 0 });
    }
    if (more) break;
  }
  const order = (x: GalaxySummary) => TIERS.indexOf(x.tier);
  // What is left of them: the chain may have fused some again; the response lists the galaxies that still exist.
  const alive = new Set(
    made.length
      ? (
          await trx
            .selectFrom('galaxy.galaxies')
            .select('id')
            .where(
              'id',
              'in',
              made.map((m) => m.id),
            )
            .where('disintegrated_at', 'is', null)
            .execute()
        ).map((r) => r.id)
      : [],
  );
  const galaxies = made.filter((m) => alive.has(m.id)).sort((a, b) => order(b) - order(a) || a.name.localeCompare(b.name));
  return { galaxies, fusions, dust: spent, more, wallet: await getWallet(trx, ownerId) };
}

/** Locks or unlocks one of the owner's live galaxies; false when it is not theirs or is gone. */
export async function setLock(db: Kysely<DB>, ownerId: string, id: string, locked: boolean): Promise<boolean> {
  const r = await db
    .updateTable('galaxy.galaxies')
    .set({ locked })
    .where('id', '=', id)
    .where('owner_id', '=', ownerId)
    .where('disintegrated_at', 'is', null)
    .returning('id')
    .executeTakeFirst();
  return r !== undefined;
}
