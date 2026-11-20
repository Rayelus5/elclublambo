// The scanner's music while a pro reveal plays (plan «escáner pro», part B): layers of one loop started at the same
// instant, so they stay locked sample for sample, and faded in and out by the rarest card seen so far. The base plays
// from the ignition; a rare adds the arpeggio, an epic the choir, a legendary the bells and drums, and a mythic (plan
// «rareza Mítica» M2) a fifth layer of its own, a shimmer over them all. Only the gains move (smooth ramps), never the
// sources, so changing layer never clicks. A mythic's held breath ducks the whole score for a moment (one master gain
// after the layers), and lets it up again for the impact.

/** How many layers play: 0 the base … 3 a legendary's, 4 a mythic's. */
export type ScoreLevel = 0 | 1 | 2 | 3 | 4;

export interface Score {
  /** Starts every layer at `at` (audio-context seconds), the base audible over `fade` seconds. */
  start(at: number, fade?: number): void;
  /** From `at`, the layers up to `level` play (crossfading over `fade` seconds). Missing layers are simply silent. */
  level(level: ScoreLevel, at: number, fade?: number): void;
  /** Ducks the whole score to `depth` from `at` for `dur` seconds, then lets it back up. */
  duck(at: number, dur: number, depth?: number): void;
  /** Lets a duck go at once (a jump out of the held breath). */
  unduck(at: number): void;
  /** Fades everything out by `at + fade` and stops. */
  stop(at: number, fade?: number): void;
  readonly started: boolean;
}

/** How fast a duck goes down and comes back up (seconds). */
const DUCK_IN = 0.2;
const DUCK_OUT = 0.25;

/** The score of `layers` (in order: base, rare, epic, legendary, mythic) into `out`, optionally looping a section. */
export function createScore(ctx: BaseAudioContext, out: AudioNode, layers: readonly AudioBuffer[], loop?: { start: number; end: number }): Score {
  const gains = layers.map(() => {
    const g = ctx.createGain();
    g.gain.value = 0;
    return g;
  });
  const master = ctx.createGain();
  master.gain.value = 1;
  master.connect(out);
  for (const g of gains) g.connect(master);
  const sources: AudioBufferSourceNode[] = [];
  let started = false;
  let current: ScoreLevel = 0;

  const ramp = (g: GainNode, value: number, at: number, fade: number) => {
    g.gain.cancelScheduledValues(at);
    g.gain.setValueAtTime(g.gain.value, at);
    g.gain.linearRampToValueAtTime(value, at + Math.max(0.01, fade));
  };

  return {
    start(at, fade = 1.5) {
      if (started) return;
      started = true;
      layers.forEach((buffer, i) => {
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.loop = true;
        if (loop) {
          src.loopStart = loop.start;
          src.loopEnd = loop.end;
        }
        src.connect(gains[i]!);
        src.start(at);
        sources.push(src);
      });
      ramp(gains[0]!, 1, at, fade);
    },
    level(level, at, fade = 1.2) {
      current = level;
      gains.forEach((g, i) => {
        if (i > 0) ramp(g, i <= current ? 1 : 0, at, fade);
      });
    },
    duck(at, dur, depth = 0.2) {
      const down = Math.min(DUCK_IN, Math.max(0.01, dur / 2));
      master.gain.cancelScheduledValues(at);
      master.gain.setValueAtTime(master.gain.value, at);
      master.gain.linearRampToValueAtTime(depth, at + down);
      master.gain.setValueAtTime(depth, at + Math.max(down, dur));
      master.gain.linearRampToValueAtTime(1, at + Math.max(down, dur) + DUCK_OUT);
    },
    unduck(at) {
      ramp(master, 1, at, 0.15);
    },
    stop(at, fade = 1) {
      gains.forEach((g) => ramp(g, 0, at, fade));
      for (const s of sources) {
        try {
          s.stop(at + fade + 0.05);
        } catch {
          // Already stopped.
        }
      }
      sources.length = 0;
    },
    get started() {
      return started;
    },
  };
}
