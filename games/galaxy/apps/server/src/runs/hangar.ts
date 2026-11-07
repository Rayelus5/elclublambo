import {
  dailyStatus,
  type GalaxySummary,
  type HangarView,
  type LoadoutRequest,
  type ProbeCard,
  type ProbesConfig,
  probeStatus,
  type RunStats,
  type SectorCard,
  type SectorsConfig,
  type SectorStats,
  sectorStatus,
} from '@galaxy/shared';
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
export async function ensureHangar(db: Kysely<DB>, accountId: string): Promise<{ probe: string; sector: string; slots: number }> {
  await db.insertInto('galaxy.hangars').values({ account_id: accountId }).onConflict((oc) => oc.column('account_id').doNothing()).execute();
  const row = await db.selectFrom('galaxy.hangars').select(['probe', 'sector', 'relic_slots']).where('account_id', '=', accountId).executeTakeFirstOrThrow();
  return { probe: row.probe, sector: row.sector, slots: row.relic_slots };
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

/** The account's stats in each sector from finished, non-suspicious runs (what opens the next sectors). */
export async function sectorStats(db: Kysely<DB>, accountId: string): Promise<Record<string, SectorStats>> {
  const rows = await db
    .selectFrom('galaxy.runs')
    .select((eb) => [
      'sector',
      eb.fn.coalesce(eb.fn.sum<string>('boss_kills'), sql<string>`0`).as('bossKills'),
      eb.fn.coalesce(eb.fn.max('depth'), sql<number>`0`).as('maxDepth'),
      sql<string>`count(*) filter (where outcome = 'extracted')`.as('extractions'),
    ])
    .where('account_id', '=', accountId)
    .where('finished_at', 'is not', null)
    .where('suspicious', '=', false)
    .groupBy('sector')
    .execute();
  const out: Record<string, SectorStats> = {};
  for (const r of rows) out[r.sector] = { bossKills: Number(r.bossKills), maxDepth: Number(r.maxDepth), extractions: Number(r.extractions) };
  return out;
}

function sectorCards(content: Content, stats: Record<string, SectorStats>, cfg: SectorsConfig): SectorCard[] {
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
      biome: s.biome,
      ...sectorStatus(s, stats, cfg),
    };
  });
}

/** The account's stats from finished, non-suspicious runs of `minSeconds` or more (what unlocks probes). */
export async function runStats(db: Kysely<DB>, accountId: string, minSeconds: number): Promise<RunStats> {
  const row = await db
    .selectFrom('galaxy.runs')
    .select((eb) => [
      eb.fn.countAll<string>().as('runs'),
      eb.fn.coalesce(eb.fn.sum<string>('boss_kills'), sql<string>`0`).as('bossKills'),
      eb.fn.coalesce(eb.fn.max('depth'), sql<number>`0`).as('maxDepth'),
      sql<string>`count(*) filter (where outcome = 'extracted')`.as('extractions'),
      eb.fn.coalesce(eb.fn.sum<string>('kills'), sql<string>`0`).as('kills'),
    ])
    .where('account_id', '=', accountId)
    .where('finished_at', 'is not', null)
    .where('suspicious', '=', false)
    .where('seconds', '>=', minSeconds)
    .executeTakeFirstOrThrow();
  return { runs: Number(row.runs), bossKills: Number(row.bossKills), maxDepth: Number(row.maxDepth), extractions: Number(row.extractions), kills: Number(row.kills) };
}

/** The probe the account's test gave, or null before the test. */
export async function testedProbe(db: Kysely<DB>, accountId: string): Promise<string | null> {
  const row = await db.selectFrom('galaxy.probe_tests').select('probe').where('account_id', '=', accountId).executeTakeFirst();
  return row?.probe ?? null;
}

function probeCards(content: Content, assigned: string | null, stats: RunStats, cfg: ProbesConfig): ProbeCard[] {
  return content.probes.map((p) => {
    const w = content.weapons.find((x) => x.id === p.weapon);
    const status = assigned ? probeStatus(p.id, assigned, stats, cfg) : { unlocked: false, condition: null, progress: 0 };
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      sprite: p.sprite,
      hp: p.hp,
      speed: p.speed,
      weapon: { id: p.weapon, name: w?.name ?? p.weapon, icon: w?.icon ?? '' },
      quirk: p.quirk?.kind ?? null,
      ...status,
    };
  });
}

/** Seconds of run time the account has today (Madrid day). */
export async function playedToday(db: Kysely<DB>, accountId: string, now: Date): Promise<number> {
  const row = await db.selectFrom('galaxy.run_days').select('seconds').where('account_id', '=', accountId).where('day', '=', madridDay(now)).executeTakeFirst();
  return row?.seconds ?? 0;
}

export async function hangarView(deps: RunsDeps, accountId: string): Promise<HangarView> {
  const [content, runs, features, probes, sectorsCfg] = await Promise.all([
    deps.config.get('content'),
    deps.config.get('runs'),
    deps.config.get('features'),
    deps.config.get('probes'),
    deps.config.get('sectors'),
  ]);
  const h = await ensureHangar(deps.db, accountId);
  const now = deps.now();
  const assigned = await testedProbe(deps.db, accountId);
  const sectors = sectorCards(content, await sectorStats(deps.db, accountId), sectorsCfg);
  // A chosen sector that closed (the season ended, a condition was raised) falls back to the first open one.
  const chosen = sectors.find((s) => s.id === h.sector && s.unlocked) ?? sectors.find((s) => s.unlocked);
  return {
    sectors,
    sector: chosen?.id ?? h.sector,
    probes: probeCards(content, assigned, await runStats(deps.db, accountId, probes.minRunSeconds), probes),
    probe: h.probe,
    test: { taken: assigned !== null, probe: assigned },
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
