import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { parseConfig, sectorStatus, type SectorStats } from '../src/index';

// Sector unlocks (GDD §5.5, §13.1): the Nebulosa is open, each next sector opens by beating the Core of the one before,
// and the season sector is open to everyone while it is the live config's season. Conditions are live config.

const cfg = parseConfig('sectors', {});
const zero: SectorStats = { bossKills: 0, maxDepth: 0, extractions: 0 };
const normal = (id: string) => ({ id, season: false });
const rift = { id: 'signal-rift', season: true };

describe('sectores normales', () => {
  test('un sector sin condición y que no es de temporada está abierto', () => {
    expect(sectorStatus(normal('outer-nebula'), {}, cfg)).toEqual({ unlocked: true, condition: null, progress: 1, season: false });
  });

  test('Anillos de Escarcha se abre al vencer una vez al Núcleo de la Nebulosa, no antes', () => {
    expect(sectorStatus(normal('frost-rings'), { 'outer-nebula': zero }, cfg)).toEqual({
      unlocked: false,
      condition: { sector: 'outer-nebula', stat: 'bossKills', value: 1 },
      progress: 0,
      season: false,
    });
    expect(sectorStatus(normal('frost-rings'), { 'outer-nebula': { ...zero, bossKills: 1 } }, cfg)).toMatchObject({ unlocked: true, progress: 1 });
  });

  test('una condición sobre un sector aún sin partidas da progreso 0', () => {
    expect(sectorStatus(normal('hollow-reef'), {}, cfg)).toMatchObject({ unlocked: false, progress: 0, condition: { sector: 'frost-rings' } });
    expect(sectorStatus(normal('broken-forge'), {}, cfg)).toMatchObject({ unlocked: false, condition: { sector: 'hollow-reef' } });
  });
});

describe('la temporada', () => {
  test('abierta mientras es la de la configuración; cerrada y sin condición si no', () => {
    expect(sectorStatus(rift, {}, cfg, { runs: 15 })).toEqual({ unlocked: true, condition: null, progress: 1, season: true });
    expect(sectorStatus(rift, {}, parseConfig('sectors', { season: null }))).toEqual({ unlocked: false, condition: null, progress: 0, season: true });
    expect(sectorStatus(rift, {}, parseConfig('sectors', { season: 'otra-temporada' }))).toMatchObject({ unlocked: false });
  });

  test('un sector normal nunca se abre por ser el de temporada de la configuración', () => {
    expect(sectorStatus(normal('frost-rings'), {}, parseConfig('sectors', { season: 'frost-rings' }))).toMatchObject({ unlocked: false });
  });
});

describe('la clave `sectors`', () => {
  test('trae las tres condiciones en cadena y la temporada 1', () => {
    expect(cfg.unlocks).toEqual({
      'frost-rings': { sector: 'outer-nebula', stat: 'bossKills', value: 1 },
      'hollow-reef': { sector: 'frost-rings', stat: 'bossKills', value: 1 },
      'broken-forge': { sector: 'hollow-reef', stat: 'bossKills', value: 1 },
    });
    expect(cfg.season).toBe('signal-rift');
  });

  test('rechaza valores no positivos, estadísticas desconocidas y campos de más', () => {
    expect(() => parseConfig('sectors', { unlocks: { x: { sector: 'outer-nebula', stat: 'bossKills', value: 0 } } })).toThrow();
    expect(() => parseConfig('sectors', { unlocks: { x: { sector: 'outer-nebula', stat: 'kills', value: 1 } } })).toThrow();
    expect(() => parseConfig('sectors', { extra: 1 })).toThrow();
  });

  test('el progreso siempre está entre 0 y 1', () => {
    fc.assert(
      fc.property(fc.nat(1000), fc.nat(1000), fc.nat(1000), fc.integer({ min: 1, max: 1000 }), fc.constantFrom('bossKills', 'maxDepth', 'extractions'), (b, d, e, v, stat) => {
        const c = parseConfig('sectors', { unlocks: { s: { sector: 'p', stat, value: v } } });
        const st = sectorStatus(normal('s'), { p: { bossKills: b, maxDepth: d, extractions: e } }, c);
        return st.progress >= 0 && st.progress <= 1;
      }),
    );
  });
});

// The season sector opens with 15 runs (2026-11-16), while its season is open; whoever already played it keeps it.
describe('la Fisura a las 15 incursiones', () => {
  test('con 14 incursiones está cerrada y dice cuánto falta; con 15 se abre', () => {
    expect(sectorStatus(rift, {}, cfg, { runs: 14 })).toEqual({
      unlocked: false,
      condition: { sector: null, stat: 'runs', value: 15 },
      progress: 14 / 15,
      season: true,
    });
    expect(sectorStatus(rift, {}, cfg, { runs: 15 })).toMatchObject({ unlocked: true, progress: 1, season: true });
  });

  test('quien ya terminó una incursión en ella la conserva aunque tenga menos de 15', () => {
    expect(sectorStatus(rift, { 'signal-rift': { ...zero, maxDepth: 1 } }, cfg, { runs: 3 })).toMatchObject({ unlocked: true });
  });

  test('fuera de temporada sigue cerrada aunque tenga las incursiones', () => {
    expect(sectorStatus(rift, {}, { ...cfg, season: null }, { runs: 99 })).toMatchObject({ unlocked: false, condition: null, season: true });
  });

  test('sin condición de temporada (null) vuelve a abrirse para todos', () => {
    expect(sectorStatus(rift, {}, { ...cfg, seasonUnlock: null }, { runs: 0 })).toMatchObject({ unlocked: true, condition: null });
  });
});

