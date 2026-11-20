import { deriveSeed, isMythicScore, scoreTraits, subRng } from '@galaxy/engine';
import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import {
  API_ERROR_CODES,
  atLeast,
  bannerOdds,
  DRAWN_FINISHES,
  disintegrateYield,
  drawPull,
  expectedTierRates,
  FINISHES,
  FUSION_TOP,
  generateGalaxy,
  LEGENDARY,
  legendaryChance,
  minPriceFor,
  MYTHIC,
  parseConfig,
  perTier,
  prestige,
  simulateGacha,
  tierRates,
  TIERS,
  tierWeights,
  validateFusion,
  type PityState,
} from '../src/index';

// The «Mítica» (sixth tier, plan «rareza Mítica» M1): drawn on its own stream before the normal tier roll, with a
// chance that is 0 until the owner publishes it, so every pull made so far replays the same. The guarantee never
// gives one, fusion never makes or takes one, it always has a special finish, and the per-tier lists already
// published (with five values) still parse: a missing sixth value counts as the legendary's.

const cfg = parseConfig('gacha', {});
const standard = cfg.banners[0]!;
const event = {
  id: 'nova',
  kind: 'event' as const,
  name: 'Semana nova',
  pityGroup: 'event-nova',
  currency: 'signal:nova',
  featured: { trait: 'phenomenon' as const, value: 'supernova' },
};
const seed64 = fc.bigInt({ min: 0n, max: 2n ** 64n - 1n });
const state = fc.record({ sinceLegendary: fc.integer({ min: 0, max: 19 }), sinceFeatured: fc.integer({ min: 0, max: 44 }), welcome: fc.boolean() });

describe('la rareza', () => {
  test('es la sexta, después de la legendaria', () => {
    expect(TIERS).toEqual(['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic']);
    expect(LEGENDARY).toBe(TIERS.indexOf('legendary'));
    expect(MYTHIC).toBe(TIERS.indexOf('mythic'));
    expect(FUSION_TOP).toBe(LEGENDARY);
  });

  test('«legendaria o mejor» incluye la mítica', () => {
    expect(atLeast('mythic', 'legendary')).toBe(true);
    expect(atLeast('legendary', 'legendary')).toBe(true);
    expect(atLeast('epic', 'legendary')).toBe(false);
    expect(atLeast(5, 'epic')).toBe(true);
    expect(atLeast(2, 'epic')).toBe(false);
  });

  test('una lista por rareza que se quedó en la legendaria repite su último valor para la mítica', () => {
    expect(perTier([1, 2, 4, 7, 12])).toEqual([1, 2, 4, 7, 12, 12]);
    expect(perTier([1, 2, 4, 7, 12, 20])).toEqual([1, 2, 4, 7, 12, 20]);
  });
});

