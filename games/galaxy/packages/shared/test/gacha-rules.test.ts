import { deriveSeed, drawTraits, galaxyName, scoreTraits, subRng, tierOfScore } from '@galaxy/engine';
import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import {
  disintegrateYield,
  drawPull,
  generateGalaxy,
  legendaryChance,
  parseConfig,
  tierWeights,
  validateFusion,
  type PityState,
} from '../src/index';

// GDD §9: rising luck and guarantee, welcome luck, featured galaxies on event banners, finishes; §8.5 fusion and
// disintegration. Pure functions over the engine's RNG: the server only adds storage and money.
const cfg = parseConfig('gacha', {});
const galaxiesCfg = parseConfig('galaxies', {});
const standard = cfg.banners[0]!;
const event = {
  id: 'nova',
  kind: 'event' as const,
  name: 'Semana nova',
  pityGroup: 'event-nova',
  currency: 'signal:nova',
  featured: { trait: 'phenomenon' as const, value: 'supernova' },
};
const fresh: PityState = { sinceLegendary: 0, sinceFeatured: 0, welcome: false };
const seed64 = fc.bigInt({ min: 0n, max: 2n ** 64n - 1n });

describe('suerte creciente y garantía', () => {
  test('la probabilidad está en [0, 1], nunca baja y vale 1 en la garantía', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 60 }), (n) => {
        const p = legendaryChance(n, cfg.standard);
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(1);
        expect(legendaryChance(n + 1, cfg.standard)).toBeGreaterThanOrEqual(p);
      }),
      { numRuns: 200 },
    );
    expect(legendaryChance(1, cfg.standard)).toBe(0.03);
    expect(legendaryChance(8, cfg.standard)).toBeCloseTo(0.09, 12);
    expect(legendaryChance(19, cfg.standard)).toBeCloseTo(0.75, 12);
    expect(legendaryChance(20, cfg.standard)).toBe(1);
    expect(legendaryChance(10, cfg.welcome)).toBe(1);
  });

  test('los pesos de los cinco niveles suman 1 en cualquier estado', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 19 }), fc.boolean(), (since, welcome) => {
        const w = tierWeights({ sinceLegendary: since, sinceFeatured: 0, welcome }, cfg);
        expect(w).toHaveLength(5);
        expect(Math.abs(w.reduce((a, b) => a + b, 0) - 1)).toBeLessThan(1e-12);
        expect(w.every((x) => x >= 0)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  test('en cualquier secuencia de tiradas nunca pasan más de 19 sin Legendaria (9 en bienvenida)', () => {
    fc.assert(
      fc.property(seed64, fc.boolean(), (base, welcome) => {
        let state: PityState = { ...fresh, welcome };
        let run = 0;
        let first = true;
        for (let i = 0; i < 60; i++) {
          const r = drawPull(deriveSeed(base, 'pull', i), state, standard, cfg);
          if (r.tier === 4) {
            if (first && welcome) expect(run).toBeLessThanOrEqual(9);
            first = false;
            run = 0;
            expect(r.state.sinceLegendary).toBe(0);
            expect(r.state.welcome).toBe(false);
          } else {
            run++;
            expect(run).toBeLessThanOrEqual(19);
          }
          state = r.state;
        }
      }),
      { numRuns: 200 },
    );
  });

  test('en un banner de evento el destacado llega como mucho a la tirada 45 y reinicia ambos contadores', () => {
    fc.assert(
      fc.property(seed64, (base) => {
        let state = fresh;
        let sinceFeatured = 0;
        for (let i = 0; i < 100; i++) {
          const r = drawPull(deriveSeed(base, 'pull', i), state, event, cfg);
          if (r.featured) {
            expect(r.tier).toBe(4);
            expect(r.state).toMatchObject({ sinceFeatured: 0, sinceLegendary: 0 });
            sinceFeatured = 0;
          } else {
            sinceFeatured++;
            expect(sinceFeatured).toBeLessThanOrEqual(44);
          }
          state = r.state;
        }
      }),
      { numRuns: 200 },
    );
  });

  test('un banner estándar no toca el contador del destacado', () => {
    const r = drawPull(123n, { sinceLegendary: 3, sinceFeatured: 17, welcome: false }, standard, cfg);
    expect(r.state.sinceFeatured).toBe(17);
    expect(r.featured).toBe(false);
  });

  test('misma semilla y estado, mismo resultado', () => {
    fc.assert(
      fc.property(seed64, fc.integer({ min: 0, max: 19 }), (s, since) => {
        const state = { sinceLegendary: since, sinceFeatured: 0, welcome: false };
        expect(drawPull(s, state, standard, cfg)).toEqual(drawPull(s, state, standard, cfg));
      }),
      { numRuns: 200 },
    );
  });
});

