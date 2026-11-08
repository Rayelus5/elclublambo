import { expect, test } from 'vitest';
import { warningFrom, warningProgress } from '../src/arena/stage/warnings';

// Warnings run on the simulation's clock, not the wall's (GDD §17.3: nothing hits without its warning on screen). A
// level-up choice, the pause or a slow frame stop the simulation, and the warning waits with it.

const mine = warningFrom({ t: 'telegraph', kind: 'explode', x: 10, y: 20, angle: 0, ticks: 60, radius: 30 }, 100);

test('un aviso empieza en el tick de su evento y dura sus ticks', () => {
  expect(mine).toMatchObject({ kind: 'explode', x: 10, y: 20, radius: 30, start: 100, total: 60 });
  expect(warningProgress(mine, 100)).toBe(0);
  expect(warningProgress(mine, 130)).toBeCloseTo(0.5);
  // Between two ticks, with the frame's fraction.
  expect(warningProgress(mine, 145.5)).toBeCloseTo(45.5 / 60);
});

test('se acaba en el tick en que golpea, ni antes ni después', () => {
  expect(warningProgress(mine, 159.9)).not.toBeNull();
  expect(warningProgress(mine, 160)).toBeNull();
});

test('con la simulación parada no avanza, pase el tiempo real que pase', () => {
  // Same tick before and after a long pause: the same progress.
  const before = warningProgress(mine, 130);
  const after = warningProgress(mine, 130);
  expect(after).toBe(before);
});

test('tras volver atrás en una repetición, un aviso que aún no había salido desaparece', () => {
  // The panel's replayer (M6d-3) rebuilds from tick 0: a warning raised later in the run is not on screen before it.
  expect(warningProgress(mine, 99.5)).toBeNull();
  expect(warningProgress(mine, 0)).toBeNull();
});
