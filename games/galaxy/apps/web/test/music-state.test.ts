import { expect, test } from 'vitest';
import { runScene, type RunMood } from '../src/audio/music/state';

// The music of a run (plan «banda sonora», part A): calm at first, combat from the second layer or at the beacon, danger
// with little life left, the Núcleo's own piece while it is on the field (the deep one its own; the others alternate by
// layer), dimmed while choosing a level-up, ducked in pause.

const mood = (over: Partial<RunMood> = {}): RunMood => ({ hp: 100, maxHp: 100, phase: 'waves', layer: 1, status: 'running', boss: null, ...over });

test.each([
  ['las primeras oleadas, calma', mood(), 1],
  ['la segunda capa, combate', mood({ layer: 2 }), 2],
  ['la baliza, combate', mood({ phase: 'beacon' }), 2],
  ['poca vida, peligro', mood({ hp: 25 }), 3],
  ['el Núcleo, combate', mood({ phase: 'boss', boss: { phase: 1 } }), 2],
  ['el Núcleo en su segunda fase, peligro', mood({ phase: 'boss', boss: { phase: 2 } }), 3],
] as const)('%s', (_, m, intensity) => {
  const scene = runScene(m, 'ice', false, false);
  expect(scene).toMatchObject({ kind: 'run', biome: 'ice', intensity });
});

test('el Núcleo trae su pieza: el profundo la suya, los demás alternan por capa', () => {
  expect(runScene(mood(), 'reef', false, false)).toMatchObject({ boss: null });
  expect(runScene(mood({ phase: 'boss', layer: 1, boss: { phase: 1 } }), 'reef', false, false)).toMatchObject({ boss: { deep: false, form: 1 } });
  expect(runScene(mood({ phase: 'boss', layer: 2, boss: { phase: 1 } }), 'reef', false, false)).toMatchObject({ boss: { deep: false, form: 2 } });
  expect(runScene(mood({ phase: 'boss', layer: 4, boss: { phase: 1 } }), 'reef', true, false)).toMatchObject({ boss: { deep: true } });
});

test('eligiendo mejora se atenúa, y en pausa baja', () => {
  expect(runScene(mood({ status: 'choosing' }), 'nebula', false, false)).toMatchObject({ choosing: true, paused: false });
  expect(runScene(mood(), 'nebula', false, true)).toMatchObject({ choosing: false, paused: true });
});
