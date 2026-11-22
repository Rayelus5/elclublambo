import { describe, expect, test } from 'vitest';
import { createFinalsCache, pageOf, seasonStatsOf } from '../../src/season/history';

// The past seasons for players (plan «temporadas como fichas», histórico, 2026-11-22): the numbers frozen at a close
// read leniently (a season closed before they were kept has none), the final ranking a page at a time, and each
// season's final ranking computed once and kept, since it never changes.

describe('las estadísticas guardadas al cerrar', () => {
  const stats = { players: 12, runs: 340, kills: 91_000, cores: 44, extractions: 120, maxDepth: 14, topSector: 'fisura', topProbe: 'lumen', tiers: { bronze: 5, silver: 4, gold: 2, platinum: 1, stellar: 0 } };

  test('se leen tal cual', () => {
    expect(seasonStatsOf(stats)).toEqual(stats);
  });

  test('una temporada cerrada antes de guardarlas no tiene', () => {
    expect(seasonStatsOf(null)).toBeNull();
    expect(seasonStatsOf(undefined)).toBeNull();
    expect(seasonStatsOf('x')).toBeNull();
  });

  test('lo que falta o no es un número vale cero, y los tramos que faltan también', () => {
    expect(seasonStatsOf({ players: 3, runs: 'muchas', tiers: { gold: 2 } })).toEqual({
      players: 3,
      runs: 0,
      kills: 0,
      cores: 0,
      extractions: 0,
      maxDepth: 0,
      topSector: null,
      topProbe: null,
      tiers: { bronze: 0, silver: 0, gold: 2, platinum: 0, stellar: 0 },
    });
  });
});

describe('las páginas de la clasificación final', () => {
  const rows = ['a', 'b', 'c', 'd', 'e'];

  test('la primera trae las primeras filas y dice dónde empieza la siguiente', () => {
    expect(pageOf(rows, 0, 2)).toEqual({ rows: ['a', 'b'], next: 2 });
  });

  test('la última no tiene siguiente', () => {
    expect(pageOf(rows, 2, 3)).toEqual({ rows: ['c', 'd', 'e'], next: null });
    expect(pageOf(rows, 4, 10)).toEqual({ rows: ['e'], next: null });
  });

  test('más allá del final, vacía', () => {
    expect(pageOf(rows, 9, 2)).toEqual({ rows: [], next: null });
  });
});

describe('la caché de las clasificaciones finales', () => {
  test('se calcula una vez por temporada, también con lecturas a la vez', async () => {
    const cache = createFinalsCache<string[]>({ ttlMs: 60_000 });
    let calls = 0;
    const compute = async () => {
      calls++;
      return ['a'];
    };
    const [x, y] = await Promise.all([cache.get('t1', compute), cache.get('t1', compute)]);
    expect(x).toEqual(['a']);
    expect(y).toEqual(['a']);
    expect(await cache.get('t1', compute)).toEqual(['a']);
    expect(calls).toBe(1);
    await cache.get('t2', compute);
    expect(calls).toBe(2);
  });

  test('pasado su tiempo se vuelve a leer (un jugador expulsado desde entonces deja de salir)', async () => {
    let now = 0;
    const cache = createFinalsCache<number>({ ttlMs: 1000, now: () => now });
    let calls = 0;
    const compute = async () => ++calls;
    expect(await cache.get('t', compute)).toBe(1);
    now = 999;
    expect(await cache.get('t', compute)).toBe(1);
    now = 1000;
    expect(await cache.get('t', compute)).toBe(2);
  });

  test('una lectura que falla no se guarda', async () => {
    const cache = createFinalsCache<string>({ ttlMs: 60_000 });
    await expect(cache.get('t', async () => Promise.reject(new Error('db')))).rejects.toThrow('db');
    expect(await cache.get('t', async () => 'bien')).toBe('bien');
  });

  test('guarda pocas temporadas: la más antigua sale primero', async () => {
    const cache = createFinalsCache<string>({ ttlMs: 60_000, max: 2 });
    let calls = 0;
    const compute = (v: string) => async () => {
      calls++;
      return v;
    };
    await cache.get('a', compute('a'));
    await cache.get('b', compute('b'));
    await cache.get('c', compute('c'));
    expect(calls).toBe(3);
    await cache.get('c', compute('c'));
    await cache.get('b', compute('b'));
    expect(calls).toBe(3);
    await cache.get('a', compute('a'));
    expect(calls).toBe(4);
  });
});
