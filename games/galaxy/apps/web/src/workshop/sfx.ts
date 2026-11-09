import { getSettings, sfxOut } from '../audio/mixer';

// The workshop's sounds (the owner's «mejora visual completa»): a probe levelling up is a burst of welding crackle,
// a servo whine that rises, then a bright three-note chord; equipping one is a heavy clamp and a short chime. On the
// effects bus (its volume and the mute apply), synthesised, never louder than the interface's confirm.

function noise(ctx: AudioContext, out: AudioNode, t: number, dur: number, vol: number, hz: number): void {
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  // Crackle: sparse spikes, not a hiss.
  for (let i = 0; i < len; i++) data[i] = Math.random() < 0.08 ? (Math.random() * 2 - 1) * (1 - i / len) : 0;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = hz;
  f.Q.value = 0.8;
  const g = ctx.createGain();
  g.gain.value = vol;
  src.connect(f).connect(g).connect(out);
  src.start(t);
}

function tone(ctx: AudioContext, out: AudioNode, t: number, from: number, to: number, dur: number, vol: number, type: OscillatorType = 'triangle'): void {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(from, t);
  o.frequency.exponentialRampToValueAtTime(to, t + dur * 0.8);
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 3600;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(f).connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.02);
}

/** A probe reached a new level. */
export function playLevelUp(): void {
  const bus = sfxOut();
  if (!bus || getSettings().muted) return;
  const { ctx, out } = bus;
  const t = ctx.currentTime;
  noise(ctx, out, t, 0.35, 0.5, 2400);
  noise(ctx, out, t + 0.12, 0.25, 0.35, 4200);
  tone(ctx, out, t + 0.05, 220, 660, 0.4, 0.035, 'sawtooth');
  const chord = [523.3, 659.3, 784, 1046.5];
  chord.forEach((hz, i) => tone(ctx, out, t + 0.42 + i * 0.07, hz, hz, 0.5, 0.05));
  tone(ctx, out, t + 0.7, 2093, 2093, 0.4, 0.012, 'sine');
}

/** A probe was equipped: a clamp closing and a chime. */
export function playEquip(): void {
  const bus = sfxOut();
  if (!bus || getSettings().muted) return;
  const { ctx, out } = bus;
  const t = ctx.currentTime;
  tone(ctx, out, t, 140, 70, 0.18, 0.08, 'square');
  noise(ctx, out, t, 0.08, 0.3, 900);
  tone(ctx, out, t + 0.1, 784, 784, 0.18, 0.045);
  tone(ctx, out, t + 0.16, 1174.7, 1174.7, 0.22, 0.04);
}
