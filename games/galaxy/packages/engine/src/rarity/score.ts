import { TRAITS } from '../config/generated';
import type { Traits } from '../config/types';
import { subRng } from '../rng/generator';
import { deriveSeed } from '../rng/seed';
import { drawTraits } from '../traits';
import calibration from './calibration.json';

// Rarity of a galaxy (GDD §7): its score is the information of its traits, Σ −log2(frequency of each value) over
// the draw order (an absent trait counts as «—»). The five tiers are score bands calibrated offline on a fixed sample
// of random galaxies; a legendary must also have a phenomenon (GDD §8.2). The calibration is versioned data:
// changing it changes which seeds the gacha accepts for each tier, never the galaxies already owned.
export const ABSENT = '—';
/** Score quantiles that separate common | uncommon | rare | epic | legendary. */
export const TIER_QUANTILES = [0.5, 0.78, 0.91, 0.97] as const;

export interface RarityCalibration {
  samples: number;
  counts: Record<string, Record<string, number>>;
  bands: [number, number, number, number];
}

const data = calibration as RarityCalibration;
export const RARITY_BANDS = data.bands;

const info = new Map<string, number>();
for (const [key, values] of Object.entries(data.counts)) {
  for (const [value, count] of Object.entries(values)) info.set(`${key}=${value}`, -Math.log2(count / data.samples));
}

function scoreWith(traits: Traits, table: Map<string, number>): number {
  const t = traits as Readonly<Record<string, string | undefined>>;
  let score = 0;
  for (const key of TRAITS.drawOrder) {
    const bits = table.get(`${key}=${t[key] ?? ABSENT}`);
    // A value never seen in the calibration sample is rarer than anything seen: count it as one sample.
    score += bits ?? Math.log2(data.samples);
  }
  return score;
}

export function scoreTraits(traits: Traits): number {
  return scoreWith(traits, info);
}

/** Tier index 0–4 (common → legendary) for a score; without a phenomenon a galaxy is at most epic. */
export function tierOfScore(score: number, hasPhenomenon: boolean): number {
  const [b0, b1, b2, b3] = RARITY_BANDS;
  if (score >= b3) return hasPhenomenon ? 4 : 3;
  if (score >= b2) return 3;
  if (score >= b1) return 2;
  if (score >= b0) return 1;
  return 0;
}

/** The calibration from `samples` random galaxies (seeds deriveSeed('rarity-calibration', i)). Deterministic. */
export function calibrateRarity(samples: number): RarityCalibration {
  const all: Traits[] = [];
  const counts: Record<string, Record<string, number>> = {};
  for (const key of TRAITS.drawOrder) counts[key] = {};
  for (let i = 0; i < samples; i++) {
    const traits = drawTraits(subRng(deriveSeed('rarity-calibration', i), 'traits'));
    all.push(traits);
    const t = traits as Readonly<Record<string, string | undefined>>;
    for (const key of TRAITS.drawOrder) {
      const value = t[key] ?? ABSENT;
      counts[key]![value] = (counts[key]![value] ?? 0) + 1;
    }
  }
  const table = new Map<string, number>();
  for (const [key, values] of Object.entries(counts)) {
    for (const [value, count] of Object.entries(values)) table.set(`${key}=${value}`, -Math.log2(count / samples));
  }
  const scores = Float64Array.from(all, (t) => scoreWith(t, table)).sort();
  const bands = TIER_QUANTILES.map((q) => scores[Math.floor(q * samples)]!) as RarityCalibration['bands'];
  return { samples, counts, bands };
}
