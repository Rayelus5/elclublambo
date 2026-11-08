import {
  type AdminGachaLuck,
  type AdminLabNodeEdit,
  type AdminProbeEdit,
  type AdminProbeGrant,
  type AdminProgress,
  type AdminRoomEdit,
  type AdminSeasonEdit,
  probeMaxLevel,
  probeStatus,
  ROOM_IDS,
  ROOMS,
  type RoomId,
  roomStatus,
  seasonOpen,
} from '@galaxy/shared';
import { type Kysely, sql } from 'kysely';
import { type AuditActor, writeAudit } from '../audit';
import type { SessionInfo } from '../auth/sessions';
import type { ConfigReader } from '../config/reader';
import type { DB } from '../db/schema';
import { inTransaction } from '../db/tx';
import { HttpError } from '../errors';
import { probeGrants, runStats, testedProbe } from '../runs/hangar';
import { lockStation, settleStation } from '../station/service';
import { invalidateLeaderboard, ranking } from '../social/leaderboard';
import { confirmPassword } from './players';

// A player's progress edited from the panel (GDD §16.2 «Editar todo»; M6d-4). Every change runs in a transaction with
// its audit row (before and after); one that takes something away (a lower level, a locked probe, points taken away)
// asks the admin's password first. Station and Laboratorio changes take the station's lock and keep what the refinery
// refined at its old rate first, as the player's own upgrades do. The routes check who may be acted on (guardTarget).

export type ProgressDeps = { db: Kysely<DB>; config: ConfigReader };
const target = (id: string) => ({ targetType: 'account', targetId: id });
const runsDeps = (deps: ProgressDeps) => ({ db: deps.db, config: deps.config, now: () => new Date() });
const MACHINES = ROOM_IDS.filter((r) => ROOMS[r].kind === 'machine');

/** Everything the «Progreso» tab shows. */
export async function progressOf(deps: ProgressDeps, accountId: string): Promise<AdminProgress> {
  const { db } = deps;
  const [content, probesCfg, station, lab, season, account] = await Promise.all([
    deps.config.get('content'),
    deps.config.get('probes'),
    deps.config.get('station'),
    deps.config.get('lab'),
    deps.config.get('season'),
    deps.config.get('account'),
  ]);
  const [gacha, levels, grants, assigned, stats, rooms, nodes, welcomeGranted] = await Promise.all([
    db.selectFrom('galaxy.gacha_state').select(['pity_group', 'since_legendary', 'since_featured', 'welcome', 'total_pulls']).where('account_id', '=', accountId).orderBy('pity_group').execute(),
    db.selectFrom('galaxy.probe_levels').select(['probe', 'level', 'variant']).where('account_id', '=', accountId).execute(),
    probeGrants(db, accountId),
    testedProbe(db, accountId),
    runStats(db, accountId, probesCfg.minRunSeconds),
    db.selectFrom('galaxy.station_rooms').select(['room', 'level']).where('account_id', '=', accountId).execute(),
    db.selectFrom('galaxy.lab_nodes').select(['node', 'level']).where('account_id', '=', accountId).execute(),
    welcomeGiven(db, accountId),
  ]);
  const groups = gacha.map((g) => ({ group: g.pity_group, sinceLegendary: g.since_legendary, sinceFeatured: g.since_featured, welcome: g.welcome, totalPulls: g.total_pulls }));
  // Before the first visit to the Escáner the welcome luck is still to come (M6d-4 review): shown on, so a change keeps it.
  if (!groups.some((g) => g.group === 'standard')) groups.unshift({ group: 'standard', sinceLegendary: 0, sinceFeatured: 0, welcome: !welcomeGranted, totalPulls: 0 });
  const max = probeMaxLevel(probesCfg);
  const now = new Date();
  let seasonView: AdminProgress['season'] = null;
  if (seasonOpen(season, now)) {
    const [mine, adj] = await Promise.all([
      ranking(db, season, 'general', account.minRunSeconds).then((rows) => rows.find((r) => r.accountId === accountId)),
      db.selectFrom('galaxy.season_adjustments').select(sql<number>`coalesce(sum(points), 0)::int`.as('n')).where('account_id', '=', accountId).where('season', '=', season.id).executeTakeFirstOrThrow(),
    ]);
    seasonView = { id: season.id, name: season.name, points: mine?.value ?? 0, adjustments: adj.n };
  }
  return {
    gacha: groups,
    probes: content.probes.map((p) => {
      const row = levels.find((l) => l.probe === p.id);
      const granted = grants.has(p.id);
      return {
        probe: p.id,
        name: p.name,
        level: Math.min(row?.level ?? 1, max),
        maxLevel: max,
        variant: row?.variant ?? null,
        variants: content.weapons.filter((w) => w.variant?.of === p.weapon).map((w) => ({ id: w.id, name: w.name, unlockAt: w.variant!.unlockAt })),
        unlocked: assigned !== null ? probeStatus(p.id, assigned, stats, probesCfg, granted).unlocked : granted,
        granted,
      };
    }),
    rooms: MACHINES.map((room) => {
      const level = rooms.find((r) => r.room === room)?.level ?? ROOMS[room].initial;
      return { room, level, maxLevel: roomStatus(room, level, station).maxLevel };
    }),
    lab: lab.nodes.map((n) => ({ node: n.id, name: n.name, level: nodes.find((x) => x.node === n.id)?.level ?? 0, max: n.max })),
    season: seasonView,
  };
}

