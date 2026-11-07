import { randomUUID } from 'node:crypto';
import type { StationView } from '@galaxy/shared';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { credit } from '../../src/economy/wallet';
import { get, post, sessionCookie, testApp, uniqueName } from '../helpers';

// The station on the server (GDD §10, §11.3): a lazy initial state, the refinery and the antenna on the server's hour,
// repairs and upgrades paid with components and coins, every action idempotent and in the ledger, no balance below 0.

let ctx: Awaited<ReturnType<typeof testApp>>;
let clock = new Date('2026-11-07T10:00:00.000Z');
const H = 3_600_000;
const later = (hours: number) => (clock = new Date(clock.getTime() + hours * H));

beforeAll(async () => {
  ctx = await testApp({ now: () => clock });
});
afterAll(() => ctx.close());

async function player() {
  const res = await post(ctx.app, '/galaxy/api/auth/register', { username: uniqueName('stn'), password: 'una-clave-larga' });
  return { cookie: sessionCookie(res), id: (res.json() as { id: string }).id };
}
const view = async (cookie: string) => (await get(ctx.app, '/galaxy/api/station', { cookie })).json() as StationView;
const act = (cookie: string, path: string, body: unknown = {}, key = randomUUID()) => post(ctx.app, `/galaxy/api/station/${path}`, body, { cookie, headers: { 'idempotency-key': key } });
const give = (id: string, currency: string, n: number) => credit(ctx.db, id, currency, n, 'test');

test('una cuenta nueva: cinco salas funcionan, la Antena está rota, cuatro en reparación, la refinería 1 vacía', async () => {
  const { cookie } = await player();
  const [a, b] = await Promise.all([get(ctx.app, '/galaxy/api/station', { cookie }), get(ctx.app, '/galaxy/api/station', { cookie })]);
  expect(a.statusCode).toBe(200);
  expect(b.statusCode).toBe(200);
  const v = a.json() as StationView;
  const state = Object.fromEntries(v.rooms.map((r) => [r.id, r.state]));
  expect(state).toEqual({
    scanner: 'working',
    planetarium: 'working',
    lab: 'future',
    hangar: 'working',
    collider: 'working',
    comms: 'future',
    refinery: 'working',
    antenna: 'broken',
    archive: 'future',
    trophies: 'future',
  });
  expect(v.refinery).toMatchObject({ level: 1, rate: 20, capacity: 100, queue: 0, ready: 0, nextAt: null });
  expect(v.antenna).toMatchObject({ level: 0, accrued: 0 });
});

test('la refinería: cargar, esperar y recoger, sin pasar de su cola ni cobrar dos veces', async () => {
  const { cookie, id } = await player();
  await give(id, 'material', 150);
  const full = await act(cookie, 'refinery/load', { amount: 101 });
  expect(full.statusCode).toBe(409);
  expect(full.json()).toEqual({ error: 'refinery_full' });
  const key = randomUUID();
  const loaded = await act(cookie, 'refinery/load', { amount: 50 }, key);
  expect(loaded.statusCode).toBe(200);
  expect((loaded.json() as StationView).refinery).toMatchObject({ queue: 50, ready: 0 });
  expect((loaded.json() as StationView).wallet['material']).toBe(100);
  // The same key again: the same answer, nothing charged twice.
  expect((await act(cookie, 'refinery/load', { amount: 50 }, key)).json()).toEqual(loaded.json());
  expect((await view(cookie)).wallet['material']).toBe(100);
  later(1);
  expect((await view(cookie)).refinery).toMatchObject({ queue: 30, ready: 20 });
  const got = await act(cookie, 'refinery/collect');
  expect(got.statusCode).toBe(200);
  expect((got.json() as StationView).wallet['components']).toBe(20);
  expect((got.json() as StationView).refinery).toMatchObject({ queue: 30, ready: 0 });
  const again = await act(cookie, 'refinery/collect');
  expect(again.statusCode).toBe(409);
  expect(again.json()).toEqual({ error: 'nothing_to_collect' });
});

