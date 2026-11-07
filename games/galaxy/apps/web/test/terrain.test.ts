import { expect, test } from 'vitest';
import { CHUNK, terrainAt } from '../src/arena/stage/terrain';

// The sector's decoration (DESIGN_SYSTEM §8 quater): placed by chunk from the run seed, the same every time.

test('un trozo siempre tiene la misma decoración y otro trozo, otra', () => {
  expect(terrainAt(3, -2, '42')).toEqual(terrainAt(3, -2, '42'));
  expect(terrainAt(3, -2, '42')).not.toEqual(terrainAt(4, -2, '42'));
  expect(terrainAt(3, -2, '42')).not.toEqual(terrainAt(3, -2, '43'));
});

test('todo cae dentro de su trozo y es de un tipo conocido', () => {
  for (let cx = -3; cx <= 3; cx++) {
    const decor = terrainAt(cx, 1, '7');
    expect(decor.length).toBeGreaterThan(0);
    for (const d of decor) {
      expect(['cloud', 'rock', 'dust']).toContain(d.kind);
      expect(d.x).toBeGreaterThanOrEqual(cx * CHUNK);
      expect(d.x).toBeLessThan((cx + 1) * CHUNK);
      expect(d.y).toBeGreaterThanOrEqual(CHUNK);
      expect(d.y).toBeLessThan(2 * CHUNK);
    }
  }
});
