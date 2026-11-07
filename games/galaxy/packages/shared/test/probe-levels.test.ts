import { DEFAULT_CONTENT } from '@galaxy/sim';
import { describe, expect, test } from 'vitest';
import {
  parseConfig,
  probeLevelBonuses,
  probeLevelNext,
  probeLevelUpSchema,
  probeMaxLevel,
  probeVariantCards,
  probeVariantSchema,
  startingWeapon,
  variantsOf,
} from '../src/index';

// Probe levels and starting-weapon variants (GDD §6, M4b-1): levels 1–10 bought with components and coins, small stat
// bonuses per level, and the weapon's two variants opening at levels 4 and 8.

const cfg = parseConfig('probes', {});
const C = DEFAULT_CONTENT;
const lumen = C.probes.find((p) => p.id === 'lumen')!;

describe('los niveles', () => {
  test('el nivel 1 no da bonos y el 10 da +27 % de vida y +18 % de daño', () => {
    expect(probeLevelBonuses(1, cfg)).toEqual([]);
    const top = probeLevelBonuses(10, cfg);
    expect(top.map((b) => b.stat)).toEqual(['maxHp', 'damage']);
    // Part of what the sim's proving ground plays with (packages/sim/test/proving.ts VETERAN; lab.test.ts pins the sum).
    expect(top[0]!.value).toBeCloseTo(0.27, 9);
    expect(top[1]!.value).toBeCloseTo(0.18, 9);
    expect(probeLevelBonuses(4, cfg).map((b) => b.value)).toEqual([expect.closeTo(0.09, 9), expect.closeTo(0.06, 9)]);
    expect(probeLevelBonuses(99, cfg)).toEqual(top);
    expect(probeLevelBonuses(0, cfg)).toEqual([]);
  });

  test('subir cuesta componentes y monedas, y al 10 no hay más', () => {
    expect(probeMaxLevel(cfg)).toBe(10);
    expect(probeLevelNext(1, cfg)).toEqual({ components: 20, coins: 300 });
    expect(probeLevelNext(3, cfg)).toEqual({ components: 60, coins: 1000 });
    expect(probeLevelNext(9, cfg)).toEqual({ components: 400, coins: 8000 });
    expect(probeLevelNext(10, cfg)).toBeNull();
  });

  test('la configuración rechaza bonos grandes, costes negativos y una lista vacía', () => {
    expect(() => parseConfig('probes', { levels: { perLevel: { maxHp: 1 }, costs: [{ components: 1, coins: 1 }] } })).toThrow();
    expect(() => parseConfig('probes', { levels: { perLevel: {}, costs: [{ components: -1, coins: 1 }] } })).toThrow();
    expect(() => parseConfig('probes', { levels: { perLevel: {}, costs: [] } })).toThrow();
    expect(() => parseConfig('probes', { levels: { perLevel: { nope: 0.1 }, costs: [{ components: 1, coins: 1 }] } })).toThrow();
    const short = parseConfig('probes', { levels: { perLevel: { speed: 0.01 }, costs: [{ components: 5, coins: 50 }] } });
    expect(probeMaxLevel(short)).toBe(2);
    expect(probeLevelBonuses(2, short)).toEqual([{ stat: 'speed', value: 0.01 }]);
  });
});

describe('el arma inicial', () => {
  test('las variantes de un arma, por el nivel que las abre', () => {
    expect(variantsOf('pulse', C).map((w) => w.id)).toEqual(['pulse-twin', 'pulse-frost']);
    expect(variantsOf('pulse-storm', C)).toEqual([]);
  });

  test('sale con la variante elegida solo si su nivel la abre y es de su arma', () => {
    expect(startingWeapon(lumen, 3, 'pulse-twin', C)).toBe('pulse');
    expect(startingWeapon(lumen, 4, 'pulse-twin', C)).toBe('pulse-twin');
    expect(startingWeapon(lumen, 8, 'pulse-frost', C)).toBe('pulse-frost');
    expect(startingWeapon(lumen, 10, 'nova-wide', C)).toBe('pulse');
    expect(startingWeapon(lumen, 10, null, C)).toBe('pulse');
    expect(startingWeapon(lumen, 10, 'pulse', C)).toBe('pulse');
  });

  test('las tarjetas: la base primero y sus dos variantes, abiertas según el nivel', () => {
    const cards = probeVariantCards(lumen, 4, C);
    expect(cards.map((c) => [c.id, c.unlockAt, c.unlocked])).toEqual([
      ['pulse', 1, true],
      ['pulse-twin', 4, true],
      ['pulse-frost', 8, false],
    ]);
    expect(cards[2]).toMatchObject({ name: 'Pulso gélido', element: 'slow' });
    expect(cards[0]!.icon).toBe('icon-pulse');
  });
});

describe('las peticiones', () => {
  test('subir de nivel dice a qué nivel; elegir arma dice cuál', () => {
    expect(probeLevelUpSchema.parse({ level: 2 })).toEqual({ level: 2 });
    expect(() => probeLevelUpSchema.parse({ level: 1 })).toThrow();
    expect(() => probeLevelUpSchema.parse({ level: 2, extra: 1 })).toThrow();
    expect(probeVariantSchema.parse({ variant: 'pulse-twin' })).toEqual({ variant: 'pulse-twin' });
    expect(() => probeVariantSchema.parse({ variant: 'Nope!' })).toThrow();
  });
});
