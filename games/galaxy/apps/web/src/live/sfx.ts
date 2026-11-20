import { sfxOut } from '../audio/mixer';
import { tone } from '../audio/synth';

// The notices' chime (real-time notices plan): synthesised like every effect (no files, the CSP stays as it is), on the
// effects bus (its volume and «Silenciar todo» apply), and clearly louder than the interface's clicks so a notice is
// heard. A bright arpeggio for good news (a sale, an achievement, a result), a falling pair for bad news, a rising
// pair for the rest. Several notices at once (after a run) chime once.

export type NoticeTone = 'social' | 'trade' | 'sale' | 'mail' | 'clan' | 'achievement' | 'alert' | 'result';

const GAP_MS = 500;
let last = -Infinity;

export function playNotice(kind: NoticeTone): void {
  const now = performance.now();
  if (now - last < GAP_MS) return;
  const s = sfxOut();
  if (!s) return;
  last = now;
  const t = s.ctx.currentTime + 0.01;
  if (kind === 'alert') {
    tone(s.ctx, s.out, t, 659, 659, 0.16, 0.16, 'triangle');
    tone(s.ctx, s.out, t + 0.13, 523, 494, 0.26, 0.16, 'triangle');
    return;
  }
  if (kind === 'sale' || kind === 'achievement' || kind === 'result') {
    [1047, 1319, 1568].forEach((hz, i) => tone(s.ctx, s.out, t + i * 0.085, hz, hz, 0.22 + i * 0.05, 0.15, 'triangle'));
    tone(s.ctx, s.out, t + 0.26, 2093, 2093, 0.3, 0.05, 'sine');
    return;
  }
  tone(s.ctx, s.out, t, 784, 784, 0.16, 0.17, 'triangle');
  tone(s.ctx, s.out, t + 0.12, 1175, 1175, 0.32, 0.17, 'triangle');
}
