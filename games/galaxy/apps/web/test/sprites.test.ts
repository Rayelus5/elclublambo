import { DEFAULT_CONTENT } from '@galaxy/sim';
import { expect, test } from 'vitest';
import { pixels, probeNozzle, SPRITES } from '../src/arena/sprites';

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
    'missile', 'shard', 'split-shard', 'mine', 'disc', 'turret', 'strike-mark', 'stun-star', 'mark-pip',
    // Nov plan B3: the harpoon's head and the mortar's shell (the sling's body, the hologram and the beam are drawn).
    'harpoon', 'mortar-shell'];
  for (const id of [...named, ...engine]) expect(SPRITES[id], id).toBeDefined();
});

test('los píxeles: transparente donde hay un punto y el color de la paleta donde no', () => {
  const def = { w: 2, h: 1, frames: [['.k']], palette: { k: '#102030' }, fps: 0, anchor: [0.5, 0.5] as [number, number] };
  expect([...pixels(def, 0)]).toEqual([0, 0, 0, 0, 0x10, 0x20, 0x30, 255]);
});

// M3b-3 (plan table): the fauna and Cores of the four new sectors, and three rocks per new biome.
const M3B3_FAUNA = ['splinter', 'narwhal', 'beacon', 'geode', 'floe', 'polyp', 'jelly', 'urchin', 'eel', 'colony', 'ember', 'ram', 'sentry', 'golem', 'welder', 'crucible', 'glitch', 'wraith', 'cantor'];
const M3B3_CORES = ['glacier', 'anemone', 'anvil', 'echo-core', 'signal'];
const M3B3_ROCKS = ['ice', 'coral', 'slag', 'rift'].flatMap((b) => [1, 2, 3].map((k) => `${b}-${k}`));

test('M3b-3: cada especie y cada Núcleo de los sectores nuevos, y 3 rocas por bioma, tienen sprite', () => {
  for (const id of [...M3B3_FAUNA, ...M3B3_CORES, ...M3B3_ROCKS]) expect(SPRITES[id], id).toBeDefined();
  // Fauna reads at a glance: two frames at least, and the Cores at the size of the first one.
  for (const id of M3B3_FAUNA) expect(SPRITES[id]!.frames.length, id).toBeGreaterThanOrEqual(2);
  for (const id of M3B3_CORES) expect([SPRITES[id]!.w, SPRITES[id]!.h], id).toEqual([40, 40]);
});

// Nov plan B4: the second and third forms of every Core, 40×40 with two frames, and none looks like another.
const B4_FORMS = [
  ...['hive-swarm', 'hive-queen', 'glacier-egg', 'glacier-daughter', 'anemone-spore', 'anemone-maw'],
  ...['anvil-hammer', 'anvil-furnace', 'echo-choir', 'echo-mirror', 'signal-carrier', 'signal-answer'],
];

test('Nov plan B4: cada forma nueva de Núcleo tiene su sprite de 40×40 con 2 fotogramas distintos, y ninguna repite otra', () => {
  const cores = ['hive', ...M3B3_CORES, ...B4_FORMS];
  expect(cores).toHaveLength(18);
  for (const id of B4_FORMS) {
    const def = SPRITES[id]!;
    expect(def, id).toBeDefined();
    expect([def.w, def.h, def.frames.length], id).toEqual([40, 40, 2]);
    expect(def.frames[0], id).not.toEqual(def.frames[1]);
  }
  const looks = new Set(cores.map((id) => SPRITES[id]!.frames[0]!.join('')));
  expect(looks.size).toBe(18);
  for (const b of DEFAULT_CONTENT.bosses) expect(cores, b.id).toContain(b.sprite);
});

test('ningún sprite de botín, disparo o icono pisa a uno de la fauna o de la sonda', async () => {
  const { ITEMS } = await import('../src/arena/sprites/items');
  const { ICONS } = await import('../src/arena/sprites/icons');
  const fauna = ['probe-lumen', 'mite', 'cell', 'cellet', 'ray', 'spitter', 'shell', 'hive', ...M3B3_FAUNA, ...M3B3_CORES, ...B4_FORMS];
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

// Plan «banda sonora, skins, perfil y entorno», part B: the eight probes redrawn in Aseprite (art/probes), bigger and
// alive while idle, each with the nozzle its flame comes out of.
test('las ocho sondas rediseñadas: 24 × 24, cuatro fotogramas en reposo que cambian y su propia tobera', () => {
  const probes = DEFAULT_CONTENT.probes.map((p) => p.sprite);
  expect(probes).toHaveLength(8);
  for (const id of probes) {
    const def = SPRITES[id]!;
    expect([def.w, def.h, def.frames.length], id).toEqual([24, 24, 4]);
    expect(new Set(def.frames.map((f) => f.join('|'))).size, id).toBeGreaterThan(1);
    // Behind its centre, inside its drawing (the flame comes out of the engine, not out of the void).
    expect(probeNozzle(id), id).toBeGreaterThanOrEqual(8);
    expect(probeNozzle(id), id).toBeLessThanOrEqual(12);
  }
  // A drawing without its own (a skin to come, an old id) keeps the old nozzle.
  expect(probeNozzle('mite')).toBe(8);
});
