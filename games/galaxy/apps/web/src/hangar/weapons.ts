// The starting weapons and their variants in the Hangar's cards (GDD §6, §17.5; DESIGN_SYSTEM §8 ter): 32×32 scenes of
// each weapon in action, painted in Aseprite by `art/weapons/paint-weapons.lua` (editable layers in
// art/weapons/*.aseprite), exported as strips of four frames that CSS plays with steps(); still with reduced motion.

export const WEAPON_FRAMES = 4;

/** The strips as served files, never inlined: only the cards in sight are fetched, and they stay out of the bundle. */
const SHEETS = import.meta.glob<string>('./weapons/*.png', { eager: true, query: '?no-inline', import: 'default' });

export function weaponArtUrl(id: string): string | undefined {
  return SHEETS[`./weapons/${id}.png`];
}
