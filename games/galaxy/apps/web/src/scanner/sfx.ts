import { TIERS, type Tier } from '@galaxy/shared';
import { getSettings, setSettings, sfxOut } from '../audio/mixer';
import { noise, tone } from '../audio/synth';

// The scanner's sounds (GDD §9), synthesised with WebAudio: no audio files, so the CSP stays as it is. The clack is a
// Perkins braille machine's key (a filtered noise burst with a low thud); the chord brightens with the rarity and the
// Legendary one is a rising arpeggio. Short sounds only, always after the player's own click; muting is remembered.
// Chord notes (Hz) per tier: a fifth for common, a triad, a seventh, a ninth, and an arpeggio for legendary.
const CHORDS: Record<Tier, number[]> = {
  common: [261.63, 392],
  uncommon: [293.66, 369.99, 440],
  rare: [329.63, 415.3, 493.88, 622.25],
  epic: [349.23, 440, 523.25, 659.25, 783.99],
  legendary: [392, 493.88, 587.33, 739.99, 880, 1174.66],
};

export interface Sfx {
  clack(): void;
  chord(tier: Tier): void;
  /** A ping per signal bar as it rises (120 ms apart, like the bars), rising in pitch. */
  bars(n: number): void;
  /** The scan building up over `seconds`: a rising tone and crackle, louder the rarer. */
  riser(tier: Tier, seconds: number): void;
  /** The moment the card appears: a low thud and a burst, with sparkles from rare up. */
  impact(tier: Tier): void;
  /** The Legendary's fanfare: an arpeggio, a bell and a held chord. */
  fanfare(): void;
  /** «¡Destacada!»: a short two-note sting. */
  sting(): void;
  /** A summary card landing (the `i`-th). */
  ping(i: number): void;
  muted(): boolean;
  setMuted(on: boolean): void;
}

export function createSfx(): Sfx {
  // The mixer's effects bus (M8a): its volume and the mute for all come from the settings.
  function audio(): { ctx: AudioContext; out: GainNode } | null {
    return sfxOut();
  }

  return {
    clack() {
      const bus = audio();
      if (!bus) return;
      const a = bus.ctx;
      const t = a.currentTime;
      const length = Math.floor(a.sampleRate * 0.05);
      const buffer = a.createBuffer(1, length, a.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3;
      const noise = a.createBufferSource();
      noise.buffer = buffer;
      const band = a.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = 2400;
      band.Q.value = 1.4;
      const gain = a.createGain();
      gain.gain.setValueAtTime(0.32, t);
      noise.connect(band).connect(gain).connect(bus.out);
      noise.start(t);
      // The key bottoming out: a short low thud under the click.
      const thud = a.createOscillator();
      thud.type = 'sine';
      thud.frequency.setValueAtTime(140, t);
      thud.frequency.exponentialRampToValueAtTime(60, t + 0.06);
      const thudGain = a.createGain();
      thudGain.gain.setValueAtTime(0.22, t);
      thudGain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
      thud.connect(thudGain).connect(bus.out);
      thud.start(t);
      thud.stop(t + 0.1);
    },
    bars(n) {
      const bus = audio();
      if (!bus) return;
      const t = bus.ctx.currentTime;
      for (let i = 0; i < n; i++) {
        const hz = 660 * 2 ** (i / 4);
        tone(bus.ctx, bus.out, t + i * 0.12, hz, hz * 1.02, 0.16, 0.05, 'square');
        tone(bus.ctx, bus.out, t + i * 0.12, hz * 2, hz * 2, 0.08, 0.015, 'sine');
      }
    },
    riser(tier, seconds) {
      const bus = audio();
      if (!bus) return;
      const k = TIERS.indexOf(tier);
      const t = bus.ctx.currentTime;
      const dur = Math.max(0.3, seconds);
      tone(bus.ctx, bus.out, t, 110 * (1 + k * 0.2), 660 * (1 + k * 0.3), dur, 0.012 + k * 0.006, 'sawtooth');
      for (let j = 0; j < 5; j++) noise(bus.ctx, bus.out, t + (j * dur) / 5, dur / 5, 0.05 + k * 0.03, 800 + j * 900);
    },
    impact(tier) {
      const bus = audio();
      if (!bus) return;
      const k = TIERS.indexOf(tier);
      const t = bus.ctx.currentTime;
      tone(bus.ctx, bus.out, t, 140, 40, 0.35 + 0.1 * k, 0.08 + 0.04 * k, 'sine');
      noise(bus.ctx, bus.out, t, 0.25 + 0.1 * k, 0.15 + 0.12 * k, 1200 + 400 * k);
      [2093, 2637, 3136, 4186].slice(0, Math.max(0, k)).forEach((hz, i) => tone(bus.ctx, bus.out, t + 0.05 + i * 0.05, hz, hz, 0.3, 0.02, 'sine'));
    },
    fanfare() {
      const bus = audio();
      if (!bus) return;
      const t = bus.ctx.currentTime + 0.1;
      [392, 493.88, 587.33, 783.99, 987.77, 1174.66].forEach((hz, i) => tone(bus.ctx, bus.out, t + i * 0.08, hz, hz, 0.55, 0.05, 'triangle'));
      tone(bus.ctx, bus.out, t + 0.5, 1567.98, 1567.98, 1.4, 0.04, 'sine');
      tone(bus.ctx, bus.out, t + 0.5, 2349.32, 2349.32, 1.1, 0.02, 'sine');
      [392, 493.88, 587.33].forEach((hz) => tone(bus.ctx, bus.out, t + 0.48, hz, hz, 1.8, 0.03, 'sine'));
    },
    sting() {
      const bus = audio();
      if (!bus) return;
      const t = bus.ctx.currentTime + 0.25;
      tone(bus.ctx, bus.out, t, 783.99, 783.99, 0.18, 0.06, 'triangle');
      tone(bus.ctx, bus.out, t + 0.16, 1174.66, 1174.66, 0.5, 0.06, 'triangle');
      noise(bus.ctx, bus.out, t + 0.16, 0.4, 0.2, 5200);
    },
    ping(i) {
      const bus = audio();
      if (!bus) return;
      const hz = 1046.5 * 2 ** ((i % 8) / 12);
      tone(bus.ctx, bus.out, bus.ctx.currentTime, hz, hz, 0.14, 0.035, 'sine');
    },
    chord(tier) {
      const bus = audio();
      if (!bus) return;
      const a = bus.ctx;
      const t0 = a.currentTime;
      const arpeggio = tier === 'legendary';
      const notes = CHORDS[tier];
      const bright = TIERS.indexOf(tier);
      notes.forEach((hz, i) => {
        const t = t0 + (arpeggio ? i * 0.07 : 0);
        const osc = a.createOscillator();
        osc.type = bright >= 3 ? 'triangle' : 'sine';
        osc.frequency.setValueAtTime(hz, t);
        const gain = a.createGain();
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.linearRampToValueAtTime(0.16 / Math.sqrt(notes.length), t + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.1 + bright * 0.25);
        osc.connect(gain).connect(bus.out);
        osc.start(t);
        osc.stop(t + 1.4 + bright * 0.25);
      });
    },
    muted: () => getSettings().muted,
    setMuted(on) {
      setSettings({ muted: on });
    },
  };
}

/** The app's one sound board. */
export const sfx = createSfx();
