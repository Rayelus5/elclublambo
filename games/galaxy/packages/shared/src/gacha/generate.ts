import { deriveSeed, dna, drawTraits, galaxyName, scoreTraits, subRng, tierOfScore, type Traits } from '@galaxy/engine';
import type { FeaturedTrait } from './types';

// «Rareza coherente» (GDD §7): the tier is drawn first, then candidate seeds are tried until one's traits fall in
// that tier's score band (and carry the featured trait, if any). The galaxy is always exactly
// renderFromSeed(seed) — traits are never fixed, so what the server stores is what every client draws.
export const MAX_CANDIDATES = 200_000;

export interface GeneratedGalaxy {
  seed: bigint;
  traits: Traits;
  dna: string;
  score: number;
  name: string;
  designation: string;
}

export function generateGalaxy(
  pullSeed: bigint,
  tier: number,
  featured?: { trait: FeaturedTrait; value: string },
  maxCandidates = MAX_CANDIDATES,
): GeneratedGalaxy {
  for (let k = 0; k < maxCandidates; k++) {
    const seed = deriveSeed(pullSeed, 'candidate', k);
    const traits = drawTraits(subRng(seed, 'traits'));
    if (featured && (traits as Readonly<Record<string, string | undefined>>)[featured.trait] !== featured.value) continue;
    const score = scoreTraits(traits);
    if (tierOfScore(score, traits.phenomenon !== 'none') !== tier) continue;
    const id = dna(traits);
    return { seed, traits, dna: id, score, name: galaxyName(seed), designation: `GX-${id.slice(0, 6).toUpperCase()}` };
  }
  throw new RangeError('tier_unreachable');
}
