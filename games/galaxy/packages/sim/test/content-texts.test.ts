import { expect, test } from 'vitest';
import { contentSchema, DEFAULT_CONTENT } from '../src/index';

// The texts tied to a sector, a Núcleo or an enemy live in the content too (the content editor, 2026-11-16, P8):
// optional, so what was published before still plays as it did, and the web falls back to its own text.

test('los textos son opcionales: lo publicado antes sigue valiendo y no los trae', () => {
  const parsed = contentSchema.parse(DEFAULT_CONTENT);
  expect(parsed.sectors[0]!.lore).toBeUndefined();
  expect(parsed.bosses[0]!.radio).toBeUndefined();
});

test('un sector, un Núcleo y un enemigo pueden traer sus textos', () => {
  const c = structuredClone(DEFAULT_CONTENT);
  c.sectors[0]!.lore = 'Un sector nuevo';
  c.sectors[0]!.radio = 'PERKINS: hola';
  c.sectors[0]!.hazardNames = { meteors: 'Lluvia de chispas' };
  c.bosses[0]!.lore = 'Un Núcleo';
  c.bosses[0]!.radio = 'PERKINS: cuidado';
  c.enemies[0]!.lore = 'Un bicho';
  const parsed = contentSchema.parse(c);
  expect(parsed.sectors[0]!.hazardNames).toEqual({ meteors: 'Lluvia de chispas' });
  expect(parsed.enemies[0]!.lore).toBe('Un bicho');
});

test('un texto demasiado largo o un peligro que no existe no valen', () => {
  const c = structuredClone(DEFAULT_CONTENT);
  c.sectors[0]!.lore = 'x'.repeat(401);
  expect(contentSchema.safeParse(c).success).toBe(false);
  const d = structuredClone(DEFAULT_CONTENT) as unknown as { sectors: { hazardNames?: Record<string, string> }[] };
  d.sectors[0]!.hazardNames = { ambush: 'Trampa' };
  expect(contentSchema.safeParse(d).success).toBe(false);
});
