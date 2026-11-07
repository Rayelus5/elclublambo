import { parseConfig } from '@galaxy/shared';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { LAB_ICON_FRAMES, labIconUrl } from '../src/lab/icons';

// The Laboratorio's node icons (GDD §10.6, §17.5; M4b-2 Task 6): every node of the default tree has a 24×24 icon of
// its effect, painted in Aseprite (art/lab/paint-lab.lua) in two frames of glow, and no strip is left over.

const dir = join(process.cwd(), 'apps/web/src/lab/icons');
const size = (name: string) => {
  const b = readFileSync(join(dir, `${name}.png`));
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
};

test('cada nodo del árbol tiene su icono de dos fotogramas de 24×24, y no sobra ninguno', () => {
  const ids = parseConfig('lab', {}).nodes.map((n) => n.id);
  expect(ids).toHaveLength(16);
  for (const id of ids) {
    expect(labIconUrl(id), id).toBeTruthy();
    expect(size(id), id).toEqual([24 * LAB_ICON_FRAMES, 24]);
  }
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.png'))
    .map((f) => f.slice(0, -4));
  expect(new Set(files)).toEqual(new Set(ids));
});
