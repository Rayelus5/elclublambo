import { expect, test } from 'vitest';
import { parseConfig, runPayout, simulateEconomy } from '../src/index';

// The economy simulator (GDD §16.6; M6d-5): the same pay finishRun gives, per run and through a day's daily yield.
const runs = parseConfig('runs', {});
const none = parseConfig('boosts', {});
const sample = { outcome: 'died' as const, ticks: 10 * 3600, depth: 2, kills: 900, bossKills: 1, level: 12, loot: [{ coins: 60, dust: 20 }, { coins: 40, dust: 10 }] };

test('una partida paga lo mismo que runPayout', () => {
  const r = simulateEconomy([sample], runs, none, { minutesPerDay: 60, at: new Date('2026-11-15T12:00:00Z') });
  const pay = runPayout({ ...sample, hash: '0000000000000000' }, runs, 1);
  expect(r.perRun.coins).toBe(pay.coins);
  expect(r.perRun.dust).toBe(pay.dust);
});

test('el día reparte las partidas por el rendimiento diario y un multiplicador sube lo suyo', () => {
  const short = simulateEconomy([sample], runs, none, { minutesPerDay: 60, at: new Date('2026-11-15T12:00:00Z') });
  expect(short.perDay.runs).toBe(6);
  const long = simulateEconomy([sample], runs, none, { minutesPerDay: 360, at: new Date('2026-11-15T12:00:00Z') });
  // Past the full-rate hours each run pays less: six hours pay less than six times one.
  expect(long.perDay.coins).toBeLessThan(short.perDay.coins * 6);
  const boosted = parseConfig('boosts', { list: [{ id: 'p', name: 'Doble polvo', currency: 'dust', factor: 2, startsAt: '2026-11-14T00:00:00.000Z', endsAt: '2026-11-16T00:00:00.000Z' }] });
  // Doubled before rounding down once: twice the plain pay, or one more.
  const dust = simulateEconomy([sample], runs, boosted, { minutesPerDay: 60, at: new Date('2026-11-15T12:00:00Z') }).perRun.dust;
  expect(dust - short.perRun.dust * 2).toBeGreaterThanOrEqual(0);
  expect(dust - short.perRun.dust * 2).toBeLessThanOrEqual(1);
});
