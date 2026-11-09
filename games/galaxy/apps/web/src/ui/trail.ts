import { useEffect, useSyncExternalStore } from 'react';
import { useLocation } from 'react-router';

// The trail of screens this visit went through (M6d-1, the owner's request), so «Volver» leads to the real previous
// screen — Hogar, then Escáner profundo, then Volver is the Hogar again — and not always to the title. A card's detail
// dialog (/coleccion/:id) counts as its collection, so opening and closing it never becomes a step back. The trail lives
// for the visit (a reload starts a new one, and «Volver» goes where it always went).

export type Step = { screen: string; href: string };

/** The screen a path belongs to: its own path, except a card's detail, which is its collection. */
export function screenOf(pathname: string): string {
  return /^\/coleccion\/[^/]+$/.test(pathname) ? '/coleccion' : pathname;
}

/** Whether `screen` hangs below `parent` by its address (/incursion/grupo below /incursion; everything below /). */
function below(screen: string, parent: string): boolean {
  return parent === '/' ? screen !== '/' : screen.startsWith(`${parent}/`);
}

/**
 * The trail after arriving at `screen` (at `href`): the same screen updates its address; the one before means going
 * back (it is dropped back to); anything else is a new step. A screen met further back cuts the trail there. Going up
 * to the screen a page hangs from (the group page's «Volver al hangar») is going back too, even if the visit started
 * below it (a reload): the pages below it at the end of the trail are dropped, so the parent's own «Volver» never
 * leads down again.
 */
export function nextTrail(trail: Step[], screen: string, href: string): Step[] {
  if (trail.at(-1)?.screen === screen) return [...trail.slice(0, -1), { screen, href }];
  const at = trail.findIndex((s) => s.screen === screen);
  if (at >= 0) return [...trail.slice(0, at), { screen, href }];
  let end = trail.length;
  while (end > 0 && below(trail[end - 1]!.screen, screen)) end--;
  return [...trail.slice(0, end), { screen, href }].slice(-30);
}

let trail: Step[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function resetTrail(): void {
  trail = [];
  emit();
}

/** The step before this screen, if this visit came from one. */
export function usePreviousStep(): Step | undefined {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => trail.at(-2),
  );
}

/** Keeps the trail as the address changes; rendered once, inside the router. */
export function TrailTracker(): null {
  const location = useLocation();
  useEffect(() => {
    trail = nextTrail(trail, screenOf(location.pathname), `${location.pathname}${location.search}`);
    emit();
  }, [location.pathname, location.search]);
  return null;
}
