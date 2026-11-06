import { subRng, type Generator } from './rng/generator';

// naming.py (galaxy-nft): galaxy proper names from 24 syllables, drawn from the seed's "name" stream.
export const SYLLABLES = [
  've', 'la', 'thra', 'or', 'in', 'ux', 'ka', 'sel', 'mir', 'ae', 'ty', 'ro',
  'zen', 'qua', 'li', 'dra', 'em', 'os', 'vi', 'na', 'rei', 'tha', 'cor', 'yl',
] as const;

/** proper_name: 3 syllables with probability 0.55, else 2; never the same syllable twice in a row. */
export function properName(rng: Generator): string {
  const count = rng.random() < 0.55 ? 3 : 2;
  const parts: string[] = [];
  while (parts.length < count) {
    const syllable = SYLLABLES[rng.integers(0, SYLLABLES.length)]!;
    if (parts.length === 0 || syllable !== parts[parts.length - 1]) parts.push(syllable);
  }
  const name = parts.join('');
  return name[0]!.toUpperCase() + name.slice(1);
}

/** The name of the galaxy with this seed. */
export function galaxyName(seed: bigint): string {
  return properName(subRng(seed, 'name'));
}
