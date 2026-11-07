import { DEFAULT_CONTENT } from '@galaxy/sim';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { SPRITES } from '../src/arena/sprites';
import { WEAPON_FRAMES, weaponArtUrl } from '../src/hangar/weapons';

// The starting weapons' art (GDD §6, §17.5; M4b-1 Task 6): every probe's weapon and its two variants have an animated
// 32×32 illustration painted in Aseprite (art/weapons/paint-weapons.lua) for the Hangar's cards, and every variant has
// its own 12×12 icon for the run's HUD, told apart from its base's.

const dir = join(process.cwd(), 'apps/web/src/hangar/weapons');
const size = (name: string) => {
  const b = readFileSync(join(dir, `${name}.png`));
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
};
const starting = DEFAULT_CONTENT.probes.map((p) => p.weapon);
const variants = DEFAULT_CONTENT.weapons.filter((w) => w.variant);

test('cada arma inicial y sus variantes tienen su tira de cuatro fotogramas de 32×32, y no sobra ninguna', () => {
  const ids = [...starting, ...variants.map((v) => v.id)];
  expect(ids).toHaveLength(24);
  for (const id of ids) {
    expect(weaponArtUrl(id), id).toBeTruthy();
    expect(size(id), id).toEqual([32 * WEAPON_FRAMES, 32]);
  }
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.png'))
    .map((f) => f.slice(0, -4));
  expect(new Set(files)).toEqual(new Set(ids));
});

test('cada variante tiene su icono, distinto del de su base', () => {
  for (const v of variants) {
    expect(v.icon, v.id).toBe(`icon-${v.id}`);
    const own = SPRITES[v.icon];
    const base = SPRITES[DEFAULT_CONTENT.weapons.find((w) => w.id === v.variant!.of)!.icon];
    expect(own, v.id).toBeDefined();
    expect(JSON.stringify(own), v.id).not.toBe(JSON.stringify(base));
  }
});
