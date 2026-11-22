import { getSettings, sfxOut } from '../audio/mixer';
import { noise, tone } from '../audio/synth';
import type { Reward } from './ready';

// Collecting a reward (open beta) sounds like what it gives, one after another: the pop of collecting, coins clinking
// in a cascade (more coins, more clinks), dust shimmering, a signal ringing like a bell, the season's shards chiming
// like glass, a blip for points or experience, a sparkle for a new piece (title, frame, avatar, skin), a rising
// shimmer for a galaxy and an engine's hum for a probe (a season's gifts, plan «temporadas como fichas» PR 4), and a
// short fanfare for an achievement, a season mission or the season's closing prizes. On the effects bus, synthesised.

export function playClaim(reward: Reward, big = false): void {
  const bus = sfxOut();
  if (!bus || getSettings().muted) return;
  const { ctx, out } = bus;
  const t = ctx.currentTime;
  tone(ctx, out, t, 440, 880, 0.12, 0.05, 'triangle');
  let at = t + 0.08;
  const coins = reward.coins ?? 0;
  if (coins > 0) {
    const clinks = Math.max(2, Math.min(9, Math.round(Math.log2(coins / 40)) + 2));
    for (let i = 0; i < clinks; i++) {
      const hz = 2093 + (i % 3) * 220;
      tone(ctx, out, at + i * 0.045, hz, hz, 0.09, 0.028, 'square');
      tone(ctx, out, at + i * 0.045, hz * 1.5, hz * 1.5, 0.06, 0.012, 'sine');
    }
    at += clinks * 0.045 + 0.04;
  }
  if ((reward.dust ?? 0) > 0) {
    noise(ctx, out, at, 0.35, 0.16, 6400);
    tone(ctx, out, at, 1200, 2600, 0.4, 0.022, 'sine');
    at += 0.18;
  }
  if ((reward.signal ?? 0) + (reward.eventSignals ?? 0) > 0) {
    tone(ctx, out, at, 1568, 1568, 0.9, 0.05, 'sine');
    tone(ctx, out, at, 2349, 2349, 0.7, 0.022, 'sine');
    tone(ctx, out, at + 0.12, 3136, 3136, 0.6, 0.014, 'sine');
    at += 0.15;
  }
  if ((reward.shards ?? 0) > 0) {
    // Glass: a quick rising triad, high and bright, each note with a faint octave ringing over it.
    [1760, 2217.5, 2637].forEach((hz, i) => {
      tone(ctx, out, at + i * 0.06, hz, hz, 0.45, 0.03, 'sine');
      tone(ctx, out, at + i * 0.06, hz * 2, hz * 2, 0.25, 0.008, 'sine');
    });
    at += 0.22;
  }
  if ((reward.points ?? 0) + (reward.xp ?? 0) > 0) tone(ctx, out, at, 660, 990, 0.1, 0.03, 'triangle');
  const cards = reward.cards ?? [];
  if (cards.some((c) => c.kind === 'galaxy')) {
    // A galaxy: a slow sweep upwards with a cluster of faint stars round it.
    tone(ctx, out, at, 330, 1320, 0.7, 0.035, 'sine');
    [2637, 3136, 3951].forEach((hz, i) => tone(ctx, out, at + 0.2 + i * 0.08, hz, hz, 0.35, 0.012, 'sine'));
    at += 0.45;
  }
  if (cards.some((c) => c.kind === 'probe')) {
    // A probe: its engine humming low and climbing as it starts.
    tone(ctx, out, at, 110, 220, 0.5, 0.04, 'sawtooth');
    tone(ctx, out, at + 0.05, 220, 440, 0.4, 0.02, 'triangle');
    at += 0.35;
  }
  if (reward.title || reward.frame || reward.avatar || reward.skin || cards.some((c) => c.kind === 'title' || c.kind === 'frame' || c.kind === 'avatar' || c.kind === 'skin' || c.kind === 'resource')) {
    // A sparkle: twinkles falling from very high over a faint crackle.
    noise(ctx, out, at, 0.5, 0.05, 9000);
    [4186, 3520, 3951, 3136, 3520].forEach((hz, i) => tone(ctx, out, at + i * 0.05, hz, hz * 1.02, 0.16, 0.016, 'sine'));
    at += 0.25;
  }
  if (big) {
    [523.3, 659.3, 784, 1046.5].forEach((hz, i) => tone(ctx, out, at + 0.05 + i * 0.09, hz, hz, 0.5, 0.045, 'triangle'));
    [523.3, 659.3, 784].forEach((hz) => tone(ctx, out, at + 0.45, hz, hz, 1, 0.03, 'sine'));
  }
}
