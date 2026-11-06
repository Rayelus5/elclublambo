import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { calibrateRarity, deriveSeed, drawTraits, RARITY_BANDS, scoreTraits, subRng, tierOfScore, type Traits } from '../src/index';

// GDD §7 «rareza coherente»: a galaxy's score is the information of its traits (rare traits → high score); the five
// tiers are score bands calibrated offline so that a random galaxy is common 50 %, uncommon 28 %, rare 13 %, epic 6 %
// and legendary 3 % — and a legendary always has a phenomenon. Regenerate with CALIBRATE=1.
const FILE = new URL('../src/rarity/calibration.json', import.meta.url);

describe('calibración', () => {
  test('es determinista y coincide con calibration.json', () => {
    const fresh = calibrateRarity(200_000);
    if (process.env['CALIBRATE']) writeFileSync(FILE, `${JSON.stringify(fresh, null, 1)}\n`);
    expect(JSON.parse(readFileSync(FILE, 'utf8'))).toEqual(fresh);
    expect(RARITY_BANDS).toEqual(fresh.bands);
  }, 120_000);

  test('en una muestra independiente las bandas dan 50 / 28 / 13 / 6 / 3 %', () => {
    const counts = [0, 0, 0, 0, 0];
    const n = 40_000;
    for (let i = 0; i < n; i++) {
      const traits = drawTraits(subRng(deriveSeed('rarity-check', i), 'traits'));
      counts[tierOfScore(scoreTraits(traits), true)]!++;
    }
    [0.5, 0.28, 0.13, 0.06, 0.03].forEach((share, tier) => {
      expect(Math.abs(counts[tier]! / n - share), `tier ${tier}`).toBeLessThan(0.01);
    });
  });
});

describe('puntuación', () => {
  const base: Traits = {
    galaxy_type: 'spiral',
    arms: '2',
    size: 'medium',
    inclination: 'face_on',
    core: 'bright',
    star_density: 'normal',
    palette: 'andromeda_blue',
    background: 'starfield',
    phenomenon: 'none',
  };

  test('cambiar un rasgo común por uno raro sube la puntuación', () => {
    expect(scoreTraits({ ...base, phenomenon: 'pulsar' })).toBeGreaterThan(scoreTraits(base));
    expect(scoreTraits({ ...base, palette: 'antimatter', background: 'deep_void' })).toBeGreaterThan(scoreTraits(base));
  });

  test('una Legendaria exige fenómeno: sin él se queda en Épica', () => {
    const top = RARITY_BANDS[3] + 1;
    expect(tierOfScore(top, true)).toBe(4);
    expect(tierOfScore(top, false)).toBe(3);
    expect(tierOfScore(RARITY_BANDS[0] - 1, true)).toBe(0);
  });
});
