import { describe, expect, test } from 'vitest';
import {
  API_ERROR_CODES,
  leaderboardQuerySchema,
  levelOf,
  parseConfig,
  publicCollectionQuerySchema,
  runXp,
  SEASON_TIERS,
  seasonOpen,
  seasonPoints,
  seasonTier,
} from '../src/index';

// Account level and season score (GDD §12.1, §14.1, §13.1; M5a): every run that is not suspicious gives account
// experience (time, layers, Cores and the extraction) and, during an open season, season points; the score's tier is
// Bronce to Estelar.

const account = parseConfig('account', {});
const season = parseConfig('season', {});
const run = (over: Partial<{ seconds: number; depth: number; bossKills: number; outcome: 'extracted' | 'died' | 'abandoned' }> = {}) => ({
  seconds: 600,
  depth: 2,
  bossKills: 1,
  outcome: 'extracted' as const,
  ...over,
});

describe('la experiencia de cuenta', () => {
  test('una incursión da experiencia por minuto entero, por capa, por Núcleo y por extraer', () => {
    expect(runXp(run(), account)).toBe(200);
    expect(runXp(run({ outcome: 'abandoned' }), account)).toBe(170);
    expect(runXp(run({ outcome: 'died' }), account)).toBe(170);
    expect(runXp(run({ seconds: 59, depth: 0, bossKills: 0, outcome: 'died' }), account)).toBe(0);
    expect(runXp(run({ seconds: 119.9, depth: 1, bossKills: 0, outcome: 'died' }), account)).toBe(25);
  });

  test('el nivel sale de los umbrales acumulados, con lo que llevas y lo que falta', () => {
    expect(levelOf(0, account)).toEqual({ level: 1, into: 0, next: 100 });
    expect(levelOf(99, account)).toEqual({ level: 1, into: 99, next: 100 });
    expect(levelOf(100, account)).toEqual({ level: 2, into: 0, next: 200 });
    expect(levelOf(1000, account)).toEqual({ level: 5, into: 0, next: 500 });
    // A run that jumps several thresholds lands on the level of the total.
    expect(levelOf(2200, account).level).toBe(7);
    expect(levelOf(24_500, account)).toEqual({ level: 30, into: 0, next: null });
    expect(levelOf(99_999, account)).toEqual({ level: 30, into: 75_499, next: null });
  });

  test('los umbrales por defecto llegan al nivel 30 y deben crecer', () => {
    expect(account.levels).toHaveLength(29);
    expect(account.levels.slice(0, 9)).toEqual([100, 300, 600, 1000, 1500, 2100, 2800, 3600, 4500]);
    expect(account.levels.at(-1)).toBe(24_500);
    expect(() => parseConfig('account', { levels: [100, 100] })).toThrow();
    expect(() => parseConfig('account', { levels: [300, 100] })).toThrow();
  });
});

describe('la temporada', () => {
  test('cada incursión suma puntos por capa, por Núcleo y por extraer', () => {
    expect(seasonPoints(run(), season)).toBe(95);
    expect(seasonPoints(run({ outcome: 'died' }), season)).toBe(70);
  });

  test('los tramos van de Bronce a Estelar', () => {
    expect(SEASON_TIERS).toEqual(['bronze', 'silver', 'gold', 'platinum', 'stellar']);
    expect(seasonTier(0, season)).toBeNull();
    expect(seasonTier(499, season)).toBeNull();
    expect(seasonTier(500, season)).toBe('bronze');
    expect(seasonTier(5999, season)).toBe('silver');
    expect(seasonTier(30_000, season)).toBe('stellar');
  });

  test('está abierta desde su inicio y hasta antes de su fin', () => {
    expect(seasonOpen(season, new Date(season.startsAt))).toBe(true);
    expect(seasonOpen(season, new Date(new Date(season.startsAt).getTime() - 1))).toBe(false);
    expect(seasonOpen(season, new Date(new Date(season.endsAt).getTime() - 1))).toBe(true);
    expect(seasonOpen(season, new Date(season.endsAt))).toBe(false);
  });

  test('la configuración trae la temporada 1 y rechaza fechas al revés o tramos que no crecen', () => {
    expect(season).toMatchObject({ id: 'season-1', name: 'Temporada 1', points: { layer: 10, core: 50, extraction: 25 }, tiers: [500, 2000, 6000, 15000, 30000], top: 100 });
    expect(() => parseConfig('season', { startsAt: '2026-12-13T00:00:00.000Z', endsAt: '2026-11-01T00:00:00.000Z' })).toThrow();
    expect(() => parseConfig('season', { tiers: [500, 400, 6000, 15000, 30000] })).toThrow();
    expect(() => parseConfig('season', { top: 1 })).toThrow();
  });
});

describe('la API', () => {
  test('la clasificación tiene tres pestañas y la general por defecto', () => {
    expect(leaderboardQuerySchema.parse({})).toEqual({ tab: 'general' });
    expect(leaderboardQuerySchema.parse({ tab: 'purges' })).toEqual({ tab: 'purges' });
    expect(leaderboardQuerySchema.safeParse({ tab: 'clans' }).success).toBe(false);
  });

  test('la colección pública se ordena y se filtra como la propia', () => {
    expect(publicCollectionQuerySchema.parse({})).toEqual({ sort: 'rarity', limit: 30 });
    expect(publicCollectionQuerySchema.parse({ tier: 'epic', limit: '12' })).toEqual({ sort: 'rarity', limit: 12, tier: 'epic' });
    expect(publicCollectionQuerySchema.safeParse({ owner: 'x' }).success).toBe(false);
  });

  test('los errores nuevos existen', () => {
    expect(API_ERROR_CODES).toContain('profile_not_found');
    expect(API_ERROR_CODES).toContain('season_closed');
  });
});
