import { deriveSeed } from '@galaxy/engine';
import { expect, test } from 'vitest';
import { drawPull, parseConfig, type PityState } from '../src/index';

// GDD §9 pacing with the starting numbers: a legendary every ~10–15 pulls (≈ 30 min – 2 h at ~10 pulls/h), never
// more than 20; a new account's first legendary within 10; finishes at their configured rates. Deterministic.
const cfg = parseConfig('gacha', {});
const banner = cfg.banners[0]!;

test('ritmo estándar: media entre Legendarias de 9 a 15 tiradas y nunca más de 20', () => {
  let state: PityState = { sinceLegendary: 0, sinceFeatured: 0, welcome: false };
  const gaps: number[] = [];
  let gap = 0;
  const finishes = [0, 0, 0, 0, 0];
  const n = 60_000;
  for (let i = 0; i < n; i++) {
    const r = drawPull(deriveSeed('simulation', i), state, banner, cfg);
    gap++;
    if (r.tier === 4) {
      gaps.push(gap);
      gap = 0;
    }
    finishes[['normal', 'holo', 'prismatic', 'braille', 'corrupt'].indexOf(r.finish)]!++;
    state = r.state;
  }
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  expect(mean).toBeGreaterThanOrEqual(9);
  expect(mean).toBeLessThanOrEqual(15);
  expect(Math.max(...gaps)).toBeLessThanOrEqual(20);
  cfg.finishes.forEach((p, i) => {
    const sigma = Math.sqrt(n * p * (1 - p));
    expect(Math.abs(finishes[i]! - n * p), `finish ${i}`).toBeLessThanOrEqual(3 * sigma + 1);
  });
}, 60_000);

test('bienvenida: la primera Legendaria de una cuenta nueva llega siempre en 10 tiradas o menos', () => {
  for (let account = 0; account < 3_000; account++) {
    let state: PityState = { sinceLegendary: 0, sinceFeatured: 0, welcome: true };
    let pulls = 0;
    for (;;) {
      const r = drawPull(deriveSeed('welcome', account, pulls), state, banner, cfg);
      pulls++;
      state = r.state;
      if (r.tier === 4) break;
    }
    expect(pulls).toBeLessThanOrEqual(10);
  }
}, 60_000);
