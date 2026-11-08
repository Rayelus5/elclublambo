import { CLAN_COLORS, type ClanColor, type ClanEmblem } from '@galaxy/shared';

// The clans' emblems (GDD §14.3, DESIGN_SYSTEM §8 duodecies): painted in Aseprite at 32×32 by
// `art/clans/paint-emblems.lua` (editable layers in art/clans/*.aseprite), each a strip of its six colours in
// CLAN_COLORS order; the colour is a background-position along the strip.

/** The strips as served files, never inlined: they stay out of the bundle. */
const SHEETS = import.meta.glob<string>('./emblems/*.png', { eager: true, query: '?no-inline', import: 'default' });

export function clanEmblemUrl(emblem: ClanEmblem): string | undefined {
  return SHEETS[`./emblems/${emblem}.png`];
}

/** The colour's place along the strip, as a background-position-x percentage (0 % is the first, 100 % the last). */
export function clanEmblemOffset(color: ClanColor): string {
  return `${(CLAN_COLORS.indexOf(color) * 100) / (CLAN_COLORS.length - 1)}%`;
}