/** Whether the account already had its welcome (signals and the welcome luck), on its first visit to the Escáner. */
async function welcomeGiven(db: Kysely<DB>, accountId: string): Promise<boolean> {
  const row = await db.selectFrom('galaxy.gacha_accounts').select('welcome_granted_at').where('account_id', '=', accountId).executeTakeFirst();
  return !!row?.welcome_granted_at;
}

/**
 * The gacha luck of one pity group. Lowering a counter or turning the welcome luck off takes away what the player paid
 * for (M6d-4 review): the password, decided against the row read under its lock.
 */
export async function setGachaLuck(deps: ProgressDeps, actor: AuditActor, s: SessionInfo, accountId: string, req: AdminGachaLuck): Promise<AdminProgress> {
  const cfg = await deps.config.get('gacha');
  if (!new Set(['standard', ...cfg.banners.map((b) => b.pityGroup)]).has(req.group)) throw new HttpError(400, 'invalid_input');
  await inTransaction(deps.db, async (trx) => {
    // A standard row made here, before the first visit, starts with the welcome luck still to come.
    const welcome = req.group === 'standard' && !(await welcomeGiven(trx, accountId));
    await trx.insertInto('galaxy.gacha_state').values({ account_id: accountId, pity_group: req.group, welcome }).onConflict((oc) => oc.doNothing()).execute();
    const before = await trx
      .selectFrom('galaxy.gacha_state')
      .select(['since_legendary', 'since_featured', 'welcome'])
      .where('account_id', '=', accountId)
      .where('pity_group', '=', req.group)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (req.sinceLegendary < before.since_legendary || req.sinceFeatured < before.since_featured || (before.welcome && !req.welcome)) {
      await confirmPassword(deps.db, s, req.password);
    }
    await trx
      .updateTable('galaxy.gacha_state')
      .set({ since_legendary: req.sinceLegendary, since_featured: req.sinceFeatured, welcome: req.welcome })
      .where('account_id', '=', accountId)
      .where('pity_group', '=', req.group)
      .execute();
    await writeAudit(trx, {
      actor,
      action: 'player.gacha_luck',
      ...target(accountId),
      before: { group: req.group, sinceLegendary: before.since_legendary, sinceFeatured: before.since_featured, welcome: before.welcome },
      after: { group: req.group, sinceLegendary: req.sinceLegendary, sinceFeatured: req.sinceFeatured, welcome: req.welcome },
      reason: req.reason,
    });
  });
  return progressOf(deps, accountId);
}

