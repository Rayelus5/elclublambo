import { randomUUID } from 'node:crypto';
import { ENGINE_VERSION } from '@galaxy/engine';
import { type GalaxyDetail, generateGalaxy, type HangarView, PROBE_TEST, type RunStart } from '@galaxy/shared';
import { SIM_VERSION } from '@galaxy/sim';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { credit, getWallet } from '../../src/economy/wallet';
import { get, post, put, sessionCookie, testApp, uniqueName } from '../helpers';

// Relic levels and slots on the server (GDD §8.4, §8.4 bis; M4c-1): a galaxy's next level is bought with dust in an
// idempotent operation that names it; fusing or disintegrating returns half the dust put into it; the next slot opens
// with its milestone and dust; a run snapshots its relics' levels at the start.

let ctx: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  ctx = await testApp();
});
afterAll(() => ctx.close());

async function player() {
  const res = await post(ctx.app, '/galaxy/api/auth/register', { username: uniqueName('rel'), password: 'una-clave-larga' });
  const cookie = sessionCookie(res);
  await post(ctx.app, '/galaxy/api/probe-test', { answers: PROBE_TEST.questions.map((q) => q.answers.indexOf('lumen' as never)) }, { cookie });
  return { cookie, id: (res.json() as { id: string }).id };
}

let seedCounter = 1n;
async function own(owner: string, tier: number, n = 1): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const g = generateGalaxy(BigInt(Date.now()) * 1000n + 777n + seedCounter++, tier);
    const row = await ctx.db
      .insertInto('galaxy.galaxies')
      .values({ owner_id: owner, seed: g.seed.toString(), engine_version: ENGINE_VERSION, traits: JSON.stringify(g.traits), dna: g.dna, name: g.name, designation: g.designation, tier, score: g.score, finish: 'normal', origin: 'grant' })
      .returning('id')
      .executeTakeFirstOrThrow();
    ids.push(row.id);
  }
  return ids;
}
const give = (id: string, n: number) => credit(ctx.db, id, 'dust', n, 'test');
const levelUp = (cookie: string, id: string, level: number, key = randomUUID()) =>
  post(ctx.app, `/galaxy/api/galaxies/${id}/level-up`, { level }, { cookie, headers: { 'idempotency-key': key } });
const detail = async (cookie: string, id: string) => (await get(ctx.app, `/galaxy/api/galaxies/${id}`, { cookie })).json() as GalaxyDetail;
const act = (cookie: string, url: string, body?: object) => post(ctx.app, url, body, { cookie, headers: { 'idempotency-key': randomUUID() } });
const unlock = (cookie: string, slot: number, key = randomUUID()) => post(ctx.app, '/galaxy/api/hangar/slots/unlock', { slot }, { cookie, headers: { 'idempotency-key': key } });
const hangar = async (cookie: string) => (await get(ctx.app, '/galaxy/api/hangar', { cookie })).json() as HangarView;

/** Finished, non-suspicious runs of two minutes straight in the table (what finishRun would leave). */
async function finishedRuns(account: string, n: number) {
  for (let k = 0; k < n; k++) {
    await ctx.db
      .insertInto('galaxy.runs')
      .values({
        account_id: account,
        seed: '1',
        sector: 'outer-nebula',
        probe: 'lumen',
        relics: '[]',
        content_version: 0,
        sim_version: SIM_VERSION,
        start_key: randomUUID(),
        started_at: new Date(),
        finished_at: new Date(),
        outcome: 'died',
        ticks: 7200,
        depth: 1,
        kills: 10,
        boss_kills: 0,
        level: 3,
        seconds: 120,
        hash: '0123456789abcdef',
        payout: '{}',
        runs_version: 0,
        flags: [],
        suspicious: false,
      })
      .execute();
  }
}

test('subir una galaxia al nivel 2 cuesta 20 de polvo, lo apunta y el detalle lo dice', async () => {
  const { cookie, id } = await player();
  const [g] = await own(id, 3);
  await give(id, 100);
  const res = await levelUp(cookie, g!, 2);
  expect(res.statusCode).toBe(200);
  const body = res.json() as { galaxy: GalaxyDetail; wallet: { dust: number } };
  expect(body.galaxy).toMatchObject({ level: 2, levelUp: { dust: 35 }, refund: 10 });
  expect(body.wallet.dust).toBe(80);
  const row = await ctx.db.selectFrom('galaxy.galaxies').select(['level', 'level_dust']).where('id', '=', g!).executeTakeFirstOrThrow();
  expect(row).toEqual({ level: 2, level_dust: 20 });
});

