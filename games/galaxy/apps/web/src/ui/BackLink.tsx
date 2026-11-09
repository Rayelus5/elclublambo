import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { copy } from '../copy/es';
import { Icon } from './Icon';
import { usePreviousStep } from './trail';

/** What «Volver» says for a destination: the screen's name, a player's page by its name, or plain «Volver». */
export function backLabel(href: string): string {
  const t = copy.backTo;
  const path = href.split(/[?#]/)[0] || '/';
  const named = t.screens[path] ?? t.screens[path.replace(/\/coleccion\/[^/]+$/, '/coleccion')];
  if (named) return named;
  const player = /^\/perfil\/([^/]+)(\/coleccion)?$/.exec(path);
  if (player) return player[2] ? t.collectionOf(decodeURIComponent(player[1]!)) : t.profile(decodeURIComponent(player[1]!));
  const visit = /^\/planetario\/([^/]+)$/.exec(path);
  if (visit) return t.planetariumOf(decodeURIComponent(visit[1]!));
  if (/^\/clanes\/[^/]+$/.test(path)) return t.clan;
  return t.generic;
}

/**
 * «Volver» (M6d-1): to the screen this visit came from (the trail), or to `fallback` when it came straight here by
 * address; `to` instead fixes it (a page that hangs from another always goes back to it: the room to the hangar).
 * It says where it leads (the owner's report: a «Volver al hangar» that went elsewhere). A link, so it keeps its href,
 * opens in a new tab and reads as a link.
 */
export function BackLink({ fallback = '/', to, className = 'lip pill', children }: { fallback?: string; to?: string; className?: string; children?: ReactNode }) {
  const previous = usePreviousStep();
  const href = to ?? previous?.href ?? fallback;
  return (
    <Link to={href} className={className} data-sfx="back">
      {children ?? (
        <>
          <Icon name="back" />
          <span>{backLabel(href)}</span>
        </>
      )}
    </Link>
  );
}

/** «Volver al inicio»: always the title screen, wherever the visit came from (the owner's report on M6d-1's «Volver»). */
export function HomeLink({ className = 'lip pill', children }: { className?: string; children: ReactNode }) {
  return (
    <Link to="/" className={className} data-sfx="back">
      {children}
    </Link>
  );
}
