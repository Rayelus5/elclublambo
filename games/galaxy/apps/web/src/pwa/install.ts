import { useSyncExternalStore } from 'react';

// Installing the game as an app (galaxysurvivor.es plan, PR 3; Chromium browsers, and help for the others below). The browser offers it with
// `beforeinstallprompt`: we keep that offer, without the browser's own banner, so Ajustes › Pantalla and the pill at
// the foot of the title screen can open it from the game's own button. `appinstalled` says it went in, and the
// `standalone` display mode says we are already playing in the installed window.

/** The event Chrome and Edge fire when the page can be installed (not in the DOM types yet). */
interface InstallOffer extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export interface InstallState {
  /** The browser's offer is here: the game's «Instalar» can open it. */
  canPrompt: boolean;
  /** Playing in the installed app's own window. */
  standalone: boolean;
  /** Installed during this visit. */
  installed: boolean;
}

const INITIAL: InstallState = { canPrompt: false, standalone: false, installed: false };
let offer: InstallOffer | null = null;
let state: InstallState = INITIAL;
const listeners = new Set<() => void>();

function set(next: Partial<InstallState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

/** Starts listening (main.tsx, before the first paint: the offer can come early). Returns the stop. */
export function watchInstall(win: Window = window): () => void {
  const onOffer = (e: Event) => {
    e.preventDefault();
    offer = e as InstallOffer;
    set({ canPrompt: true });
  };
  const onInstalled = () => {
    offer = null;
    set({ canPrompt: false, installed: true });
  };
  let mode: MediaQueryList | null = null;
  try {
    mode = typeof win.matchMedia === 'function' ? win.matchMedia('(display-mode: standalone)') : null;
  } catch {
    mode = null;
  }
  const onMode = () => set({ standalone: mode?.matches === true });
  onMode();
  win.addEventListener('beforeinstallprompt', onOffer);
  win.addEventListener('appinstalled', onInstalled);
  mode?.addEventListener?.('change', onMode);
  return () => {
    win.removeEventListener('beforeinstallprompt', onOffer);
    win.removeEventListener('appinstalled', onInstalled);
    mode?.removeEventListener?.('change', onMode);
  };
}

/** Opens the browser's install dialog. An offer is good for one prompt: after it, the button goes until another comes. */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const current = offer;
  if (!current) return 'unavailable';
  offer = null;
  set({ canPrompt: false });
  try {
    await current.prompt();
    return (await current.userChoice).outcome;
  } catch {
    return 'dismissed';
  }
}

/** The install state now (outside React). */
export function getInstall(): InstallState {
  return state;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The install state, kept current. */
export function useInstall(): InstallState {
  return useSyncExternalStore(subscribe, getInstall, getInstall);
}

/** Tests: back to nothing offered. */
export function resetInstall(): void {
  offer = null;
  set(INITIAL);
}

/**
 * How this browser installs a page (the owner, 2026-11-18). Only Chromium fires `beforeinstallprompt`, so the game's own
 * button only works there (Chrome, Edge, Brave, Vivaldi). Firefox on Windows has its own address-bar icon (Firefox 143
 * on), Safari on the Mac «Añadir al Dock», and Opera (GX too) no install at all, though it is Chromium.
 */
export type InstallBrowser = 'chromium' | 'opera' | 'firefox' | 'firefox-elsewhere' | 'safari' | 'other';

/** The browser, by its user agent, for the install help in Ajustes. */
export function installBrowser(ua: string = typeof navigator === 'undefined' ? '' : navigator.userAgent): InstallBrowser {
  if (/\bOPR(GX)?\//.test(ua)) return 'opera';
  if (/\bFirefox\//.test(ua)) return /Windows NT/.test(ua) ? 'firefox' : 'firefox-elsewhere';
  if (/\b(Chrome|Chromium|Edg)\//.test(ua)) return 'chromium';
  if (/Macintosh/.test(ua) && /\bSafari\//.test(ua)) return 'safari';
  return 'other';
}

/** True when this page offers the app at all: the server only links the manifest on the game's own host. */
export function installable(doc: Document = document): boolean {
  return doc.querySelector('link[rel="manifest"]') !== null;
}
