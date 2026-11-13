import { TIERS } from '@galaxy/shared';
import { afterEach, expect, test, vi } from 'vitest';
import { createBank, filesByName, pickFormat } from '../src/audio/bank';
import { holdMusic, musicPlaying, startMusic, stopMusic } from '../src/audio/music';
import { setSettings } from '../src/audio/mixer';
import { createScore } from '../src/audio/score';
import { foldTail, SCORE_LENGTH, writeLayer } from '../src/audio/stems-synth';
import { PRO_SOUNDS, type ProSound, TIER_FILE } from '../src/scanner/pro/cues';
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
  // No file of its own: a mythic plays the legendary's file when there is one (its own recipe otherwise).
  expect(file({ tier: 'mythic' })).toBe(`revelar-${TIER_FILE.legendary}`);
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
