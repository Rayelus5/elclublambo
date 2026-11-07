import { describe, expect, test } from 'vitest';
import { nextSlot, parseConfig, relicLevelCost, relicLevelUpSchema, relicRefund, type RunStats, slotUnlockSchema } from '../src/index';

// Relic levels and slots (GDD §8.4, §8.4 bis; M4c-1): a galaxy levels 1–10 with star dust at a rising cost, and fusing
// or disintegrating it returns half the dust put into it; slots 3–6 open one by one with a milestone and dust.

const cfg = parseConfig('relics', {});
const stats = (over: Partial<RunStats> = {}): RunStats => ({ runs: 0, bossKills: 0, maxDepth: 0, extractions: 0, kills: 0, ...over });

describe('los niveles', () => {
  test('cada nivel cuesta más polvo que el anterior, y en el 10 no hay más', () => {
    expect(relicLevelCost(1, cfg)).toBe(20);
    expect(relicLevelCost(2, cfg)).toBe(35);
    expect(relicLevelCost(9, cfg)).toBe(330);
    expect(relicLevelCost(10, cfg)).toBeNull();
    for (let l = 2; l < 10; l++) expect(relicLevelCost(l, cfg)!).toBeGreaterThan(relicLevelCost(l - 1, cfg)!);
  });

  test('desintegrar o fusionar devuelve la mitad del polvo invertido, redondeada abajo', () => {
    expect(relicRefund(155, cfg)).toBe(77);
    expect(relicRefund(0, cfg)).toBe(0);
  });
});

describe('las ranuras', () => {
  test('la siguiente ranura dice su hito, su progreso y su polvo; en 6 no hay más', () => {
    expect(nextSlot(2, stats({ runs: 3 }), cfg)).toEqual({ slot: 3, condition: { stat: 'runs', value: 5 }, progress: 0.6, dust: 100, ready: false });
    expect(nextSlot(2, stats({ runs: 5 }), cfg)).toMatchObject({ slot: 3, ready: true, progress: 1 });
    expect(nextSlot(3, stats({ bossKills: 1 }), cfg)).toMatchObject({ slot: 4, condition: { stat: 'bossKills', value: 3 }, dust: 300, ready: false });
    expect(nextSlot(5, stats({ extractions: 12 }), cfg)).toMatchObject({ slot: 6, dust: 1000, ready: true, progress: 1 });
    expect(nextSlot(6, stats(), cfg)).toBeNull();
  });

  test('la configuración rechaza costes negativos, una devolución de más del total y más de cuatro ranuras', () => {
    expect(() => parseConfig('relics', { ...cfg, levels: [-1, 2, 3, 4, 5, 6, 7, 8, 9] })).toThrow();
    expect(() => parseConfig('relics', { ...cfg, refund: 1.5 })).toThrow();
    expect(() => parseConfig('relics', { ...cfg, slots: [...cfg.slots, cfg.slots[0]] })).toThrow();
    expect(() => parseConfig('relics', { ...cfg, levels: [1, 2, 3] })).toThrow();
  });
});

test('subir de nivel dice a qué nivel; abrir una ranura dice cuál', () => {
  expect(relicLevelUpSchema.parse({ level: 2 })).toEqual({ level: 2 });
  expect(() => relicLevelUpSchema.parse({ level: 11 })).toThrow();
  expect(slotUnlockSchema.parse({ slot: 3 })).toEqual({ slot: 3 });
  expect(() => slotUnlockSchema.parse({ slot: 2 })).toThrow();
  expect(() => slotUnlockSchema.parse({ slot: 7 })).toThrow();
});