describe('la tirada', () => {
  test('con probabilidad 0, cada tirada da lo mismo que antes de existir la mítica', () => {
    expect(cfg.mythic).toBe(0);
    fc.assert(
      fc.property(seed64, state, fc.boolean(), (s, st: PityState, onEvent) => {
        const banner = onEvent ? event : standard;
        const featured = banner.kind === 'event' && subRng(s, 'featured').random() < legendaryChance(st.sinceFeatured + 1, cfg.featured);
        const tier = featured ? 4 : subRng(s, 'tier').choiceP(tierWeights(st, cfg));
        const r = drawPull(s, st, banner, cfg);
        expect(r.tier).toBe(tier);
        expect(r.featured).toBe(featured);
        expect(r.finish).toBe(FINISHES[subRng(s, 'finish').choiceP(cfg.finishes)]);
      }),
      { numRuns: 300 },
    );
  });

  test('una mítica tiene acabado especial, reinicia la garantía de legendaria y acaba la bienvenida', () => {
    const always = { ...cfg, mythic: 1 };
    fc.assert(
      fc.property(seed64, state, fc.boolean(), (s, st: PityState, onEvent) => {
        const r = drawPull(s, st, onEvent ? event : standard, always);
        expect(r.tier).toBe(MYTHIC);
        expect(r.featured).toBe(false);
        expect(r.finish).not.toBe('normal');
        expect(DRAWN_FINISHES).toContain(r.finish);
        expect(r.state.sinceLegendary).toBe(0);
        expect(r.state.welcome).toBe(false);
        // Not the featured galaxy: an event's counter keeps going.
        expect(r.state.sinceFeatured).toBe(onEvent ? st.sinceFeatured + 1 : st.sinceFeatured);
      }),
      { numRuns: 200 },
    );
  });

  test('la garantía nunca da una mítica: en la tirada segura sale una legendaria', () => {
    fc.assert(
      fc.property(seed64, (s) => {
        const r = drawPull(s, { sinceLegendary: cfg.standard.hard - 1, sinceFeatured: 0, welcome: false }, standard, cfg);
        expect(r.tier).toBe(LEGENDARY);
      }),
      { numRuns: 100 },
    );
  });

  // Review of #177: with the mythic chance on, the sure pull is still a legendary or better (a mythic then, with its
  // own chance), never less.
  test('con la mítica activada, la tirada segura da una legendaria o una mítica, nunca menos', () => {
    const on = { ...cfg, mythic: 0.3 };
    let mythics = 0;
    fc.assert(
      fc.property(seed64, (s) => {
        const r = drawPull(s, { sinceLegendary: on.standard.hard - 1, sinceFeatured: 0, welcome: false }, standard, on);
        expect(r.tier === LEGENDARY || r.tier === MYTHIC).toBe(true);
        if (r.tier === MYTHIC) mythics++;
      }),
      { numRuns: 300 },
    );
    expect(mythics).toBeGreaterThan(0);
  });

  test('el precio máximo del mercado cubre también el mínimo de una mítica', () => {
    expect(() => parseConfig('market', { minPrice: { common: 50, uncommon: 120, rare: 400, epic: 1500, legendary: 6000, mythic: 20000 }, maxPrice: 10000 })).toThrow();
    expect(parseConfig('market', { minPrice: { common: 50, uncommon: 120, rare: 400, epic: 1500, legendary: 6000, mythic: 20000 }, maxPrice: 20000 }).maxPrice).toBe(20000);
  });

  test('se tira en su propio flujo: con el 50 % sale en la mitad de las semillas', () => {
    const half = { ...cfg, mythic: 0.5 };
    let hits = 0;
    for (let i = 0; i < 2_000; i++) if (drawPull(deriveSeed('mythic-half', i), { sinceLegendary: 0, sinceFeatured: 0, welcome: false }, standard, half).tier === MYTHIC) hits++;
    expect(hits).toBeGreaterThan(900);
    expect(hits).toBeLessThan(1100);
  });

  test('la configuración acepta una probabilidad pequeña y rechaza una absurda', () => {
    expect(parseConfig('gacha', { mythic: 0.0005 }).mythic).toBe(0.0005);
    expect(() => parseConfig('gacha', { mythic: -0.1 })).toThrow();
    expect(() => parseConfig('gacha', { mythic: 0.5 })).toThrow();
  });
});

describe('lo que enseña el escáner', () => {
  const live = { ...cfg, mythic: 0.0005 };
  test('las probabilidades de la próxima tirada son seis y suman 1', () => {
    fc.assert(
      fc.property(state, (st: PityState) => {
        const r = tierRates(st, live);
        expect(r).toHaveLength(6);
        expect(r[MYTHIC]).toBe(0.0005);
        expect(Math.abs(r.reduce((a, b) => a + b, 0) - 1)).toBeLessThan(1e-12);
      }),
      { numRuns: 100 },
    );
    expect(bannerOdds({ sinceLegendary: 0, sinceFeatured: 0, welcome: false }, standard, live).nextRates).toEqual(tierRates({ sinceLegendary: 0, sinceFeatured: 0, welcome: false }, live));
  });

  test('a la larga: con 0 las cinco de siempre y la mítica a 0; con 0,05 % la mítica sale a ese ritmo', () => {
    const before = expectedTierRates(cfg);
    expect(before).toHaveLength(6);
    expect(before[MYTHIC]).toBe(0);
    const after = expectedTierRates(live);
    expect(after[MYTHIC]).toBeCloseTo(0.0005, 12);
    expect(Math.abs(after.reduce((a, b) => a + b, 0) - 1)).toBeLessThan(1e-12);
    // A mythic resets the legendary luck: the legendary rate barely moves.
    expect(Math.abs(after[LEGENDARY]! - before[LEGENDARY]!)).toBeLessThan(0.001);
  });

  test('el simulador cuenta las míticas', () => {
    const run = simulateGacha({ ...cfg, mythic: 0.01 }, standard.id, 5_000, 7n);
    expect(run.tiers).toHaveLength(6);
    expect(run.tiers[MYTHIC]).toBeGreaterThan(20);
    expect(run.tiers.reduce((a, b) => a + b, 0)).toBe(5_000);
    expect(simulateGacha(cfg, standard.id, 2_000, 7n).tiers[MYTHIC]).toBe(0);
  });
});

