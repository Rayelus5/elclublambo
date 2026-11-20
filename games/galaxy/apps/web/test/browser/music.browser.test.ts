import { afterAll, expect, test } from 'vitest';
import { commands } from 'vitest/browser';
import { COMPOSITIONS } from '../../src/audio/music/compositions';
import { createEngine, type MusicScene } from '../../src/audio/music/engine';
import { MUSIC_STYLES, type MusicStyleId } from '../../src/audio/music/styles';

// The soundtrack rendered for real (plan «banda sonora», part A): every piece in every style, through the whole chain
// (instruments, reverb, echo, compressor), for a few seconds offline. None is silent, none clips, and they all sit near
// one loudness, so moving from the menu to a sector or a Núcleo never jumps out. VITE_MUSIC_WAV=1 also writes each one
// to apps/web/test/browser/__shots__/musica-<estilo>-<pieza>.wav to listen to.

const SECONDS = 7;
const RATE = 22_050;
const levels: { name: string; rms: number }[] = [];

function sceneFor(group: string, biome?: string): MusicScene {
  if (group === 'menu') return { kind: 'menu' };
  if (group === 'results') return { kind: 'results' };
  return { kind: 'run', biome: (biome ?? 'nebula') as 'nebula', boss: group === 'boss' ? { deep: false, form: 1 } : null, intensity: 2, choosing: false, paused: false };
}

function wav(buffer: AudioBuffer): string {
  const ch = buffer.numberOfChannels;
  const len = buffer.length;
  const data = new DataView(new ArrayBuffer(44 + len * ch * 2));
  const text = (o: number, s: string) => [...s].forEach((c, i) => data.setUint8(o + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  data.setUint32(4, 36 + len * ch * 2, true);
  text(8, 'WAVEfmt ');
  data.setUint32(16, 16, true);
  data.setUint16(20, 1, true);
  data.setUint16(22, ch, true);
  data.setUint32(24, buffer.sampleRate, true);
  data.setUint32(28, buffer.sampleRate * ch * 2, true);
  data.setUint16(32, ch * 2, true);
  data.setUint16(34, 16, true);
  text(36, 'data');
  data.setUint32(40, len * ch * 2, true);
  const chans = Array.from({ length: ch }, (_, c) => buffer.getChannelData(c));
  for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++) data.setInt16(44 + (i * ch + c) * 2, Math.max(-1, Math.min(1, chans[c]![i]!)) * 32767, true);
  let s = '';
  const bytes = new Uint8Array(data.buffer);
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

for (const style of MUSIC_STYLES) {
  for (const comp of COMPOSITIONS) {
    test(`${style}: «${comp.name}» suena, sin saturar`, async () => {
      const ctx = new OfflineAudioContext(2, SECONDS * RATE, RATE);
      const out = ctx.createGain();
      out.connect(ctx.destination);
      const engine = createEngine(ctx, out, { seed: 3, choice: style as MusicStyleId, lookahead: SECONDS, voiceCap: 10_000 });
      engine.setScene(sceneFor(comp.group, comp.biome));
      engine.direct({ piece: comp.id, intensity: comp.group === 'boss' ? 3 : 2 });
      engine.start();
      engine.tick();
      const buffer = await ctx.startRendering();
      let peak = 0;
      let sum = 0;
      let n = 0;
      for (let c = 0; c < buffer.numberOfChannels; c++) {
        const d = buffer.getChannelData(c);
        for (let i = 0; i < d.length; i++) {
          peak = Math.max(peak, Math.abs(d[i]!));
          // The loudness after the fade-in.
          if (i > RATE * 2) {
            sum += d[i]! * d[i]!;
            n++;
          }
        }
      }
      const rms = Math.sqrt(sum / n);
      levels.push({ name: `${style}/${comp.id}`, rms });
      expect(rms, comp.id).toBeGreaterThan(0.01);
      expect(peak, comp.id).toBeLessThan(0.98);
      if (import.meta.env['VITE_MUSIC_WAV']) await commands.writeFile(`apps/web/test/browser/__shots__/musica-${style}-${comp.id}.wav`, wav(buffer), 'base64');
    }, 60_000);
  }
}

afterAll(() => {
  // Every piece within ±4 dB of the middle one (the owner: «que no molesten»: nothing jumps out).
  const sorted = [...levels].sort((a, b) => a.rms - b.rms);
  const mid = sorted[Math.floor(sorted.length / 2)]!.rms;
  const off = levels.filter((l) => Math.abs(20 * Math.log10(l.rms / mid)) > 4).map((l) => `${l.name} ${(20 * Math.log10(l.rms / mid)).toFixed(1)} dB`);
  expect(off, off.join(', ')).toEqual([]);
});
