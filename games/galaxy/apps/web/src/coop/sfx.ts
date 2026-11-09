import type { CoopMark } from '@galaxy/shared';
import { getSettings, sfxOut } from '../audio/mixer';
import { tone } from '../audio/synth';

// The quick marks' sounds (phase 6c): a short two-note chirp, rising for «Aquí» and «A la baliza», urgent for «Ayuda»
// and low for «Cuidado». On the effects bus, quiet: they come in the middle of a fight.

const NOTES: Record<CoopMark, [number, number, OscillatorType]> = {
  here: [880, 1175, 'triangle'],
  beacon: [660, 990, 'triangle'],
  help: [1320, 1320, 'square'],
  danger: [330, 220, 'sawtooth'],
};

export function playMark(kind: CoopMark): void {
  const bus = sfxOut();
  if (!bus || getSettings().muted) return;
  const { ctx, out } = bus;
  const t = ctx.currentTime;
  const [a, b, type] = NOTES[kind];
  tone(ctx, out, t, a, a, 0.09, 0.035, type);
  tone(ctx, out, t + 0.1, b, b, 0.14, 0.035, type);
}
