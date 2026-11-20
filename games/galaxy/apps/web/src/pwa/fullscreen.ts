import { useSyncExternalStore } from 'react';

// Full screen from Ajustes › Pantalla (galaxysurvivor.es plan, PR 3). In full screen the browser takes Escape to leave
// it, so we ask for the keyboard lock on Escape (Chrome and Edge): a press reaches the game, which pauses the run, and
// holding it leaves full screen. Without the lock (Firefox), Escape leaves at once, and the arena pauses when full
// screen ends (ArenaScreen listens to fullscreenchange).

/** The keyboard lock (Chrome and Edge; not in the DOM types yet). */
type LockingNavigator = Navigator & { keyboard?: { lock?: (codes: string[]) => Promise<void>; unlock?: () => void } };

/** True when this browser lets the page go full screen. */
export function fullscreenAvailable(doc: Document = document): boolean {
  return doc.fullscreenEnabled === true && typeof doc.documentElement.requestFullscreen === 'function';
}

/** True while the page is in full screen. */
export function isFullscreen(doc: Document = document): boolean {
  return Boolean(doc.fullscreenElement);
}

/** Enters full screen (from a click: browsers ask for a gesture), then locks Escape for the game. Never throws. */
export async function enterFullscreen(doc: Document = document): Promise<void> {
  try {
    if (!doc.fullscreenElement) await doc.documentElement.requestFullscreen({ navigationUI: 'hide' });
    await (navigator as LockingNavigator).keyboard?.lock?.(['Escape']);
  } catch {
    // Refused (no gesture, a policy): nothing changes and the switch stays as the browser says.
  }
}

/** Leaves full screen and gives Escape back to the browser. Never throws. */
export async function exitFullscreen(doc: Document = document): Promise<void> {
  try {
    (navigator as LockingNavigator).keyboard?.unlock?.();
    if (doc.fullscreenElement) await doc.exitFullscreen();
  } catch {
    // Already out.
  }
}

function subscribe(listener: () => void): () => void {
  document.addEventListener('fullscreenchange', listener);
  return () => document.removeEventListener('fullscreenchange', listener);
}

/** Whether the page is in full screen now, kept current however it changes (the switch, Esc held, F11). */
export function useFullscreen(): boolean {
  return useSyncExternalStore(subscribe, () => isFullscreen(), () => false);
}
