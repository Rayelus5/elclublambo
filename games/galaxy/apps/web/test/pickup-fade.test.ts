import { expect, test } from 'vitest';
import { pickupAlpha } from '../src/arena/stage/pickup-fade';

// Loose items that expire (2026-11-22): a data fragment or a repair kit about to go blinks softly, faster and faster,
// and fades out; with reduced motion it only fades. Everything else, and anything flying to a probe, stays whole.

const FADE = 300;

test('entero hasta que empieza el aviso, y siempre si no caduca', () => {
  expect(pickupAlpha(Infinity, FADE, false)).toBe(1);
  expect(pickupAlpha(Infinity, FADE, true)).toBe(1);
  expect(pickupAlpha(FADE, FADE, false)).toBe(1);
  expect(pickupAlpha(5000, FADE, false)).toBe(1);
  expect(pickupAlpha(10, 0, false)).toBe(1);
});

test('con movimiento reducido se desvanece sin parpadear', () => {
  expect(pickupAlpha(FADE - 0.001, FADE, true)).toBeCloseTo(1, 3);
  expect(pickupAlpha(FADE / 2, FADE, true)).toBeCloseTo(0.625);
  expect(pickupAlpha(0, FADE, true)).toBeCloseTo(0.25);
  let last = 1;
  for (let left = FADE - 1; left >= 0; left--) {
    const a = pickupAlpha(left, FADE, true);
    expect(a).toBeLessThan(last);
    last = a;
  }
});

test('el parpadeo empieza entero, se apaga poco a poco y acelera hacia el final', () => {
  expect(pickupAlpha(FADE - 0.001, FADE, false)).toBeCloseTo(1, 2);
  const blinks = (from: number, to: number) => {
    let n = 0;
    let prev = pickupAlpha(from, FADE, false);
    let falling = false;
    for (let left = from - 0.25; left >= to; left -= 0.25) {
      const a = pickupAlpha(left, FADE, false);
      if (a > prev && falling) n++;
      falling = a < prev;
      prev = a;
    }
    return n;
  };
  // The same span of time at the start and at the end of the warning.
  expect(blinks(FADE - 1, FADE - 61)).toBeLessThan(blinks(61, 1));
  for (let left = FADE - 1; left >= 0; left -= 7) {
    const k = left / FADE;
    const a = pickupAlpha(left, FADE, false);
    expect(a).toBeLessThanOrEqual(0.35 + 0.65 * k + 1e-9);
    expect(a).toBeGreaterThanOrEqual(0.2 * (0.35 + 0.65 * k) - 1e-9);
  }
});
