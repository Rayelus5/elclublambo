import type { PackArt } from '@galaxy/shared';

// The mailbox's gift parcel (GDD §16.5, DESIGN_SYSTEM §8 vicies): painted in Aseprite at 32×32 by
// `art/mail/paint-gift.lua` (editable layers in art/mail/gift.aseprite), exported as a horizontal strip of four frames
// that CSS plays with steps(4) at an integer scale: the ribbon's glint runs across and a spark blinks. The packs of the
// mail library (mail v2, P4) have five more arts in the same style, painted by `art/mail/paint-packs.lua`; the parcel is
// the «parcel» one.

/** The strips as served files, never inlined: they stay out of the bundle. */
const SHEETS = import.meta.glob<string>('./art/*.png', { eager: true, query: '?no-inline', import: 'default' });

export const giftUrl: string | undefined = SHEETS['./art/gift.png'];

/** A pack's art strip. */
export function packArtUrl(art: PackArt): string | undefined {
  return art === 'parcel' ? giftUrl : SHEETS[`./art/pack-${art}.png`];
}
