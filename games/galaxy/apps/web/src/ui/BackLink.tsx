import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { usePreviousStep } from './trail';

/**
 * «Volver» (M6d-1): to the screen this visit came from (the trail), or to `fallback` when it came straight here by
 * address. A link, so it keeps its href, opens in a new tab and reads as a link.
 */
export function BackLink({ fallback, className = 'lip pill', children }: { fallback: string; className?: string; children: ReactNode }) {
  const previous = usePreviousStep();
  return (
    <Link to={previous?.href ?? fallback} className={className}>
      {children}
    </Link>
  );
}
