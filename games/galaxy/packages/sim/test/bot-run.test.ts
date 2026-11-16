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

test('con enemigos mucho más duros dura menos, llega menos lejos o sube menos de nivel', () => {
  const hard = structuredClone(DEFAULT_CONTENT);
  hard.sectors[0]!.enemyHp = 3;
  hard.sectors[0]!.enemyDamage = 4;
  const easy = playBot(DEFAULT_CONTENT, { sector: 'outer-nebula', probe: 'lumen', seed: '202', maxMinutes: 8 });
  const tough = playBot(hard, { sector: 'outer-nebula', probe: 'lumen', seed: '202', maxMinutes: 8 });
  // Lasts less, or in the same time levels less (each enemy takes longer to fall).
  expect(tough.minutes * 1000 + tough.layer * 100 + tough.level).toBeLessThan(easy.minutes * 1000 + easy.layer * 100 + easy.level);
});
