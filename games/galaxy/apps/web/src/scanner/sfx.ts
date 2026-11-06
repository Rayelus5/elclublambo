import { TIERS, type Tier } from '@galaxy/shared';

// The scanner's sounds (GDD §9), synthesised with WebAudio: no audio files, so the CSP stays as it is. The clack is a
// Perkins braille machine's key (a filtered noise burst with a low thud); the chord brightens with the rarity and the
// Legendary one is a rising arpeggio. Short sounds only, always after the player's own click; muting is remembered.
const MUTE_KEY = 'galaxy.sfx.muted';
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
  muted(): boolean;
  setMuted(on: boolean): void;
}

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export function createSfx(): Sfx {
  let ctx: AudioContext | null = null;
  let muted = readMuted();

  function audio(): AudioContext | null {
    if (muted) return null;
    const Ctor = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
    if (!Ctor) return null;
    try {
      ctx ??= new Ctor();
      if (ctx.state === 'suspended') void ctx.resume();
      return ctx;
    } catch {
      return null;
    }
  }

  return {
    clack() {
      const a = audio();
      if (!a) return;
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
      noise.connect(band).connect(gain).connect(a.destination);
      noise.start(t);
      // The key bottoming out: a short low thud under the click.
      const thud = a.createOscillator();
      thud.type = 'sine';
      thud.frequency.setValueAtTime(140, t);
      thud.frequency.exponentialRampToValueAtTime(60, t + 0.06);
      const thudGain = a.createGain();
      thudGain.gain.setValueAtTime(0.22, t);
      thudGain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
      thud.connect(thudGain).connect(a.destination);
      thud.start(t);
      thud.stop(t + 0.1);
    },
    chord(tier) {
      const a = audio();
      if (!a) return;
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
        osc.connect(gain).connect(a.destination);
        osc.start(t);
        osc.stop(t + 1.4 + bright * 0.25);
      });
    },
    muted: () => muted,
    setMuted(on) {
      muted = on;
      try {
        localStorage.setItem(MUTE_KEY, on ? '1' : '0');
      } catch {
        // Private windows: the choice lasts for this page only.
      }
    },
  };
}

/** The app's one sound board. */
export const sfx = createSfx();
