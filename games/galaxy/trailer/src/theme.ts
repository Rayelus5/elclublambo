import beats from './beats.json';

// The game's palette and type (apps/web/src/styles/app.css), and the music's grid (tools/beats.py).

export const FPS = 60;
export const C = {
  void: '#05061a',
  night: '#0b0d26',
  outline: '#15163f',
  ink: '#eef0ff',
  solar: '#ffc94a',
  nova: '#ff6b7a',
  novaLip: '#a83448',
  uv: '#7259ee',
  uvSoft: '#9b86ff',
  ice: '#bfe3ff',
  terminal: '#45e3a6',
};
export const DISPLAY = "'Bungee', sans-serif";
export const SANS = "'Fredoka', system-ui, sans-serif";
export const BRAILLE_BRAND = '⠛⠁⠇⠁⠭⠽ ⠎⠥⠗⠧⠊⠧⠕⠗';
/** Where to play (one place to change it). */
export const PLAY_URL = 'pre.elclub.party/galaxy';

export const MUSIC_SECONDS = beats.duration;
/** Seconds at bar `b` (4 beats a bar), from the music's first beat. */
export const sec = (bar: number) => beats.phase + bar * 4 * beats.beat;
/** Frame at bar `b`. */
export const fr = (bar: number) => Math.round(sec(bar) * FPS);
export const BEAT_FRAMES = beats.beat * FPS;
