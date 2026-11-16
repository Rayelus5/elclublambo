import { expect, test } from 'vitest';
import { DEFAULT_CONTENT, playBot } from '../src/index';

// A run played by the bot to the end or a time limit (the content editor's quick check, 2026-11-16, P7): how long it
// lasted, how deep it went, whether it beat the first Núcleo and how it ended. The same seed always tells the same.

test('una incursión de bot dice cuánto duró, hasta dónde llegó y cómo acabó, siempre igual con la misma semilla', () => {
  const a = playBot(DEFAULT_CONTENT, { sector: 'outer-nebula', probe: 'lumen', seed: '101', maxMinutes: 6 });
  expect(a.minutes).toBeGreaterThan(0);
  expect(a.minutes).toBeLessThanOrEqual(6.01);
  expect(a.layer).toBeGreaterThanOrEqual(1);
  expect(['died', 'extracted', 'time']).toContain(a.end);
  expect(playBot(DEFAULT_CONTENT, { sector: 'outer-nebula', probe: 'lumen', seed: '101', maxMinutes: 6 })).toEqual(a);
});

test('con enemigos mucho más duros dura menos o llega menos lejos', () => {
  const hard = structuredClone(DEFAULT_CONTENT);
  hard.sectors[0]!.enemyHp = 3;
  hard.sectors[0]!.enemyDamage = 4;
  const easy = playBot(DEFAULT_CONTENT, { sector: 'outer-nebula', probe: 'lumen', seed: '202', maxMinutes: 8 });
  const tough = playBot(hard, { sector: 'outer-nebula', probe: 'lumen', seed: '202', maxMinutes: 8 });
  expect(tough.minutes * 10 + tough.layer).toBeLessThan(easy.minutes * 10 + easy.layer);
});