test('vista vieja, clave repetida y dos a la vez: un nivel y un cobro', async () => {
  const { cookie, id } = await player();
  const [g] = await own(id, 1);
  await give(id, 200);
  const key = randomUUID();
  expect((await levelUp(cookie, g!, 2, key)).statusCode).toBe(200);
  expect((await levelUp(cookie, g!, 2, key)).statusCode).toBe(200);
  const stale = await levelUp(cookie, g!, 2);
  expect(stale.statusCode).toBe(409);
  expect(stale.json()).toEqual({ error: 'relic_changed' });
  const both = await Promise.all([levelUp(cookie, g!, 3), levelUp(cookie, g!, 3)]);
  expect(both.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  expect((await getWallet(ctx.db, id)).dust).toBe(200 - 20 - 35);
});

test('una galaxia ajena o desintegrada, 404; en el 10, relic_maxed; sin polvo, 402', async () => {
  const a = await player();
  const b = await player();
  const [mine] = await own(a.id, 0);
  expect((await levelUp(b.cookie, mine!, 2)).statusCode).toBe(404);
  expect((await levelUp(a.cookie, mine!, 2)).statusCode).toBe(402);
  await ctx.db.updateTable('galaxy.galaxies').set({ level: 10 }).where('id', '=', mine!).execute();
  await give(a.id, 1000);
  // At level 10 the request names the next level it sees (10 is the highest a request can name).
  const max = await levelUp(a.cookie, mine!, 10);
  expect(max.statusCode).toBe(409);
  expect(max.json()).toEqual({ error: 'relic_maxed' });
  expect((await act(a.cookie, `/galaxy/api/galaxies/${mine}/disintegrate`)).statusCode).toBe(200);
  expect((await levelUp(a.cookie, mine!, 2)).statusCode).toBe(404);
});

test('desintegrar una galaxia de nivel 3 (55 de polvo invertido) devuelve 27 además de su rendimiento, una vez', async () => {
  const { cookie, id } = await player();
  const [g] = await own(id, 3);
  await give(id, 55);
  expect((await levelUp(cookie, g!, 2)).statusCode).toBe(200);
  expect((await levelUp(cookie, g!, 3)).statusCode).toBe(200);
  const d = await detail(cookie, g!);
  expect(d.refund).toBe(27);
  const plain = d.dust - 27;
  const res = await act(cookie, `/galaxy/api/galaxies/${g}/disintegrate`);
  expect((res.json() as { dust: number }).dust).toBe(plain + 27);
  expect((await getWallet(ctx.db, id)).dust).toBe(plain + 27);
});

test('fusionar cinco galaxias con niveles devuelve la mitad de su polvo', async () => {
  const { cookie, id } = await player();
  const five = await own(id, 0, 5);
  await give(id, 20 + 20 + 55 + 20);
  // Two at level 2 (20 each) and one at level 3 (55): refunds 10 + 10 + 27.
  expect((await levelUp(cookie, five[0]!, 2)).statusCode).toBe(200);
  expect((await levelUp(cookie, five[1]!, 2)).statusCode).toBe(200);
  expect((await levelUp(cookie, five[2]!, 2)).statusCode).toBe(200);
  expect((await levelUp(cookie, five[2]!, 3)).statusCode).toBe(200);
  const before = (await getWallet(ctx.db, id)).dust;
  const fused = await act(cookie, '/galaxy/api/galaxies/fuse', { ids: five });
  expect(fused.statusCode).toBe(200);
  // The common recipe costs 20 dust.
  expect((fused.json() as { wallet: { dust: number } }).wallet.dust).toBe(before - 20 + 47);
});

test('la ranura 3: cerrada hasta 5 partidas; después cuesta 100 de polvo, la abre y el Hangar enseña la 4', async () => {
  const { cookie, id } = await player();
  await give(id, 150);
  expect((await hangar(cookie)).nextSlot).toMatchObject({ slot: 3, ready: false, progress: 0, dust: 100 });
  const early = await unlock(cookie, 3);
  expect(early.statusCode).toBe(409);
  expect(early.json()).toEqual({ error: 'slot_locked' });
  await finishedRuns(id, 5);
  const res = await unlock(cookie, 3);
  expect(res.statusCode).toBe(200);
  const v = res.json() as HangarView;
  expect(v.slots).toBe(3);
  expect(v.loadout).toHaveLength(3);
  expect(v.nextSlot).toMatchObject({ slot: 4, condition: { stat: 'bossKills', value: 3 }, dust: 300 });
  expect((await getWallet(ctx.db, id)).dust).toBe(50);
});

test('vista vieja y seis ranuras: slot_changed y slot_maxed, sin cobrar', async () => {
  const { cookie, id } = await player();
  await give(id, 500);
  await finishedRuns(id, 5);
  expect((await unlock(cookie, 3)).statusCode).toBe(200);
  const stale = await unlock(cookie, 3);
  expect(stale.statusCode).toBe(409);
  expect(stale.json()).toEqual({ error: 'slot_changed' });
  await ctx.db.updateTable('galaxy.hangars').set({ relic_slots: 6 }).where('account_id', '=', id).execute();
  const max = await unlock(cookie, 6);
  expect(max.statusCode).toBe(409);
  expect(max.json()).toEqual({ error: 'slot_maxed' });
  expect((await getWallet(ctx.db, id)).dust).toBe(400);
});

test('la incursión usa el nivel nuevo de una reliquia equipada; la que estaba en curso no', async () => {
  const { cookie, id } = await player();
  const [g] = await own(id, 4);
  await give(id, 100);
  expect((await put(ctx.app, '/galaxy/api/hangar/loadout', { relics: [g, null] }, { cookie })).statusCode).toBe(200);
  const start = () => post(ctx.app, '/galaxy/api/runs', { sector: 'outer-nebula', probe: 'lumen', simVersion: SIM_VERSION }, { cookie, headers: { 'idempotency-key': randomUUID() } });
  const first = (await start()).json() as RunStart;
  expect(first.relics[0]!.level).toBe(1);
  expect((await levelUp(cookie, g!, 2)).statusCode).toBe(200);
  const second = (await start()).json() as RunStart;
  expect(second.relics[0]!.level).toBe(2);
  const kept = await ctx.db.selectFrom('galaxy.runs').select('relics').where('id', '=', first.id).executeTakeFirstOrThrow();
  expect((kept.relics as { level: number }[])[0]!.level).toBe(1);
});
