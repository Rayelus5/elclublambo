import { expect, test } from 'vitest';
import { MATE_GAP, MATE_PAD, mateMarkers, type MateProbe } from '../src/arena/stage/mates';

// Arrows towards teammates off screen (Nov plan A2): in their colour at the field's edge, with their name and life;
// red while down, faint while away; none for me, nobody on screen, those out until the next layer or gone.
const field = { width: 1280, height: 720, bars: 0 };
const cam = { x: 0, y: 0, zoom: 2 };
const probe = (x: number, y: number, over: Partial<MateProbe> = {}): MateProbe => ({ x, y, hp: 50, life: 'up', stats: { maxHp: 100 }, ...over });

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

test('dos compañeros en la misma dirección no se tapan: sus marcas se separan a lo largo del borde', () => {
  const ms = mateMarkers([probe(0, 0), probe(2000, 0), probe(2400, 10)], cam, field, 0);
  expect(ms).toHaveLength(2);
  expect(Math.abs(ms[0]!.y - ms[1]!.y)).toBeGreaterThanOrEqual(MATE_GAP - 0.01);
  for (const m of ms) expect(m.x).toBeCloseTo(1280 - MATE_PAD);
});

test('las marcas evitan los paneles del HUD', () => {
  const [m] = mateMarkers([probe(0, 0), probe(0, -3000)], cam, field, 0, { top: 96, right: 0, bottom: 0, left: 0 });
  expect(m!.y).toBeGreaterThanOrEqual(96 + MATE_PAD - 0.01);
});