test('sin material no carga nada: 402, y la cola sigue igual', async () => {
  const { cookie } = await player();
  const res = await act(cookie, 'refinery/load', { amount: 10 });
  expect(res.statusCode).toBe(402);
  expect(res.json()).toEqual({ error: 'insufficient_funds' });
  expect((await view(cookie)).refinery.queue).toBe(0);
});

test('reparar la antena cuesta 30 componentes; después da una señal cada 8 h, con su tope', async () => {
  const { cookie, id } = await player();
  const poor = await act(cookie, 'rooms/antenna/upgrade');
  expect(poor.statusCode).toBe(402);
  await give(id, 'components', 30);
  const fixed = await act(cookie, 'rooms/antenna/upgrade');
  expect(fixed.statusCode).toBe(200);
  const v = fixed.json() as StationView;
  expect(v.rooms.find((r) => r.id === 'antenna')).toMatchObject({ state: 'working', level: 1 });
  expect(v.wallet['components']).toBe(0);
  expect(v.antenna.accrued).toBe(0);
  const nothing = await act(cookie, 'antenna/collect');
  expect(nothing.json()).toEqual({ error: 'nothing_to_collect' });
  later(12);
  const signal = (await view(cookie)).wallet.signal;
  const got = await act(cookie, 'antenna/collect');
  expect(got.statusCode).toBe(200);
  expect((got.json() as StationView).wallet.signal).toBe(signal + 1);
  later(24 * 7);
  expect((await view(cookie)).antenna.accrued).toBe(1);
});

test('mejorar: la refinería sube de nivel pagando; al máximo, 409; lo que llega más adelante, 409; lo que no existe, 400', async () => {
  const { cookie, id } = await player();
  await give(id, 'components', 2000);
  await give(id, 'coins', 20_000);
  const up = await act(cookie, 'rooms/refinery/upgrade');
  expect(up.statusCode).toBe(200);
  expect((up.json() as StationView).refinery).toMatchObject({ level: 2, rate: 30, capacity: 150 });
  for (let k = 0; k < 3; k++) expect((await act(cookie, 'rooms/refinery/upgrade')).statusCode).toBe(200);
  const max = await act(cookie, 'rooms/refinery/upgrade');
  expect(max.statusCode).toBe(409);
  expect(max.json()).toEqual({ error: 'room_maxed' });
  const lab = await act(cookie, 'rooms/lab/upgrade');
  expect(lab.statusCode).toBe(409);
  expect(lab.json()).toEqual({ error: 'room_unavailable' });
  expect((await act(cookie, 'rooms/nope/upgrade')).statusCode).toBe(400);
  // What it cost: 40 + 90 + 180 + 320 components and 500 + 1200 + 2500 + 5000 coins.
  const w = (await view(cookie)).wallet;
  expect(w['components']).toBe(2000 - 630);
  expect(w.coins).toBe(20_000 - 9200);
});

test('dos cargas a la vez con claves distintas y 100 de material: una pasa y la otra no, sin saldos negativos', async () => {
  const { cookie, id } = await player();
  await give(id, 'material', 100);
  const [a, b] = await Promise.all([act(cookie, 'refinery/load', { amount: 60 }), act(cookie, 'refinery/load', { amount: 60 })]);
  // One goes through; the other is refused (the queue, 60 + 60 > 100, is checked before the wallet).
  const codes = [a.statusCode, b.statusCode].sort();
  expect(codes[0]).toBe(200);
  expect([402, 409]).toContain(codes[1]);
  const v = await view(cookie);
  expect(v.wallet['material']).toBe(40);
  expect(v.refinery.queue).toBe(60);
});

test('sin sesión: 401', async () => {
  expect((await get(ctx.app, '/galaxy/api/station')).statusCode).toBe(401);
});
