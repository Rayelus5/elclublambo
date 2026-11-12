import { expect, test } from 'vitest';
import { mateMarkers, type MateProbe } from '../src/arena/stage/mates';

// Arrows towards teammates off screen (Nov plan A2): in their colour at the field's edge, with their name and life;
// red while down, faint while away; none for me, nobody on screen, those out until the next layer or gone.
const field = { width: 1280, height: 720, bars: 0 };
const cam = { x: 0, y: 0, zoom: 2 };
const probe = (x: number, y: number, over: Partial<MateProbe> = {}): MateProbe => ({ x, y, hp: 50, maxHp: 100, life: 'up', ...over });

test('en solitario no hay flechas', () => {
  expect(mateMarkers([probe(0, 0)], cam, field, 0)).toEqual([]);
});

test('un compañero lejos a la derecha da una flecha en el borde derecho con su vida', () => {
  const [m, ...rest] = mateMarkers([probe(0, 0), probe(2000, 0)], cam, field, 0);
  expect(rest).toEqual([]);
  expect(m).toMatchObject({ index: 1, hp: 0.5, state: 'ok' });
  expect(m!.x).toBeGreaterThan(1180);
  expect(m!.angle).toBeCloseTo(0);
});

test('un compañero en pantalla no tiene flecha', () => {
  expect(mateMarkers([probe(0, 0), probe(50, 20)], cam, field, 0)).toEqual([]);
});

test('caído late en rojo y desconectado se ve tenue', () => {
  const ms = mateMarkers([probe(0, 0), probe(-3000, 0, { life: 'down', hp: 0 }), probe(0, 3000, { life: 'away' })], cam, field, 0);
  expect(ms.map((m) => [m.index, m.state])).toEqual([
    [1, 'down'],
    [2, 'away'],
  ]);
});

test('quien está fuera hasta la siguiente capa o se ha ido no aparece', () => {
  expect(mateMarkers([probe(0, 0), probe(3000, 0, { life: 'out' }), probe(-3000, 0, { life: 'left' })], cam, field, 0)).toEqual([]);
});

test('mientras miro a otro, mi propia sonda tampoco tiene flecha', () => {
  const ms = mateMarkers([probe(5000, 0, { life: 'out' }), probe(0, 0), probe(-4000, 0)], { x: 0, y: 0, zoom: 2 }, field, 0);
  expect(ms.map((m) => m.index)).toEqual([2]);
});
