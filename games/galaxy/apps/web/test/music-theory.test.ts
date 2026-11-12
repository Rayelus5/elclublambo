import { expect, test } from 'vitest';
import { seeded, seedOf } from '../src/audio/music/rng';
import { chordOf, degreeMidi, hz, inScale, MODES, voiceLead } from '../src/audio/music/theory';

// The soundtrack's music theory (plan «banda sonora», part A): scales by mode, chords stacked from the scale with
// their extensions, voicings that move as little as possible from one chord to the next, and a seeded random so the
// same piece always varies the same way (never Math.random).

test('las escalas por modo y los grados, también por debajo y por encima de la octava', () => {
  expect(MODES.dorian).toEqual([0, 2, 3, 5, 7, 9, 10]);
  // D dorian (D3 = 50): degree 0 is D, 2 is F, -1 is C, 7 is D4.
  expect(degreeMidi(50, 'dorian', 0)).toBe(50);
  expect(degreeMidi(50, 'dorian', 2)).toBe(53);
  expect(degreeMidi(50, 'dorian', -1)).toBe(48);
  expect(degreeMidi(50, 'dorian', 7)).toBe(62);
  expect(inScale(50, 'dorian', 59)).toBe(true); // B
  expect(inScale(50, 'dorian', 58)).toBe(false); // Bb
  expect(hz(69)).toBeCloseTo(440, 6);
  expect(hz(57)).toBeCloseTo(220, 6);
});

test('los acordes se apilan desde la escala, con sus extensiones', () => {
  // C major (C3 = 48): I = C E G, ii7 = D F A C, V sus4 = G C D, I add9 = C E G D.
  expect(chordOf(48, 'ionian', 0, 'triad')).toEqual([48, 52, 55]);
  expect(chordOf(48, 'ionian', 1, '7')).toEqual([50, 53, 57, 60]);
  expect(chordOf(48, 'ionian', 4, 'sus4')).toEqual([55, 60, 62]);
  expect(chordOf(48, 'ionian', 0, 'add9')).toEqual([48, 52, 55, 62]);
  expect(chordOf(48, 'ionian', 0, '9')).toEqual([48, 52, 55, 59, 62]);
  for (const n of chordOf(57, 'aeolian', 5, '7')) expect(inScale(57, 'aeolian', n)).toBe(true);
});

test('la voz de un acorde se acerca a la del anterior (sin saltos de una octava)', () => {
  const c = chordOf(48, 'ionian', 0, 'triad');
  const am = chordOf(48, 'ionian', 5, 'triad');
  const first = voiceLead(c, null, 60);
  const next = voiceLead(am, first, 60);
  // Same pitch classes, near the centre, and each voice moves a little.
  expect(next.map((n) => n % 12).sort()).toEqual([0, 4, 9]);
  const moved = next.reduce((s, n, i) => s + Math.abs(n - first[i]!), 0);
  expect(moved).toBeLessThanOrEqual(4);
  for (const n of next) expect(Math.abs(n - 60)).toBeLessThanOrEqual(9);
});

test('el azar con semilla repite lo mismo con la misma semilla y nada fuera de [0, 1)', () => {
  const a = seeded(seedOf('menu-1', 3, 'melody'));
  const b = seeded(seedOf('menu-1', 3, 'melody'));
  const c = seeded(seedOf('menu-1', 4, 'melody'));
  const xs = Array.from({ length: 50 }, () => a());
  expect(Array.from({ length: 50 }, () => b())).toEqual(xs);
  expect(Array.from({ length: 50 }, () => c())).not.toEqual(xs);
  for (const x of xs) {
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x).toBeLessThan(1);
  }
});
