import { describe, expect, test } from 'vitest';
import { draftFromDefaults } from '../src';

// A draft that starts from what is live (docs/CONTENIDO.md A4): a list of things with ids keeps every published entry
// (and the owner's edits to them) and gains what this build's defaults add, each in its place; with ids, only those
// entries come from the defaults, added or replacing the live one. Anything else comes whole from the defaults.

const live = [
  { id: 'a', v: 1 },
  { id: 'c', v: 30 },
  { id: 'x', v: 9 },
];
const defaults = [
  { id: 'a', v: 1 },
  { id: 'b', v: 2 },
  { id: 'c', v: 3 },
  { id: 'd', v: 4 },
];

describe('draftFromDefaults', () => {
  test('añade lo que falta, cada uno tras el que le precede en los valores por defecto, sin tocar lo vivo', () => {
    expect(draftFromDefaults(live, defaults)).toEqual([
      { id: 'a', v: 1 },
      { id: 'b', v: 2 },
      { id: 'c', v: 30 },
      { id: 'd', v: 4 },
      { id: 'x', v: 9 },
    ]);
  });

  test('con ids, solo esos: el que existe se sustituye y el que falta se añade', () => {
    expect(draftFromDefaults(live, defaults, ['c', 'b'])).toEqual([
      { id: 'a', v: 1 },
      { id: 'b', v: 2 },
      { id: 'c', v: 3 },
      { id: 'x', v: 9 },
    ]);
  });

  test('un id que los valores por defecto no tienen es un error', () => {
    expect(() => draftFromDefaults(live, defaults, ['z'])).toThrow('id_not_in_defaults:z');
  });

  test('lo que no es una lista con ids se toma entero de los valores por defecto, y con ids es un error', () => {
    expect(draftFromDefaults({ tier: [1] }, { tier: [2] })).toEqual({ tier: [2] });
    expect(() => draftFromDefaults({ tier: [1] }, { tier: [2] }, ['a'])).toThrow('not_a_list');
  });

  test('lo nuevo antes de todo lo vivo va al principio', () => {
    expect(draftFromDefaults([{ id: 'b' }], [{ id: 'a' }, { id: 'b' }])).toEqual([{ id: 'a' }, { id: 'b' }]);
  });
});
