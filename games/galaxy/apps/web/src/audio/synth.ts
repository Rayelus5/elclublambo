// Two small synth voices for the interface's celebrations (the workshop, the collection), played on the effects bus.

/** A burst of crackle (sparse spikes, not a hiss) through a band-pass at `hz`. */
export function noise(ctx: AudioContext, out: AudioNode, t: number, dur: number, vol: number, hz: number): void {
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

/** A tone gliding from `from` to `to` Hz with a quick attack and an exponential fade. */
export function tone(ctx: AudioContext, out: AudioNode, t: number, from: number, to: number, dur: number, vol: number, type: OscillatorType = 'triangle'): void {
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
