import { atLeast, TIERS, type Tier } from '@galaxy/shared';
import type { BankSound } from '../../audio/bank';
import { detunedPair, MYTHIC_CHORD } from '../sfx';
import { type CueId, SURGE_LEAD } from './script';

// The pro scanner's sounds (plan «escáner pro», part B), one per moment of the script. Each is synthesised here with
// WebAudio — weightier than the classic reveal's (a sub boom, a long riser, a metallic ring) — and each has the file
// name it would take in `src/assets/audio/escaner/` (see the LEEME.md there): drop `impacto.ogg` in and it plays
// instead. Every recipe takes `at` (audio-context seconds), so the player schedules it ahead on the audio clock.

export type ProSound = CueId | 'cierre';

export interface CueOpts {
  tier?: Tier;
  /** How long it should last (the jump's riser). */
  dur?: number;
}

/**
 * Spanish names for the files of tiered sounds (`revelar-rara`). The mythic (plan «rareza Mítica» M2) has a chord of
 * its own, so a file of its own too (`revelar-mitica`): until there is one, its own recipe plays, never the legendary's.
 */
export const TIER_FILE: Record<Tier, string> = { common: 'comun', uncommon: 'poco-comun', rare: 'rara', epic: 'epica', legendary: 'legendaria', mythic: 'mitica' };

// Chord notes (Hz) per tier, brighter the rarer: a fifth, a triad, a seventh, a ninth, a shining arpeggio, and the
// mythic's: the legendary's arpeggio climbing an octave higher (only its surge's burst uses it: its card sounds
// MYTHIC_CHORD, a swell under a Lydian bloom, through `mythicChord`).
const CHORDS: Record<Tier, number[]> = {
  common: [261.63, 392],
  uncommon: [293.66, 369.99, 440],
  rare: [329.63, 415.3, 493.88, 622.25],
  epic: [349.23, 440, 523.25, 659.25, 783.99],
  legendary: [392, 493.88, 587.33, 739.99, 880, 1174.66],
  mythic: [392, 493.88, 587.33, 739.99, 880, 1174.66, 1479.98, 1760],
};

const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();
/** Two seconds of white noise per context, reused by every recipe (no new buffer per sound). */
function whiteNoise(ctx: BaseAudioContext): AudioBuffer {
  let b = noiseCache.get(ctx);
  if (!b) {
    b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 2), ctx.sampleRate);
    const d = b.getChannelData(0);
    // A fixed pattern (no Math.random): the same hiss every time, and the tests stay stable.
    let s = 7;
    for (let i = 0; i < d.length; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      d[i] = (s / 0x7fffffff) * 2 - 1;
    }
    noiseCache.set(ctx, b);
  }
  return b;
}

function env(g: GainNode, at: number, peak: number, attack: number, dur: number) {
  g.gain.setValueAtTime(0.0001, at);
  g.gain.linearRampToValueAtTime(peak, at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
}

/** An oscillator gliding `from` → `to` Hz with a quick attack and an exponential fade. */
function osc(ctx: BaseAudioContext, out: AudioNode, at: number, type: OscillatorType, from: number, to: number, dur: number, peak: number, attack = 0.01) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(from, at);
  if (to !== from) o.frequency.exponentialRampToValueAtTime(to, at + dur * 0.85);
  const g = ctx.createGain();
  env(g, at, peak, attack, dur);
  o.connect(g).connect(out);
  o.start(at);
  o.stop(at + dur + 0.05);
}

/** Filtered noise, its filter sweeping `from` → `to` Hz. */
function hiss(ctx: BaseAudioContext, out: AudioNode, at: number, type: BiquadFilterType, from: number, to: number, dur: number, peak: number, attack = 0.01) {
  const src = ctx.createBufferSource();
  src.buffer = whiteNoise(ctx);
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.Q.value = type === 'bandpass' ? 1.2 : 0.7;
  f.frequency.setValueAtTime(from, at);
  if (to !== from) f.frequency.exponentialRampToValueAtTime(to, at + dur * 0.9);
  const g = ctx.createGain();
  env(g, at, peak, attack, dur);
  src.connect(f).connect(g).connect(out);
  src.start(at);
  src.stop(at + dur + 0.05);
}

const tierOf = (o: CueOpts) => TIERS.indexOf(o.tier ?? 'common');

/**
 * The mythic's own chord (plan «rareza Mítica» M2), weightier than the classic reveal's: a low swell growing under a
 * G Lydian stack that blooms upward, every voice a detuned pair that shimmers, and a soft octave over the top voices.
 */
