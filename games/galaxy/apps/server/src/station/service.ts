import {
  advanceRefinery,
  antennaAccrued,
  antennaFullAt,
  antennaRate,
  nextRefined,
  type RefineryRow,
  refineryLevel,
  ROOM_IDS,
  type RoomId,
  ROOMS,
  roomStatus,
  type StationConfig,
  type StationView,
} from '@galaxy/shared';
import { type Kysely, sql } from 'kysely';
import type { DB } from '../db/schema';
import { credit, debit, getWallet } from '../economy/wallet';
import { HttpError } from '../errors';
import type { RunsDeps } from '../runs/hangar';

// The station on the server (GDD §10, §11.3). Its rows are created lazily with the initial state on the first visit.
// The refinery and the antenna advance with the server's hour before every change (never a background job). Every
// change runs under the account's station lock, inside the caller's idempotent operation.

type Db = Kysely<DB>;

interface State {
  levels: Record<RoomId, number>;
  refinery: RefineryRow;
  antennaClock: Date;
}

/** The initial rows (rooms at their starting level, an empty refinery, the antenna's clock), created once. */
async function ensureStation(db: Db, accountId: string, now: Date): Promise<void> {
  await db
    .insertInto('galaxy.station_rooms')
    .values(ROOM_IDS.map((room) => ({ account_id: accountId, room, level: ROOMS[room].initial, updated_at: now })))
    .onConflict((oc) => oc.columns(['account_id', 'room']).doNothing())
    .execute();
  await db.insertInto('galaxy.refinery').values({ account_id: accountId, queue: 0, ready: 0, clock: now }).onConflict((oc) => oc.column('account_id').doNothing()).execute();
  await db.insertInto('galaxy.antenna').values({ account_id: accountId, clock: now }).onConflict((oc) => oc.column('account_id').doNothing()).execute();
}

async function readState(db: Db, accountId: string, cfg: StationConfig, now: Date): Promise<State> {
  await ensureStation(db, accountId, now);
  const rows = await db.selectFrom('galaxy.station_rooms').select(['room', 'level']).where('account_id', '=', accountId).execute();
  const levels = Object.fromEntries(ROOM_IDS.map((r) => [r, ROOMS[r].initial])) as Record<RoomId, number>;
  for (const r of rows) if ((ROOM_IDS as readonly string[]).includes(r.room)) levels[r.room as RoomId] = r.level;
  const ref = await db.selectFrom('galaxy.refinery').select(['queue', 'ready', 'clock']).where('account_id', '=', accountId).executeTakeFirstOrThrow();
  const ant = await db.selectFrom('galaxy.antenna').select('clock').where('account_id', '=', accountId).executeTakeFirstOrThrow();
  const refinery = advanceRefinery({ queue: ref.queue, ready: ref.ready, clock: ref.clock }, levels.refinery, cfg, now);
  return { levels, refinery, antennaClock: ant.clock };
}

function toView(state: State, cfg: StationConfig, now: Date, wallet: StationView['wallet']): StationView {
  const ref = refineryLevel(state.levels.refinery, cfg);
  const antenna = state.levels.antenna;
  const next = nextRefined(state.refinery, state.levels.refinery, cfg);
  return {
    rooms: ROOM_IDS.map((id) => ({ id, ...roomStatus(id, state.levels[id], cfg) })),
    refinery: { level: state.levels.refinery, rate: ref.rate, capacity: ref.queue, queue: state.refinery.queue, ready: state.refinery.ready, nextAt: next ? next.toISOString() : null },
    antenna: {
      level: antenna,
      rate: antennaRate(antenna, cfg),
      capHours: cfg.antenna.capHours,
      accrued: antennaAccrued(state.antennaClock, antenna, cfg, now).signals,
      fullAt: antenna > 0 ? antennaFullAt(state.antennaClock, cfg).toISOString() : null,
    },
    wallet,
  };
}

export async function stationView(deps: RunsDeps, accountId: string, db: Db = deps.db): Promise<StationView> {
  const cfg = await deps.config.get('station');
  const now = deps.now();
  const state = await readState(db, accountId, cfg, now);
  return toView(state, cfg, now, await getWallet(db, accountId));
}

