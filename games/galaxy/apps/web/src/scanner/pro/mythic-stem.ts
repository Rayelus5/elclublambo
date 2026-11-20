import { foldTail, SCORE_BARS, SCORE_BPM, SCORE_LENGTH } from '../../audio/stems-synth';

// The pro scanner's fifth music layer, a mythic's own (plan «rareza Mítica» M2: «una capa más de música»). There is no
// file for it, so it is synthesised like the other four (audio/stems-synth.ts) and rendered once with an
// OfflineAudioContext into a buffer exactly as long as their loop: it starts with them and stays locked sample for
// sample. Over the same four chords: a glassy pad of chord tones two octaves up, every voice a detuned pair that
// shimmers, and soft bells with their octave on the off-beats high above. Only tones the other layers already play in
// that bar, so it never clashes.

const BEAT = 60 / SCORE_BPM;
const BAR = BEAT * 4;
/** What rings past the loop's end and is folded back onto its start. */
const TAIL = 3;
/** Cents each voice of the pad's pairs is pulled from its note. */
const SHIMMER = 9;

// The same four chords as the other layers (stems-synth.ts's PROGRESSION: keep them in step; a test checks every note
// here against what the other layers play in its bar).
const PROGRESSION: { root: number; shape: number[] }[] = [
  { root: 50, shape: [0, 4, 7, 11, 14] }, // Dmaj9
  { root: 47, shape: [0, 3, 7, 10, 14] }, // Bm9
  { root: 43, shape: [0, 4, 7, 11, 14] }, // Gmaj9
  { root: 45, shape: [0, 4, 7, 9, 14] }, // A6/9
];
const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
/** Where the bells ring in each bar (beats) and which chord tone each takes (an index into the shape, shifted per bar). */
const BELLS: { beat: number; tone: number }[] = [
  { beat: 0.5, tone: 4 },
  { beat: 1.75, tone: 2 },
  { beat: 3, tone: 1 },
];

function voice(ctx: BaseAudioContext, out: AudioNode, freq: number, at: number, dur: number, peak: number, attack: number, release: number) {
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(freq, at);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.linearRampToValueAtTime(peak, at + attack);
  g.gain.setValueAtTime(peak, at + Math.max(attack, dur - release));
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(out);
  o.start(at);
  o.stop(at + dur + 0.05);
}

/** Writes the mythic's layer into `ctx` (time 0 = the loop's start), as stems-synth's writeLayer does the others. */
export function writeMythicLayer(ctx: BaseAudioContext, out: AudioNode) {
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 5200;
  lp.connect(out);
  for (let bar = 0; bar < SCORE_BARS; bar++) {
    const { root, shape } = PROGRESSION[bar % PROGRESSION.length]!;
    const t = bar * BAR;
    // The glass pad: the third, the fifth and the ninth two octaves up, each a pair a few cents apart.
    for (const n of [shape[1]!, shape[2]!, shape[4]!]) {
      const f = hz(root + 24 + n);
      for (const cents of [-SHIMMER, SHIMMER]) voice(ctx, lp, f * 2 ** (cents / 1200), t, BAR + 1.2, 0.011, 1.1, 1.5);
    }
    // The bells, high above, with a softer octave: a little sparkle that moves through the chord bar by bar.
    for (const b of BELLS) {
      const f = hz(root + 36 + shape[(b.tone + bar) % shape.length]!);
      const at = t + b.beat * BEAT;
      voice(ctx, lp, f, at, 1.8, 0.02, 0.006, 1.75);
      voice(ctx, lp, f * 2, at, 1.1, 0.006, 0.006, 1.05);
    }
  }
}

type OfflineCtor = new (channels: number, length: number, rate: number) => OfflineAudioContext;

let cached: Promise<AudioBuffer | null> | null = null;

/** The mythic's layer, rendered once per page as long as the other layers' loop (null where offline rendering is missing). */
export function synthMythicStem(rate = 44_100): Promise<AudioBuffer | null> {
  cached ??= (async () => {
    const Offline = (globalThis as { OfflineAudioContext?: OfflineCtor }).OfflineAudioContext;
    if (!Offline) return null;
    const length = Math.round(SCORE_LENGTH * rate);
    const ctx = new Offline(2, length + Math.round(TAIL * rate), rate);
    const level = ctx.createGain();
    level.gain.value = 0.9;
    level.connect(ctx.destination);
    writeMythicLayer(ctx, level);
    const rendered = await ctx.startRendering();
    return foldTail(rendered, length, (ch, len, r) => ctx.createBuffer(ch, len, r));
  })().catch(() => null);
  return cached;
}

/** Tests only: forget the rendered layer. */
export function resetMythicStem() {
  cached = null;
}
