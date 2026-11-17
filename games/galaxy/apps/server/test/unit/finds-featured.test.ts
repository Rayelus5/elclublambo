import { LEGENDARY } from '@galaxy/shared';
import { expect, test } from 'vitest';
import { featuredExample } from '../../src/gacha/finds';

// An event scanner's featured example (review of #240): made once per trait, off a bounded search, and never an error
// for the whole endpoint — a featured value no legendary can carry (a config mistake) gives no example, cached too.

test('un ejemplo con el rasgo destacado es una legendaria con ese rasgo, y se hace una sola vez', () => {
  const a = featuredExample('phenomenon', 'supernova');
  expect(a).not.toBeNull();
  expect(a!.tier).toBe('legendary');
  expect(a!.traits['phenomenon']).toBe('supernova');
  expect(a!.example).toBe(true);
  expect(featuredExample('phenomenon', 'supernova')).toBe(a);
  expect(LEGENDARY).toBe(4);
});

test('un valor imposible no rompe nada: no hay ejemplo, en poco tiempo, y la segunda vez ni se busca', () => {
  const t0 = performance.now();
  expect(featuredExample('phenomenon', 'no-existe')).toBeNull();
  const first = performance.now() - t0;
  expect(first).toBeLessThan(2500);
  const t1 = performance.now();
  expect(featuredExample('phenomenon', 'no-existe')).toBeNull();
  expect(performance.now() - t1).toBeLessThan(5);
});