function mythicChord(ctx: BaseAudioContext, out: AudioNode, at: number, level: number) {
  MYTHIC_CHORD.swell.forEach((hz, i) => osc(ctx, out, at, 'sine', hz, hz, 3.2, level * (i === 0 ? 0.2 : 0.11), 0.6));
  const peak = (level * 0.2) / Math.sqrt(MYTHIC_CHORD.bloom.length * 2);
  MYTHIC_CHORD.bloom.forEach((hz, i) => {
    const t = at + 0.1 + i * MYTHIC_CHORD.stagger;
    for (const v of detunedPair(hz)) osc(ctx, out, t, i < 4 ? 'triangle' : 'sine', v, v, 2.4 + i * 0.06, peak, 0.05);
    if (i >= MYTHIC_CHORD.bloom.length - 3) osc(ctx, out, t + 0.04, 'sine', hz * 2, hz * 2, 1.8, peak * 0.4, 0.06);
  });
}

function chord(ctx: BaseAudioContext, out: AudioNode, at: number, tier: Tier, level: number) {
  if (tier === 'mythic') {
    mythicChord(ctx, out, at, level);
    return;
  }
  const notes = CHORDS[tier];
  const k = TIERS.indexOf(tier);
  notes.forEach((hz, i) => {
    const t = at + (atLeast(tier, 'legendary') ? i * 0.07 : 0);
    const peak = (level * 0.18) / Math.sqrt(notes.length);
    osc(ctx, out, t, k >= 3 ? 'triangle' : 'sine', hz, hz, 1.2 + k * 0.3, peak, 0.025);
    // A soft octave above from rare up: the reveal shines.
    if (k >= 2) osc(ctx, out, t + 0.02, 'sine', hz * 2, hz * 2, 0.9 + k * 0.2, peak * 0.35, 0.03);
  });
}

