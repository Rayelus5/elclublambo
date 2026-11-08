// The mailbox's gift parcel (GDD §16.5, DESIGN_SYSTEM §8 vicies): painted in Aseprite at 32×32 by
// `art/mail/paint-gift.lua` (editable layers in art/mail/gift.aseprite), exported as a horizontal strip of four frames
// that CSS plays with steps(4) at an integer scale: the ribbon's glint runs across and a spark blinks.

/** The strip as a served file, never inlined: it stays out of the bundle. */
const SHEETS = import.meta.glob<string>('./art/gift.png', { eager: true, query: '?no-inline', import: 'default' });

export const giftUrl: string | undefined = SHEETS['./art/gift.png'];
