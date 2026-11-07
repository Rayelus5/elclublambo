import { BIOMES } from '@galaxy/sim';
import { expect, test } from 'vitest';
import { SPRITES } from '../src/arena/sprites';
import { BIOME_LOOK } from '../src/arena/stage/biomes';
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

test('cada bioma solo pone sus rocas, y siempre las mismas', () => {
  const prefix = { nebula: 'rock-', ice: 'ice-', reef: 'coral-', forge: 'slag-', rift: 'rift-' } as const;
  for (const biome of BIOMES) {
    const rocks = Array.from({ length: 16 }, (_, k) => terrainAt(k, 0, '9', biome))
      .flat()
      .filter((d) => d.kind === 'rock');
    expect(rocks.length, biome).toBeGreaterThan(0);
    for (const r of rocks) expect(r.sprite, biome).toMatch(new RegExp(`^${prefix[biome]}[123]$`));
  }
  expect(terrainAt(2, 3, '9', 'ice')).toEqual(terrainAt(2, 3, '9', 'ice'));
  // The nebula is M3a's ground: same placement as before the biomes.
  expect(terrainAt(2, 3, '9').map(({ sprite: _s, ...d }) => d)).toEqual(terrainAt(2, 3, '9', 'ice').map(({ sprite: _s, ...d }) => d));
});

test('cada bioma tiene su nebulosa, sus estrellas, su polvo y tres rocas que existen', () => {
  for (const biome of BIOMES) {
    const look = BIOME_LOOK[biome];
    for (const c of [...look.nebula, ...look.stars, look.dust]) expect(c, biome).toMatch(/^#[0-9a-f]{6}$/);
    expect(look.rocks).toHaveLength(3);
    for (const r of look.rocks) expect(SPRITES[r], r).toBeDefined();
  }
});
