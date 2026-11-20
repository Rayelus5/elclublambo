import { describe, expect, test } from 'vitest';
import { decodeCursor, encodeCursor } from '../../src/market/cursor';

// The market's keyset cursor (the owner, 2026-11-14: «profesional para 100.000 anuncios»): an opaque text with the last
// listing's values in the page's order; one made for another order, of another length or not ours is refused.

describe('el cursor del mercado', () => {
  test('va y vuelve con los valores del último anuncio', () => {
    const c = encodeCursor('rare', [4, 0.8125, '0f8f0d0e-6c1b-4c39-9a37-1f7b0c4c2a11']);
    expect(c).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor('rare', c, 3)).toEqual([4, 0.8125, '0f8f0d0e-6c1b-4c39-9a37-1f7b0c4c2a11']);
  });

  test('uno de otro orden, de otra longitud o que no es nuestro se rechaza', () => {
    const c = encodeCursor('new', ['2026-11-14T10:00:00.000Z', 'abc']);
    expect(() => decodeCursor('cheap', c, 2)).toThrow();
    expect(() => decodeCursor('new', c, 3)).toThrow();
    expect(() => decodeCursor('new', 'no-es-un-cursor', 2)).toThrow();
    expect(() => decodeCursor('new', encodeCursor('new', [{} as never, 'x']), 2)).toThrow();
  });
});
