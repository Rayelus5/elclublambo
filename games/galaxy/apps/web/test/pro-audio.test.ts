import { TIERS } from '@galaxy/shared';
import { afterEach, expect, test, vi } from 'vitest';
import { createBank, filesByName, pickFormat } from '../src/audio/bank';
import { holdMusic, musicPlaying, startMusic, stopMusic } from '../src/audio/music';
import { setSettings } from '../src/audio/mixer';
import { createScore } from '../src/audio/score';
import { foldTail, resetStems, SCORE_BARS, SCORE_LENGTH, writeLayer } from '../src/audio/stems-synth';
import { PRO_SOUNDS, type ProSound, TIER_FILE } from '../src/scanner/pro/cues';
import { resetMythicStem, writeMythicLayer } from '../src/scanner/pro/mythic-stem';
import { MUSIC_FILES, proStems } from '../src/scanner/pro/sounds';
import { FakeAudioContext, FakeBuffer, fakeContext } from './fake-audio';

// The pro scanner's sound (plan «escáner pro», part B): every moment has a synthesised sound, scheduled on the audio
// clock; a file with its name replaces it (and one that fails to load keeps the synthesised one); the music is four
// layers of one loop that start together and cross-fade by the rarest card seen; the game's own music waits.

afterEach(() => {
  vi.unstubAllGlobals();
  stopMusic();
  holdMusic(false);
});

test('los archivos se encuentran por su nombre y el formato se elige según el navegador', () => {
  const files = filesByName({
    '/src/assets/audio/escaner/impacto.ogg': '/galaxy/assets/impacto-a1.ogg',
    '/src/assets/audio/escaner/impacto.m4a': '/galaxy/assets/impacto-b2.m4a',
    '/src/assets/audio/escaner/revelar-rara.ogg': '/galaxy/assets/revelar-rara-c3.ogg',
    '/src/assets/audio/escaner/LEEME.md': '/x',
  });
  expect(files).toEqual({
    impacto: { ogg: '/galaxy/assets/impacto-a1.ogg', m4a: '/galaxy/assets/impacto-b2.m4a' },
    'revelar-rara': { ogg: '/galaxy/assets/revelar-rara-c3.ogg' },
  });
  expect(pickFormat((t) => (t.includes('opus') ? 'probably' : ''))).toBe('ogg');
  expect(pickFormat(() => '')).toBe('m4a');
});

test('sin archivos suena la receta sintetizada, en su momento', () => {
  const ctx = fakeContext();
  const bank = createBank(ctx, PRO_SOUNDS, {});
  bank.play('impacto', 3, ctx.destination as unknown as AudioNode, { tier: 'epic' });
  expect(ctx.started.length).toBeGreaterThan(0);
  expect(ctx.started.every((s) => s.at >= 3)).toBe(true);
  expect(bank.fromFile('impacto', {})).toBe(false);
});

test('con archivo, se descarga una vez, se decodifica y suena él; si falla, sigue la receta', async () => {
  const ctx = fakeContext();
  const fetch = vi.fn(async (url: string) => (url.includes('roto') ? new Response(null, { status: 500 }) : new Response(new ArrayBuffer(16))));
  const bank = createBank(ctx, PRO_SOUNDS, { impacto: { ogg: '/a/impacto.ogg' }, 'revelar-rara': { ogg: '/a/roto.ogg' } }, { format: 'ogg', fetch: fetch as unknown as typeof globalThis.fetch });
  await bank.preload(['impacto', 'revelar'], [{ tier: 'rare' }]);
  await bank.preload(['impacto']);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(bank.fromFile('impacto', {})).toBe(true);
  expect(bank.fromFile('revelar', { tier: 'rare' })).toBe(false);
  ctx.started.length = 0;
  bank.play('impacto', 2, ctx.destination as unknown as AudioNode, {});
  expect(ctx.started).toEqual([expect.objectContaining({ kind: 'buffer', at: 2 })]);
  ctx.started.length = 0;
  bank.play('revelar', 2, ctx.destination as unknown as AudioNode, { tier: 'rare' });
  expect(ctx.started.every((s) => s.kind === 'osc')).toBe(true);
});

