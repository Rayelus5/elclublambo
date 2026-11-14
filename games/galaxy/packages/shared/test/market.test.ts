import { describe, expect, test } from 'vitest';
import { API_ERROR_CODES, commissionOf, marketListSchema, marketQuerySchema, minPriceFor, parseConfig, tradeBlock, tradeConfirmSchema, tradeOfferSchema, tradeProposeSchema } from '../src/index';

// The market (GDD §14.6, §14.7; M5c-1): galaxies only, a minimum price per rarity, a commission that sinks coins, and
// who may trade (level 10, an account 3 days old).

const market = parseConfig('market', {});
const DAY = 86_400_000;

describe('la configuración', () => {
  test('los valores de partida son los del GDD', () => {
    expect(market).toEqual({
      minPrice: { common: 50, uncommon: 120, rare: 400, epic: 1500, legendary: 6000, mythic: 15_000 },
      mythicListing: false,
      maxPrice: 10_000_000,
      commission: 0.07,
      days: 7,
      perDay: { listings: 10, purchases: 10, trades: 10 },
      offers: { hours: 48, open: 10, perDay: 30, perListing: 20 },
      minLevel: 10,
      minAccountDays: 3,
      alertMultiple: 20,
      sharedIpDays: 30,
      tradeDays: 3,
      openTrades: 5,
      tradeAlertTierGap: 3,
    });
  });

  test('el mínimo crece con la rareza y nunca pasa del máximo', () => {
    expect(() => parseConfig('market', { minPrice: { common: 50, uncommon: 120, rare: 400, epic: 1500, legendary: 1000 } })).toThrow();
    expect(() => parseConfig('market', { maxPrice: 1000 })).toThrow();
    expect(() => parseConfig('market', { commission: 0.6 })).toThrow();
  });
});

describe('precios y comisión', () => {
  test('el mínimo de cada rareza', () => {
    expect(minPriceFor('common', market)).toBe(50);
    expect(minPriceFor('legendary', market)).toBe(6000);
  });

  test('la comisión redondea hacia abajo y es al menos una moneda', () => {
    expect(commissionOf(50, 0.07)).toBe(3);
    expect(commissionOf(10, 0.07)).toBe(1);
    expect(commissionOf(6000, 0.07)).toBe(420);
    expect(commissionOf(1, 0)).toBe(0);
  });
});

describe('quién puede comerciar', () => {
  const now = new Date('2026-11-08T12:00:00Z');
  test('primero el nivel, luego los días de cuenta', () => {
    expect(tradeBlock(9, new Date(now.getTime() - 10 * DAY), now, market)).toBe('level');
    expect(tradeBlock(9, now, now, market)).toBe('level');
    expect(tradeBlock(10, new Date(now.getTime() - 3 * DAY + 1000), now, market)).toBe('age');
    expect(tradeBlock(10, new Date(now.getTime() - 3 * DAY), now, market)).toBeNull();
  });
});

describe('lo que se envía', () => {
  test('un precio es un entero positivo', () => {
    const galaxyId = '00000000-0000-4000-8000-000000000001';
    expect(marketListSchema.parse({ galaxyId, price: 50 })).toEqual({ galaxyId, price: 50 });
    for (const price of [0, 1.5, '50', -3]) expect(() => marketListSchema.parse({ galaxyId, price })).toThrow();
  });

  // The market at scale (the owner, 2026-11-14): filters, six orders and a cursor instead of pages.
  test('la búsqueda tiene orden, filtros y cursor', () => {
    expect(marketQuerySchema.parse({})).toEqual({ sort: 'new' });
    expect(marketQuerySchema.parse({ tier: 'rare', sort: 'cheap', q: 'Vega', cursor: 'eyJzIjoiY2hlYXAifQ' })).toEqual({ tier: 'rare', sort: 'cheap', q: 'Vega', cursor: 'eyJzIjoiY2hlYXAifQ' });
    expect(marketQuerySchema.parse({ finish: 'holo', phenomenon: 'any', minLevel: '2', maxPrice: '5000', sort: 'rare' })).toEqual({ finish: 'holo', phenomenon: 'any', minLevel: 2, maxPrice: 5000, sort: 'rare' });
    expect(() => marketQuerySchema.parse({ sort: 'random' })).toThrow();
    expect(() => marketQuerySchema.parse({ page: '2' })).toThrow();
    expect(() => marketQuerySchema.parse({ cursor: 'no válido' })).toThrow();
    expect(() => marketQuerySchema.parse({ minLevel: '0' })).toThrow();
  });

  test('los errores del comercio existen', () => {
    for (const code of ['trade_level', 'trade_age', 'trade_daily_cap', 'price_too_low', 'price_too_high', 'listing_gone', 'own_listing', 'galaxy_listed'])
      expect(API_ERROR_CODES).toContain(code);
  });
});

describe('el trueque', () => {
  const a = '00000000-0000-4000-8000-000000000001';
  const b = '00000000-0000-4000-8000-000000000002';
  test('proponer da una galaxia y puede pedir una del otro', () => {
    expect(tradeProposeSchema.parse({ username: 'vega_9', give: a })).toEqual({ username: 'vega_9', give: a });
    expect(tradeProposeSchema.parse({ username: 'vega_9', give: a, want: b })).toEqual({ username: 'vega_9', give: a, want: b });
    expect(() => tradeProposeSchema.parse({ username: 'vega_9' })).toThrow();
  });

  test('cambiar o confirmar nombran la versión que se ve', () => {
    expect(tradeOfferSchema.parse({ give: a, want: null, version: 2 })).toEqual({ give: a, want: null, version: 2 });
    expect(() => tradeOfferSchema.parse({ give: a, want: b })).toThrow();
    expect(tradeConfirmSchema.parse({ version: 3 })).toEqual({ version: 3 });
    expect(() => tradeConfirmSchema.parse({ version: 0 })).toThrow();
  });

  test('sus errores existen', () => {
    for (const code of ['galaxy_in_trade', 'trade_changed', 'trade_gone', 'trade_self', 'trade_limit', 'trade_incomplete']) expect(API_ERROR_CODES).toContain(code);
  });
});
