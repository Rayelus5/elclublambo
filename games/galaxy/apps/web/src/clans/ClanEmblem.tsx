import type { ClanColor, ClanEmblem as Emblem } from '@galaxy/shared';
import type { CSSProperties } from 'react';
import { clanEmblemOffset, clanEmblemUrl } from './emblems';

/** A clan's emblem: the 32×32 Aseprite strip at ×1 or ×2, its colour picked along the strip; decorative. */
export function ClanEmblem({ emblem, color, scale = 2 }: { emblem: Emblem; color: ClanColor; scale?: 1 | 2 }) {
  const url = clanEmblemUrl(emblem);
  return (
    <span
      className="clan-emblem"
      aria-hidden="true"
      style={{ '--size': `${32 * scale}px`, backgroundPositionX: clanEmblemOffset(color), ...(url ? { backgroundImage: `url(${url})` } : {}) } as CSSProperties}
    />
  );
}
