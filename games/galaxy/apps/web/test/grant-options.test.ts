import { DEFAULT_CONTENT } from '@galaxy/sim';
import { expect, test } from 'vitest';
import { grantOptions, searchGrants } from '../src/arena/debug/grant-options';

// What the debug panel can grant (2026-11-15): every weapon but variants and evolutions, every passive and every
// evolution, each with its top level; the search ignores case and accents.

test('lista armas sin variantes, pasivas y evoluciones con su nivel máximo', () => {
  const all = grantOptions(DEFAULT_CONTENT);
  const weapons = all.filter((o) => o.kind === 'weapon');
  expect(weapons.map((o) => o.id)).toEqual(DEFAULT_CONTENT.weapons.filter((w) => !w.variant && !w.evolution).map((w) => w.id));
  expect(all.filter((o) => o.kind === 'passive')).toHaveLength(DEFAULT_CONTENT.passives.length);
  expect(all.filter((o) => o.kind === 'evolution').map((o) => o.id)).toEqual(DEFAULT_CONTENT.weapons.filter((w) => w.evolution).map((w) => w.id));
  const nova = DEFAULT_CONTENT.weapons.find((w) => w.id === 'nova')!;
  expect(all.find((o) => o.id === 'nova')).toMatchObject({ kind: 'weapon', name: nova.name, maxLevel: nova.levels.length });
});

test('la búsqueda ignora mayúsculas y tildes, y busca también por id', () => {
  const all = grantOptions(DEFAULT_CONTENT);
  const named = all.find((o) => /[áéíóú]/i.test(o.name))!;
  const plain = named.name.normalize('NFD').replace(/\p{Diacritic}/gu, '').toUpperCase();
  expect(searchGrants(all, plain).map((o) => o.id)).toContain(named.id);
  expect(searchGrants(all, 'pulse-storm').map((o) => o.id)).toContain('pulse-storm');
  expect(searchGrants(all, '')).toEqual(all);
});
