import { randomUUID } from 'node:crypto';
import type { CodexProgress } from '@galaxy/shared';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { get, post, randomIp, sessionCookie, testApp, uniqueName } from '../helpers';

// The Códice (M7b-2) counts what the account has done. Nov plan B4: a sector's later Core forms open by the most Cores
// purged in one run there, and only runs of SIM 1.9.0 on met those forms (review B, M6): an older run that purged
// layer 3 fought the first form three times.

type Ctx = Awaited<ReturnType<typeof testApp>>;
let ctx: Ctx;
beforeAll(async () => {
  ctx = await testApp();
});
afterAll(() => ctx.close());

async function finishedRun(accountId: string, sector: string, simVersion: string, bossKills: number) {
  await ctx.db
    .insertInto('galaxy.runs')
    .values({
      account_id: accountId,
      seed: '1',
      sector,
      probe: 'lumen',
      relics: '[]',
      content_version: 0,
      sim_version: simVersion,
      start_key: randomUUID(),
      started_at: new Date(),
      finished_at: new Date(),
      outcome: 'died',
      seconds: 300 * (bossKills + 1),
      depth: bossKills + 1,
      boss_kills: bossKills,
      flags: [],
    })
    .execute();
}

test('las formas del Núcleo solo cuentan las partidas de la SIM 1.9.0 en adelante', async () => {
  const res = await post(ctx.app, '/galaxy/api/auth/register', { username: uniqueName('cdx'), password: 'una-clave-larga' }, { ip: randomIp() });
  const cookie = sessionCookie(res);
  const id = (res.json() as { id: string }).id;
  await finishedRun(id, 'outer-nebula', '1.8.3', 3);
  await finishedRun(id, 'outer-nebula', '1.9.0', 1);
  await finishedRun(id, 'frost-rings', '1.10.0', 2);
  await finishedRun(id, 'frost-rings', 'raro', 3);

  const codex = (await get(ctx.app, '/galaxy/api/codex', { cookie })).json() as CodexProgress;
  // Every finished run still counts for the Cores purged and the longest run.
  expect(codex.sectors['outer-nebula']).toEqual({ maxSeconds: 1200, bossKills: 4, maxBossKills: 1 });
  expect(codex.sectors['frost-rings']).toEqual({ maxSeconds: 1200, bossKills: 5, maxBossKills: 2 });
  expect(codex.bossKills).toBe(9);
});
