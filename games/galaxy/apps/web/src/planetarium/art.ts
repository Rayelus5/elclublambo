// The planetarium's dome (GDD §10.5, DESIGN_SYSTEM §8 decies): painted in Aseprite at 192×96 by
// `art/planetarium/paint-planetarium.lua` (editable layers in art/planetarium/dome.aseprite), exported as a horizontal
// strip of eight frames that CSS plays with steps(8): the projector turns, the stars travel across the dome and the
// rim lamps chase. The six exhibited cards stand over its pedestals.

export const DOME = {
  width: 192,
  height: 96,
  frames: 8,
  /** The pedestals' centres, in art pixels, left to right. */
  pedestals: [18, 46, 74, 118, 146, 174],
  /** Where the pedestals' tops are, in art pixels. */
  pedestalTop: 84,
} as const;

/** The strip as a served file, never inlined: it stays out of the bundle. */
const SHEETS = import.meta.glob<string>('./art/dome.png', { eager: true, query: '?no-inline', import: 'default' });

export const domeUrl: string | undefined = SHEETS['./art/dome.png'];
