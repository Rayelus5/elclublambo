import type { SimEvent } from '@galaxy/sim';
import { sfx } from '../scanner/sfx';

// Combat sounds (GDD §17.4), synthesised like the scanner's: short, quiet, rate-limited so a swarm never turns into
// noise, and silenced with the same mute switch. Music is M8.

let ctx: AudioContext | null = null;
const lastAt: Record<string, number> = {};

function audio(): AudioContext | null {
  if (sfx.muted()) return null;
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

function tone(kind: string, gap: number, play: (a: AudioContext, t: number) => void): void {
  const a = audio();
  if (!a) return;
  const t = a.currentTime;
  if (t - (lastAt[kind] ?? -1) < gap) return;
  lastAt[kind] = t;
  play(a, t);
}

function blip(a: AudioContext, t: number, from: number, to: number, dur: number, vol: number, type: OscillatorType = 'square'): void {
  const o = a.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(from, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
  const g = a.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

export function playEvents(events: readonly SimEvent[]): void {
  for (const e of events) {
    switch (e.t) {
      case 'hit':
        tone('hit', 0.05, (a, t) => blip(a, t, e.crit ? 900 : 620, 300, 0.05, 0.035));
        break;
      case 'kill':
        tone('kill', 0.06, (a, t) => blip(a, t, 300, 80, 0.09, 0.05, 'triangle'));
        break;
      case 'pickup':
        if (e.kind === 'xp') tone('xp', 0.04, (a, t) => blip(a, t, 1200, 1700, 0.05, 0.025, 'sine'));
        else tone('coin', 0.05, (a, t) => blip(a, t, 1500, 2300, 0.08, 0.04, 'sine'));
        break;
      case 'hurt':
        tone('hurt', 0.12, (a, t) => blip(a, t, 180, 60, 0.18, 0.09, 'sawtooth'));
        break;
      case 'levelUp':
        tone('level', 0.3, (a, t) => [523, 659, 784, 1047].forEach((hz, k) => blip(a, t + k * 0.06, hz, hz, 0.14, 0.05, 'triangle')));
        break;
      case 'bossSpawn':
        tone('boss', 1, (a, t) => [0, 0.45].forEach((d) => blip(a, t + d, 110, 70, 0.4, 0.09, 'sawtooth')));
        break;
      case 'beaconOpen':
        tone('beacon', 1, (a, t) => [784, 988, 1175].forEach((hz, k) => blip(a, t + k * 0.1, hz, hz, 0.2, 0.05, 'sine')));
        break;
      case 'extracted':
        tone('extract', 1, (a, t) => [523, 784, 1047, 1568].forEach((hz, k) => blip(a, t + k * 0.09, hz, hz, 0.3, 0.06, 'triangle')));
        break;
      default:
        break;
    }
  }
}
