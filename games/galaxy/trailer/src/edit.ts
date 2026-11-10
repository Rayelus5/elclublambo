// The edit, bar by bar on the music (tools/beats.py: 87.5 BPM, a bar is 2.74 s). Each shot: its bars, the recorded
// clip and where in it (seconds), the camera move, and the caption. The clips are the real game recorded at 60 fps
// (capture/*.capture.tsx); KEY marks the moments the edit hangs on.

export interface Shot {
  from: number;
  to: number;
  clip: string;
  start: number;
  rate?: number;
  zoom?: [number, number];
  pan?: [number, number, number, number];
  punch?: boolean;
  cap?: [string, string?];
  capAt?: 'low' | 'mid' | 'high';
  capSize?: number;
  capSide?: 'center' | 'left';
  flash?: string;
  dim?: number;
}

/** Moments inside the clips (seconds), read off their contact sheets. */
export const KEY = {
  cardsShown: 0.75,
  cardPicked: 2.55,
  bossFalls: 7.75,
  extracted: 8.05,
  refineryOpen: 3.25,
  scanStart: 0.85,
  epic: 22.1,
  // In scanner-end (the last 12 s of the same ten-pull scan): the legendary's flash and the full summary.
  legendary: 4.2,
  summary: 7.5,
};

export const SHOTS: Shot[] = [
  // Incursions.
  { from: 3, to: 5, clip: 'horde', start: 0.4, zoom: [1.0, 1.12], cap: ['SOBREVIVE A', 'LA ESTÁTICA'], flash: '#ffffff' },
  { from: 5, to: 7, clip: 'horde', start: 3.6, zoom: [1.28, 1.12], cap: ['MUÉVETE', 'TU SONDA DISPARA SOLA'], capSize: 100 },
  { from: 7, to: 9, clip: 'horde', start: 7.2, zoom: [1.0, 1.06], punch: true, cap: ['CIENTOS DE', 'ENEMIGOS'], flash: '#ffffff' },
  { from: 9, to: 10, clip: 'cards', start: KEY.cardsShown - 0.4, zoom: [1.05, 1.16], cap: ['SUBE DE NIVEL', 'ELIGE MEJORAS'] },
  { from: 10, to: 11, clip: 'cards', start: KEY.cardPicked - 0.3, zoom: [1.12, 1.0], punch: true, cap: ['EVOLUCIONA', 'TUS ARMAS'] },
  { from: 11, to: 12, clip: 'lobby', start: 0.8, zoom: [1.6, 1.72], pan: [0, -8, 0, -8], cap: ['8 SONDAS', 'DIFERENTES'] },
  { from: 12, to: 13, clip: 'lobby', start: 5.1, zoom: [1.8, 1.86], pan: [-38, 6, -42, 6], cap: ['5 SECTORES', 'CON SU NÚCLEO'], capAt: 'mid', capSide: 'left', capSize: 108 },
  { from: 13, to: 14, clip: 'lobby', start: 2.0, zoom: [1.7, 1.8], pan: [12, -34, 10, -39], cap: ['EQUIPA GALAXIAS', 'COMO RELIQUIAS'], capAt: 'high', capSize: 104 },
  { from: 14, to: 16, clip: 'boss', start: 0.2, zoom: [1.0, 1.14], punch: true, cap: ['DERROTA', 'AL NÚCLEO'], flash: '#ff6b7a' },
  { from: 16, to: 17, clip: 'boss', start: KEY.bossFalls - 0.6, rate: 0.6, zoom: [1.18, 1.3], flash: '#ffffff' },
  { from: 17, to: 19, clip: 'extract', start: 2.7, zoom: [1.05, 1.22], cap: ['EXTRAE', 'ANTES DE MORIR'] },
  // The station.
  { from: 19, to: 21, clip: 'station', start: 0.2, zoom: [1.0, 1.08], cap: ['GESTIONA', 'TU ESTACIÓN'], flash: '#45e3a6' },
  { from: 21, to: 22, clip: 'station', start: KEY.refineryOpen, zoom: [1.4, 1.5], pan: [19, 2, 23, 2], cap: ['MEJORA', 'SUS SALAS'], capAt: 'mid', capSide: 'left', capSize: 112 },
  { from: 22, to: 23, clip: 'lab', start: 0.2, zoom: [1.0, 1.12], cap: ['MEJORAS', 'PERMANENTES'] },
  // The scanner.
  { from: 23, to: 25, clip: 'scanner', start: KEY.scanStart - 0.6, zoom: [1.0, 1.12], cap: ['CONSIGUE', 'NUEVAS GALAXIAS'], flash: '#bfe3ff' },
  // Rarer and rarer: common, uncommon, rare, epic; then the legendary builds up and lands on the bar.
  { from: 25, to: 25.5, clip: 'scanner', start: 7.7, zoom: [1.3, 1.36], punch: true },
  { from: 25.5, to: 26, clip: 'scanner', start: 4.8, zoom: [1.3, 1.36], punch: true },
  { from: 26, to: 26.5, clip: 'scanner', start: 11.6, zoom: [1.3, 1.36], punch: true },
  { from: 26.5, to: 27, clip: 'scanner', start: KEY.epic - 0.15, zoom: [1.3, 1.36], punch: true },
  { from: 27, to: 28, clip: 'scanner-end', start: KEY.legendary - 2.74, zoom: [1.2, 1.35] },
  { from: 28, to: 29, clip: 'scanner-end', start: KEY.legendary, zoom: [1.4, 1.3], punch: true, flash: '#ffc94a', cap: ['LEGENDARIA'], capAt: 'low', capSize: 130 },
  { from: 29, to: 31, clip: 'inspector', start: 0.4, zoom: [1.55, 1.75], cap: ['+18 TRILLONES', 'DE DISEÑOS DIFERENTES'], capSize: 96 },
  { from: 31, to: 33, clip: 'collection', start: 0.6, zoom: [1.0, 1.1], cap: ['COLECCIÓNALAS', 'Y FUSIÓNALAS'] },
  { from: 33, to: 35, clip: 'event', start: 0.3, zoom: [1.0, 1.08], cap: ['EVENTOS', 'CON ESCÁNER PROPIO'], flash: '#9b86ff' },
  { from: 35, to: 36, clip: 'event', start: 2.4, zoom: [1.7, 1.8], pan: [35, -35, 38, -38], cap: ['GALAXIAS DESTACADAS', 'POR TIEMPO LIMITADO'], capAt: 'high', capSize: 100 },
  // Together.
  { from: 36, to: 39, clip: 'coop', start: 0.4, zoom: [1.0, 1.16], cap: ['JUEGA EN GRUPO', 'HASTA 4 SONDAS'], flash: '#bfe3ff' },
];

