import { describe, expect, test } from 'vitest';
import { ART_AVATARS, ART_FRAMES, cosmeticsConfigSchema, DEFAULT_COSMETICS, FRAMES, profileCosmeticsSchema, portraitFor } from '../src/index';

// Profile cosmetics (Nov plan C2): the live catalog of avatars, frames and titles, and what a player may wear.
describe('el catálogo de cosméticos', () => {
  test('por defecto trae el lote de estreno: 28 avatares, 16 marcos y 4 títulos de tienda', () => {
    const c = cosmeticsConfigSchema.parse({});
    expect(c.avatars).toHaveLength(28);
    expect(c.frames).toHaveLength(16);
    expect(c.titles.filter((t) => t.source === 'shop')).toHaveLength(4);
    expect(c.avatars.filter((a) => a.source === 'default')).toHaveLength(12);
    expect(c).toEqual(DEFAULT_COSMETICS);
  });

  test('cada pieza tiene arte: un id sin dibujo no se puede publicar', () => {
    expect(cosmeticsConfigSchema.safeParse({ avatars: [{ id: 'no-existe', name: 'X', rarity: 'common', source: 'default', hint: 'x' }] }).success).toBe(false);
    for (const a of DEFAULT_COSMETICS.avatars) expect(ART_AVATARS).toContain(a.id);
    for (const f of DEFAULT_COSMETICS.frames) expect(ART_FRAMES).toContain(f.id);
  });

  test('no hay dos piezas con el mismo id ni dos títulos iguales', () => {
    const twice = [...DEFAULT_COSMETICS.avatars.slice(0, 1), ...DEFAULT_COSMETICS.avatars.slice(0, 1)];
    expect(cosmeticsConfigSchema.safeParse({ avatars: twice }).success).toBe(false);
  });

  test('los marcos de hoy siguen valiendo y los ids de marco son solo letras', () => {
    for (const f of ['bronze', 'silver', 'gold', 'nebula', 'abyss', 'crown']) expect(FRAMES).toContain(f);
    for (const f of FRAMES) expect(f).toMatch(/^[a-z]{1,16}$/);
  });
});

describe('lo que se pide al personalizar', () => {
  test('cada campo es opcional y null lo quita', () => {
    expect(profileCosmeticsSchema.parse({ avatar: 'crew-pilot' })).toEqual({ avatar: 'crew-pilot' });
    expect(profileCosmeticsSchema.parse({ frame: null, title: null, banner: null })).toEqual({ frame: null, title: null, banner: null });
    expect(profileCosmeticsSchema.safeParse({ avatar: 'NO VALE' }).success).toBe(false);
    expect(profileCosmeticsSchema.safeParse({ banner: 'no-uuid' }).success).toBe(false);
  });
});

test('el retrato de cada Núcleo', () => {
  expect(portraitFor('hive')).toBe('portrait-hive');
  expect(portraitFor('echo-core')).toBe('portrait-echo-core');
  expect(portraitFor('nadie')).toBeNull();
});
