import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { dailyFactor, dailySegments, dailyStatus, depthMultiplier, parseConfig, runMaterial, runPayout, type RunClaim } from '../src/index';

// What a run pays (GDD §5.1, §11.3 bis): loot × the depth of the layer it was picked up in, half without extraction,
// and the daily yield prorated over the minutes played past each threshold.

const cfg = parseConfig('runs', {});
const claim = (over: Partial<RunClaim> = {}): RunClaim => ({
  outcome: 'extracted',
  ticks: 6 * 3600,
  depth: 1,
  kills: 300,
  bossKills: 1,
  level: 12,
  loot: [{ coins: 100, dust: 10 }],
  hash: '0123456789abcdef',
  ...over,
});

describe('profundidad', () => {
  test('×1, ×1,5, ×2,2, ×3 y luego +0,8 por capa', () => {
    const want = [1, 1.5, 2.2, 3, 3.8, 4.6];
    want.forEach((m, i) => expect(depthMultiplier(i + 1, cfg)).toBeCloseTo(m, 12));
  });
});

describe('pago', () => {
  test('extraer paga cada capa por su profundidad', () => {
    const r = runPayout(claim({ depth: 2, bossKills: 2, loot: [{ coins: 100, dust: 10 }, { coins: 100, dust: 10 }] }), cfg, 1);
    expect(r).toMatchObject({ coins: 250, dust: 25, share: 1 });
    expect(r.layers).toEqual([
      { layer: 1, coins: 100, dust: 10, multiplier: 1 },
      { layer: 2, coins: 100, dust: 10, multiplier: 1.5 },
    ]);
  });

  test('morir o abandonar paga la mitad', () => {
    expect(runPayout(claim({ outcome: 'died', bossKills: 0 }), cfg, 1)).toMatchObject({ coins: 50, dust: 5, share: 0.5 });
    expect(runPayout(claim({ outcome: 'abandoned', bossKills: 0 }), cfg, 1)).toMatchObject({ coins: 50, dust: 5, share: 0.5 });
  });

  test('el factor diario se aplica al final y se redondea hacia abajo', () => {
    expect(runPayout(claim({ loot: [{ coins: 250, dust: 25 }] }), cfg, 0.875)).toMatchObject({ coins: 218, dust: 21 });
  });
});

describe('rendimiento diario', () => {
  test('con 2 h 50 min jugadas, una partida de 20 min cobra 10 min a ×1 y 10 a ×0,75', () => {
    const segs = dailySegments(2 * 3600 + 50 * 60, 20 * 60, cfg);
    expect(segs).toEqual([
      { seconds: 600, multiplier: 1 },
      { seconds: 600, multiplier: 0.75 },
    ]);
    expect(dailyFactor(segs)).toBe(0.875);
  });

  test('una partida que cruza varios tramos los cobra todos y nunca baja de ×0,25', () => {
    expect(dailySegments(2.5 * 3600, 3 * 3600, cfg)).toEqual([
      { seconds: 1800, multiplier: 1 },
      { seconds: 3600, multiplier: 0.75 },
      { seconds: 3600, multiplier: 0.5 },
      { seconds: 1800, multiplier: 0.25 },
    ]);
    expect(dailySegments(9 * 3600, 600, cfg)).toEqual([{ seconds: 600, multiplier: 0.25 }]);
  });

  test('los tramos suman la duración, el factor está entre 0,25 y 1 y jugar más antes nunca paga más', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 30 * 3600 }), fc.integer({ min: 1, max: 6 * 3600 }), fc.integer({ min: 0, max: 3600 }), (before, seconds, more) => {
        const segs = dailySegments(before, seconds, cfg);
        const f = dailyFactor(segs);
        const later = dailyFactor(dailySegments(before + more, seconds, cfg));
        return segs.reduce((a, s) => a + s.seconds, 0) === seconds && f >= 0.25 && f <= 1 && later <= f + 1e-12;
      }),
      { numRuns: 300 },
    );
  });

  test('el estado del día: cuánto queda a premio completo y el tramo actual', () => {
    expect(dailyStatus(3600, cfg)).toEqual({ playedSeconds: 3600, fullSecondsLeft: 7200, multiplier: 1 });
    expect(dailyStatus(4.5 * 3600, cfg)).toEqual({ playedSeconds: 16200, fullSecondsLeft: 0, multiplier: 0.5 });
  });
});

describe('frenos del pago', () => {
  test('una partida castigada cobra la parte de morir aunque extraiga', () => {
    expect(runPayout(claim(), cfg, 1, true)).toMatchObject({ coins: 50, dust: 5, share: 0.5 });
  });

  test('ninguna partida cobra más que el techo por partida', () => {
    const deep = claim({ depth: 40, bossKills: 40, loot: Array.from({ length: 40 }, () => ({ coins: 5_000, dust: 5_000 })) });
    const r = runPayout(deep, cfg, 1);
    expect(r).toMatchObject({ coins: cfg.caps.runCoins, dust: cfg.caps.runDust, capped: true });
    expect(runPayout(claim(), cfg, 1).capped).toBe(false);
  });
});

describe('el laboratorio en lo cobrado (M4b-2)', () => {
  test('sube monedas y polvo antes de los topes, y una partida sin extraer cobra su parte', () => {
    expect(runPayout(claim(), cfg, 1, false, { coins: 0.1, dust: 0.2 })).toMatchObject({ coins: 110, dust: 12 });
    expect(runPayout(claim({ outcome: 'died' }), cfg, 1, false, { coins: 0.1, dust: 0 })).toMatchObject({ coins: 55, dust: 5 });
    expect(runPayout(claim(), cfg, 1, true, { coins: 0.1, dust: 0 })).toMatchObject({ coins: 55, share: 0.5 });
    // Never past the per-run caps.
    const rich = runPayout(claim({ loot: [{ coins: cfg.caps.runCoins, dust: cfg.caps.runDust }] }), cfg, 1, false, { coins: 0.1, dust: 0.1 });
    expect(rich).toMatchObject({ coins: cfg.caps.runCoins, dust: cfg.caps.runDust, capped: true });
    expect(runPayout(claim(), cfg, 1)).toMatchObject({ coins: 100, dust: 10 });
  });

  test('sube el material antes de su tope', () => {
    // 1 layer × 6 + 1 Core × 10 + 3 × 2 per hundred kills = 22.
    expect(runMaterial(claim(), cfg, 1)).toBe(22);
    expect(runMaterial(claim(), cfg, 1, false, 0.2)).toBe(26);
    expect(runMaterial(claim({ depth: 1000 }), cfg, 1, false, 0.2)).toBe(cfg.caps.runMaterial);
  });
});
