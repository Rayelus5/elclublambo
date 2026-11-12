import type { Texture } from './compositions';
import { seeded } from './rng';
import type { VoiceName } from './styles';
import { hz } from './theory';

// The soundtrack's instruments (plan «banda sonora», part A): each one schedules its nodes for one note on the audio
// clock and returns when it ends. Built to be soft and warm, never shrill: slow attacks on the beds, filters on every
// bright waveform, decays that never cut (exponential ramps end at a hair above zero) and no full-scale levels. The
// noise they use is made once per context from a fixed seed.

export interface Note {
  midi: number;
  /** When it starts and how long it is held (seconds). */
  at: number;
  dur: number;
  /** 0–1. */
  vel: number;
}

export interface VoiceColor {
  /** 0 dark … 1 bright (the piece's colour). */
  bright: number;
  texture: Texture;
  /** A seed for what varies inside the note (the texture's grains). */
  seed: number;
}

const FLOOR = 0.0001;
const noises = new WeakMap<BaseAudioContext, AudioBuffer>();

/** One second of seeded white noise for this context (the drums, the textures). */
export function noiseOf(ctx: BaseAudioContext): AudioBuffer {
  let b = noises.get(ctx);
  if (b) return b;
  b = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate)), ctx.sampleRate);
  const d = b.getChannelData(0);
  const rand = seeded(0x51ce);
  for (let i = 0; i < d.length; i++) d[i] = rand() * 2 - 1;
  noises.set(ctx, b);
  return b;
}

/** An envelope: up to `peak` in `attack`, held, then down over `release` (never to zero: exponential). */
function envelope(g: AudioParam, at: number, attack: number, hold: number, release: number, peak: number) {
  g.setValueAtTime(FLOOR, at);
  g.linearRampToValueAtTime(peak, at + attack);
  g.setValueAtTime(peak, at + Math.max(attack, hold));
  g.exponentialRampToValueAtTime(FLOOR, at + Math.max(attack, hold) + release);
}

function osc(ctx: BaseAudioContext, type: OscillatorType, freq: number, at: number, until: number, detune = 0) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, at);
  if (detune) o.detune.setValueAtTime(detune, at);
  o.start(at);
  o.stop(until);
  return o;
}

function noise(ctx: BaseAudioContext, at: number, until: number) {
  const s = ctx.createBufferSource();
  s.buffer = noiseOf(ctx);
  s.loop = true;
  s.start(at);
  s.stop(until);
  return s;
}