/** A probe's level and starting weapon; a variant must be one of its weapon's that the level opens. Lower: password. */
export async function setProbe(deps: ProgressDeps, actor: AuditActor, s: SessionInfo, accountId: string, req: AdminProbeEdit): Promise<AdminProgress> {
  const [content, cfg] = await Promise.all([deps.config.get('content'), deps.config.get('probes')]);
  const def = content.probes.find((p) => p.id === req.probe);
  if (!def || req.level > probeMaxLevel(cfg)) throw new HttpError(400, 'invalid_input');
  let variant: string | null = null;
  if (req.variant !== null && req.variant !== def.weapon) {
    const w = content.weapons.find((x) => x.id === req.variant);
    if (!w?.variant || w.variant.of !== def.weapon || w.variant.unlockAt > req.level) throw new HttpError(400, 'invalid_input');
    variant = w.id;
  }
  const current = await deps.db.selectFrom('galaxy.probe_levels').select(['level', 'variant']).where('account_id', '=', accountId).where('probe', '=', req.probe).executeTakeFirst();
  if (req.level < (current?.level ?? 1)) await confirmPassword(deps.db, s, req.password);
  await inTransaction(deps.db, async (trx) => {
    await sql`select pg_advisory_xact_lock(hashtextextended(${`probes:${accountId}`}, 0))`.execute(trx);
    const before = await trx.selectFrom('galaxy.probe_levels').select(['level', 'variant']).where('account_id', '=', accountId).where('probe', '=', req.probe).executeTakeFirst();
    const now = new Date();
    await trx
      .insertInto('galaxy.probe_levels')
      .values({ account_id: accountId, probe: req.probe, level: req.level, variant, updated_at: now })
      .onConflict((oc) => oc.columns(['account_id', 'probe']).doUpdateSet({ level: req.level, variant, updated_at: now }))
      .execute();
    await writeAudit(trx, {
      actor,
      action: 'player.probe',
      ...target(accountId),
      before: { probe: req.probe, level: before?.level ?? 1, variant: before?.variant ?? null },
      after: { probe: req.probe, level: req.level, variant },
      reason: req.reason,
    });
  });
  return progressOf(deps, accountId);
}

/**
 * Unlocks a probe for the account, or locks it again (password). A locked probe that the hangar has chosen, and that the
 * account has not earned on its own, gives the hangar back the test's probe, so the next run can start.
 */
export async function setProbeGrant(deps: ProgressDeps, actor: AuditActor, s: SessionInfo, accountId: string, req: AdminProbeGrant): Promise<AdminProgress> {
  const [content, cfg] = await Promise.all([deps.config.get('content'), deps.config.get('probes')]);
  if (!content.probes.some((p) => p.id === req.probe)) throw new HttpError(400, 'invalid_input');
  if (!req.granted) await confirmPassword(deps.db, s, req.password);
  await inTransaction(deps.db, async (trx) => {
    const had = (await probeGrants(trx, accountId)).has(req.probe);
    if (req.granted) {
      await trx.insertInto('galaxy.probe_grants').values({ account_id: accountId, probe: req.probe }).onConflict((oc) => oc.doNothing()).execute();
    } else {
      await trx.deleteFrom('galaxy.probe_grants').where('account_id', '=', accountId).where('probe', '=', req.probe).execute();
      const assigned = await testedProbe(trx, accountId);
      const earned = assigned !== null && probeStatus(req.probe, assigned, await runStats(trx, accountId, cfg.minRunSeconds), cfg).unlocked;
      if (!earned && assigned !== null) {
        await trx.updateTable('galaxy.hangars').set({ probe: assigned, updated_at: new Date() }).where('account_id', '=', accountId).where('probe', '=', req.probe).execute();
      }
    }
    await writeAudit(trx, { actor, action: 'player.probe_grant', ...target(accountId), before: { probe: req.probe, granted: had }, after: { probe: req.probe, granted: req.granted }, reason: req.reason });
  });
  return progressOf(deps, accountId);
}

