import type { SeasonTier } from '@galaxy/shared';

// The season tiers' emblems (GDD §13.1, DESIGN_SYSTEM §8 undecies): painted in Aseprite at 32×32 by
// `art/seasons/paint-tiers.lua` (editable layers in art/seasons/*.aseprite), exported as strips of four frames that
// CSS plays with steps(4): a shine sweeps each emblem, and the higher tiers twinkle (Estelar's galaxy turns).

export const TIER_FRAMES = 4;

/** The strips as served files, never inlined: they stay out of the bundle. */
const SHEETS = import.meta.glob<string>('./tiers/*.png', { eager: true, query: '?no-inline', import: 'default' });

export function tierArtUrl(tier: SeasonTier): string | undefined {
  return SHEETS[`./tiers/${tier}.png`];
}