function filter(ctx: BaseAudioContext, type: BiquadFilterType, freq: number, q = 0.7) {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

type Play = (ctx: BaseAudioContext, out: AudioNode, n: Note, color: VoiceColor) => number;

const pad: Play = (ctx, out, n, color) => {
  const attack = Math.min(1.4, n.dur * 0.35);
  const release = 1.8;
  const end = n.at + n.dur + release + 0.05;
  const lp = filter(ctx, 'lowpass', 1100 + color.bright * 2600, 0.5);
  const amp = ctx.createGain();
  envelope(amp.gain, n.at, attack, n.dur, release, 0.16 * n.vel);
  const f = hz(n.midi);
  for (const [type, cents, level] of [
    ['sawtooth', -7, 0.32],
    ['sawtooth', 7, 0.32],
    ['triangle', 0, 0.5],
  ] as const) {
    const g = ctx.createGain();
    g.gain.value = level;
    osc(ctx, type, f, n.at, end, cents).connect(g).connect(lp);
  }
  lp.connect(amp).connect(out);
  return end;
};

const sub: Play = (ctx, out, n) => {
  const release = 0.35;
  const end = n.at + n.dur + release + 0.05;
  const amp = ctx.createGain();
  envelope(amp.gain, n.at, 0.03, n.dur, release, 0.34 * n.vel);
  const f = hz(n.midi);
  osc(ctx, 'sine', f, n.at, end).connect(amp);
  const body = ctx.createGain();
  body.gain.value = 0.25;
  osc(ctx, 'triangle', f, n.at, end).connect(body).connect(amp);
  amp.connect(out);
  return end;
};

const pluck: Play = (ctx, out, n, color) => {
  const end = n.at + 1;
  const lp = filter(ctx, 'lowpass', 600, 1.2);
  lp.frequency.setValueAtTime(1600 + color.bright * 2200, n.at);
  lp.frequency.exponentialRampToValueAtTime(520, n.at + 0.35);
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(FLOOR, n.at);
  amp.gain.linearRampToValueAtTime(0.2 * n.vel, n.at + 0.006);
  amp.gain.exponentialRampToValueAtTime(FLOOR, n.at + 0.9);
  const f = hz(n.midi);
  osc(ctx, 'triangle', f, n.at, end).connect(lp);
  const sq = ctx.createGain();
  sq.gain.value = 0.18;
  osc(ctx, 'square', f, n.at, end).connect(sq).connect(lp);
  lp.connect(amp).connect(out);
  return end;
};

const bells: Play = (ctx, out, n) => {
  const decay = 2.6;
  const end = n.at + decay + 0.05;
  const f = hz(n.midi);
  const carrier = osc(ctx, 'sine', f, n.at, end);
  const mod = osc(ctx, 'sine', f * 3.5, n.at, end);
  const index = ctx.createGain();
  index.gain.setValueAtTime(f * 1.6, n.at);
  index.gain.exponentialRampToValueAtTime(f * 0.05, n.at + 1.2);
  mod.connect(index).connect(carrier.frequency);
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(FLOOR, n.at);
  amp.gain.linearRampToValueAtTime(0.16 * n.vel, n.at + 0.004);
  amp.gain.exponentialRampToValueAtTime(FLOOR, n.at + decay);
  carrier.connect(amp).connect(out);
  return end;
};

const flute: Play = (ctx, out, n) => {
  const release = 0.35;
  const end = n.at + n.dur + release + 0.05;
  const f = hz(n.midi);
  const lp = filter(ctx, 'lowpass', 2600, 0.6);
  const amp = ctx.createGain();
  envelope(amp.gain, n.at, 0.07, n.dur, release, 0.17 * n.vel);
  const tone = osc(ctx, 'triangle', f, n.at, end);
  // A gentle vibrato that only starts once the note settles.
  const lfo = osc(ctx, 'sine', 5.2, n.at, end);
  const depth = ctx.createGain();
  depth.gain.setValueAtTime(0, n.at);
  depth.gain.linearRampToValueAtTime(9, n.at + Math.min(0.5, n.dur));
  lfo.connect(depth).connect(tone.detune);
  tone.connect(lp);
  const air = ctx.createGain();
  air.gain.value = 0.12;
  osc(ctx, 'sine', f * 2, n.at, end).connect(air).connect(lp);
  lp.connect(amp).connect(out);
  return end;
};

const choir: Play = (ctx, out, n) => {
  const attack = Math.min(0.9, n.dur * 0.3);
  const release = 1.3;
  const end = n.at + n.dur + release + 0.05;
  const f = hz(n.midi);
  const amp = ctx.createGain();
  envelope(amp.gain, n.at, attack, n.dur, release, 0.12 * n.vel);
  const mix = ctx.createGain();
  for (const cents of [-11, 0, 9]) osc(ctx, 'sawtooth', f, n.at, end, cents).connect(mix);
  // Two vowel formants («ah»).
  for (const [freq, q, level] of [
    [720, 5, 0.6],
    [1150, 6, 0.4],
  ] as const) {
    const bp = filter(ctx, 'bandpass', freq, q);
    const g = ctx.createGain();
    g.gain.value = level;
    mix.connect(bp).connect(g).connect(amp);
  }
  amp.connect(out);
  return end;
};

const brass: Play = (ctx, out, n) => {
  const release = 0.25;
  const end = n.at + n.dur + release + 0.05;
  const f = hz(n.midi);
  const lp = filter(ctx, 'lowpass', 400, 1);
  lp.frequency.setValueAtTime(400, n.at);
  lp.frequency.linearRampToValueAtTime(2200, n.at + 0.09);
  lp.frequency.linearRampToValueAtTime(1300, n.at + 0.35);
  const amp = ctx.createGain();
  envelope(amp.gain, n.at, 0.04, n.dur, release, 0.12 * n.vel);
  for (const cents of [-5, 5]) osc(ctx, 'sawtooth', f, n.at, end, cents).connect(lp);
  lp.connect(amp).connect(out);
  return end;
};

const timpani: Play = (ctx, out, n) => {
  const decay = 1.3;
  const end = n.at + decay + 0.05;
  const f = hz(n.midi);
  const o = osc(ctx, 'sine', f * 1.12, n.at, end);
  o.frequency.exponentialRampToValueAtTime(f, n.at + 0.08);
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(FLOOR, n.at);
  amp.gain.linearRampToValueAtTime(0.5 * n.vel, n.at + 0.004);
  amp.gain.exponentialRampToValueAtTime(FLOOR, n.at + decay);
  o.connect(amp);
  const thud = ctx.createGain();
  thud.gain.setValueAtTime(0.25 * n.vel, n.at);
  thud.gain.exponentialRampToValueAtTime(FLOOR, n.at + 0.12);
  noise(ctx, n.at, n.at + 0.15).connect(filter(ctx, 'lowpass', 380)).connect(thud).connect(out);
  amp.connect(out);
  return end;
};

const kick: Play = (ctx, out, n) => {
  const end = n.at + 0.4;
  const o = osc(ctx, 'sine', 120, n.at, end);
  o.frequency.exponentialRampToValueAtTime(44, n.at + 0.13);
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(FLOOR, n.at);
  amp.gain.linearRampToValueAtTime(0.7 * n.vel, n.at + 0.004);
  amp.gain.exponentialRampToValueAtTime(FLOOR, n.at + 0.34);
  o.connect(amp).connect(out);
  return end;
};

const snare: Play = (ctx, out, n) => {
  const end = n.at + 0.25;
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(FLOOR, n.at);
  amp.gain.linearRampToValueAtTime(0.32 * n.vel, n.at + 0.003);
  amp.gain.exponentialRampToValueAtTime(FLOOR, n.at + 0.18);
  noise(ctx, n.at, end).connect(filter(ctx, 'bandpass', 1900, 0.8)).connect(amp);
  const body = ctx.createGain();
  body.gain.setValueAtTime(0.2 * n.vel, n.at);
  body.gain.exponentialRampToValueAtTime(FLOOR, n.at + 0.1);
  osc(ctx, 'triangle', 185, n.at, n.at + 0.12).connect(body).connect(out);
  amp.connect(out);
  return end;
};

const hat: Play = (ctx, out, n) => {
  const end = n.at + 0.09;
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(FLOOR, n.at);
  amp.gain.linearRampToValueAtTime(0.18 * n.vel, n.at + 0.002);
  amp.gain.exponentialRampToValueAtTime(FLOOR, n.at + 0.06);
  noise(ctx, n.at, end).connect(filter(ctx, 'highpass', 6800, 0.6)).connect(amp).connect(out);
  return end;
};

const tom: Play = (ctx, out, n) => {
  const end = n.at + 0.45;
  const o = osc(ctx, 'sine', 160, n.at, end);
  o.frequency.exponentialRampToValueAtTime(92, n.at + 0.22);
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(FLOOR, n.at);
  amp.gain.linearRampToValueAtTime(0.42 * n.vel, n.at + 0.004);
  amp.gain.exponentialRampToValueAtTime(FLOOR, n.at + 0.4);
  o.connect(amp).connect(out);
  return end;
};

/** The bed's texture, one bar long: a soft wind, crystals, bubbles, embers or static, by the piece's colour. */
const texture: Play = (ctx, out, n, color) => {
  const end = n.at + n.dur + 0.3;
  const rand = seeded(color.seed);
  const amp = ctx.createGain();
  const kind = color.texture;
  if (kind === 'space' || kind === 'wind') {
    const bp = filter(ctx, 'bandpass', 500, kind === 'wind' ? 0.9 : 1.6);
    const from = kind === 'wind' ? 300 : 450;
    bp.frequency.setValueAtTime(from + rand() * 300, n.at);
    bp.frequency.linearRampToValueAtTime(from + 200 + rand() * 500, n.at + n.dur);
    envelope(amp.gain, n.at, n.dur * 0.4, n.dur * 0.6, 0.3, (kind === 'wind' ? 0.07 : 0.045) * n.vel);
    noise(ctx, n.at, end).connect(bp).connect(amp).connect(out);
    return end;
  }
  amp.gain.value = n.vel;
  amp.connect(out);
  // Grains spread over the bar.
  const grains = kind === 'crystal' ? 4 : kind === 'bubbles' ? 5 : kind === 'embers' ? 9 : 6;
  for (let i = 0; i < grains; i++) {
    const t = n.at + rand() * n.dur;
    const g = ctx.createGain();
    if (kind === 'crystal') {
      // High sine pings on the key's tonic and fifth, far above the music.
      const o = osc(ctx, 'sine', hz(n.midi + (rand() < 0.5 ? 36 : 43)), t, t + 0.9);
      g.gain.setValueAtTime(FLOOR, t);
      g.gain.linearRampToValueAtTime(0.025, t + 0.003);
      g.gain.exponentialRampToValueAtTime(FLOOR, t + 0.8);
      o.connect(g).connect(amp);
    } else if (kind === 'bubbles') {
      const o = osc(ctx, 'sine', 380 + rand() * 200, t, t + 0.12);
      o.frequency.exponentialRampToValueAtTime(900 + rand() * 300, t + 0.08);
      g.gain.setValueAtTime(FLOOR, t);
      g.gain.linearRampToValueAtTime(0.03, t + 0.01);
      g.gain.exponentialRampToValueAtTime(FLOOR, t + 0.1);
      o.connect(g).connect(amp);
    } else {
      // Embers crackle; static buzzes in short bursts.
      const len = kind === 'embers' ? 0.012 : 0.05 + rand() * 0.08;
      g.gain.setValueAtTime(FLOOR, t);
      g.gain.linearRampToValueAtTime(kind === 'embers' ? 0.06 : 0.025, t + 0.002);
      g.gain.exponentialRampToValueAtTime(FLOOR, t + len);
      noise(ctx, t, t + len + 0.02).connect(filter(ctx, kind === 'embers' ? 'highpass' : 'bandpass', kind === 'embers' ? 3000 : 2400, kind === 'embers' ? 0.7 : 4)).connect(g).connect(amp);
    }
  }
  return end;
};

export const VOICES: Record<VoiceName, Play> = { pad, sub, pluck, bells, flute, choir, brass, timpani, kick, snare, hat, tom, texture };