describe('galaxias de una tirada', () => {
  test('la galaxia es la del motor para su semilla, del nivel pedido, sin rasgos fijados', () => {
    fc.assert(
      fc.property(seed64, fc.integer({ min: 0, max: 4 }), (pullSeed, tier) => {
        const g = generateGalaxy(pullSeed, tier);
        const traits = drawTraits(subRng(g.seed, 'traits'));
        expect(g.traits).toEqual(traits);
        expect(tierOfScore(scoreTraits(traits), traits.phenomenon !== 'none')).toBe(tier);
        expect(g.name).toBe(galaxyName(g.seed));
        expect(g.designation).toBe(`GX-${g.dna.slice(0, 6).toUpperCase()}`);
        if (tier === 4) expect(traits.phenomenon).not.toBe('none');
        expect(generateGalaxy(pullSeed, tier)).toEqual(g);
      }),
      { numRuns: 200 },
    );
  });

  test('una galaxia destacada lleva el rasgo destacado y es Legendaria', () => {
    fc.assert(
      fc.property(seed64, (pullSeed) => {
        const g = generateGalaxy(pullSeed, 4, event.featured);
        expect(g.traits.phenomenon).toBe('supernova');
      }),
      { numRuns: 50 },
    );
  });

  test('un destacado imposible para su nivel no cuelga: lanza tier_unreachable', () => {
    expect(() => generateGalaxy(1n, 4, { trait: 'phenomenon', value: 'none' }, 2_000)).toThrow('tier_unreachable');
  });
});

describe('desintegrar y fusionar', () => {
  test('el polvo depende del nivel y del acabado', () => {
    expect(disintegrateYield(0, 'normal', galaxiesCfg)).toBe(5);
    expect(disintegrateYield(4, 'normal', galaxiesCfg)).toBe(200);
    expect(disintegrateYield(2, 'holo', galaxiesCfg)).toBe(45);
    expect(disintegrateYield(3, 'corrupt', galaxiesCfg)).toBe(375);
  });

  test('cinco distintas del mismo nivel dan una del siguiente, con su coste en polvo', () => {
    const g = (id: string, tier: number) => ({ id, tier });
    expect(validateFusion(['a', 'b', 'c', 'd', 'e'].map((id) => g(id, 0)), galaxiesCfg)).toEqual({ tier: 1, dust: 20 });
    expect(validateFusion(['a', 'b', 'c', 'd', 'e'].map((id) => g(id, 3)), galaxiesCfg)).toEqual({ tier: 4, dust: 300 });
    expect(validateFusion(['a', 'b', 'c', 'd'].map((id) => g(id, 0)), galaxiesCfg)).toEqual({ error: 'invalid_fusion' });
    expect(validateFusion(['a', 'a', 'c', 'd', 'e'].map((id) => g(id, 0)), galaxiesCfg)).toEqual({ error: 'invalid_fusion' });
    expect(validateFusion([g('a', 0), g('b', 0), g('c', 1), g('d', 0), g('e', 0)], galaxiesCfg)).toEqual({ error: 'invalid_fusion' });
    expect(validateFusion(['a', 'b', 'c', 'd', 'e'].map((id) => g(id, 4)), galaxiesCfg)).toEqual({ error: 'invalid_fusion' });
  });
});