export const PRO_SOUNDS: Record<ProSound, BankSound<CueOpts>> = {
  // The bands closing: air pushed down and a soft thud when they meet.
  cierre: {
    file: 'cierre',
    synth(ctx, out, at) {
      hiss(ctx, out, at, 'lowpass', 1400, 120, 0.65, 0.18, 0.25);
      osc(ctx, out, at + 0.5, 'sine', 90, 42, 0.45, 0.32);
    },
  },
  // A heartbeat in the dark: lub-dub.
  latido: {
    file: 'latido',
    synth(ctx, out, at) {
      osc(ctx, out, at, 'sine', 62, 48, 0.28, 0.42, 0.012);
      osc(ctx, out, at + 0.16, 'sine', 54, 42, 0.32, 0.3, 0.012);
    },
  },
  // The jump: a riser that grows (a saw climbing through an opening filter, rushing air, a swelling sub).
  salto: {
    file: 'salto',
    fit: true,
    synth(ctx, out, at, o) {
      const dur = Math.max(0.6, o.dur ?? 2);
      const k = tierOf(o);
      const saw = ctx.createOscillator();
      saw.type = 'sawtooth';
      saw.frequency.setValueAtTime(70, at);
      saw.frequency.exponentialRampToValueAtTime(210 + 40 * k, at + dur);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.Q.value = 4;
      f.frequency.setValueAtTime(260, at);
      f.frequency.exponentialRampToValueAtTime(3800 + 600 * k, at + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.05 + 0.012 * k, at + dur * 0.92);
      g.gain.linearRampToValueAtTime(0.0001, at + dur + 0.04);
      saw.connect(f).connect(g).connect(out);
      saw.start(at);
      saw.stop(at + dur + 0.1);
      hiss(ctx, out, at, 'bandpass', 380, 6400, dur, 0.1 + 0.03 * k, dur * 0.85);
      osc(ctx, out, at, 'sine', 40, 58, dur + 0.05, 0.16 + 0.03 * k, dur * 0.9);
    },
  },
  // The surge: a swell that sucks in, then the real colour bursting through.
  ascenso: {
    file: 'ascenso',
    synth(ctx, out, at, o) {
      // The swell (0.34 s, it starts that long before the burst: see the script), then the burst.
      hiss(ctx, out, at, 'highpass', 1800, 9000, 0.36, 0.22, 0.33);
      const burst = at + SURGE_LEAD;
      const notes = CHORDS[o.tier ?? 'legendary'];
      notes.forEach((hz, i) => osc(ctx, out, burst + i * 0.035, 'triangle', hz, hz * 2, 0.7, 0.05, 0.01));
      osc(ctx, out, burst, 'sine', 80, 50, 0.6, 0.3);
    },
  },
  // A shooting star falling: a whistle sliding down through the air.
  meteoro: {
    file: 'meteoro',
    synth(ctx, out, at) {
      osc(ctx, out, at, 'sine', 2600, 320, 0.95, 0.05, 0.08);
      hiss(ctx, out, at, 'bandpass', 4200, 700, 0.95, 0.12, 0.3);
    },
  },
  // The impact: a thud and a burst, sparkles from rare up.
  impacto: {
    file: 'impacto',
    synth(ctx, out, at, o) {
      const k = tierOf(o);
      osc(ctx, out, at, 'sine', 150, 38, 0.55 + 0.08 * k, 0.5);
      hiss(ctx, out, at, 'lowpass', 2400, 300, 0.35 + 0.08 * k, 0.28 + 0.06 * k);
      [2093, 2637, 3136].slice(0, Math.max(0, k - 1)).forEach((hz, i) => osc(ctx, out, at + 0.06 + i * 0.05, 'sine', hz, hz, 0.4, 0.03));
    },
  },
  // The big impact (epic and better): a sub boom that shakes, a long tail and a metallic ring.
  'impacto-grande': {
    file: 'impacto-grande',
    synth(ctx, out, at, o) {
      const k = tierOf(o);
      osc(ctx, out, at, 'sine', 160, 34, 0.7, 0.55);
      osc(ctx, out, at, 'sine', 72, 24, 1.6 + 0.3 * (k - 3), 0.55, 0.005);
      hiss(ctx, out, at, 'lowpass', 3000, 160, 1.4, 0.42, 0.005);
      [523, 781, 1172, 1757].forEach((hz, i) => osc(ctx, out, at + 0.02, 'triangle', hz, hz * 0.995, 1.8 - i * 0.2, 0.035 - i * 0.006, 0.004));
    },
  },
  // Ten cards dealt onto the table.
  reparto: {
    file: 'reparto',
    synth(ctx, out, at) {
      for (let i = 0; i < 10; i++) hiss(ctx, out, at + i * 0.06, 'highpass', 3200, 2600, 0.06, 0.14, 0.004);
    },
  },
  // A card turning over.
  giro: {
    file: 'giro',
    synth(ctx, out, at) {
      hiss(ctx, out, at, 'bandpass', 700, 3600, 0.22, 0.16, 0.06);
    },
  },
  // The card's face: its tier's chord.
  revelar: {
    file: (o) => `revelar-${TIER_FILE[o.tier ?? 'common']}`,
    synth(ctx, out, at, o) {
      chord(ctx, out, at, o.tier ?? 'common', 1);
    },
  },
  // The tier stamped on: a low knock and a click.
  sello: {
    file: 'sello',
    synth(ctx, out, at, o) {
      const k = tierOf(o);
      osc(ctx, out, at, 'sine', 120, 52, 0.22, 0.28 + 0.05 * k, 0.004);
      hiss(ctx, out, at, 'bandpass', 2600, 2200, 0.05, 0.22, 0.002);
    },
  },
  // The fanfare of a legendary or a mythic: a rising arpeggio, a bell and a held chord.
  fanfarria: {
    file: 'fanfarria',
    synth(ctx, out, at) {
      [392, 493.88, 587.33, 783.99, 987.77, 1174.66].forEach((hz, i) => osc(ctx, out, at + i * 0.08, 'triangle', hz, hz, 0.6, 0.06, 0.012));
      osc(ctx, out, at + 0.5, 'sine', 1567.98, 1567.98, 1.6, 0.045, 0.01);
      osc(ctx, out, at + 0.5, 'sine', 2349.32, 2349.32, 1.2, 0.022, 0.01);
      [392, 493.88, 587.33].forEach((hz) => osc(ctx, out, at + 0.48, 'sine', hz, hz, 2, 0.035, 0.08));
    },
  },
  // «Fenómeno detectado»: a shimmering arpeggio climbing away.
  fenomeno: {
    file: 'fenomeno',
    synth(ctx, out, at) {
      [880, 1108.73, 1318.51, 1760, 2217.46, 2637.02].forEach((hz, i) => {
        osc(ctx, out, at + i * 0.07, 'sine', hz, hz, 0.5, 0.04);
        osc(ctx, out, at + i * 0.07 + 0.18, 'sine', hz, hz, 0.4, 0.015);
      });
    },
  },
  // «¡Destacada!»: a two-note sting with a sparkle.
  destacada: {
    file: 'destacada',
    synth(ctx, out, at) {
      osc(ctx, out, at, 'triangle', 783.99, 783.99, 0.2, 0.07);
      osc(ctx, out, at + 0.16, 'triangle', 1174.66, 1174.66, 0.55, 0.07);
      hiss(ctx, out, at + 0.16, 'highpass', 6000, 5000, 0.45, 0.12);
    },
  },
  // A finish catching the light: a little glitter.
  acabado: {
    file: 'acabado',
    synth(ctx, out, at) {
      [2793.83, 3520, 3135.96, 4186.01, 3729.31].forEach((hz, i) => osc(ctx, out, at + i * 0.075, 'sine', hz, hz, 0.25, 0.025, 0.004));
    },
  },
  // The summary: the rarest tier's chord, softly.
  resumen: {
    file: 'resumen',
    synth(ctx, out, at, o) {
      chord(ctx, out, at, o.tier ?? 'common', 0.5);
    },
  },
};
