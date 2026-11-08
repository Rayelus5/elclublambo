import { describe, expect, test } from 'vitest';
import { activeBoosts, boostFactor, configIssues, parseConfig, runMaterial, runPayout } from '../src/index';

// Temporary global multipliers (GDD §16.3; M6d-5): «doble polvo el fin de semana». A boost pays inside its window,
// boosts on one currency multiply up to ×5, and the per-run caps still bound the pay.

const at = (iso: string) => new Date(iso);
const boosts = (list: unknown[]) => parseConfig('boosts', { list });
const dust = { id: 'polvo', name: 'Doble polvo', currency: 'dust', factor: 2, startsAt: '2026-11-14T00:00:00.000Z', endsAt: '2026-11-16T00:00:00.000Z' };

describe('la ventana', () => {
  test('un multiplicador cuenta dentro de su ventana y no fuera', () => {
    const cfg = boosts([dust]);
    expect(activeBoosts(cfg, at('2026-11-13T23:59:59.999Z'))).toEqual([]);
    expect(activeBoosts(cfg, at('2026-11-14T00:00:00.000Z')).map((b) => b.id)).toEqual(['polvo']);
    expect(boostFactor(cfg, 'dust', at('2026-11-15T23:59:59.999Z'))).toBe(2);
    expect(boostFactor(cfg, 'dust', at('2026-11-16T00:00:00.000Z'))).toBe(1);
    expect(boostFactor(cfg, 'coins', at('2026-11-15T00:00:00.000Z'))).toBe(1);
  });

  test('dos multiplicadores de la misma moneda se multiplican hasta 5', () => {
    const cfg = boosts([dust, { ...dust, id: 'mas-polvo', factor: 3 }]);
    expect(boostFactor(cfg, 'dust', at('2026-11-15T00:00:00.000Z'))).toBe(5);
    expect(boostFactor(boosts([dust, { ...dust, id: 'b', factor: 1.5 }]), 'dust', at('2026-11-15T00:00:00.000Z'))).toBe(3);
  });

  test('sin configurar no hay ninguno', () => {
    expect(parseConfig('boosts', {})).toEqual({ list: [] });
  });
});

describe('la configuración', () => {
  test('rechaza factores fuera de 1 a 5, ventanas al revés o de más de 14 días e ids repetidos', () => {
    expect(configIssues('boosts', { list: [{ ...dust, factor: 0.5 }] })).not.toEqual([]);
    expect(configIssues('boosts', { list: [{ ...dust, factor: 6 }] })).not.toEqual([]);
    expect(configIssues('boosts', { list: [{ ...dust, endsAt: dust.startsAt }] })).not.toEqual([]);
    expect(configIssues('boosts', { list: [{ ...dust, endsAt: '2026-12-01T00:00:00.000Z' }] })).not.toEqual([]);
    expect(configIssues('boosts', { list: [dust, dust] })).not.toEqual([]);
    expect(configIssues('boosts', { list: [{ ...dust, currency: 'gems' }] })).not.toEqual([]);
    expect(configIssues('boosts', { list: [dust] })).toEqual([]);
  });
});

describe('la paga', () => {
  const runs = parseConfig('runs', {});
  const claim = { outcome: 'extracted' as const, ticks: 6 * 3600, depth: 1, kills: 600, bossKills: 1, level: 10, loot: [{ coins: 40, dust: 12 }], hash: '0123456789abcdef' };

  test('el multiplicador sube la paga antes de los topes, y el tope sigue mandando', () => {
    const plain = runPayout(claim, runs, 1);
    const boosted = runPayout(claim, runs, 1, false, { coins: 0, dust: 0 }, { coins: 1, dust: 2 });
    expect(boosted.dust).toBe(plain.dust * 2);
    expect(boosted.coins).toBe(plain.coins);
    const huge = { ...claim, loot: [{ coins: 40, dust: runs.caps.runDust }] };
    const capped = runPayout(huge, runs, 1, false, { coins: 0, dust: 0 }, { coins: 1, dust: 2 });
    expect(capped.dust).toBe(runs.caps.runDust);
    expect(capped.capped).toBe(true);
  });

  test('el material también', () => {
    expect(runMaterial(claim, runs, 1, false, 0, 2)).toBe(Math.min(runMaterial(claim, runs, 1) * 2, runs.caps.runMaterial));
  });
});