/** The climax (bars 39–47): a cut every two beats, a word on every other bar. */
const CLIMAX_CLIPS: [string, number, [number, number]][] = [
  ['horde', 1.6, [1.1, 1.2]],
  ['boss', 2.2, [1.15, 1.25]],
  ['horde', 9.0, [1.3, 1.2]],
  ['coop', 4.0, [1.1, 1.2]],
  ['extract', 2.2, [1.2, 1.35]],
  ['boss', 5.0, [1.0, 1.15]],
  ['horde', 5.5, [1.25, 1.35]],
  ['cards', KEY.cardPicked + 0.2, [1.1, 1.2]],
  ['scanner-end', KEY.legendary + 0.1, [1.35, 1.45]],
  ['inspector', 0.3, [1.6, 1.7]],
  ['scanner-end', KEY.summary, [1.1, 1.2]],
  ['collection', 3.0, [1.15, 1.25]],
  ['coop', 7.0, [1.2, 1.3]],
  ['horde', 8.3, [1.1, 1.25]],
  ['boss', KEY.bossFalls - 0.3, [1.2, 1.35]],
  ['coop', 9.5, [1.0, 1.15]],
  ['horde', 0.2, [1.35, 1.2]],
  ['extract', KEY.extracted, [1.1, 1.25]],
];
CLIMAX_CLIPS.forEach(([clip, start, zoom], i) => SHOTS.push({ from: 39 + i * 0.5, to: 39.5 + i * 0.5, clip, start, zoom, punch: true }));

export const WORDS: { bar: number; word: string; color?: string }[] = [
  { bar: 39, word: 'SOBREVIVE' },
  { bar: 41, word: 'EXTRAE', color: '#45e3a6' },
  { bar: 43, word: 'ESCANEA', color: '#ffc94a' },
  { bar: 45, word: 'COLECCIONA', color: '#9b86ff' },
  { bar: 47, word: 'REPITE', color: '#ff6b7a' },
];
