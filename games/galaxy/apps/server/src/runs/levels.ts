import { type HangarView, probeLevelNext, type ProbesConfig, probeStatus, skinParts } from '@galaxy/shared';
import type { Content } from '@galaxy/sim';
import { type Kysely, sql } from 'kysely';
import type { DB } from '../db/schema';
import { debit } from '../economy/wallet';
import { HttpError } from '../errors';
import { hangarView, probeGrants, runStats, type RunsDeps, testedProbe } from './hangar';

// Probe levels and starting weapons (GDD §6, M4b-1). A level is bought with components and coins under a per-account
// lock, naming the level it buys (a stale view gets 409 probe_changed and pays nothing); the variant is chosen once the
// probe's level opens it. No row means level 1 with the base weapon. Each probe also wears a skin of the player's (plan
// «skins», part C): only drawing, snapshotted at the start of a run like the rest.

export type ProbeLevels = Record<string, { level: number; variant: string | null; skin: string | null }>;

/** A probe's row with its skin only while the account still has it (a skin taken away never flies again). */
function levelsWithSkin(db: Kysely<DB>, accountId: string) {
  return db
    .selectFrom('galaxy.probe_levels as pl')
    .leftJoin('galaxy.cosmetics as c', (j) => j.onRef('c.account_id', '=', 'pl.account_id').on('c.kind', '=', 'skin').onRef('c.value', '=', 'pl.skin'))
    .select(['pl.probe', 'pl.level', 'pl.variant', 'c.value as skin'])
    .where('pl.account_id', '=', accountId);
}

export async function probeLevels(db: Kysely<DB>, accountId: string): Promise<ProbeLevels> {
  const rows = await levelsWithSkin(db, accountId).execute();
  return Object.fromEntries(rows.map((r) => [r.probe, { level: r.level, variant: r.variant, skin: r.skin ?? null }]));
}

/** The skin a probe of the account wears and still has (null: its base drawing). */
export async function wornSkin(db: Kysely<DB>, accountId: string, probe: string): Promise<string | null> {
  const row = await levelsWithSkin(db, accountId).where('pl.probe', '=', probe).executeTakeFirst();
  return row?.skin ?? null;
}

/** 400 for a probe the content does not have, 409 before the test or for one the account has not earned. */
async function requireOwned(db: Kysely<DB>, accountId: string, probe: string, content: Content, cfg: ProbesConfig): Promise<void> {
  if (!content.probes.some((p) => p.id === probe)) throw new HttpError(400, 'invalid_input');
  const assigned = await testedProbe(db, accountId);
  if (assigned === null) throw new HttpError(409, 'probe_test_required');
  const granted = (await probeGrants(db, accountId)).has(probe);
  if (!probeStatus(probe, assigned, await runStats(db, accountId, cfg.minRunSeconds), cfg, granted).unlocked) throw new HttpError(409, 'probe_locked');
}

export async function levelUpProbe(deps: RunsDeps, trx: Kysely<DB>, accountId: string, probe: string, level: number, key: string): Promise<HangarView> {
  const [content, cfg] = await Promise.all([deps.config.get('content'), deps.config.get('probes')]);
  await sql`select pg_advisory_xact_lock(hashtextextended(${`probes:${accountId}`}, 0))`.execute(trx);
  await requireOwned(trx, accountId, probe, content, cfg);
  const current = (await probeLevels(trx, accountId))[probe]?.level ?? 1;
  const next = probeLevelNext(current, cfg);
  if (!next) throw new HttpError(409, 'probe_maxed');
  if (level !== current + 1) throw new HttpError(409, 'probe_changed');
  const ref = { probe, level };
  if (next.components > 0) await debit(trx, accountId, 'components', next.components, 'probe_level', ref, key);
  if (next.coins > 0) await debit(trx, accountId, 'coins', next.coins, 'probe_level', ref, key);
  const now = deps.now();
  await trx
    .insertInto('galaxy.probe_levels')
    .values({ account_id: accountId, probe, level, updated_at: now })
    .onConflict((oc) => oc.columns(['account_id', 'probe']).doUpdateSet({ level, updated_at: now }))
    .execute();
  return hangarView(deps, accountId, trx);
}

/**
 * The skin a probe wears: one of the player's skins of that very probe, still in the catalog, or null for its base
 * drawing. 400 for a skin of another probe, 409 cosmetic_locked for one the player does not have.
 */
export async function chooseSkin(deps: RunsDeps, accountId: string, probe: string, skin: string | null): Promise<HangarView> {
  const [content, cfg, cosmetics] = await Promise.all([deps.config.get('content'), deps.config.get('probes'), deps.config.get('cosmetics')]);
  await requireOwned(deps.db, accountId, probe, content, cfg);
  if (skin !== null && skinParts(skin)?.probe !== probe) throw new HttpError(400, 'invalid_input');
  if (skin !== null && !cosmetics.skins.find((k) => k.id === skin)?.enabled) throw new HttpError(409, 'cosmetic_locked');
  if (skin !== null) {
    const owned = await deps.db.selectFrom('galaxy.cosmetics').select('value').where('account_id', '=', accountId).where('kind', '=', 'skin').where('value', '=', skin).executeTakeFirst();
    if (!owned) throw new HttpError(409, 'cosmetic_locked');
  }
  // A refund racing this can leave the name here after taking the skin: harmless, every read joins the player's
  // skins (levelsWithSkin), so a skin no longer theirs never flies.
  const now = deps.now();
  await deps.db
    .insertInto('galaxy.probe_levels')
    .values({ account_id: accountId, probe, skin, updated_at: now })
    .onConflict((oc) => oc.columns(['account_id', 'probe']).doUpdateSet({ skin, updated_at: now }))
    .execute();
  return hangarView(deps, accountId);
}

/** The starting weapon: the probe's base weapon (stored as null) or one of its variants its level opens. */
export async function chooseVariant(deps: RunsDeps, accountId: string, probe: string, variant: string): Promise<HangarView> {
  const [content, cfg] = await Promise.all([deps.config.get('content'), deps.config.get('probes')]);
  await requireOwned(deps.db, accountId, probe, content, cfg);
  const def = content.probes.find((p) => p.id === probe)!;
  const weapon = content.weapons.find((w) => w.id === variant);
  if (!weapon || (weapon.id !== def.weapon && weapon.variant?.of !== def.weapon)) throw new HttpError(400, 'invalid_input');
  const level = (await probeLevels(deps.db, accountId))[probe]?.level ?? 1;
  if (weapon.variant && level < weapon.variant.unlockAt) throw new HttpError(409, 'variant_locked');
  const stored = weapon.variant ? weapon.id : null;
  const now = deps.now();
  await deps.db
    .insertInto('galaxy.probe_levels')
    .values({ account_id: accountId, probe, variant: stored, updated_at: now })
    .onConflict((oc) => oc.columns(['account_id', 'probe']).doUpdateSet({ variant: stored, updated_at: now }))
    .execute();
  return hangarView(deps, accountId);
}
