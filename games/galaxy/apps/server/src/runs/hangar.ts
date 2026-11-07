import { dailyStatus, type GalaxySummary, type HangarView, type LoadoutRequest, type ProbeCard, type SectorCard } from '@galaxy/shared';
import type { Content, RelicInput } from '@galaxy/sim';
import { type Kysely, sql } from 'kysely';
import { summary } from '../collection/service';
import type { ConfigReader } from '../config/reader';
import type { DB } from '../db/schema';
import { inTransaction } from '../db/tx';
import { madridDay, nextMadridMidnight } from '../economy/day';
import { HttpError } from '../errors';

// The hangar (GDD §5.1, §8.4): the probe and sector for the next run, and the galaxies equipped as relics in the open
// slots. A loadout only ever shows live galaxies the player still owns.

export type RunsDeps = { db: Kysely<DB>; config: ConfigReader; now: () => Date };

const LIVE = ['id', 'seed', 'tier', 'finish', 'traits', 'name', 'designation', 'featured', 'level', 'created_at', 'score'] as const;

/** The account's hangar row, created with defaults on the first visit. */
export async function ensureHangar(db: Kysely<DB>, accountId: string): Promise<{ probe: string; slots: number }> {
  await db.insertInto('galaxy.hangars').values({ account_id: accountId }).onConflict((oc) => oc.column('account_id').doNothing()).execute();
  const row = await db.selectFrom('galaxy.hangars').select(['probe', 'relic_slots']).where('account_id', '=', accountId).executeTakeFirstOrThrow();
  return { probe: row.probe, slots: row.relic_slots };
}

/** Equipped live galaxies by slot (only the open slots). */
export async function loadoutOf(db: Kysely<DB>, accountId: string, slots: number): Promise<(GalaxySummary | null)[]> {
  const rows = await db
    .selectFrom('galaxy.loadouts as l')
    .innerJoin('galaxy.galaxies as g', 'g.id', 'l.galaxy_id')
    .select(['l.slot', ...LIVE.map((c) => `g.${c}` as const)])
    .where('l.account_id', '=', accountId)
    .where('g.owner_id', '=', accountId)
    .where('g.disintegrated_at', 'is', null)
    .execute();
  const out: (GalaxySummary | null)[] = Array.from({ length: slots }, () => null);
  for (const r of rows) if (r.slot < slots) out[r.slot] = { ...summary(r), equipped: true };
  return out;
}

/** The relics a run starts with: the equipped live galaxies, as the simulation sees them. */
export async function relicSnapshot(db: Kysely<DB>, accountId: string, slots: number): Promise<RelicInput[]> {
  const live = await loadoutOf(db, accountId, slots);
  return live
    .filter((g): g is GalaxySummary => g !== null)
    .map((g) => ({ id: g.id, seed: g.seed, tier: ['common', 'uncommon', 'rare', 'epic', 'legendary'].indexOf(g.tier), level: g.level, traits: g.traits }));
}

function sectorCards(content: Content): SectorCard[] {
  return content.sectors.map((s) => {
    const boss = content.bosses.find((b) => b.id === s.boss);
    const fauna: SectorCard['fauna'] = [];
    for (const sp of s.spawns) {
      const e = content.enemies.find((x) => x.id === sp.enemy);
      if (e && !fauna.some((f) => f.id === e.id)) fauna.push({ id: e.id, name: e.name, sprite: e.sprite });
    }
    return {
      id: s.id,
      name: s.name,
      description: s.description,
      boss: { name: boss?.name ?? '', title: boss?.title ?? '', sprite: boss?.sprite ?? '' },
      fauna,
      layerSeconds: s.layerSeconds,
    };
  });
}

function probeCards(content: Content, chosen: string): ProbeCard[] {
  return content.probes.map((p) => {
    const w = content.weapons.find((x) => x.id === p.weapon);
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      sprite: p.sprite,
      hp: p.hp,
      speed: p.speed,
      weapon: { id: p.weapon, name: w?.name ?? p.weapon, icon: w?.icon ?? '' },
      unlocked: p.id === chosen,
    };
  });
}

/** Seconds of run time the account has today (Madrid day). */
export async function playedToday(db: Kysely<DB>, accountId: string, now: Date): Promise<number> {
  const row = await db.selectFrom('galaxy.run_days').select('seconds').where('account_id', '=', accountId).where('day', '=', madridDay(now)).executeTakeFirst();
  return row?.seconds ?? 0;
}

export async function hangarView(deps: RunsDeps, accountId: string): Promise<HangarView> {
  const [content, runs, features] = await Promise.all([deps.config.get('content'), deps.config.get('runs'), deps.config.get('features')]);
  const h = await ensureHangar(deps.db, accountId);
  const now = deps.now();
  return {
    sectors: sectorCards(content),
    probes: probeCards(content, h.probe),
    probe: h.probe,
    slots: h.slots,
    maxSlots: 6,
    loadout: await loadoutOf(deps.db, accountId, h.slots),
    daily: { ...dailyStatus(await playedToday(deps.db, accountId, now), runs), resetsAt: nextMadridMidnight(now).toISOString() },
    runsEnabled: features.runs,
  };
}

/** Replaces the whole loadout: own live galaxies only, no more than the open slots. */
export async function setLoadout(deps: RunsDeps, accountId: string, req: LoadoutRequest): Promise<HangarView> {
  const h = await ensureHangar(deps.db, accountId);
  if (req.relics.length > h.slots) throw new HttpError(409, 'invalid_loadout');
  const ids = req.relics.filter((x): x is string => x !== null);
  await inTransaction(deps.db, async (trx) => {
    await sql`select pg_advisory_xact_lock(hashtextextended(${`loadout:${accountId}`}, 0))`.execute(trx);
    if (ids.length > 0) {
      // Lock the chosen galaxies: a disintegration or fusion of one of them waits for this loadout, then sees it.
      const live = await trx
        .selectFrom('galaxy.galaxies')
        .select('id')
        .where('id', 'in', ids)
        .where('owner_id', '=', accountId)
        .where('disintegrated_at', 'is', null)
        .forUpdate()
        .execute();
      if (live.length !== ids.length) throw new HttpError(409, 'invalid_loadout');
    }
    await trx.deleteFrom('galaxy.loadouts').where('account_id', '=', accountId).execute();
    const rows = req.relics.flatMap((g, slot) => (g ? [{ account_id: accountId, slot, galaxy_id: g }] : []));
    if (rows.length > 0) await trx.insertInto('galaxy.loadouts').values(rows).execute();
    await trx.updateTable('galaxy.hangars').set({ updated_at: new Date() }).where('account_id', '=', accountId).execute();
  });
  return hangarView(deps, accountId);
}
