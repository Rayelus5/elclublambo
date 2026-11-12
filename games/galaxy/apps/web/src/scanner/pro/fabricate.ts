import { generateGalaxy, TIERS, type Finish, type PulledGalaxy, type Tier } from '@galaxy/shared';

// The Ensayo's scans (plan «escáner pro», part B): real galaxies of the tiers asked for, made in the browser with the
// game's own generator — the same rule the server uses («rareza coherente»: candidate seeds until one's traits fall in
// the tier) — so the cinematic can be directed without paying or saving anything. One galaxy at a time, letting the
// page breathe between them (a legendary can take a moment to find).

export interface FabricateOptions {
  tiers: readonly Tier[];
  finish?: Finish;
  /** Which pulls are «Destacada». */
  featured?: readonly number[];
  /** Shown as the pulls' phenomenon (the image stays the seed's own). */
  phenomenon?: string | null;
}

/** Ten-pull rarities to try the cinematic with. */
export const REHEARSAL_PRESETS = {
  variada: ['common', 'common', 'uncommon', 'common', 'rare', 'common', 'uncommon', 'common', 'epic', 'legendary'],
  comunes: ['common', 'common', 'common', 'common', 'common', 'common', 'common', 'uncommon', 'common', 'common'],
  unaEpica: ['common', 'uncommon', 'common', 'rare', 'common', 'common', 'uncommon', 'common', 'common', 'epic'],
  unaLegendaria: ['common', 'common', 'uncommon', 'common', 'common', 'rare', 'common', 'uncommon', 'common', 'legendary'],
  dosLegendarias: ['common', 'legendary', 'uncommon', 'common', 'rare', 'common', 'epic', 'common', 'uncommon', 'legendary'],
} as const satisfies Record<string, readonly Tier[]>;

export type RehearsalPreset = keyof typeof REHEARSAL_PRESETS;

const MAX_CANDIDATES = 400_000;

/** A seed from the page's crypto (the Ensayo's «otra tirada»). */
export function randomSeed(): bigint {
  const words = new Uint32Array(2);
  crypto.getRandomValues(words);
  return (BigInt(words[0]!) << 32n) | BigInt(words[1]!);
}

export async function fabricatePulls(o: FabricateOptions, base: bigint = randomSeed()): Promise<PulledGalaxy[]> {
  const out: PulledGalaxy[] = [];
  for (let i = 0; i < o.tiers.length; i++) {
    // Let the page paint between galaxies.
    await new Promise((r) => setTimeout(r, 0));
    const tier = o.tiers[i]!;
    const g = generateGalaxy(base + BigInt(i) * 7_919n, TIERS.indexOf(tier), undefined, MAX_CANDIDATES);
    const traits: Record<string, string> = { ...(g.traits as unknown as Record<string, string>) };
    if (o.phenomenon !== undefined && o.phenomenon !== null) traits['phenomenon'] = o.phenomenon;
    out.push({
      id: `ensayo-${base}-${i}`,
      seed: g.seed.toString(),
      tier,
      finish: o.finish ?? 'normal',
      traits,
      name: g.name,
      designation: g.designation,
      featured: o.featured?.includes(i) ?? false,
    });
  }
  return out;
}
