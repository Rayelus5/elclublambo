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
    expect(checkRun(claim(), ctx)).toEqual({ flags: [], claim: claim(), penalized: false });
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

describe('una reclamación imposible se recorta a lo que pudo pasar', () => {
  // The review's forged finish: one minute after the start, layer 999, ten million kills and all loot in the last layer.
  const forged = (): RunClaim =>
    claim({
      ticks: 60 * 60,
      depth: 999,
      kills: 10_000_000,
      bossKills: 999,
      loot: Array.from({ length: 999 }, (_, i) => (i === 998 ? { coins: 10_000_000, dust: 10_000_000 } : { coins: 0, dust: 0 })),
    });

  test('la profundidad, las bajas y los jefes se recortan al tiempo real y el botín de capas de más se pierde', () => {
    const r = checkRun(forged(), { ...ctx, wallSeconds: 60, logTicks: 0 });
    expect(r.flags).toEqual(expect.arrayContaining(['depth_vs_time', 'kills_rate']));
    expect(r.claim.depth).toBe(1);
    expect(r.claim.loot).toEqual([{ coins: 0, dust: 0 }]);
    expect(r.claim.bossKills).toBe(1);
    expect(r.claim.kills).toBe(650);
    expect(r.penalized).toBe(true);
  });

  test('el tiempo de juego se recorta al tiempo real con su margen', () => {
    const r = checkRun(claim({ ticks: 60 * 3600, depth: 1 }), { ...ctx, wallSeconds: 100 });
    expect(r.flags).toContain('too_fast');
    expect(r.claim.ticks).toBe((100 + cfg.caps.slackSeconds) * 60);
  });

  test('solo las banderas de trampa castigan: un botín recortado a su tope no', () => {
    expect(checkRun(claim(), ctx).penalized).toBe(false);
    expect(checkRun(claim({ kills: 100, loot: [{ coins: 10_000, dust: 9_000 }] }), ctx).penalized).toBe(false);
    expect(checkRun(claim(), { ...ctx, logTicks: 6 * 3600 + 1 }).penalized).toBe(true);
  });

  test('ninguna reclamación pasa de lo que cabe en su tiempo real', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 999 }),
        fc.integer({ min: 0, max: 60 * 3600 * 24 }),
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.integer({ min: 0, max: 999 }),
        fc.integer({ min: 0, max: 24 * 3600 }),
        (depth, ticks, kills, bossKills, wall) => {
          const loot = Array.from({ length: depth }, () => ({ coins: 1000, dust: 1000 }));
          const r = checkRun(claim({ depth, ticks, kills, bossKills, loot }), { ...ctx, wallSeconds: wall, logTicks: null });
          const real = Math.min(ticks, (wall + cfg.caps.slackSeconds) * 60);
          return (
            r.claim.ticks <= real &&
            r.claim.depth <= 1 + Math.floor(real / (300 * 60)) &&
            r.claim.loot.length === r.claim.depth &&
            r.claim.kills <= cfg.caps.killsPerMinute * (real / 3600) + 50 &&
            r.claim.bossKills <= r.claim.depth
          );
        },
      ),
      { numRuns: 400 },
    );
  });
});