async function lock(trx: Db, accountId: string): Promise<void> {
  await sql`select pg_advisory_xact_lock(hashtextextended(${`station:${accountId}`}, 0))`.execute(trx);
}

async function saveRefinery(trx: Db, accountId: string, row: RefineryRow): Promise<void> {
  await trx.updateTable('galaxy.refinery').set({ queue: row.queue, ready: row.ready, clock: row.clock }).where('account_id', '=', accountId).execute();
}

/** One station change, under the account's lock: `change` gets the advanced state and may write. */
async function change(deps: RunsDeps, trx: Db, accountId: string, fn: (state: State, cfg: StationConfig, now: Date) => Promise<void>): Promise<StationView> {
  await lock(trx, accountId);
  const cfg = await deps.config.get('station');
  const now = deps.now();
  const state = await readState(trx, accountId, cfg, now);
  await fn(state, cfg, now);
  return stationView(deps, accountId, trx);
}

export function loadRefinery(deps: RunsDeps, trx: Db, accountId: string, amount: number, key: string): Promise<StationView> {
  return change(deps, trx, accountId, async (state, cfg) => {
    const { queue: capacity } = refineryLevel(state.levels.refinery, cfg);
    if (state.refinery.queue + amount > capacity) throw new HttpError(409, 'refinery_full');
    await debit(trx, accountId, 'material', amount, 'refinery_load', { amount }, key);
    await saveRefinery(trx, accountId, { ...state.refinery, queue: state.refinery.queue + amount });
  });
}

export function collectRefinery(deps: RunsDeps, trx: Db, accountId: string, key: string): Promise<StationView> {
  return change(deps, trx, accountId, async (state) => {
    const ready = state.refinery.ready;
    if (ready <= 0) throw new HttpError(409, 'nothing_to_collect');
    await credit(trx, accountId, 'components', ready, 'refinery_collect', { ready }, key);
    await saveRefinery(trx, accountId, { ...state.refinery, ready: 0 });
  });
}

export function collectAntenna(deps: RunsDeps, trx: Db, accountId: string, key: string): Promise<StationView> {
  return change(deps, trx, accountId, async (state, cfg, now) => {
    const { signals, clock } = antennaAccrued(state.antennaClock, state.levels.antenna, cfg, now);
    if (signals <= 0) throw new HttpError(409, 'nothing_to_collect');
    await credit(trx, accountId, 'signal', signals, 'antenna', { signals }, key);
    await trx.updateTable('galaxy.antenna').set({ clock }).where('account_id', '=', accountId).execute();
  });
}

export function upgradeRoom(deps: RunsDeps, trx: Db, accountId: string, room: string, key: string): Promise<StationView> {
  if (!(ROOM_IDS as readonly string[]).includes(room)) throw new HttpError(400, 'invalid_input');
  const id = room as RoomId;
  return change(deps, trx, accountId, async (state, cfg, now) => {
    const status = roomStatus(id, state.levels[id], cfg);
    if (status.state === 'future') throw new HttpError(409, 'room_unavailable');
    if (!status.next) throw new HttpError(409, 'room_maxed');
    const { components, coins } = status.next.cost;
    const ref = { room: id, level: state.levels[id] + 1 };
    if (components > 0) await debit(trx, accountId, 'components', components, 'room_upgrade', ref, key);
    if (coins > 0) await debit(trx, accountId, 'coins', coins, 'room_upgrade', ref, key);
    // The refinery keeps what it refined at its old rate (already advanced); a repaired antenna starts accruing now.
    if (id === 'refinery') await saveRefinery(trx, accountId, state.refinery);
    if (id === 'antenna' && state.levels.antenna === 0) await trx.updateTable('galaxy.antenna').set({ clock: now }).where('account_id', '=', accountId).execute();
    await trx
      .updateTable('galaxy.station_rooms')
      .set({ level: state.levels[id] + 1, updated_at: now })
      .where('account_id', '=', accountId)
      .where('room', '=', id)
      .execute();
  });
}
