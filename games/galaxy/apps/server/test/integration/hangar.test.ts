import { ENGINE_VERSION } from '@galaxy/engine';
import { generateGalaxy, type HangarView } from '@galaxy/shared';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { get, post, put, sessionCookie, testApp, uniqueName } from '../helpers';

// The hangar (GDD §5.1, §8.4): the sector and probe for the next run, and the galaxies equipped as relics in the open
// slots (2 to begin with).
let ctx: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  ctx = await testApp();
});
afterAll(() => ctx.close());

async function player() {
  const res = await post(ctx.app, '/galaxy/api/auth/register', { username: uniqueName('hng'), password: 'una-clave-larga' });
  return { cookie: sessionCookie(res), id: (res.json() as { id: string }).id };
}

let seedCounter = 1n;
async function own(owner: string, tier = 2): Promise<string> {
  const g = generateGalaxy(BigInt(Date.now()) * 1000n + 500n + seedCounter++, tier);
  const row = await ctx.db
    .insertInto('galaxy.galaxies')
    .values({
      owner_id: owner,
      seed: g.seed.toString(),
      engine_version: ENGINE_VERSION,
      traits: JSON.stringify(g.traits),
      dna: g.dna,
      name: g.name,
      designation: g.designation,
      tier,
      score: g.score,
      finish: 'normal',
      origin: 'grant',
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

const hangar = async (cookie: string) => (await get(ctx.app, '/galaxy/api/hangar', { cookie })).json() as HangarView;
const equip = (cookie: string, relics: (string | null)[]) => put(ctx.app, '/galaxy/api/hangar/loadout', { relics }, { cookie });

test('un hangar nuevo: la Nebulosa Exterior, las 8 sondas aún bloqueadas y 2 ranuras vacías con el día a premio completo', async () => {
  const { cookie } = await player();
  const h = await hangar(cookie);
  expect(h.sectors.map((s) => s.id)).toEqual(['outer-nebula', 'frost-rings', 'hollow-reef', 'broken-forge', 'signal-rift']);
  expect(h.sectors[0]!.boss).toMatchObject({ name: 'La Colmena Rota', title: 'Núcleo de la Estática' });
  expect(h.sectors[0]!.fauna.map((f) => f.id)).toEqual(['mite', 'cell', 'ray', 'spitter', 'shell']);
  expect(h.probe).toBe('lumen');
  // Before the probe test (M3b-2) all eight probes are locked: the test gives the first one.
  expect(h.test).toEqual({ taken: false, probe: null });
  expect(h.probes).toHaveLength(8);
  expect(h.probes[0]).toMatchObject({ id: 'lumen', unlocked: false, quirk: 'magnet', weapon: expect.objectContaining({ id: 'pulse' }) });
  expect(h.probes.find((p) => p.id === 'bastion')?.quirk).toBe('thorns');
  expect(h.probes.every((p) => !p.unlocked)).toBe(true);
  expect(h.slots).toBe(2);
  expect(h.maxSlots).toBe(6);
  expect(h.loadout).toEqual([null, null]);
  expect(h.daily).toMatchObject({ playedSeconds: 0, fullSecondsLeft: 3 * 3600, multiplier: 1 });
  expect(new Date(h.daily.resetsAt).getTime()).toBeGreaterThan(Date.now());
  expect(h.runsEnabled).toBe(true);
});

test('equipar galaxias propias las pone en sus ranuras, marcadas como equipadas', async () => {
  const { cookie, id } = await player();
  const a = await own(id, 4);
  const b = await own(id, 1);
  const res = await equip(cookie, [b, a]);
  expect(res.statusCode).toBe(200);
  const h = res.json() as HangarView;
  expect(h.loadout.map((g) => g?.id)).toEqual([b, a]);
  expect(h.loadout[1]).toMatchObject({ tier: 'legendary', equipped: true });
  expect((await equip(cookie, [null, a])).json()).toMatchObject({ loadout: [null, expect.objectContaining({ id: a })] });
});

test('ajenas, desintegradas, repetidas o de más: no cambia nada', async () => {
  const me = await player();
  const other = await player();
  const mine = await own(me.id);
  const theirs = await own(other.id);
  const gone = await own(me.id);
  await ctx.db.updateTable('galaxy.galaxies').set({ disintegrated_at: new Date() }).where('id', '=', gone).execute();
  await equip(me.cookie, [mine, null]);

  for (const relics of [[theirs], [gone], [mine, null, await own(me.id)]]) {
    const res = await equip(me.cookie, relics);
    expect(res.statusCode, JSON.stringify(relics)).toBe(409);
    expect(res.json()).toEqual({ error: 'invalid_loadout' });
  }
  const dup = await equip(me.cookie, [mine, mine]);
  expect(dup.statusCode).toBe(400);
  expect((await hangar(me.cookie)).loadout.map((g) => g?.id ?? null)).toEqual([mine, null]);
});

test('sin sesión no hay hangar', async () => {
  expect((await get(ctx.app, '/galaxy/api/hangar')).statusCode).toBe(401);
});
