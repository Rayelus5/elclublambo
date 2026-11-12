// The scanner's music while a pro reveal plays (plan «escáner pro», part B): four layers of one loop started at the
// same instant, so they stay locked sample for sample, and faded in and out by the rarest card seen so far. The base
// plays from the ignition; a rare adds the arpeggio, an epic the choir, a legendary the bells and drums. Only the
// gains move (smooth ramps), never the sources, so changing layer never clicks.

export interface Score {
  /** Starts every layer at `at` (audio-context seconds), the base audible over `fade` seconds. */
  start(at: number, fade?: number): void;
  /** From `at`, the layers up to `level` play (crossfading over `fade` seconds). */
  level(level: 0 | 1 | 2 | 3, at: number, fade?: number): void;
  /** Fades everything out by `at + fade` and stops. */
  stop(at: number, fade?: number): void;
  readonly started: boolean;
}

export function createScore(ctx: BaseAudioContext, out: AudioNode, layers: readonly AudioBuffer[], loop?: { start: number; end: number }): Score {
  const gains = layers.map(() => {
    const g = ctx.createGain();
    g.gain.value = 0;
    g.connect(out);
    return g;
  });
  const sources: AudioBufferSourceNode[] = [];
  let started = false;
  let current = 0;

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
