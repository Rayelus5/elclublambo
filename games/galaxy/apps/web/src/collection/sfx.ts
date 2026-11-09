import { getSettings, sfxOut } from '../audio/mixer';
import { noise, tone } from '../audio/synth';

// The collection's sounds: galaxies fusing (a swirl that rises, the impact, a bright chord) and a galaxy levelling up
// (a shimmer and a rising arpeggio). On the effects bus (its volume and the mute apply), synthesised.

/** The selected galaxies pull together and merge. */
export function playFusion(): void {
  const bus = sfxOut();
  if (!bus || getSettings().muted) return;
  const { ctx, out } = bus;
  const t = ctx.currentTime;
  tone(ctx, out, t, 110, 880, 1.3, 0.04, 'sawtooth');
  tone(ctx, out, t + 0.2, 220, 1760, 1.1, 0.02, 'triangle');
  noise(ctx, out, t + 1.25, 0.5, 0.6, 500);
  tone(ctx, out, t + 1.25, 90, 45, 0.6, 0.1, 'square');
  [523.3, 784, 1046.5, 1568].forEach((hz, i) => tone(ctx, out, t + 1.35 + i * 0.06, hz, hz, 0.7, 0.045));
}

/** A galaxy reached a new level. */
export function playGalaxyLevel(): void {
  const bus = sfxOut();
  if (!bus || getSettings().muted) return;
  const { ctx, out } = bus;
  const t = ctx.currentTime;
  noise(ctx, out, t, 0.4, 0.35, 5200);
  [392, 523.3, 659.3, 784, 1046.5].forEach((hz, i) => tone(ctx, out, t + 0.05 + i * 0.07, hz, hz, 0.45, 0.04, 'sine'));
  tone(ctx, out, t + 0.45, 2093, 2093, 0.6, 0.012, 'sine');
}