describe('la galaxia', () => {
  test('una mítica es una legendaria de la banda más alta, siempre con fenómeno', () => {
    fc.assert(
      fc.property(seed64, (s) => {
        const g = generateGalaxy(s, MYTHIC);
        expect(g.traits.phenomenon).not.toBe('none');
        expect(isMythicScore(scoreTraits(g.traits), true)).toBe(true);
        expect(generateGalaxy(s, MYTHIC)).toEqual(g);
      }),
      { numRuns: 10 },
    );
  });
});

describe('fusión', () => {
  const galaxies = parseConfig('galaxies', {});
  test('nunca hace una mítica ni se fusionan míticas', () => {
    const five = (tier: number) => ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, tier }));
    expect(validateFusion(five(LEGENDARY), galaxies)).toEqual({ error: 'invalid_fusion' });
    expect(validateFusion(five(MYTHIC), galaxies)).toEqual({ error: 'invalid_fusion' });
  });
});

describe('las listas por rareza ya publicadas', () => {
  test('desintegrar: cinco valores siguen valiendo y la mítica da como la legendaria; por defecto, 500', () => {
    const old = parseConfig('galaxies', { disintegrate: { tier: [5, 12, 30, 75, 200], finish: [1, 1.5, 2, 2.5, 5] } });
    expect(disintegrateYield(MYTHIC, 'holo', old)).toBe(disintegrateYield(LEGENDARY, 'holo', old));
    const now = parseConfig('galaxies', {});
    expect(now.disintegrate.tier).toEqual([5, 12, 30, 75, 200, 500]);
    expect(disintegrateYield(MYTHIC, 'holo', now)).toBe(750);
    expect(() => parseConfig('galaxies', { disintegrate: { tier: [5, 12, 30, 75], finish: [1, 1.5, 2, 2.5, 5] } })).toThrow();
  });

  test('prestigio: cinco valores siguen valiendo; por defecto la mítica da 20', () => {
    const old = parseConfig('planetarium', { points: { tiers: [1, 2, 4, 7, 12], finish: 1 } });
    expect(prestige([{ tier: 'mythic', finish: 'holo' }], old)).toBe(13);
    const now = parseConfig('planetarium', {});
    expect(now.points.tiers).toEqual([1, 2, 4, 7, 12, 20]);
    expect(prestige([{ tier: 'mythic', finish: 'holo' }], now)).toBe(21);
  });

  test('mercado: sin precio mínimo de mítica vale el de la legendaria; por defecto, 15000 y sin poder venderla', () => {
    const old = parseConfig('market', { minPrice: { common: 50, uncommon: 120, rare: 400, epic: 1500, legendary: 6000 } });
    expect(minPriceFor('mythic', old)).toBe(6000);
    expect(old.mythicListing).toBe(false);
    const now = parseConfig('market', {});
    expect(minPriceFor('mythic', now)).toBe(15_000);
    expect(parseConfig('market', { mythicListing: true }).mythicListing).toBe(true);
    expect(() => parseConfig('market', { minPrice: { common: 50, uncommon: 120, rare: 400, epic: 1500, legendary: 6000, mythic: 5000 } })).toThrow();
    expect(API_ERROR_CODES).toContain('mythic_not_listable');
  });
});
