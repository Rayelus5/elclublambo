import { expect, test } from 'vitest';
import { edgePoint } from '../src/arena/stage/edge';

// Pinning a marker to the screen's edge (Nov plan A2): the beacon, the co-op marks and the teammates' arrows share it.
const field = { width: 1280, height: 720, bars: 0 };

test('un punto dentro de la pantalla se queda donde está', () => {
  expect(edgePoint(field, 100, -50, 48)).toEqual({ x: 740, y: 310, angle: 0, inside: true });
});

test('un punto lejos a la derecha queda en el borde derecho, mirando a la derecha', () => {
  const p = edgePoint(field, 5000, 0, 48);
  expect(p.inside).toBe(false);
  expect(p.x).toBeCloseTo(1280 - 48);
  expect(p.y).toBeCloseTo(360);
  expect(p.angle).toBeCloseTo(0);
});

test('un punto arriba a la izquierda se pega al borde más cercano', () => {
  const p = edgePoint(field, -3000, -3000, 48);
  expect(p.inside).toBe(false);
  expect(p.y).toBeCloseTo(48);
  expect(p.x).toBeGreaterThan(48);
  expect(p.angle).toBeCloseTo(-3 * Math.PI / 4);
});

test('con bandas a los lados nunca entra en ellas', () => {
  const p = edgePoint({ width: 3440, height: 1440, bars: 600 }, -9000, 10, 56);
  expect(p.x).toBeCloseTo(600 + 56);
  expect(p.inside).toBe(false);
});

test('con márgenes por lado (el HUD), la marca se queda fuera de ellos', () => {
  const insets = { top: 100, right: 0, bottom: 120, left: 230 };
  const up = edgePoint(field, 0, -5000, 10, insets);
  expect(up.y).toBeCloseTo(110);
  const left = edgePoint(field, -5000, 0, 10, insets);
  expect(left.x).toBeCloseTo(240);
  const down = edgePoint(field, 0, 5000, 10, insets);
  expect(down.y).toBeCloseTo(720 - 130);
  // A point behind the HUD (inside the screen but in its band) counts as off the free field.
  expect(edgePoint(field, 0, -300, 10, insets).inside).toBe(false);
});
