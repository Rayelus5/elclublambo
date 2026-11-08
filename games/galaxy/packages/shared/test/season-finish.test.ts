import { describe, expect, test } from 'vitest';
import { disintegrateYield, parseConfig, seasonFinish } from '../src/index';

// A season's exclusive finish (GDD §13.1; M8c): its own stream, its chance, and nothing out of season.
describe('el acabado de temporada', () => {
  const season = { finish: 'rift' as const, finishChance: 0.02 };
  test('sale con su probabilidad, siempre igual para la misma semilla', () => {
    let n = 0;
    for (let i = 0n; i < 20_000n; i++) if (seasonFinish(i * 7919n + 1n, season) === 'rift') n++;
    expect(n / 20_000).toBeGreaterThan(0.015);
    expect(n / 20_000).toBeLessThan(0.025);
    expect(seasonFinish(123n, season)).toBe(seasonFinish(123n, season));
  });
  test('sin temporada, sin acabado o con probabilidad 0 no sale nunca', () => {
    for (const s of [null, { finish: null, finishChance: 0.5 }, { finish: 'rift' as const, finishChance: 0 }]) {
      for (let i = 0n; i < 500n; i++) expect(seasonFinish(i, s)).toBeNull();
    }
  });
  test('al desintegrarla rinde como el acabado más raro del sorteo', () => {
    const cfg = parseConfig('galaxies', {});
    expect(disintegrateYield(4, 'rift', cfg)).toBe(disintegrateYield(4, 'corrupt', cfg));
  });
});
