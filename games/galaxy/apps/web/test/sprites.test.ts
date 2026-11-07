import { DEFAULT_CONTENT } from '@galaxy/sim';
import { expect, test } from 'vitest';
import { pixels, SPRITES } from '../src/arena/sprites';

// The arena's pixel art is written in code as palette grids (plan ruling 10). Every grid must be well formed and
// every sprite the content names must exist, or the renderer would draw holes.

test('cada sprite tiene fotogramas del mismo tamaño y solo usa colores de su paleta', () => {
  for (const [id, def] of Object.entries(SPRITES)) {
    expect(def.frames.length, id).toBeGreaterThan(0);
    for (const frame of def.frames) {
      expect(frame, id).toHaveLength(def.h);
      for (const row of frame) {
        expect(row, `${id}: ${row}`).toHaveLength(def.w);
        for (const ch of row) if (ch !== '.') expect(def.palette[ch], `${id} usa «${ch}»`).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  }
});

test('existen los sprites y los iconos que nombra el contenido, y los del botín y los disparos', () => {
  const C = DEFAULT_CONTENT;
  const named = [
    ...C.probes.map((p) => p.sprite),
    ...C.enemies.map((e) => e.sprite),
    ...C.bosses.map((b) => b.sprite),
    ...C.weapons.map((w) => w.icon),
    ...C.passives.map((p) => p.icon),
  ];
  const engine = ['xp-1', 'xp-5', 'xp-25', 'coin', 'dust', 'repair', 'bolt', 'lance', 'arc', 'drone-bolt', 'orb', 'drone', 'blade', 'relic-ray', 'jet', 'quasar', 'chaos', 'reflected', 'foe-bullet', 'rock-1', 'rock-2', 'rock-3',
    // M3b-1: the arsenal's shots and the enemies' states.
    'missile', 'shard', 'split-shard', 'mine', 'disc', 'turret', 'strike-mark', 'stun-star', 'mark-pip'];
  for (const id of [...named, ...engine]) expect(SPRITES[id], id).toBeDefined();
});

test('los píxeles: transparente donde hay un punto y el color de la paleta donde no', () => {
  const def = { w: 2, h: 1, frames: [['.k']], palette: { k: '#102030' }, fps: 0, anchor: [0.5, 0.5] as [number, number] };
  expect([...pixels(def, 0)]).toEqual([0, 0, 0, 0, 0x10, 0x20, 0x30, 255]);
});

test('ningún sprite de botín, disparo o icono pisa a uno de la fauna o de la sonda', async () => {
  const { ITEMS } = await import('../src/arena/sprites/items');
  const { ICONS } = await import('../src/arena/sprites/icons');
  const fauna = ['probe-lumen', 'mite', 'cell', 'cellet', 'ray', 'spitter', 'shell', 'hive'];
  for (const id of [...Object.keys(ITEMS), ...Object.keys(ICONS)]) expect(fauna, id).not.toContain(id);
});

test('cada evolución tiene su icono dorado y no es igual que el del arma base', () => {
  for (const w of DEFAULT_CONTENT.weapons.filter((x) => x.evolution)) {
    const base = DEFAULT_CONTENT.weapons.find((x) => x.id === w.evolution!.from)!;
    expect(SPRITES[w.icon], w.id).toBeDefined();
    expect(w.icon).toBe(`${base.icon}-evo`);
    expect([...pixels(SPRITES[w.icon]!, 0)]).not.toEqual([...pixels(SPRITES[base.icon]!, 0)]);
  }
});

test('ningún id se repite entre el botín y los disparos y los iconos', async () => {
  const { ITEMS } = await import('../src/arena/sprites/items');
  const { ICONS } = await import('../src/arena/sprites/icons');
  for (const id of Object.keys(ITEMS)) expect(Object.keys(ICONS), id).not.toContain(id);
});
