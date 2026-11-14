import type { SimEvent } from '@galaxy/sim';
import { isPersonal } from './personal';
import { sfxOut } from '../audio/mixer';

// Combat sounds (GDD §17.4), synthesised like the scanner's: short, quiet, rate-limited so a swarm never turns into
// noise, and silenced with the same mute switch; through the mixer's effects bus (M8a).

const lastAt: Record<string, number> = {};

let out: AudioNode | null = null;

function tone(kind: string, gap: number, play: (a: AudioContext, t: number) => void): void {
  const bus = sfxOut();
  if (!bus) return;
  out = bus.out;
  const t = bus.ctx.currentTime;
  if (t - (lastAt[kind] ?? -1) < gap) return;
  lastAt[kind] = t;
  play(bus.ctx, t);
}

function blip(a: AudioContext, t: number, from: number, to: number, dur: number, vol: number, type: OscillatorType = 'square'): void {
  const o = a.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(from, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
  const g = a.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out ?? a.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

let noiseBuf: AudioBuffer | null = null;

/** Filtered noise: a band that sweeps from `from` to `to` Hz (whooshes, crunches). */
function hiss(a: AudioContext, t: number, from: number, to: number, dur: number, vol: number, q = 1.2): void {
  noiseBuf ??= (() => {
    const b = a.createBuffer(1, Math.floor(a.sampleRate * 0.6), a.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  })();
  const src = a.createBufferSource();
  src.buffer = noiseBuf;
  const f = a.createBiquadFilter();
  f.type = 'bandpass';
  f.Q.value = q;
  f.frequency.setValueAtTime(from, t);
  f.frequency.exponentialRampToValueAtTime(Math.max(40, to), t + dur);
  const g = a.createGain();
  // A soft attack, so a dash breathes instead of clicking.
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.04, dur / 3));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(out ?? a.destination);
  src.start(t);
  src.stop(t + dur + 0.02);
}

/** `me`: my probe; a teammate's hit, level-up, pickup or dash is theirs and stays silent here (Nov plan A2). */
export function playEvents(events: readonly SimEvent[], me = 0): void {
  for (const e of events) {
    if (!isPersonal(e, me)) continue;
    switch (e.t) {
      case 'hit':
        tone('hit', 0.05, (a, t) => blip(a, t, e.crit ? 900 : 620, 300, 0.05, 0.035));
        break;
      case 'kill':
        tone('kill', 0.06, (a, t) => blip(a, t, 300, 80, 0.09, 0.05, 'triangle'));
        break;
      case 'pickup':
        if (e.kind === 'xp') tone('xp', 0.04, (a, t) => blip(a, t, 1200, 1700, 0.05, 0.025, 'sine'));
        else if (e.kind === 'magnet')
          tone('magnet', 0.3, (a, t) => {
            blip(a, t, 300, 1200, 0.35, 0.05, 'sine');
            hiss(a, t, 400, 2400, 0.4, 0.05, 2);
          });
        else if (e.kind === 'component')
          tone('component', 0.06, (a, t) => {
            blip(a, t, 2400, 2100, 0.05, 0.035, 'triangle');
            blip(a, t + 0.05, 3100, 2900, 0.06, 0.03, 'triangle');
          });
        else tone('coin', 0.05, (a, t) => blip(a, t, 1500, 2300, 0.08, 0.04, 'sine'));
        break;
      case 'dash':
        tone('dash', 0.15, (a, t) => hiss(a, t, 1800, 500, e.kind === 'comet' ? 0.3 : 0.2, 0.07, 0.9));
        break;
      case 'anomaly':
        // A relic's anomaly: the ship's own «error», a crackle of static and two square steps down, then its outcome
        // (thrown aside: a zip; a freeze: an icy hiss; a strike: a zap).
        tone('anomaly', 0.25, (a, t) => {
          for (const [d, hz] of [
            [0, 3200],
            [0.035, 1400],
            [0.06, 2600],
          ] as const)
            hiss(a, t + d, hz, hz * 0.9, 0.03, 0.06, 8);
          blip(a, t + 0.02, 660, 640, 0.05, 0.03);
          blip(a, t + 0.08, 440, 420, 0.06, 0.03);
          if (e.what === 'blink') hiss(a, t + 0.05, 3000, 400, 0.14, 0.06, 1.4);
          else if (e.what === 'freeze') hiss(a, t + 0.06, 5200, 2400, 0.3, 0.05, 3);
          else blip(a, t + 0.06, 1800, 160, 0.12, 0.035, 'sawtooth');
        });
        break;
      case 'telegraph':
        // A blast's fuse (2026-11-14): beeps closer and closer together until it goes off.
        if (e.kind === 'explode') {
          const d = e.ticks / 60;
          tone('fuse', 0.3, (a, t) => [0, 0.4, 0.65, 0.82, 0.93].forEach((f) => blip(a, t + f * d, 1250, 1150, 0.05, 0.028)));
        }
        break;
      case 'blast':
        // It goes off: a deep thump, a crack and a rumble of debris.
        tone('blast', 0.08, (a, t) => {
          blip(a, t, 150, 36, 0.5, 0.16, 'sine');
          blip(a, t, 95, 30, 0.32, 0.05, 'sawtooth');
          hiss(a, t, 1600, 110, 0.55, 0.13, 0.7);
        });
        break;
      case 'propBreak':
        tone('prop', 0.05, (a, t) => {
          hiss(a, t, 900, 180, 0.16, 0.08, 1.6);
          blip(a, t, 220, 90, 0.1, 0.035, 'triangle');
        });
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
