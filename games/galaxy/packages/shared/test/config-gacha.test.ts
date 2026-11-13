import { describe, expect, test } from 'vitest';
import { DISINTEGRATE_MAX, disintegrateManySchema, DRAWN_FINISHES, FINISHES, fuseRequestSchema, parseConfig, pullRequestSchema, TIERS } from '../src/index';

// GDD §9, §8.5 and §16.3: every starting number of the gacha and the galaxies is live configuration.
describe('configuración del gachapón', () => {
  test('las señales de evento que sobran al cerrar su escáner valen 50 de polvo cada una por defecto, y se puede cambiar', () => {
    expect(parseConfig('gacha', {}).leftoverDust).toBe(50);
    expect(parseConfig('gacha', { leftoverDust: 80 }).leftoverDust).toBe(80);
    expect(parseConfig('gacha', { leftoverDust: 0 }).leftoverDust).toBe(0);
    expect(() => parseConfig('gacha', { leftoverDust: -1 })).toThrow();
    expect(() => parseConfig('gacha', { leftoverDust: 10_001 })).toThrow();
  });

  test('por defecto reproduce los valores de partida del plan M2b', () => {
    const g = parseConfig('gacha', {});
    expect(g.tiers.base).toEqual([0.5, 0.28, 0.13, 0.06, 0.03]);
    expect(g.standard).toEqual({ base: 0.03, softStart: 8, softStep: 0.06, hard: 20 });
    expect(g.welcome).toEqual({ base: 0.06, softStart: 5, softStep: 0.15, hard: 10, signals: 10 });
    expect(g.featured).toEqual({ base: 0.005, softStart: 30, softStep: 0.04, hard: 45 });
    expect(g.costs).toEqual({ coins: 100, coinsTen: 900, signals: 1 });
    expect(g.dailyFree).toBe(true);
    expect(g.finishes).toEqual([0.85, 0.1, 0.035, 0.013, 0.002]);
    expect(g.banners).toEqual([
      { id: 'deep-scan', kind: 'standard', name: 'Escáner profundo', pityGroup: 'standard', currency: 'signal' },
    ]);
    const galaxies = parseConfig('galaxies', {});
    expect(galaxies.disintegrate).toEqual({ tier: [5, 12, 30, 75, 200], finish: [1, 1.5, 2, 2.5, 5] });
    expect(galaxies.fusion).toEqual({ count: 5, dust: [20, 50, 120, 300] });
    expect(parseConfig('features', {}).gacha).toBe(true);
    expect(TIERS).toEqual(['common', 'uncommon', 'rare', 'epic', 'legendary']);
    expect(FINISHES).toEqual(['normal', 'holo', 'prismatic', 'braille', 'corrupt', 'rift']);
    // The odds draw five; Fisura is season 1's exclusive finish (M8c).
    expect(DRAWN_FINISHES).toEqual(['normal', 'holo', 'prismatic', 'braille', 'corrupt']);
  });

  test('rechaza probabilidades que no suman 1', () => {
    expect(() => parseConfig('gacha', { tiers: { base: [0.5, 0.3, 0.1, 0.05, 0.03] } })).toThrow();
    expect(() => parseConfig('gacha', { finishes: [0.9, 0.1, 0.1, 0, 0] })).toThrow();
    expect(() => parseConfig('gacha', { tiers: { base: [0.5, 0.3, 0.14, 0.09, -0.03] } })).toThrow();
  });

  test('rechaza una garantía anterior al inicio de la suerte creciente', () => {
    expect(() => parseConfig('gacha', { standard: { base: 0.03, softStart: 25, softStep: 0.06, hard: 20 } })).toThrow();
  });

  test('un banner de evento necesita un rasgo destacado válido y señales propias', () => {
    const event = {
      id: 'nova',
      kind: 'event',
      name: 'Semana nova',
      pityGroup: 'event-nova',
      currency: 'signal:nova',
      featured: { trait: 'phenomenon', value: 'supernova' },
    };
    expect(parseConfig('gacha', { banners: [event] }).banners[0]).toMatchObject(event);
    expect(() => parseConfig('gacha', { banners: [{ ...event, featured: undefined }] })).toThrow();
    expect(() => parseConfig('gacha', { banners: [{ ...event, currency: 'signal' }] })).toThrow();
    expect(() => parseConfig('gacha', { banners: [{ ...event, featured: { trait: 'color', value: 'x' } }] })).toThrow();
    expect(() => parseConfig('gacha', { banners: [event, { ...event }] })).toThrow(); // duplicate id
  });
});

describe('peticiones', () => {
  test('una tirada es x1 o x10 y se paga con monedas, señales o la gratis', () => {
    expect(pullRequestSchema.parse({ banner: 'deep-scan', count: 10, pay: 'coins' })).toEqual({
      banner: 'deep-scan',
      count: 10,
      pay: 'coins',
    });
    expect(() => pullRequestSchema.parse({ banner: 'deep-scan', count: 5, pay: 'coins' })).toThrow();
    expect(() => pullRequestSchema.parse({ banner: 'deep-scan', count: 1, pay: 'gems' })).toThrow();
  });

  test('una fusión lleva identificadores distintos', () => {
    const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
    expect(fuseRequestSchema.parse({ ids: [1, 2, 3, 4, 5].map(id) }).ids).toHaveLength(5);
    expect(() => fuseRequestSchema.parse({ ids: [1, 1, 3, 4, 5].map(id) })).toThrow();
    expect(() => fuseRequestSchema.parse({ ids: ['x'] })).toThrow();
  });

  test('desintegrar varias: de 1 a 50 galaxias distintas, con aviso previo opcional', () => {
    const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    expect(DISINTEGRATE_MAX).toBe(50);
    expect(disintegrateManySchema.parse({ ids: [id(1)] }).ids).toHaveLength(1);
    expect(disintegrateManySchema.parse({ ids: [id(1), id(2)], preview: true }).preview).toBe(true);
    expect(disintegrateManySchema.parse({ ids: Array.from({ length: 50 }, (_, i) => id(i)) }).ids).toHaveLength(50);
    expect(() => disintegrateManySchema.parse({ ids: [] })).toThrow();
    expect(() => disintegrateManySchema.parse({ ids: Array.from({ length: 51 }, (_, i) => id(i)) })).toThrow();
    expect(() => disintegrateManySchema.parse({ ids: [id(1), id(1)] })).toThrow();
    expect(() => disintegrateManySchema.parse({ ids: [id(1)], extra: 1 })).toThrow();
  });
});