test('cada sonido del guion tiene receta y nombre de archivo, y nunca suena antes de su momento', () => {
  const sounds = Object.keys(PRO_SOUNDS) as ProSound[];
  expect(sounds).toEqual(expect.arrayContaining(['cierre', 'latido', 'salto', 'ascenso', 'meteoro', 'impacto', 'impacto-grande', 'reparto', 'giro', 'revelar', 'sello', 'fanfarria', 'fenomeno', 'destacada', 'acabado', 'resumen']));
  for (const id of sounds) {
    for (const tier of TIERS) {
      const ctx = fakeContext();
      expect(() => PRO_SOUNDS[id].synth(ctx, ctx.destination as unknown as AudioNode, 5, { tier, dur: 2 })).not.toThrow();
      expect(ctx.started.length).toBeGreaterThan(0);
      expect(ctx.started.every((s) => s.at >= 5)).toBe(true);
    }
  }
  const file = PRO_SOUNDS.revelar.file as (o: { tier: 'legendary' | 'mythic' }) => string;
  expect(file({ tier: 'legendary' })).toBe(`revelar-${TIER_FILE.legendary}`);
  // Plan «rareza Mítica» M2: a mythic has its own chord, so its own file name (never the legendary's file).
  expect(file({ tier: 'mythic' })).toBe('revelar-mitica');
});

/** The frequency each oscillator starts on, for every oscillator `f` creates on a fake context. */
function notesOf(f: (ctx: ReturnType<typeof fakeContext>) => void): { hz: number; at: number }[] {
  const ctx = fakeContext();
  const params: { moves: { value: number; at: number }[] }[] = [];
  const make = ctx.createOscillator.bind(ctx);
  ctx.createOscillator = (() => {
    const o = make();
    params.push(o.frequency);
    return o;
  }) as never;
  f(ctx);
  return params.map((p) => ({ hz: p.moves[0]!.value, at: p.moves[0]!.at }));
}
const pitchClass = (hz: number) => (((Math.round(12 * Math.log2(hz / 440) + 69) % 12) + 12) % 12);

test('la cara de una mítica suena su propio acorde, no el arpegio de la legendaria', () => {
  const play = (tier: 'legendary' | 'mythic') => notesOf((ctx) => PRO_SOUNDS.revelar.synth(ctx, ctx.destination as unknown as AudioNode, 2, { tier })).map((n) => n.hz);
  const legendary = play('legendary');
  const mythic = play('mythic');
  // The legendary's arpeggio, as it was: its six notes and their soft octaves.
  expect(legendary).toEqual([392, 784, 493.88, 987.76, 587.33, 1174.66, 739.99, 1479.98, 880, 1760, 1174.66, 2349.32]);
  expect(Math.min(...mythic)).toBeLessThan(150);
  expect(mythic.some((hz) => pitchClass(hz) === 1)).toBe(true);
  expect(legendary.some((hz) => pitchClass(hz) === 1)).toBe(false);
  expect(mythic.length).toBeGreaterThan(legendary.length);
  // The summary's softer chord is the mythic's own too.
  const summary = notesOf((ctx) => PRO_SOUNDS.resumen.synth(ctx, ctx.destination as unknown as AudioNode, 2, { tier: 'mythic' })).map((n) => n.hz);
  expect(summary.some((hz) => pitchClass(hz) === 1)).toBe(true);
});

test('la música de la mítica: una quinta capa que solo entra con una mítica', () => {
  const ctx = fakeContext();
  const layers = [0, 1, 2, 3, 4].map(() => new FakeBuffer(2, 100, 8000) as unknown as AudioBuffer);
  const score = createScore(ctx, ctx.destination as unknown as AudioNode, layers);
  score.start(1);
  expect(ctx.started.filter((s) => s.kind === 'buffer')).toHaveLength(5);
  const gains = ctx.gains.slice(0, 5);
  const lastLinear = (g: (typeof gains)[number]) => g.gain.moves.filter((m) => m.kind === 'linear').at(-1)?.value ?? 0;
  score.level(3, 4);
  expect(lastLinear(gains[3]!)).toBe(1);
  expect(lastLinear(gains[4]!)).toBe(0);
  score.level(4, 6);
  expect(lastLinear(gains[4]!)).toBe(1);
});

test('el silencio de una mítica agacha la música y la devuelve, sin tocar las capas', () => {
  const ctx = fakeContext();
  const layers = [0, 1, 2, 3, 4].map(() => new FakeBuffer(2, 100, 8000) as unknown as AudioBuffer);
  const score = createScore(ctx, ctx.destination as unknown as AudioNode, layers);
  score.start(0);
  const master = ctx.gains[5]!;
  score.duck(3, 0.7, 0.2);
  const ramps = master.gain.moves.filter((m) => m.kind === 'linear');
  expect(ramps[0]).toMatchObject({ value: 0.2 });
  expect(ramps[0]!.at).toBeGreaterThan(3);
  expect(ramps[0]!.at).toBeLessThanOrEqual(3.3);
  expect(ramps.at(-1)).toMatchObject({ value: 1 });
  expect(ramps.at(-1)!.at).toBeGreaterThanOrEqual(3.7);
  expect(ramps.at(-1)!.at).toBeLessThan(4.2);
  score.unduck(3.2);
  expect(master.gain.moves.at(-1)).toMatchObject({ kind: 'linear', value: 1 });
  expect(master.gain.moves.at(-1)!.at).toBeLessThan(3.6);
});

