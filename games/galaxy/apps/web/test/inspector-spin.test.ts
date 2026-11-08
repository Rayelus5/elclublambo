import { expect, test } from 'vitest';
import { dragSpin, faceOf, settle, toFace } from '../src/inspector/spin';

// Turning the 3D inspector's card by dragging (M6d-1 request): a drag across the whole card is a turn and a half
// (dragSpin), letting go settles on the nearest face (settle), and the button turns to the other face from wherever it
// rests (toFace). faceOf says which face shows.

test('arrastrar todo el ancho gira una vuelta y media; sin arrastre no gira', () => {
  expect(dragSpin(0, 0, 400)).toBe(0);
  expect(dragSpin(0, 400, 400)).toBeCloseTo(Math.PI * 1.5);
  expect(dragSpin(Math.PI, -200, 400)).toBeCloseTo(Math.PI * 0.25);
});

test('al soltar se asienta en la cara más cercana', () => {
  expect(settle(0.4)).toBe(0);
  expect(settle(Math.PI * 0.6)).toBeCloseTo(Math.PI);
  expect(settle(-Math.PI * 0.7)).toBeCloseTo(-Math.PI);
  expect(settle(Math.PI * 2.4)).toBeCloseTo(Math.PI * 2);
});

test('qué cara se ve, también tras varias vueltas o hacia el otro lado', () => {
  expect(faceOf(0)).toBe('front');
  expect(faceOf(Math.PI)).toBe('back');
  expect(faceOf(-Math.PI)).toBe('back');
  expect(faceOf(Math.PI * 2)).toBe('front');
  expect(faceOf(Math.PI * 3)).toBe('back');
});

test('el botón lleva a la otra cara desde donde esté, por el camino corto', () => {
  expect(toFace(0, 'back')).toBeCloseTo(Math.PI);
  expect(toFace(Math.PI * 2, 'back')).toBeCloseTo(Math.PI * 3);
  expect(toFace(-Math.PI, 'front')).toBeCloseTo(0);
  expect(toFace(Math.PI, 'back')).toBeCloseTo(Math.PI);
});
