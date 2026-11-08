import { describe, expect, test } from 'vitest';
import { API_ERROR_CODES, configIssues, expectedTierRates, parseConfig, simulateGacha } from '../src/index';

// The admin's config tools (GDD §16.3, §16.6; M6b): a gacha simulator that runs a config before it is published, the
// rates it should give, the issues of a draft by path, and the new feature switches.

const gacha = parseConfig('gacha', {});
const banner = gacha.banners[0]!.id;

describe('el simulador del gachapón', () => {
  test('es determinista para una semilla y cuenta cada tirada', () => {
    const a = simulateGacha(gacha, banner, 5000, 42n);
    const b = simulateGacha(gacha, banner, 5000, 42n);
    expect(a).toEqual(b);
    expect(a.tiers.reduce((x, y) => x + y, 0)).toBe(5000);
    expect(Object.values(a.finishes).reduce((x, y) => x + y, 0)).toBe(5000);
    expect(a.longestWithout).toBeLessThanOrEqual(gacha.standard.hard);
  });

  test('en 100 000 tiradas, cada rareza queda a menos de un punto de lo esperado, suerte creciente incluida', () => {
    const run = simulateGacha(gacha, banner, 100_000, 7n);
    const expected = expectedTierRates(gacha);
    expect(expected.reduce((x, y) => x + y, 0)).toBeCloseTo(1, 9);
    run.tiers.forEach((n, i) => expect(Math.abs(n / 100_000 - expected[i]!)).toBeLessThan(0.01));
    expect(run.legendaryEvery).toBeCloseTo(1 / expected[4]!, 0);
  });

  test('una configuración distinta cambia lo esperado', () => {
    const generous = parseConfig('gacha', { ...gacha, standard: { ...gacha.standard, base: 0.2 } });
    expect(expectedTierRates(generous)[4]!).toBeGreaterThan(expectedTierRates(gacha)[4]!);
  });
});

describe('los problemas de un borrador', () => {
  test('cada problema con su ruta, y ninguno en uno válido', () => {
    expect(configIssues('chat', { maxLength: 5, words: ['ok', 'x'] }).map((i) => i.path).sort()).toEqual(['maxLength', 'words.1']);
    expect(configIssues('chat', { maxLength: 300 })).toEqual([]);
    expect(configIssues('chat', 'no es un objeto').length).toBeGreaterThan(0);
  });

  test('los problemas se dicen en español, para quien edita el panel', () => {
    expect(configIssues('chat', { maxLength: 5 })[0]!.message).toMatch(/^Demasiado pequeño/);
  });
});

describe('los interruptores', () => {
  test('mercado, trueque y chat existen y empiezan encendidos', () => {
    expect(parseConfig('features', {})).toMatchObject({ registrationOpen: true, maintenance: false, gacha: true, runs: true, market: true, trades: true, chat: true });
    for (const code of ['market_disabled', 'trades_disabled', 'chat_disabled']) expect(API_ERROR_CODES).toContain(code);
  });
});
