import type { AccountSettings, SettingsView } from '@galaxy/shared';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { manualAim, onManualAim, setManualAim } from '../arena/settings';
import { type AudioSettings, getSettings, onSettings, setSettings } from '../audio/mixer';
import { CURSOR_COLORS, type CursorSettings, getCursor, onCursor, saveCursor } from '../ui/cursor';
import { getPrefs, type Prefs, setPrefs, subscribePrefs } from './prefs';

// The settings on the account (plan «ajustes en la cuenta»; the owner: «hay que guardar los ajustes también»). This
// browser keeps its copy, so a start looks right before the server answers; once signed in, the account's settings
// replace it (the account wins: every device the same), or, the first time, this browser's go up to the account. Each
// change after that is saved a moment later, all in one go; a failed save says so and goes again with the next change,
// the connection coming back, or a while later. Whatever the account sent is applied without being sent back. A
// change made before the account answers is the player's latest word: it wins and goes up.

export type SyncStatus = 'local' | 'saving' | 'saved' | 'offline';

const status = createStore<{ status: SyncStatus }>(() => ({ status: 'local' }));
const setStatus = (s: SyncStatus) => status.setState({ status: s });
export const getSyncStatus = (): SyncStatus => status.getState().status;
/** How the account's copy stands: kept, saving, or waiting for the connection. */
export const useSyncStatus = (): SyncStatus => useStore(status, (s) => s.status);

/** Everything Ajustes holds, as the account keeps it. */
export function snapshot(): AccountSettings {
  const p = getPrefs();
  const a = getSettings();
  const c = getCursor();
  return {
    v: 1,
    scannerPro: p.scannerPro,
    motion: p.motion,
    colorVision: p.colorVision,
    music: a.music,
    sfx: a.sfx,
    muted: a.muted,
    ui: a.ui,
    cursor: c.on,
    cursorSize: c.size,
    cursorColor: c.color,
    manualAim: manualAim(),
    notesSeen: p.notesSeen,
  };
}

/** Puts the account's settings in place (each store checks its own; a cursor colour the game lacks is left out). */
export function applyRemote(s: AccountSettings): void {
  const prefs: Partial<Prefs> = {};
  if (s.scannerPro !== undefined) prefs.scannerPro = s.scannerPro;
  if (s.motion !== undefined) prefs.motion = s.motion;
  if (s.colorVision !== undefined) prefs.colorVision = s.colorVision;
  if (s.notesSeen !== undefined) prefs.notesSeen = s.notesSeen;
  if (Object.keys(prefs).length > 0) setPrefs(prefs);

  const audio: Partial<AudioSettings> = {};
  if (s.music !== undefined) audio.music = s.music;
  if (s.sfx !== undefined) audio.sfx = s.sfx;
  if (s.muted !== undefined) audio.muted = s.muted;
  if (s.ui !== undefined) audio.ui = s.ui;
  if (Object.keys(audio).length > 0) setSettings(audio);

  const cursor: Partial<CursorSettings> = {};
  if (s.cursor !== undefined) cursor.on = s.cursor;
  if (s.cursorSize !== undefined) cursor.size = s.cursorSize;
  if (s.cursorColor !== undefined && CURSOR_COLORS.some((c) => c.hex === s.cursorColor)) cursor.color = s.cursorColor;
  if (Object.keys(cursor).length > 0) saveCursor(cursor);

  if (s.manualAim !== undefined && s.manualAim !== manualAim()) setManualAim(s.manualAim);
}

export interface SyncDeps {
  load: () => Promise<SettingsView>;
  save: (s: AccountSettings) => Promise<unknown>;
  /** How long after a change it is saved (ms). */
  delay?: number;
  /** How long before asking the account again after it did not answer (ms). */
  retry?: number;
}

/** Keeps this browser and the account in step while signed in; the returned function stops it. */
export function startSync(deps: SyncDeps): () => void {
  const delay = deps.delay ?? 800;
  const retry = deps.retry ?? 30_000;
  let stopped = false;
  let loaded = false;
  let dirty = false;
  let applying = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let again: ReturnType<typeof setTimeout> | null = null;

  const flush = async () => {
    timer = null;
    if (stopped) return;
    setStatus('saving');
    try {
      await deps.save(snapshot());
      if (!stopped && !timer) setStatus('saved');
    } catch {
      if (stopped) return;
      setStatus('offline');
      again ??= setTimeout(() => {
        again = null;
        schedule();
      }, retry);
    }
  };

  function schedule() {
    if (applying || stopped) return;
    if (!loaded) {
      dirty = true;
      return;
    }
    if (timer) clearTimeout(timer);
    setStatus('saving');
    timer = setTimeout(() => void flush(), delay);
  }

  const load = async () => {
    try {
      const view = await deps.load();
      if (stopped) return;
      loaded = true;
      if (view.settings && !dirty) {
        applying = true;
        try {
          applyRemote(view.settings);
        } finally {
          applying = false;
        }
        setStatus('saved');
      } else schedule();
    } catch {
      if (stopped) return;
      setStatus('offline');
      again ??= setTimeout(() => {
        again = null;
        void load();
      }, retry);
    }
  };

  const unsubscribe = [subscribePrefs(schedule), onSettings(schedule), onCursor(schedule), onManualAim(schedule)];
  const online = () => {
    if (!loaded) void load();
    else if (getSyncStatus() === 'offline') schedule();
  };
  window.addEventListener('online', online);
  void load();

  return () => {
    stopped = true;
    for (const off of unsubscribe) off();
    window.removeEventListener('online', online);
    if (again) clearTimeout(again);
    // A change still waiting goes now.
    if (timer) {
      clearTimeout(timer);
      void deps.save(snapshot()).catch(() => {});
    }
    timer = null;
    setStatus('local');
  };
}