test('la capa de la mítica se escribe dentro del bucle y solo con notas de los acordes que ya suenan en cada compás', () => {
  const bar = SCORE_LENGTH / SCORE_BARS;
  const others = [...notesOf((ctx) => writeLayer(ctx, ctx.destination as unknown as AudioNode, 0)), ...notesOf((ctx) => writeLayer(ctx, ctx.destination as unknown as AudioNode, 1))].filter((n) => n.hz > 150);
  const mythic = notesOf((ctx) => writeMythicLayer(ctx, ctx.destination as unknown as AudioNode));
  expect(mythic.length).toBeGreaterThan(20);
  expect(Math.max(...mythic.map((n) => n.at))).toBeLessThan(SCORE_LENGTH);
  for (const n of mythic) {
    const b = Math.floor((n.at + 1e-6) / bar);
    const chord = new Set(others.filter((o) => Math.floor((o.at + 1e-6) / bar) === b).map((o) => pitchClass(o.hz)));
    expect(chord.has(pitchClass(n.hz))).toBe(true);
  }
});

test('sin archivos, la música trae cinco capas sincronizadas: las cuatro y la de la mítica, del mismo largo', async () => {
  class FakeOffline extends FakeAudioContext {
    constructor(
      readonly channels: number,
      readonly length: number,
      rate: number,
    ) {
      super();
      this.sampleRate = rate;
    }
    startRendering = async () => new FakeBuffer(this.channels, this.length, this.sampleRate);
  }
  vi.stubGlobal('OfflineAudioContext', FakeOffline);
  resetStems();
  resetMythicStem();
  const layers = await proStems(fakeContext());
  expect(layers).toHaveLength(5);
  expect(new Set(layers!.map((l) => l.length)).size).toBe(1);
  expect(MUSIC_FILES).toHaveLength(4);
  resetStems();
  resetMythicStem();
});

test('la música: las cuatro capas arrancan a la vez y entran según la rareza más alta vista', () => {
  const ctx = fakeContext();
  const layers = [0, 1, 2, 3].map(() => new FakeBuffer(2, 100, 8000) as unknown as AudioBuffer);
  const score = createScore(ctx, ctx.destination as unknown as AudioNode, layers);
  score.start(1);
  const starts = ctx.started.filter((s) => s.kind === 'buffer');
  expect(starts).toHaveLength(4);
  expect(new Set(starts.map((s) => s.at))).toEqual(new Set([1]));
  const gains = ctx.gains.slice(0, 4);
  const last = (g: (typeof gains)[number]) => g.gain.moves.at(-1)!;
  expect(last(gains[0]!).value).toBe(1);
  score.level(2, 4);
  expect(last(gains[1]!)).toMatchObject({ kind: 'linear', value: 1 });
  expect(last(gains[2]!)).toMatchObject({ kind: 'linear', value: 1 });
  expect(gains[3]!.gain.moves.filter((m) => m.kind === 'linear').at(-1)?.value ?? 0).toBe(0);
  score.stop(9);
  for (const g of gains) expect(last(g).value).toBe(0);
});

test('el bucle de la música no tiene costura: lo que suena después del final vuelve al principio', () => {
  const rendered = new FakeBuffer(1, 10, 8000);
  rendered.getChannelData(0).set([1, 1, 1, 1, 1, 1, 0.5, 0.25, 0, 0]);
  const loop = foldTail(rendered as unknown as AudioBuffer, 6, (c, l, r) => new FakeBuffer(c, l, r) as unknown as AudioBuffer);
  expect([...loop.getChannelData(0)]).toEqual([1.5, 1.25, 1, 1, 1, 1]);
  // The four layers write their notes inside the loop (an echo may start just past the end: it folds back) on any context.
  const ctx = fakeContext();
  for (const layer of [0, 1, 2, 3] as const) expect(() => writeLayer(ctx, ctx.destination as unknown as AudioNode, layer)).not.toThrow();
  expect(Math.max(...ctx.started.map((s) => s.at))).toBeLessThan(SCORE_LENGTH + 0.5);
});

test('la música del juego espera a la del escáner y vuelve después si sonaba', () => {
  vi.stubGlobal('AudioContext', FakeAudioContext);
  setSettings({ music: 0.5, muted: false });
  startMusic();
  expect(musicPlaying()).toBe(true);
  holdMusic(true);
  expect(musicPlaying()).toBe(false);
  startMusic();
  expect(musicPlaying()).toBe(false);
  holdMusic(false);
  expect(musicPlaying()).toBe(true);
});
