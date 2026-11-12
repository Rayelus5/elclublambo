import { getPrefs, subscribePrefs } from '../settings/prefs';
import { pickFormat } from './bank';
import { audioBus, getSettings, onSettings } from './mixer';
import { createEngine, type EngineState, type MusicEngine, type MusicScene, type StingerKind } from './music/engine';
import { type MusicChoice, musicLibrary, type MusicLibrary } from './music/files';
import { MUSIC_STYLES } from './music/styles';

// The game's music (GDD §17.4; plan «banda sonora», part A): the generative soundtrack (audio/music/) behind a small
// facade the screens use. The menu plays its playlist; a run sets its scene several times a second (sector, intensity,
// Núcleo, a level-up choice, the pause); the end of a run plays its stinger and the results' piece. The style comes from
// Ajustes (prefs.musicStyle, on the account), and «Mi música» from the owner's files when there are any. The pro
// scanner's own music holds the game's while it plays.

export type { MusicScene, StingerKind } from './music/engine';

const FOUND = import.meta.glob('../assets/audio/musica/**/*.{ogg,m4a}', { query: '?no-inline', import: 'default', eager: true }) as Record<string, string>;

function canPlay(type: string): string {
  try {
    return document.createElement('audio').canPlayType(type);
  } catch {
    return '';
  }
}

let library: MusicLibrary | null = null;
/** The owner's music files there are (built in, so known before anything plays). */
export function musicFiles(): MusicLibrary {
  library ??= musicLibrary(FOUND, pickFormat(canPlay));
  return library;
}

/** The styles a player can pick: the generated ones, and «Mi música» when it has files. */
export function musicChoices(): MusicChoice[] {
  return musicFiles().hasOwn ? [...MUSIC_STYLES, 'own'] : [...MUSIC_STYLES];
}

/** The chosen style, or the default one where the choice is not available (a style still to come, no own files). */
function choiceNow(): MusicChoice {
  const c = getPrefs().musicStyle as MusicChoice;
  return musicChoices().includes(c) ? c : 'ambient';
}

let engine: MusicEngine | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let scene: MusicScene = { kind: 'menu' };

function sessionSeed(): number {
  try {
    return crypto.getRandomValues(new Uint32Array(1))[0]!;
  } catch {
    return 1;
  }
}

function ensure(): MusicEngine | null {
  if (engine) return engine;
  const b = audioBus();
  if (!b) return null;
  engine = createEngine(b.ctx, b.music, { seed: sessionSeed(), choice: choiceNow(), library: musicFiles() });
  return engine;
}

/** The pro scanner's own music is playing (plan «escáner pro», part B): the game's waits for it to end. */
let held = false;
let resumeAfterHold = false;

/** Starts the music (after a gesture) or keeps it going; harmless to call again. */
export function startMusic(): void {
  if (held || timer || getSettings().music <= 0) return;
  const e = ensure();
  if (!e) return;
  e.setScene(scene);
  e.start();
  e.tick();
  timer = setInterval(() => e.tick(), 25);
}

/** Fades the music out and stops scheduling. */
export function stopMusic(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
  engine?.stop();
}

/**
 * Silences the game's music while another plays (the pro scanner's), and brings it back after if it was playing.
 * Unlike duckMusic it stops it, so the two never sound together.
 */
export function holdMusic(on: boolean): void {
  if (on === held) return;
  if (on) {
    resumeAfterHold = timer !== null;
    stopMusic();
    held = true;
  } else {
    held = false;
    if (resumeAfterHold) startMusic();
    resumeAfterHold = false;
  }
}

/** What is going on, for the music: the menu, a run (and how it goes), the results. */
export function setMusicScene(next: MusicScene): void {
  scene = next;
  engine?.setScene(next);
}

/** A short phrase in the piece's key: extraction, death, a new layer. */
export function musicStinger(kind: StingerKind): void {
  engine?.stinger(kind);
}

/** What is playing (the music Ensayo). */
export function musicState(): EngineState | null {
  return engine?.state() ?? null;
}

export function musicPlaying(): boolean {
  return timer !== null;
}

// Turning the music down to zero stops it; turning it up again waits for the next start.
onSettings((s) => {
  if (s.music <= 0 || s.muted) stopMusic();
});
// A new style plays from the next bar.
subscribePrefs(() => engine?.setChoice(choiceNow()));
// A hidden tab runs its timers once a second: the music schedules further ahead so it never stutters there.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => engine?.setLookahead(document.hidden ? 1.4 : 0.15));
}
