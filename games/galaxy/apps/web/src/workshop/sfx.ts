import { getSettings, sfxOut } from '../audio/mixer';
import { noise, tone } from '../audio/synth';

// The workshop's sounds (the owner's «mejora visual completa»): a probe levelling up is a burst of welding crackle,
// a servo whine that rises, then a bright three-note chord; equipping one is a heavy clamp and a short chime. On the
// effects bus (its volume and the mute apply), synthesised, never louder than the interface's confirm.

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

/** Liftoff from the lobby: a deep engine rumble that swells and a rising whine. */
export function playLaunch(): void {
  const bus = sfxOut();
  if (!bus || getSettings().muted) return;
  const { ctx, out } = bus;
  const t = ctx.currentTime;
  tone(ctx, out, t, 55, 90, 0.9, 0.09, 'sawtooth');
  noise(ctx, out, t, 0.7, 0.45, 300);
  noise(ctx, out, t + 0.2, 0.6, 0.3, 700);
  tone(ctx, out, t + 0.15, 330, 1320, 0.7, 0.03);
}
