import { generateGalaxy, LEGENDARY } from '@galaxy/shared';
import { expect, test, vi } from 'vitest';
import { featuredExample } from '../../src/gacha/finds';

// An event scanner's featured example (review of #240): made once per trait, off a bounded search, and never an error
// for the whole endpoint — a featured value no legendary can carry (a config mistake) gives no example, cached too.
// Checked by what is asked of the generator (its bound, how often), never by the clock.

vi.mock('@galaxy/shared', async (original) => {
  const real = await original<typeof import('@galaxy/shared')>();
  return { ...real, generateGalaxy: vi.fn(real.generateGalaxy) };
});
const generate = vi.mocked(generateGalaxy);

test('un ejemplo con el rasgo destacado es una legendaria con ese rasgo, y se hace una sola vez', () => {
  generate.mockClear();
  const a = featuredExample('phenomenon', 'supernova');
  expect(a).not.toBeNull();
  expect(a!.tier).toBe('legendary');
  expect(a!.traits['phenomenon']).toBe('supernova');
  expect(a!.example).toBe(true);
  expect(featuredExample('phenomenon', 'supernova')).toBe(a);
  expect(generate).toHaveBeenCalledTimes(1);
  expect(generate.mock.calls[0]![1]).toBe(LEGENDARY);
});

test('un valor imposible no rompe nada: no hay ejemplo, la búsqueda tiene tope y la segunda vez ni se busca', () => {
  generate.mockClear();
  expect(featuredExample('phenomenon', 'no-existe')).toBeNull();
  expect(generate).toHaveBeenCalledTimes(1);
  // Bounded: far under the generator's own 200 000.
  expect(generate.mock.calls[0]![3]).toBeLessThanOrEqual(30_000);
  expect(featuredExample('phenomenon', 'no-existe')).toBeNull();
  expect(generate).toHaveBeenCalledTimes(1);
});
