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
// change after that is saved a moment later, all in one go and one save at a time; a failed save says so and goes
// again with the next change, the connection coming back, or a while later. Whatever the account sent is applied
// without being sent back. A setting the player changes before the account answers is their latest word: that one
// wins and goes up, the rest come from the account. The last release note seen only ever moves forward.

export type SyncStatus = 'local' | 'saving' | 'saved' | 'offline';

const status = createStore<{ status: SyncStatus; ready: boolean }>(() => ({ status: 'local', ready: true }));
const setStatus = (s: SyncStatus) => status.setState({ status: s });
const setReady = (ready: boolean) => status.setState({ ready });
export const getSyncStatus = (): SyncStatus => status.getState().status;
/** How the account's copy stands: kept, saving, or waiting for the connection. */
export const useSyncStatus = (): SyncStatus => useStore(status, (s) => s.status);
/** False only while a sync waits for the account's first answer (its settings may still change what is shown). */
export const getSyncReady = (): boolean => status.getState().ready;
export const useSyncReady = (): boolean => useStore(status, (s) => s.ready);

/** The later of two release-note versions (1.10 after 1.9); null only when both are. */
export function laterNote(a: string | null | undefined, b: string | null | undefined): string | null {
  if (!a) return b ?? null;
  if (!b) return a;
  const [am = 0, an = 0] = a.split('.').map(Number);
  const [bm = 0, bn = 0] = b.split('.').map(Number);
  return (am - bm || an - bn) < 0 ? b : a;
}

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
    musicStyle: p.musicStyle,
  };
}

/** Puts the account's settings in place (each store checks its own; a cursor colour the game lacks is left out). */
export function applyRemote(s: AccountSettings): void {
  const prefs: Partial<Prefs> = {};
  if (s.scannerPro !== undefined) prefs.scannerPro = s.scannerPro;
  if (s.motion !== undefined) prefs.motion = s.motion;
  if (s.colorVision !== undefined) prefs.colorVision = s.colorVision;
  if (s.musicStyle !== undefined) prefs.musicStyle = s.musicStyle;
  // Seen only moves forward: an older value from the account never brings «Nuevo» back.
  if (s.notesSeen !== undefined) {
    const later = laterNote(getPrefs().notesSeen, s.notesSeen);
    if (later !== getPrefs().notesSeen) prefs.notesSeen = later;
  }
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

type Key = Exclude<keyof AccountSettings, 'v'>;

/** Keeps this browser and the account in step while signed in; the returned function stops it. */
export function startSync(deps: SyncDeps): () => void {
  const delay = deps.delay ?? 800;
  const retry = deps.retry ?? 30_000;
  // What this browser had when the sync started: a setting that differs when the account answers was the player's.
  const baseline = snapshot();
  let stopped = false;
  let loaded = false;
  let loading = false;
  let applying = false;
  let saving = false;
  let again = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let loadRetry: ReturnType<typeof setTimeout> | null = null;
  let saveRetry: ReturnType<typeof setTimeout> | null = null;
  setReady(false);

  const flush = async () => {
    timer = null;
    if (stopped) return;
    // One save at a time: a change during one goes right after it, with everything as it is then.
    if (saving) {
      again = true;
      return;
    }
    saving = true;
    setStatus('saving');
    try {
      await deps.save(snapshot());
      if (stopped) return;
      if (!again && !timer) setStatus('saved');
    } catch {
      if (stopped) return;
      setStatus('offline');
      saveRetry ??= setTimeout(() => {
        saveRetry = null;
        schedule();
      }, retry);
    } finally {
      saving = false;
      if (again && !stopped) {
        again = false;
        timer ??= setTimeout(() => void flush(), 0);
      }
    }
  };

  function schedule() {
    if (applying || stopped || !loaded) return;
    if (timer) clearTimeout(timer);
    setStatus('saving');
    timer = setTimeout(() => void flush(), delay);
  }

  const load = async () => {
    if (loading || loaded || stopped) return;
    loading = true;
    try {
      const view = await deps.load();
      if (stopped) return;
      loaded = true;
      if (loadRetry) clearTimeout(loadRetry);
      loadRetry = null;
      if (!view.settings) {
        schedule();
        return;
      }
      // The account's settings, but for those the player changed while it answered (and seen, the later of both).
      const local = snapshot();
      const merged: AccountSettings = { ...view.settings };
      let mine = false;
      for (const k of Object.keys(local) as Key[]) {
        if (k === 'notesSeen') continue;
        if (local[k] !== baseline[k]) {
          (merged as Record<Key, unknown>)[k] = local[k];
          mine = true;
        }
      }
      merged.notesSeen = laterNote(local.notesSeen, view.settings.notesSeen);
      applying = true;
      try {
        applyRemote(merged);
      } finally {
        applying = false;
      }
      if (mine || merged.notesSeen !== (view.settings.notesSeen ?? null)) schedule();
      else setStatus('saved');
    } catch {
      if (stopped) return;
      setStatus('offline');
      loadRetry ??= setTimeout(() => {
        loadRetry = null;
        void load();
      }, retry);
    } finally {
      loading = false;
      if (!stopped) setReady(true);
    }
  };

  const unsubscribe = [subscribePrefs(schedule), onSettings(schedule), onCursor(schedule), onManualAim(schedule)];
  const online = () => {
    if (!loaded) {
      if (loadRetry) clearTimeout(loadRetry);
      loadRetry = null;
      void load();
    } else if (getSyncStatus() === 'offline') {
      if (saveRetry) clearTimeout(saveRetry);
      saveRetry = null;
      schedule();
    }
  };
  window.addEventListener('online', online);
  void load();

  return () => {
    stopped = true;
    for (const off of unsubscribe) off();
    window.removeEventListener('online', online);
    if (loadRetry) clearTimeout(loadRetry);
    if (saveRetry) clearTimeout(saveRetry);
    // A change still waiting goes now.
    if (timer) {
      clearTimeout(timer);
      void deps.save(snapshot()).catch(() => {});
    }
    timer = null;
    setStatus('local');
    setReady(true);
  };
}
