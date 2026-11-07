import { randomUUID } from 'node:crypto';
import type { LabView, StationView } from '@galaxy/shared';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { credit, getWallet } from '../../src/economy/wallet';
import { get, post, sessionCookie, testApp, uniqueName } from '../helpers';

// The Laboratorio on the server (GDD §10.6, M4b-2): closed until its room is repaired; each node level is bought with
// star dust and components in an idempotent operation that names the level it buys; the station-branch nodes push the
// refinery and the antenna, and what was refined at the old rate stays.

let ctx: Awaited<ReturnType<typeof testApp>>;
let clock = new Date('2026-11-07T10:00:00.000Z');
const H = 3_600_000;
const later = (hours: number) => (clock = new Date(clock.getTime() + hours * H));

beforeAll(async () => {
  ctx = await testApp({ now: () => clock });
});
afterAll(() => ctx.close());

async function player() {
  const res = await post(ctx.app, '/galaxy/api/auth/register', { username: uniqueName('lab'), password: 'una-clave-larga' });
  return { cookie: sessionCookie(res), id: (res.json() as { id: string }).id };
}
const lab = async (cookie: string) => (await get(ctx.app, '/galaxy/api/lab', { cookie })).json() as LabView;
const station = async (cookie: string) => (await get(ctx.app, '/galaxy/api/station', { cookie })).json() as StationView;
const buy = (cookie: string, node: string, level: unknown, key = randomUUID()) =>
  post(ctx.app, `/galaxy/api/lab/nodes/${node}/upgrade`, { level }, { cookie, headers: { 'idempotency-key': key } });
const act = (cookie: string, path: string, body: unknown = {}) => post(ctx.app, `/galaxy/api/station/${path}`, body, { cookie, headers: { 'idempotency-key': randomUUID() } });
const give = (id: string, currency: string, n: number) => credit(ctx.db, id, currency, n, 'test');

/** A player with the Laboratorio repaired and some dust and components left. */
async function withLab(dust = 1000, components = 500) {
  const p = await player();
  await give(p.id, 'components', 50 + components);
  await give(p.id, 'coins', 500);
  await give(p.id, 'dust', dust);
  expect((await act(p.cookie, 'rooms/lab/upgrade', { level: 1 })).statusCode).toBe(200);
  return p;
}
const nodeOf = (v: LabView, id: string) => v.nodes.find((n) => n.id === id)!;

test('cerrado hasta reparar la sala: la vista lo dice y mejorar da lab_closed', async () => {
  const { cookie, id } = await player();
  await give(id, 'dust', 100);
  await give(id, 'components', 100);
  const v = await lab(cookie);
  expect(v.open).toBe(false);
  expect(v.nodes).toHaveLength(16);
  const res = await buy(cookie, 'hull', 1);
  expect(res.statusCode).toBe(409);
  expect(res.json()).toEqual({ error: 'lab_closed' });
});

test('reparar el laboratorio lo abre y Blindaje reforzado al 1 cuesta 40 de polvo y 15 componentes', async () => {
  const { cookie, id } = await withLab();
  expect((await lab(cookie)).open).toBe(true);
  const before = await getWallet(ctx.db, id);
  const res = await buy(cookie, 'hull', 1);
  expect(res.statusCode).toBe(200);
  const v = res.json() as LabView;
  expect(nodeOf(v, 'hull')).toMatchObject({ level: 1, next: { dust: 64, components: 24 } });
  expect(nodeOf(v, 'thrusters').unlocked).toBe(true);
  expect(v.effects.bonuses).toEqual([{ stat: 'maxHp', value: 0.02 }]);
  const after = await getWallet(ctx.db, id);
  expect(before.dust - after.dust).toBe(40);
  expect(before['components']! - after['components']!).toBe(15);
});

