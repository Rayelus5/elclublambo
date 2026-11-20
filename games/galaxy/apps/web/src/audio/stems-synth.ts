// The scanner's own music, synthesised (plan «escáner pro», part B; the owner: «una música tranquila y adictiva de
// fondo que no se hace pesada al repetir y que cambia según la rareza»). Four layers of one calm loop — the same tempo,
// the same eight bars — rendered once with an OfflineAudioContext into buffers that loop sample-exact:
//   0 base: a slow warm pad and a soft sub pulse (always);
//   1 rare: a plucked arpeggio with a little echo;
//   2 epic: a choir-like pad and soft toms;
//   3 legendary: bells and a full, gentle kit.
// Dmaj9 → Bm9 → Gmaj9 → A6/9 twice at 72 bpm (about 27 s). What rings past the end is folded back onto the start, so
// the loop has no seam. Files named musica-base/rara/epica/legendaria (src/assets/audio/escaner) replace them.

export const SCORE_BPM = 72;
export const SCORE_BARS = 8;
const BEAT = 60 / SCORE_BPM;
const BAR = BEAT * 4;
export const SCORE_LENGTH = BAR * SCORE_BARS;
/** What rings past the loop's end and is folded back onto its start. */
const TAIL = 3;

// Roots (MIDI) and chord shapes (semitones) of the four chords.
const PROGRESSION: { root: number; shape: number[] }[] = [
  { root: 50, shape: [0, 4, 7, 11, 14] }, // Dmaj9
  { root: 47, shape: [0, 3, 7, 10, 14] }, // Bm9
  { root: 43, shape: [0, 4, 7, 11, 14] }, // Gmaj9
  { root: 45, shape: [0, 4, 7, 9, 14] }, // A6/9
];
const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

type Ctx = BaseAudioContext;

function voice(ctx: Ctx, out: AudioNode, type: OscillatorType, freq: number, at: number, dur: number, peak: number, attack: number, release: number, detune = 0) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, at);
  o.detune.setValueAtTime(detune, at);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.linearRampToValueAtTime(peak, at + attack);
  g.gain.setValueAtTime(peak, at + Math.max(attack, dur - release));
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(out);
  o.start(at);
  o.stop(at + dur + 0.05);
}

function pluck(ctx: Ctx, out: AudioNode, freq: number, at: number, peak: number, decay: number) {
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(freq, at);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.linearRampToValueAtTime(peak, at + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, at + decay);
  o.connect(g).connect(out);
  o.start(at);
  o.stop(at + decay + 0.05);
}

let noiseBuffer: WeakMap<Ctx, AudioBuffer> = new WeakMap();
function noise(ctx: Ctx): AudioBuffer {
  let b = noiseBuffer.get(ctx);
  if (!b) {
    b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate);
    const d = b.getChannelData(0);
    let s = 11;
    for (let i = 0; i < d.length; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      d[i] = (s / 0x7fffffff) * 2 - 1;
    }
    noiseBuffer.set(ctx, b);
  }
  return b;
}

