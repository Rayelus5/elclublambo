import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { checkRun, parseConfig, type RunClaim } from '../src/index';

// Plausibility of a finished run (GDD §14.7): the client simulates, so the server checks that the claim could have
// happened. A suspicious run is flagged (it will not score) and its loot is clipped to what was possible.

const cfg = parseConfig('runs', {});
const ctx = { wallSeconds: 7 * 60, layerSeconds: 300, cfg, logTicks: 6 * 3600 - 30 };
const claim = (over: Partial<RunClaim> = {}): RunClaim => ({
  outcome: 'extracted',
  ticks: 6 * 3600,
  depth: 1,
  kills: 600,
  bossKills: 1,
  level: 14,
  loot: [{ coins: 40, dust: 15 }],
  hash: '0123456789abcdef',
  ...over,
});

describe('una partida normal', () => {
  test('no lleva banderas y conserva su botín', () => {
    expect(checkRun(claim(), ctx)).toEqual({ flags: [], claim: claim() });
  });

  test('morir en la capa 2 antes de su jefe es normal', () => {
    const c = claim({ outcome: 'died', ticks: 9 * 3600, depth: 2, bossKills: 1, loot: [{ coins: 40, dust: 15 }, { coins: 20, dust: 5 }] });
    expect(checkRun(c, { ...ctx, wallSeconds: 10 * 60, logTicks: 9 * 3600 }).flags).toEqual([]);
  });
});

describe('banderas', () => {
  test('más tiempo de juego que tiempo real', () => {
    expect(checkRun(claim(), { ...ctx, wallSeconds: 5 * 60 }).flags).toContain('too_fast');
  });

  test('más profundidad de la que da el tiempo', () => {
    expect(checkRun(claim({ depth: 3, bossKills: 3, loot: [claim().loot[0]!, claim().loot[0]!, claim().loot[0]!] }), ctx).flags).toContain('depth_vs_time');
  });

  test('demasiadas bajas por minuto', () => {
    expect(checkRun(claim({ kills: 6 * 600 + 51 }), ctx).flags).toContain('kills_rate');
  });

  test('jefes que no cuadran con la capa o con la extracción', () => {
    expect(checkRun(claim({ bossKills: 2 }), ctx).flags).toContain('boss_kills');
    expect(checkRun(claim({ bossKills: 0 }), ctx).flags).toContain('boss_kills');
    expect(checkRun(claim({ outcome: 'died', ticks: 9 * 3600, depth: 2, bossKills: 0, loot: [claim().loot[0]!, claim().loot[0]!] }), { ...ctx, wallSeconds: 600 }).flags).toContain('boss_kills');
  });

  test('una grabación que va más allá del final', () => {
    expect(checkRun(claim(), { ...ctx, logTicks: 6 * 3600 + 1 }).flags).toContain('log_mismatch');
  });

  test('botín imposible: se marca y se recorta a su tope', () => {
    const r = checkRun(claim({ kills: 100, loot: [{ coins: 10_000, dust: 9_000 }] }), ctx);
    expect(r.flags).toContain('loot_cap');
    // Tope: 100 × 0,25 + 1 × 30 + 5 = 60 monedas; 100 × 0,12 + 1 × 10 + 5 = 27 de polvo.
    expect(r.claim.loot).toEqual([{ coins: 60, dust: 27 }]);
  });

  test('el botín recortado nunca supera el tope, capa a capa incluida', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 5000 }),
        fc.array(fc.record({ coins: fc.integer({ min: 0, max: 100_000 }), dust: fc.integer({ min: 0, max: 100_000 }) }), { minLength: 1, maxLength: 5 }),
        (kills, loot) => {
          const depth = loot.length;
          const c = claim({ kills, depth, bossKills: depth, loot, ticks: depth * 400 * 60 });
          const r = checkRun(c, { ...ctx, wallSeconds: depth * 500, logTicks: null });
          const coins = r.claim.loot.reduce((a, l) => a + l.coins, 0);
          const dust = r.claim.loot.reduce((a, l) => a + l.dust, 0);
          return coins <= kills * 0.25 + depth * 30 + 5 && dust <= kills * 0.12 + depth * 10 + 5 && r.claim.loot.every((l, i) => l.coins <= loot[i]!.coins);
        },
      ),
      { numRuns: 300 },
    );
  });
});
