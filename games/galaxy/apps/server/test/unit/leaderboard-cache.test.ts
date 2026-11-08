import type { Ranked } from '../../src/social/leaderboard';
import { cachedRanking, invalidateLeaderboard } from '../../src/social/leaderboard';
import { afterEach, expect, test } from 'vitest';

// The leaderboard's cache (M5a review): one aggregate at a time per key, and a run that finishes while one is in
// flight is never hidden behind it: what was computed before the finish is not kept.
afterEach(() => invalidateLeaderboard());

const row = (accountId: string): Ranked => ({ accountId, username: accountId, value: 10, rank: 1, xp: 0 });

test('una lectura en curso cuando se invalida no se queda en la caché', async () => {
  let release: (rows: Ranked[]) => void = () => undefined;
  const stale = cachedRanking('k', () => new Promise<Ranked[]>((r) => (release = r)));
  invalidateLeaderboard();
  release([row('antes')]);
  expect(await stale).toEqual([row('antes')]);
  let calls = 0;
  const fresh = await cachedRanking('k', async () => {
    calls++;
    return [row('antes'), row('despues')];
  });
  expect(calls).toBe(1);
  expect(fresh).toHaveLength(2);
});

test('lecturas a la vez comparten una sola consulta', async () => {
  let calls = 0;
  const compute = async () => {
    calls++;
    return [row('a')];
  };
  const [x, y] = await Promise.all([cachedRanking('k', compute), cachedRanking('k', compute)]);
  expect(x).toBe(y);
  expect(calls).toBe(1);
});

test('una consulta que falla no se queda en la caché', async () => {
  await expect(cachedRanking('k', async () => Promise.reject(new Error('caída')))).rejects.toThrow('caída');
  expect(await cachedRanking('k', async () => [row('b')])).toEqual([row('b')]);
});
