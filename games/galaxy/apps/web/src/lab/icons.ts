// The Laboratorio's node icons (GDD §10.6, §17.5; DESIGN_SYSTEM §8 octies): 24×24 pictures of each node's effect,
// painted in Aseprite by `art/lab/paint-lab.lua` (editable layers in art/lab/*.aseprite), exported as strips of two
// frames of glow that CSS plays with steps(); still with reduced motion.

export const LAB_ICON_FRAMES = 2;

/** The strips as served files, never inlined: only the ones in sight are fetched, and they stay out of the bundle. */
const SHEETS = import.meta.glob<string>('./icons/*.png', { eager: true, query: '?no-inline', import: 'default' });

export function labIconUrl(id: string): string | undefined {
  return SHEETS[`./icons/${id}.png`];
}
