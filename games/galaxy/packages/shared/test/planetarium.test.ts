import { describe, expect, test } from 'vitest';
import { API_ERROR_CODES, exhibitsSchema, parseConfig, planetariumBonus, prestige, usernameParamSchema } from '../src/index';

// The planetarium (GDD §10.5, §8.5; M4c-2): what a player exhibits adds prestige by rarity and finish, and prestige
// becomes a small experience bonus in runs, never above its cap.

const cfg = parseConfig('planetarium', {});
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('el prestigio', () => {
  test('cada galaxia expuesta suma por su rareza, y uno más si su acabado no es normal', () => {
    expect(prestige([{ tier: 'common', finish: 'normal' }], cfg)).toBe(1);
    expect(prestige([{ tier: 'legendary', finish: 'holo' }], cfg)).toBe(13);
    expect(prestige([{ tier: 'rare', finish: 'normal' }, { tier: 'epic', finish: 'prismatic' }], cfg)).toBe(12);
    expect(prestige([], cfg)).toBe(0);
  });

  test('el bonus de experiencia es el prestigio por su valor, con tope del 5 %', () => {
    expect(planetariumBonus(16, cfg)).toBe(0.016);
    expect(planetariumBonus(0, cfg)).toBe(0);
    const six = Array.from({ length: 6 }, () => ({ tier: 'legendary' as const, finish: 'holo' as const }));
    expect(prestige(six, cfg)).toBe(78);
    expect(planetariumBonus(78, cfg)).toBe(0.05);
  });
});

describe('la configuración viva', () => {
  test('trae seis pedestales, ocho destacados y el tope del 5 %', () => {
    expect(cfg).toEqual({ slots: 6, points: { tiers: [1, 2, 4, 7, 12], finish: 1 }, xpPerPoint: 0.001, cap: 0.05, featured: 8 });
  });

  test('rechaza un tope por encima del 5 % y más pedestales de los seis que tiene la cúpula', () => {
    expect(() => parseConfig('planetarium', { cap: 0.06 })).toThrow();
    expect(() => parseConfig('planetarium', { slots: 7 })).toThrow();
    expect(() => parseConfig('planetarium', { points: { tiers: [1, 2, 4, 7] } })).toThrow();
  });
});

describe('la API', () => {
  test('exponer acepta huecos y rechaza duplicados y más de ocho pedestales', () => {
    expect(exhibitsSchema.safeParse({ galaxies: [id(1), null, id(2)] }).success).toBe(true);
    expect(exhibitsSchema.safeParse({ galaxies: [id(1), id(1)] }).success).toBe(false);
    expect(exhibitsSchema.safeParse({ galaxies: Array.from({ length: 9 }, (_, i) => id(i + 1)) }).success).toBe(false);
    expect(exhibitsSchema.safeParse({ galaxies: [] }).success).toBe(false);
    expect(exhibitsSchema.safeParse({ galaxies: ['no-es-un-id'] }).success).toBe(false);
  });

  test('el nombre de la visita sigue las reglas de los usuarios y se pasa a minúsculas', () => {
    expect(usernameParamSchema.parse({ username: 'Astro_Ray' })).toEqual({ username: 'astro_ray' });
    expect(usernameParamSchema.safeParse({ username: 'a' }).success).toBe(false);
    expect(usernameParamSchema.safeParse({ username: '../admin' }).success).toBe(false);
  });

  test('los errores nuevos existen', () => {
    expect(API_ERROR_CODES).toContain('galaxy_exhibited');
    expect(API_ERROR_CODES).toContain('planetarium_not_found');
  });
});
