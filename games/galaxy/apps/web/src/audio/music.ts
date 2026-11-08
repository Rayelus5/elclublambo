import { audioBus, getSettings, onSettings } from './mixer';

// Adaptive music (GDD §17.4; M8a): a synthwave loop in A minor (Am, F, C, G; 104 bpm) built from layers that join as
// the intensity rises: a pad always, then the bass, then an arpeggio, then the drums. A lookahead scheduler (a timer
// every 25 ms queues the notes of the next 120 ms on the audio clock), so the timing never depends on the frame rate.
// Intensity 0 is the hub's calm; the arena sets 1–3 from what happens on screen.

const BPM = 104;
const STEP = 60 / BPM / 4; // a sixteenth
const LOOKAHEAD = 0.12;
const TICK_MS = 25;
// Root of each bar (Hz) and its chord (semitones over the root).
const BARS: { root: number; chord: number[] }[] = [
  { root: 110, chord: [0, 3, 7] }, // Am
  { root: 87.31, chord: [0, 4, 7] }, // F
  { root: 130.81, chord: [0, 4, 7] }, // C
  { root: 98, chord: [0, 4, 7] }, // G
];
const ARP = [0, 2, 1, 2, 0, 2, 1, 3];
const semis = (hz: number, n: number) => hz * 2 ** (n / 12);

let timer: ReturnType<typeof setInterval> | null = null;
let step = 0;
let nextAt = 0;
let intensity = 0;
let level: GainNode | null = null;
let noise: AudioBuffer | null = null;

function voice(ctx: AudioContext, out: AudioNode, type: OscillatorType, hz: number, t: number, dur: number, vol: number, attack = 0.01): void {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(hz, t);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function hit(ctx: AudioContext, out: AudioNode, t: number, kind: 'kick' | 'hat' | 'snare'): void {
  if (kind === 'kick') {
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.2);
    return;
  }
  noise ??= (() => {
    const b = ctx.createBuffer(1, ctx.sampleRate * 0.2, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  })();
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const f = ctx.createBiquadFilter();
  f.type = kind === 'hat' ? 'highpass' : 'bandpass';
  f.frequency.value = kind === 'hat' ? 7000 : 1800;
  const g = ctx.createGain();
  const dur = kind === 'hat' ? 0.04 : 0.14;
  g.gain.setValueAtTime(kind === 'hat' ? 0.12 : 0.25, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(out);
  src.start(t);
  src.stop(t + dur + 0.02);
}

function schedule(ctx: AudioContext, out: AudioNode, s: number, t: number): void {
  const bar = BARS[Math.floor(s / 16) % BARS.length]!;
  const inBar = s % 16;
  // Pad: the chord at the start of each bar, long and soft.
  if (inBar === 0) for (const n of bar.chord) voice(ctx, out, 'triangle', semis(bar.root * 2, n), t, STEP * 16, 0.05, 0.4);
  // Bass: eighths on the root, an octave jump on the off-beat.
  if (intensity >= 1 && inBar % 2 === 0) voice(ctx, out, 'sawtooth', inBar % 4 === 2 ? bar.root : bar.root / 2, t, STEP * 1.6, 0.07);
  // Arpeggio: sixteenths over the chord, two octaves up.
  if (intensity >= 2) voice(ctx, out, 'square', semis(bar.root * 4, bar.chord[ARP[inBar % 8]! % 3]! + (ARP[inBar % 8] === 3 ? 12 : 0)), t, STEP * 0.9, 0.025);
  // Drums: four on the floor, hats on the off-beats, a snare on two and four.
  if (intensity >= 3) {
    if (inBar % 4 === 0) hit(ctx, out, t, 'kick');
    if (inBar % 4 === 2) hit(ctx, out, t, 'hat');
    if (inBar === 4 || inBar === 12) hit(ctx, out, t, 'snare');
  }
}

function tick(): void {
  const b = audioBus();
  if (!b || !level) return;
  while (nextAt < b.ctx.currentTime + LOOKAHEAD) {
    schedule(b.ctx, level, step, nextAt);
    step++;
    nextAt += STEP;
  }
}

/** Starts the music (after a gesture) or keeps it going; harmless to call again. */
export function startMusic(): void {
  if (timer || getSettings().music <= 0) return;
  const b = audioBus();
  if (!b) return;
  level = b.ctx.createGain();
  level.gain.value = 0;
  level.gain.setTargetAtTime(1, b.ctx.currentTime, 0.6);
  level.connect(b.music);
  nextAt = b.ctx.currentTime + 0.05;
  timer = setInterval(tick, TICK_MS);
}

/** Fades the music out and stops scheduling. */
export function stopMusic(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
  const b = audioBus();
  const l = level;
  level = null;
  if (b && l) {
    l.gain.setTargetAtTime(0, b.ctx.currentTime, 0.3);
    setTimeout(() => l.disconnect(), 1500);
  }
}

/** 0 calm (the hub) to 3 (a boss, a swarm, low life): the layers that play. */
export function setIntensity(n: number): void {
  intensity = Math.max(0, Math.min(3, Math.round(n)));
}

export function musicPlaying(): boolean {
  return timer !== null;
}

// Turning the music down to zero stops it; turning it up again waits for the next start.
onSettings((s) => {
  if (s.music <= 0 || s.muted) stopMusic();
});
