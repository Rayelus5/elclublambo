import { ENGINE_VERSION } from '@galaxy/engine';
import type { GeneratedGalaxy } from '@galaxy/shared';

// A new galaxy's row (mail v2, 2026-11-16): the fields every maker writes the same way — the scanner, a fusion, an
// admin's grant and a gift — so a change to how a galaxy is stored is made once. Each keeps its own insert (and what it
// returns).

export function galaxyValues(g: GeneratedGalaxy, o: { owner: string; tier: number; finish: string; origin: 'pull' | 'fusion' | 'grant'; featured?: boolean; season?: string | null; lineage?: string[] }) {
  return {
    owner_id: o.owner,
    seed: g.seed.toString(),
    engine_version: ENGINE_VERSION,
    traits: JSON.stringify(g.traits),
    dna: g.dna,
    name: g.name,
    designation: g.designation,
    tier: o.tier,
    score: g.score,
    finish: o.finish,
    origin: o.origin,
    ...(o.featured === undefined ? {} : { featured: o.featured }),
    ...(o.season === undefined ? {} : { season: o.season }),
    ...(o.lineage === undefined ? {} : { lineage: o.lineage }),
  };
}
