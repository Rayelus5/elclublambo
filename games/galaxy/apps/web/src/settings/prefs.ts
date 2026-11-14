import { type MusicStyleChoice, SETTINGS_COLOR_VISIONS, SETTINGS_MOTIONS, SETTINGS_MUSIC_STYLES } from '@galaxy/shared';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { CSS_TOKENS, cssTokens } from '../a11y/color-vision';

// The game's own preferences (plan «escáner pro», part A): the pro scanner, motion and colour vision, and the last
// release note seen. They live in this browser under one versioned key, like the rest of the settings, are checked on
// the way in (a hand-edited or older value falls back to the usual one) and keep working in memory when storage is
// blocked (private windows). The audio, the cursor and the aiming keep their own keys (audio/mixer.ts, ui/cursor.ts,
// arena/settings.ts). Signed in, all of them are also kept on the account (settings/sync.ts).

export const MOTIONS = SETTINGS_MOTIONS;
export type Motion = (typeof MOTIONS)[number];
export const COLOR_VISIONS = SETTINGS_COLOR_VISIONS;
export type ColorVision = (typeof COLOR_VISIONS)[number];

export interface Prefs {
  /** The cinematic scanner reveal (on by default: the owner, 2026-11-12). */
  scannerPro: boolean;
  /** «Sistema» follows the operating system's reduced-motion setting; the other two override it. */
  motion: Motion;
  /** The colour-blind palettes (part C). */
  colorVision: ColorVision;
  /** The highest «Notas de versión» opened (`1.4`), or none yet. */
  notesSeen: string | null;
  /** The soundtrack's style (plan «banda sonora»): Ambiente espacial by default. */
  musicStyle: MusicStyleChoice;
  /** A soft white glow behind my probe in the runs, to tell it from the background (the owner; off by default). */
  probeGlow: boolean;
  /** Which chats tell me with a notice while I do not have them open (the owner, 2026-11-14: clan, room and mentions). */
  chatNotify: ChatNotify;
}

export interface ChatNotify {
  global: boolean;
  clan: boolean;
  room: boolean;
  mentions: boolean;
}
export const CHAT_NOTIFY_KEYS = ['clan', 'room', 'mentions', 'global'] as const satisfies readonly (keyof ChatNotify)[];
const DEFAULT_CHAT_NOTIFY: ChatNotify = Object.freeze({ global: false, clan: true, room: true, mentions: true });

export const DEFAULT_PREFS: Readonly<Prefs> = Object.freeze({ scannerPro: true, motion: 'system', colorVision: 'none', notesSeen: null, musicStyle: 'ambient', probeGlow: false, chatNotify: DEFAULT_CHAT_NOTIFY });
const NOTE_VERSION = /^\d{1,3}\.\d{1,3}$/;

const KEY = 'galaxy.prefs';
const VERSION = 1;
const QUERY = '(prefers-reduced-motion: reduce)';

const oneOf = <T extends string>(list: readonly T[], v: unknown, fallback: T): T => (list.includes(v as T) ? (v as T) : fallback);

function sanitize(raw: unknown): Prefs {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    scannerPro: typeof r['scannerPro'] === 'boolean' ? r['scannerPro'] : DEFAULT_PREFS.scannerPro,
    motion: oneOf(MOTIONS, r['motion'], DEFAULT_PREFS.motion),
    colorVision: oneOf(COLOR_VISIONS, r['colorVision'], DEFAULT_PREFS.colorVision),
    notesSeen: typeof r['notesSeen'] === 'string' && NOTE_VERSION.test(r['notesSeen']) ? r['notesSeen'] : null,
    musicStyle: oneOf(SETTINGS_MUSIC_STYLES, r['musicStyle'], DEFAULT_PREFS.musicStyle),
    probeGlow: typeof r['probeGlow'] === 'boolean' ? r['probeGlow'] : DEFAULT_PREFS.probeGlow,
    chatNotify: chatNotifyOf(r['chatNotify']),
  };
}

function chatNotifyOf(raw: unknown): ChatNotify {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const one = (k: keyof ChatNotify) => (typeof r[k] === 'boolean' ? (r[k] as boolean) : DEFAULT_CHAT_NOTIFY[k]);
  return { global: one('global'), clan: one('clan'), room: one('room'), mentions: one('mentions') };
}

/** What this browser has kept (version 1 is the first; a later one would be migrated here). */
export function readStoredPrefs(): Prefs {
  try {
    const text = localStorage.getItem(KEY);
    if (!text) return { ...DEFAULT_PREFS };
    const saved = JSON.parse(text) as { state?: unknown; version?: unknown } | null;
    return sanitize(saved?.state);
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

function write(p: Prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ state: p, version: VERSION }));
  } catch {
    // Private windows: the choice lasts until the tab closes.
  }
}

const store = createStore<Prefs>(() => readStoredPrefs());

export const getPrefs = (): Prefs => store.getState();
export const subscribePrefs = (fn: (p: Prefs) => void): (() => void) => store.subscribe(fn);

export function setPrefs(patch: Partial<Prefs>) {
  const next = sanitize({ ...store.getState(), ...patch });
  store.setState(next, true);
  write(next);
}

/** Back to the usual values in memory (tests; storage is left as it is). */
export function resetPrefs() {
  store.setState({ ...DEFAULT_PREFS }, true);
}

export function usePrefs<T>(selector: (p: Prefs) => T): T {
  return useStore(store, selector);
}

/** Whether the operating system asks for less motion (false without matchMedia: old browsers, tests). */
export function systemReduced(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia(QUERY).matches;
  } catch {
    return false;
  }
}

export const reducedFor = (motion: Motion, os: boolean): boolean => motion === 'reduced' || (motion === 'system' && os);

/** Reduced motion right now, for code outside React (the stage, the backdrop, the entrance). */
export function prefersReduced(): boolean {
  return reducedFor(getPrefs().motion, systemReduced());
}

/** Keeps <html data-motion data-cvd> in step with the preferences and the system; the CSS reads both. */
export function applyPrefs(root: HTMLElement = document.documentElement): () => void {
  let painted: string | null = null;
  const paint = () => {
    root.dataset['motion'] = prefersReduced() ? 'reduced' : 'full';
    const mode = getPrefs().colorVision;
    root.dataset['cvd'] = mode;
    // The colour-blind palette replaces the meaningful tokens on <html> (CSSOM, allowed by the CSP); «Normal» clears
    // them, so the design's own come back.
    if (painted === mode) return;
    painted = mode;
    const tokens = cssTokens(mode);
    for (const name of CSS_TOKENS) {
      if (tokens?.[name]) root.style.setProperty(name, tokens[name]);
      else root.style.removeProperty(name);
    }
  };
  paint();
  const unsubscribe = store.subscribe(paint);
  let media: MediaQueryList | null = null;
  try {
    media = typeof matchMedia === 'function' ? matchMedia(QUERY) : null;
  } catch {
    media = null;
  }
  media?.addEventListener?.('change', paint);
  return () => {
    unsubscribe();
    media?.removeEventListener?.('change', paint);
  };
}
