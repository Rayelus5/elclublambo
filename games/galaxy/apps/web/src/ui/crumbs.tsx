import type { ReactNode } from 'react';
import { Icon } from './Icon';

/**
 * A text that names a place in the menus («Ajustes › Incursión»): each « › » becomes a small arrow icon (the owner,
 * 2026-11-27: icons, never arrows as text). Screen readers hear «Ajustes, Incursión».
 */
export function withCrumbs(text: string): ReactNode {
  const parts = text.split(' › ');
  if (parts.length === 1) return text;
  return parts.flatMap((p, i) =>
    i === 0
      ? [p]
      : [
          <span key={`s${i}`} className="sr-only">
            ,{' '}
          </span>,
          <Icon key={`i${i}`} name="next" className="ico crumb-arrow" />,
          p,
        ],
  );
}