/** A machine room's level (0 = broken). The refinery keeps what it refined at its old rate; lower: password. */
export async function setRoom(deps: ProgressDeps, actor: AuditActor, s: SessionInfo, accountId: string, req: AdminRoomEdit): Promise<AdminProgress> {
  if (!(ROOM_IDS as readonly string[]).includes(req.room)) throw new HttpError(400, 'invalid_input');
  const room = req.room as RoomId;
  if (ROOMS[room].kind !== 'machine') throw new HttpError(409, 'room_unavailable');
  const cfg = await deps.config.get('station');
  if (req.level > roomStatus(room, 0, cfg).maxLevel) throw new HttpError(400, 'invalid_input');
  const current = await deps.db.selectFrom('galaxy.station_rooms').select('level').where('account_id', '=', accountId).where('room', '=', room).executeTakeFirst();
  if (req.level < (current?.level ?? ROOMS[room].initial)) await confirmPassword(deps.db, s, req.password);
  await inTransaction(deps.db, async (trx) => {
    await lockStation(trx, accountId);
    // Creates the station's rows if needed and keeps what the refinery refined at the rate it had until now.
    await settleStation(runsDeps(deps), trx, accountId);
    const before = (await trx.selectFrom('galaxy.station_rooms').select('level').where('account_id', '=', accountId).where('room', '=', room).executeTakeFirstOrThrow()).level;
    const now = new Date();
    if (room === 'antenna' && before === 0 && req.level > 0) await trx.updateTable('galaxy.antenna').set({ clock: now }).where('account_id', '=', accountId).execute();
    await trx.updateTable('galaxy.station_rooms').set({ level: req.level, updated_at: now }).where('account_id', '=', accountId).where('room', '=', room).execute();
    await writeAudit(trx, { actor, action: 'player.room', ...target(accountId), before: { room, level: before }, after: { room, level: req.level }, reason: req.reason });
  });
  return progressOf(deps, accountId);
}

/** A Laboratorio node's level (0 removes it). The station is settled first, as the node may change its rates. */
export async function setLabNode(deps: ProgressDeps, actor: AuditActor, s: SessionInfo, accountId: string, req: AdminLabNodeEdit): Promise<AdminProgress> {
  const cfg = await deps.config.get('lab');
  const node = cfg.nodes.find((n) => n.id === req.node);
  if (!node || req.level > node.max) throw new HttpError(400, 'invalid_input');
  const current = await deps.db.selectFrom('galaxy.lab_nodes').select('level').where('account_id', '=', accountId).where('node', '=', node.id).executeTakeFirst();
  if (req.level < (current?.level ?? 0)) await confirmPassword(deps.db, s, req.password);
  await inTransaction(deps.db, async (trx) => {
    await lockStation(trx, accountId);
    if (node.effect.kind === 'refinery' || node.effect.kind === 'antenna') await settleStation(runsDeps(deps), trx, accountId);
    const before = (await trx.selectFrom('galaxy.lab_nodes').select('level').where('account_id', '=', accountId).where('node', '=', node.id).executeTakeFirst())?.level ?? 0;
    const now = new Date();
    if (req.level === 0) await trx.deleteFrom('galaxy.lab_nodes').where('account_id', '=', accountId).where('node', '=', node.id).execute();
    else
      await trx
        .insertInto('galaxy.lab_nodes')
        .values({ account_id: accountId, node: node.id, level: req.level, updated_at: now })
        .onConflict((oc) => oc.columns(['account_id', 'node']).doUpdateSet({ level: req.level, updated_at: now }))
        .execute();
    await writeAudit(trx, { actor, action: 'player.lab_node', ...target(accountId), before: { node: node.id, level: before }, after: { node: node.id, level: req.level }, reason: req.reason });
  });
  return progressOf(deps, accountId);
}

/** Season points added (or taken away: password) for the season open now, as a row that stays. */
export async function adjustSeason(deps: ProgressDeps, actor: AuditActor, s: SessionInfo, accountId: string, req: AdminSeasonEdit): Promise<AdminProgress> {
  const season = await deps.config.get('season');
  if (!seasonOpen(season, new Date())) throw new HttpError(409, 'season_closed');
  if (req.points < 0) await confirmPassword(deps.db, s, req.password);
  await inTransaction(deps.db, async (trx) => {
    await trx.insertInto('galaxy.season_adjustments').values({ account_id: accountId, season: season.id, points: req.points }).execute();
    await writeAudit(trx, { actor, action: 'player.season_points', ...target(accountId), after: { season: season.id, points: req.points }, reason: req.reason });
  });
  invalidateLeaderboard();
  return progressOf(deps, accountId);
}
