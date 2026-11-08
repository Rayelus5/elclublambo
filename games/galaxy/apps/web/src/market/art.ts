// The market's trading post (GDD §14.6, DESIGN_SYSTEM §8 quattuordecies): painted in Aseprite at 256×48 by
// `art/market/paint-market.lua` (editable layers in art/market/post.aseprite), exported as a horizontal strip of four
// frames that CSS plays with steps(4) at an integer scale: the holographic cards bob and turn, the lamps chase.

/** The strip as a served file, never inlined: it stays out of the bundle. */
const SHEETS = import.meta.glob<string>('./art/post.png', { eager: true, query: '?no-inline', import: 'default' });

export const postUrl: string | undefined = SHEETS['./art/post.png'];