function drum(ctx: Ctx, out: AudioNode, at: number, kind: 'kick' | 'tom' | 'hat' | 'snare', peak: number) {
  if (kind === 'kick' || kind === 'tom') {
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(kind === 'kick' ? 120 : 140, at);
    o.frequency.exponentialRampToValueAtTime(kind === 'kick' ? 44 : 78, at + (kind === 'kick' ? 0.14 : 0.25));
    const g = ctx.createGain();
    g.gain.setValueAtTime(peak, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + (kind === 'kick' ? 0.3 : 0.45));
    o.connect(g).connect(out);
    o.start(at);
    o.stop(at + 0.5);
    return;
  }
  const src = ctx.createBufferSource();
  src.buffer = noise(ctx);
  const f = ctx.createBiquadFilter();
  f.type = kind === 'hat' ? 'highpass' : 'bandpass';
  f.frequency.value = kind === 'hat' ? 7500 : 1700;
  const g = ctx.createGain();
  const dur = kind === 'hat' ? 0.05 : 0.18;
  g.gain.setValueAtTime(peak, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src.connect(f).connect(g).connect(out);
  src.start(at);
  src.stop(at + dur + 0.02);
}

/** Writes one layer's notes into `ctx` (time 0 = the loop's start). */
export function writeLayer(ctx: Ctx, out: AudioNode, layer: 0 | 1 | 2 | 3) {
  for (let bar = 0; bar < SCORE_BARS; bar++) {
    const { root, shape } = PROGRESSION[bar % PROGRESSION.length]!;
    const t = bar * BAR;
    if (layer === 0) {
      // The pad: four chord tones, two detuned voices each, swelling slowly and ringing into the next bar.
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1500;
      lp.connect(out);
      for (const n of [0, shape[1]!, shape[2]!, shape[3]!]) {
        voice(ctx, lp, 'triangle', hz(root + 12 + n), t, BAR + 1.4, 0.032, 1.1, 1.6, -5);
        voice(ctx, lp, 'triangle', hz(root + 12 + n), t, BAR + 1.4, 0.032, 1.1, 1.6, 5);
      }
      // The sub: the root, softly, on one and three.
      for (const beat of [0, 2]) voice(ctx, out, 'sine', hz(root - 12), t + beat * BEAT, BEAT * 1.6, 0.11, 0.03, 1.2);
    } else if (layer === 1) {
      // The arpeggio: eighths over the chord, two octaves up, each echoed a dotted eighth later.
      const order = [0, 2, 1, 3, 4, 3, 2, 1];
      for (let i = 0; i < 8; i++) {
        const n = shape[order[i]!]!;
        const at = t + i * (BEAT / 2);
        pluck(ctx, out, hz(root + 24 + n), at, 0.05, 0.42);
        pluck(ctx, out, hz(root + 24 + n), at + BEAT * 0.75, 0.018, 0.36);
      }
    } else if (layer === 2) {
      // The choir: a soft saw pad an octave up, through a dark filter; toms on two and four.
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 950;
      lp.Q.value = 1.5;
      lp.connect(out);
      for (const n of [0, shape[2]!, shape[4]!]) {
        voice(ctx, lp, 'sawtooth', hz(root + 24 + n), t, BAR + 1, 0.016, 1.4, 1.4, -7);
        voice(ctx, lp, 'sawtooth', hz(root + 24 + n), t, BAR + 1, 0.016, 1.4, 1.4, 7);
      }
      for (const beat of [1, 3]) drum(ctx, out, t + beat * BEAT, 'tom', 0.14);
      if (bar % 2 === 1) drum(ctx, out, t + 3.5 * BEAT, 'tom', 0.08);
    } else {
      // The bells (a fundamental and two bright partials) and a gentle full kit.
      for (const beat of [0, 2]) {
        const f = hz(root + 36 + shape[(bar + beat) % shape.length]!);
        pluck(ctx, out, f, t + beat * BEAT, 0.035, 2.4);
        pluck(ctx, out, f * 2.76, t + beat * BEAT, 0.012, 1.4);
        pluck(ctx, out, f * 5.4, t + beat * BEAT, 0.005, 0.8);
      }
      for (let beat = 0; beat < 4; beat++) {
        if (beat % 2 === 0) drum(ctx, out, t + beat * BEAT, 'kick', 0.32);
        else drum(ctx, out, t + beat * BEAT, 'snare', 0.11);
        drum(ctx, out, t + beat * BEAT + BEAT / 2, 'hat', 0.05);
      }
    }
  }
}

/** Folds what rang past `length` frames back onto the start, so the buffer loops with no seam. */
export function foldTail(rendered: AudioBuffer, length: number, make: (channels: number, length: number, rate: number) => AudioBuffer): AudioBuffer {
  const out = make(rendered.numberOfChannels, length, rendered.sampleRate);
  for (let c = 0; c < rendered.numberOfChannels; c++) {
    const src = rendered.getChannelData(c);
    const dst = out.getChannelData(c);
    dst.set(src.subarray(0, length));
    for (let i = length; i < src.length; i++) dst[i - length] = dst[i - length]! + src[i]!;
  }
  return out;
}

type OfflineCtor = new (channels: number, length: number, rate: number) => OfflineAudioContext;

let cached: Promise<AudioBuffer[] | null> | null = null;

/** The four layers, rendered once per page (null where offline rendering is missing). */
export function synthStems(rate = 44_100): Promise<AudioBuffer[] | null> {
  cached ??= (async () => {
    const Offline = (globalThis as { OfflineAudioContext?: OfflineCtor }).OfflineAudioContext;
    if (!Offline) return null;
    const length = Math.round(SCORE_LENGTH * rate);
    const layers: AudioBuffer[] = [];
    for (const layer of [0, 1, 2, 3] as const) {
      const ctx = new Offline(2, length + Math.round(TAIL * rate), rate);
      const level = ctx.createGain();
      level.gain.value = 0.9;
      level.connect(ctx.destination);
      writeLayer(ctx, level, layer);
      const rendered = await ctx.startRendering();
      layers.push(foldTail(rendered, length, (ch, len, r) => ctx.createBuffer(ch, len, r)));
    }
    return layers;
  })().catch(() => null);
  return cached;
}

/** Tests only: forget the rendered layers. */
export function resetStems() {
  cached = null;
  noiseBuffer = new WeakMap();
}