test('un nodo con su requisito sin comprar da lab_locked y uno que no existe, 400', async () => {
  const { cookie, id } = await withLab();
  const before = await getWallet(ctx.db, id);
  const res = await buy(cookie, 'thrusters', 1);
  expect(res.statusCode).toBe(409);
  expect(res.json()).toEqual({ error: 'lab_locked' });
  expect((await buy(cookie, 'nope', 1)).statusCode).toBe(400);
  expect(await getWallet(ctx.db, id)).toEqual(before);
});

test('una vista vieja da lab_changed sin cobrar, y una clave repetida cobra una vez', async () => {
  const { cookie, id } = await withLab();
  const key = randomUUID();
  expect((await buy(cookie, 'hull', 1, key)).statusCode).toBe(200);
  const before = await getWallet(ctx.db, id);
  expect((await buy(cookie, 'hull', 1, key)).statusCode).toBe(200);
  expect(await getWallet(ctx.db, id)).toEqual(before);
  const stale = await buy(cookie, 'hull', 1);
  expect(stale.statusCode).toBe(409);
  expect(stale.json()).toEqual({ error: 'lab_changed' });
  expect(await getWallet(ctx.db, id)).toEqual(before);
});

test('dos mejoras a la vez con claves distintas al mismo nivel: una pasa y cobra una vez', async () => {
  const { cookie, id } = await withLab();
  const before = await getWallet(ctx.db, id);
  const both = await Promise.all([buy(cookie, 'resonance', 1), buy(cookie, 'resonance', 1)]);
  expect(both.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  expect(before.dust - (await getWallet(ctx.db, id)).dust).toBe(40);
});

test('al máximo, lab_maxed; sin fondos, 402', async () => {
  const { cookie } = await withLab(5000, 2000);
  for (let level = 1; level <= 5; level++) expect((await buy(cookie, 'magnet', level)).statusCode).toBe(200);
  const max = await buy(cookie, 'magnet', 6);
  expect(max.statusCode).toBe(409);
  expect(max.json()).toEqual({ error: 'lab_maxed' });
  const poor = await withLab(10, 0);
  expect((await buy(poor.cookie, 'hull', 1)).statusCode).toBe(402);
});

test('Caudal sube el ritmo de la refinería y lo refinado antes se queda', async () => {
  const { cookie, id } = await withLab();
  await give(id, 'material', 100);
  expect((await act(cookie, 'refinery/load', { amount: 100 })).statusCode).toBe(200);
  later(1);
  expect((await station(cookie)).refinery).toMatchObject({ ready: 20, rate: 20 });
  expect((await buy(cookie, 'throughput', 1)).statusCode).toBe(200);
  later(1);
  expect((await station(cookie)).refinery).toMatchObject({ ready: 41, rate: 21 });
});

test('Silos agranda la cola y Receptor sube el ritmo de la antena', async () => {
  const { cookie } = await withLab(2000, 500);
  expect((await act(cookie, 'rooms/antenna/upgrade', { level: 1 })).statusCode).toBe(200);
  for (const node of ['throughput', 'silos', 'receiver']) expect((await buy(cookie, node, 1)).statusCode).toBe(200);
  const v = await station(cookie);
  expect(v.refinery.capacity).toBe(110);
  expect(v.antenna.rate).toBeCloseTo(0.125 * 1.05, 9);
});

test('sin sesión, 401 antes que validar el cuerpo', async () => {
  const res = await post(ctx.app, '/galaxy/api/lab/nodes/hull/upgrade', { level: 'x' }, { headers: { 'idempotency-key': randomUUID() } });
  expect(res.statusCode).toBe(401);
  expect((await get(ctx.app, '/galaxy/api/lab')).statusCode).toBe(401);
});

test('una mejora cobra los componentes antes que el polvo, en el mismo orden que el resto de la economía', async () => {
  const { cookie, id } = await withLab();
  expect((await buy(cookie, 'hull', 1)).statusCode).toBe(200);
  const rows = await ctx.db
    .selectFrom('galaxy.ledger')
    .select(['currency'])
    .where('account_id', '=', id)
    .where('reason', '=', 'lab')
    .orderBy('id')
    .execute();
  expect(rows.map((r) => r.currency)).toEqual(['components', 'dust']);
});
