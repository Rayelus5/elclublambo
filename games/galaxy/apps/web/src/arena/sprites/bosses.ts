import { dist, draw, inEllipse, lit } from './fauna2';
import { P } from './palette';
import type { SpriteDef } from './types';

// The Cores of the M3b-3 sectors (DESIGN_SYSTEM §8 quater), 40×40 like «La Colmena Rota» and drawn by rule. Each has
// a silhouette of its own and something that pulses between its two frames.

const C: [number, number] = [0.5, 0.5];
const N = 40;
const M = 19.5;
const angle = (x: number, y: number) => (Math.atan2(y + 0.5 - M, x + 0.5 - M) + Math.PI * 2) % (Math.PI * 2);
const near = (a: number, b: number, width: number) => Math.abs(((a - b + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < width;

/** La Madre Glaciar: a crown of ice spires around a frozen heart that flares. */
const glacier = (f: number) =>
  draw(N, N, (x, y) => {
    const d = dist(x, y, M, M);
    const a = angle(x, y);
    const spire = [0, 1, 2, 3, 4, 5].some((k) => near(a, (k * Math.PI) / 3 - Math.PI / 2, 0.42 * (1 - d / 19)));
    if (d > 18.4 || (d > 11.5 && !spire)) return '.';
    if (d <= (f === 0 ? 3 : 4.2)) return d < 1.6 ? 'w' : 'c';
    if (d <= 5.5) return 'b';
    if (spire && d > 11.5) return lit(x, y, M, M, 14, ['w', 'i', 'd']);
    // Facets: darker every other wedge.
    const facet = Math.floor((a + Math.PI / 6) / (Math.PI / 3)) % 2 === 0;
    return lit(x, y, M, M, 10, facet ? ['w', 'i', 'b'] : ['i', 'b', 'D']);
  });

/** La Anémona Rey: a coral crown with twelve swaying arms around a mouth that glows green. */
const anemone = (f: number) =>
  draw(N, N, (x, y) => {
    const d = dist(x, y, M, M);
    const a = angle(x, y);
    if (d <= 3.6) return d < 2 ? 'g' : 'z';
    if (d <= 11) return d < 5 ? 'G' : lit(x, y, M, M, 9, ['q', 'n', 'e']);
    if (d > 18.4) return '.';
    const sway = Math.sin(d / 2.2 + f * Math.PI) * 0.16;
    for (let k = 0; k < 12; k++) {
      const ray = (k * Math.PI) / 6 + sway;
      if (near(a, ray, 0.13 + 0.05 * (1 - (d - 11) / 8))) return k % 2 === 0 ? (d > 16 ? 'w' : 'q') : d > 16 ? 'g' : 'U';
    }
    return '.';
  });

/** El Yunque: an anvil of the old forge, its waist split open on molten metal that throbs. */
const anvil = (f: number) =>
  draw(N, N, (x, y) => {
    const top = y >= 8 && y <= 15 && x >= 4 && x <= 36 && !(x < 10 && y > 8 + (10 - x)) && !(x > 33 && y < 8 + (x - 33));
    const horn = y >= 9 && y <= 12 && x >= 1 && x < 4;
    const waist = y > 15 && y <= 26 && x >= 13 && x <= 26;
    const base = y > 26 && y <= 33 && x >= 7 && x <= 32;
    if (!top && !horn && !waist && !base) return '.';
    if (waist) {
      const core = Math.abs(x + 0.5 - M) <= (f === 0 ? 2.2 : 3.4) - Math.abs(y - 21) * 0.2;
      if (core) return Math.abs(x + 0.5 - M) < 1 ? 'w' : 's';
      if (Math.abs(x + 0.5 - M) <= 4.2) return 'o';
    }
    if (top && (x === 14 || x === 25) && y === 11) return 'm';
    if (top && y === 8) return 'w';
    return lit(x, y, M, 18, 16, ['Y', 'T', 't']);
  });

/** El Eco Profundo: a dark sphere ringed by broken bands of signal around one bright eye. */
const echoCore = (f: number) =>
  draw(N, N, (x, y) => {
    const d = dist(x, y, M, M);
    const a = angle(x, y);
    if (d >= 16.6 && d <= 18.2) {
      // Broken rings: arcs that turn between frames.
      const turn = f === 0 ? 0 : Math.PI / 6;
      return Math.floor(((a + turn) / (Math.PI * 2)) * 9) % 3 === 2 ? '.' : 'c';
    }
    if (d > 15) return '.';
    if (inEllipse(x, y, M, M, 1.1, 3.6)) return 'k';
    if (d <= 5) return d <= 3.5 ? 'w' : 'c';
    if (Math.abs(d - 10) < 0.5) return 'u';
    return lit(x, y, M, M, 12, ['a', 'p', 'z']);
  });

/** La Señal: a broadcasting diamond with an antenna; its rings of signal widen between frames. */
const signal = (f: number) =>
  draw(N, N, (x, y) => {
    if (x >= 19 && x <= 20 && y >= 2 && y <= 9) return y <= 3 ? (f === 0 ? 'c' : 'w') : 'Y';
    const dd = Math.abs(x + 0.5 - M) + Math.abs(y + 0.5 - 22);
    if (dd <= 10) {
      if (dd <= 3) return f === 0 ? 'c' : 'w';
      if (dd <= 4) return 'v';
      return lit(x, y, M, 22, 8, ['v', 'V', 'p']);
    }
    const d = dist(x, y, M, 22);
    const rings = f === 0 ? [13, 17] : [14.5, 18.5];
    if (y < 34 && rings.some((r) => Math.abs(d - r) < 0.55) && Math.abs(x + 0.5 - M) > 3) return 'c';
    return '.';
  });

const core = (fn: (f: number) => string[], fps: number): SpriteDef => ({ w: N, h: N, fps, anchor: C, palette: P, frames: [fn(0), fn(1)] });

export const BOSSES: Record<string, SpriteDef> = {
  glacier: core(glacier, 2),
  anemone: core(anemone, 3),
  anvil: core(anvil, 2),
  'echo-core': core(echoCore, 2),
  signal: core(signal, 3),
};
