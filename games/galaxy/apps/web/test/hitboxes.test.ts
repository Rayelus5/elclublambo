import { ANGLE_STEPS, createSim, DEFAULT_CONTENT, debugSummonCore, IDLE, PROBE_RADIUS, spawnEnemy, step } from '@galaxy/sim';
import { expect, test } from 'vitest';
import { hitboxShapes } from '../src/arena/stage/hitboxes';

// The admin debug mode's collisions (2026-11-15): what the stage outlines is the sim's own radius for each thing.

function world() {
  const sim = createSim({ seed: '7', content: DEFAULT_CONTENT, sector: DEFAULT_CONTENT.sectors[0]!.id, probes: [{ probe: DEFAULT_CONTENT.probes[0]!.id, relics: [] }] });
  step(sim, [IDLE]);
  return sim;
}

test('la sonda: su cuerpo y su alcance de recogida', () => {
  const sim = world();
  const p = sim.probes[0]!;
  const shapes = hitboxShapes(sim, 1);
  expect(shapes).toContainEqual({ kind: 'circle', x: p.x, y: p.y, r: PROBE_RADIUS, tone: 'probe' });
  expect(shapes).toContainEqual({ kind: 'circle', x: p.x, y: p.y, r: p.stats.pickup, tone: 'pickup' });
});

test('cada enemigo con su radio, y el Núcleo aparte', () => {
  const sim = world();
  const mite = sim.content.enemies.find((e) => e.id === 'mite')!;
  const e = spawnEnemy(sim, mite, 120, 40);
  sim.enemies.radius[e] = 6;
  debugSummonCore(sim);
  const shapes = hitboxShapes(sim, 1);
  expect(shapes).toContainEqual({ kind: 'circle', x: 120, y: 40, r: 6, tone: 'enemy' });
  const b = sim.boss!.index;
  expect(shapes).toContainEqual({ kind: 'circle', x: sim.enemies.x[b]!, y: sim.enemies.y[b]!, r: sim.enemies.radius[b]!, tone: 'boss' });
});

test('un área en cono sale como cono, en radianes', () => {
  const sim = world();
  const a = sim.areas.spawn();
  sim.areas.x[a] = 10;
  sim.areas.y[a] = 20;
  sim.areas.px[a] = 10;
  sim.areas.py[a] = 20;
  sim.areas.radius[a] = 50;
  sim.areas.angle[a] = ANGLE_STEPS / 4;
  sim.areas.arc[a] = ANGLE_STEPS / 8;
  const cone = hitboxShapes(sim, 1).find((s) => s.tone === 'area');
  expect(cone).toMatchObject({ kind: 'cone', x: 10, y: 20, r: 50 });
  expect(cone && cone.kind === 'cone' ? cone.angle : 0).toBeCloseTo(Math.PI / 2);
  expect(cone && cone.kind === 'cone' ? cone.arc : 0).toBeCloseTo(Math.PI / 4);
});

test('se dibuja donde se ve: entre la posición anterior y la actual', () => {
  const sim = world();
  const mite = sim.content.enemies.find((e) => e.id === 'mite')!;
  const e = spawnEnemy(sim, mite, 100, 0);
  sim.enemies.px[e] = 0;
  sim.enemies.py[e] = 0;
  const shape = hitboxShapes(sim, 0.5).find((s) => s.tone === 'enemy');
  expect(shape).toMatchObject({ x: 50, y: 0 });
});
