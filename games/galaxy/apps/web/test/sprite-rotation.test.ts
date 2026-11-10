import { DEFAULT_CONTENT } from '@galaxy/sim';
import { expect, test } from 'vitest';
import { SPRITES } from '../src/arena/sprites';
import { probeHeading, probeView, quarterTurn, rotSprite, scale2x } from '../src/arena/sprites/rotate';

// The probes face eight ways in the arena (open beta): right is the drawing and left its mirror, as before; up and down
// are exact quarter turns; the diagonals are turned 45° with RotSprite (Scale2x three times, turn, sample back), the
// usual way to turn pixel art without breaking it. Their mirrors give the left-hand diagonals.

test('un cuarto de vuelta a la derecha lleva la fila de arriba a la columna de la derecha', () => {
  expect(quarterTurn(['ab', 'cd', 'ef'], 1)).toEqual(['eca', 'fdb']);
  expect(quarterTurn(['ab', 'cd', 'ef'], -1)).toEqual(['bdf', 'ace']);
});

test('Scale2x dobla el tamaño y suaviza las diagonales sin inventar colores', () => {
  const big = scale2x(['.x', 'x.']);
  expect(big).toHaveLength(4);
  expect(big.every((r) => r.length === 4)).toBe(true);
  // The top-left pixel's block: its corner towards the two «x» takes their colour (the diagonal is smoothed).
  expect([big[0]!.slice(0, 2), big[1]!.slice(0, 2)]).toEqual(['..', '.x']);
  expect(new Set(big.join(''))).toEqual(new Set(['.', 'x']));
  expect(scale2x(['kk', 'kk'])).toEqual(['kkkk', 'kkkk', 'kkkk', 'kkkk']);
});

test('RotSprite gira 45° una barra horizontal hasta la diagonal, con los colores de la original y sin recortarla', () => {
  const bar = Array.from({ length: 16 }, (_, y) => (y === 7 || y === 8 ? 'k'.repeat(16) : '.'.repeat(16)));
  const turned = rotSprite(bar, Math.PI / 4, 24);
  expect(turned).toHaveLength(24);
  expect(turned.every((r) => r.length === 24)).toBe(true);
  expect(new Set(turned.join('').replace(/\./g, ''))).toEqual(new Set(['k']));
  // Down-right diagonal through the centre: filled near both ends, empty in the other corners.
  expect(turned[12]![12]).toBe('k');
  expect(turned[7]![7]).toBe('k');
  expect(turned[16]![16]).toBe('k');
  expect(turned[4]![19]).toBe('.');
  expect(turned[19]![4]).toBe('.');
});

test('cada dirección elige su dibujo: derecha e izquierda, arriba y abajo, y las cuatro diagonales', () => {
  const q = Math.PI / 4;
  const id = 'probe-spark';
  expect(probeView(id, 0)).toEqual({ id, flip: 1 });
  expect(probeView(id, Math.PI)).toEqual({ id, flip: -1 });
  expect(probeView(id, 2 * q)).toEqual({ id: `${id}@s`, flip: 1 });
  expect(probeView(id, -2 * q)).toEqual({ id: `${id}@n`, flip: 1 });
  expect(probeView(id, q)).toEqual({ id: `${id}@se`, flip: 1 });
  expect(probeView(id, 3 * q)).toEqual({ id: `${id}@se`, flip: -1 });
  expect(probeView(id, -q)).toEqual({ id: `${id}@ne`, flip: 1 });
  expect(probeView(id, -3 * q)).toEqual({ id: `${id}@ne`, flip: -1 });
  // The nearest of the eight: just under 22.5° is still right, just over it is the diagonal.
  expect(probeView(id, 0.38)).toEqual({ id, flip: 1 });
  expect(probeView(id, 0.41)).toEqual({ id: `${id}@se`, flip: 1 });
  expect(probeView(id, 2 * Math.PI + q)).toEqual({ id: `${id}@se`, flip: 1 });
});

test('cada sonda del contenido tiene sus cuatro dibujos girados, con sus mismos fotogramas y paleta', () => {
  for (const base of DEFAULT_CONTENT.probes.map((p) => p.sprite)) {
    const def = SPRITES[base]!;
    for (const dir of ['n', 's', 'ne', 'se']) {
      const turned = SPRITES[`${base}@${dir}`];
      expect(turned, `${base}@${dir}`).toBeDefined();
      expect(turned!.frames).toHaveLength(def.frames.length);
      expect(turned!.palette).toBe(def.palette);
      expect(turned!.fps).toBe(def.fps);
    }
    expect([SPRITES[`${base}@n`]!.w, SPRITES[`${base}@n`]!.h]).toEqual([def.h, def.w]);
    expect(SPRITES[`${base}@ne`]!.w).toBeGreaterThan(def.w);
  }
});

test('la sonda mira hacia donde se mueve, también con el apuntado con el ratón (el ratón solo dirige los disparos)', () => {
  // facing 1024 of 4096 steps = down; the mouse aims right.
  expect(probeHeading({ facing: 1024, aim: 0 })).toBeCloseTo(Math.PI / 2, 10);
  expect(probeView('probe-spark', probeHeading({ facing: 1024, aim: 0 }))).toEqual({ id: 'probe-spark@s', flip: 1 });
  expect(probeView('probe-spark', probeHeading({ facing: 2048, aim: 3072 }))).toEqual({ id: 'probe-spark', flip: -1 });
});
