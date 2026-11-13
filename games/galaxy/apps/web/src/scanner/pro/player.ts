import type { Bank } from '../../audio/bank';
import type { Score, ScoreLevel } from '../../audio/score';
import type { StageClock } from './clock';
import type { CueOpts, ProSound } from './cues';
import { type Face, GUION, nextStop, type Phase, phaseAt, type Script } from './script';
import type { Rig } from './timeline';

// The pro scanner's player (plan «escáner pro», part B): one frame loop that reads the clock, seeks the timeline there,
// draws the scene and the overlays, and schedules the sounds and the music's layers ahead on the audio clock. It keeps
// the waits — the single card's (until the player goes on), a card whose image is still coming (up to 4 s, then it
// turns anyway) — and moves through the script: «Seguir» to the next stop, «Saltar» to the summary. Seeking silences
// what was scheduled and sets the music to what has been revealed; skipping past a reveal still lets it be heard.
// A mythic's held breath (plan «rareza Mítica» M2) ducks the music, scheduled like its layers; a jump lifts it again.

/** How far ahead sounds are scheduled (seconds of script time at 1×). */
const LOOKAHEAD = 0.12;
/** Input is ignored this long after the start and after each jump (a double click, a held key). */
export const GUARD_START_MS = 400;
export const GUARD_SEEK_MS = 250;
/** How long a card waits for its image before it turns anyway. */
export const IMAGE_WAIT_MS = 4000;
/** A card waits for its image this long before it shows its face (its turn starts about then). */
const GATE_LEAD = 0.45;

export interface PlayerAudio {
  ctx: BaseAudioContext;
  /** The effects bus (sounds) and the music bus (the score), both under the game's mixer. */
  sfx: AudioNode;
  music: AudioNode;
}

export interface PlayerDeps {
  script: Script;
  rig: Rig;
  timeline: { time(t: number): unknown };
  clock: StageClock;
  scene?: { render(rig: Rig, t: number, dt: number): void } | null;
  paint?: (rig: Rig, t: number) => void;
  audio?: PlayerAudio | null;
  bank?: Bank<ProSound, CueOpts> | null;
  /** Whether a card's image is ready (by slot). */
  ready?: (slot: number) => boolean;
  onPhase?: (p: Phase) => void;
  onFace?: (f: Face) => void;
  /** A card is waiting for its image (true), or no longer (false). */
  onWait?: (waiting: boolean) => void;
  /** The frame loop (tests drive it by hand). */
  raf?: (cb: (now: number) => void) => number;
  caf?: (id: number) => void;
  /** Real milliseconds (the guards, the image wait). */
  now?: () => number;
}

export interface Player {
  start(): void;
  /** One frame by hand (tests; the loop calls it too). */
  frame(): void;
  /** «Seguir»: to the next stop. Ignored inside the guards. */
  advance(): boolean;
  /** «Saltar»: to the summary. */
  skip(): boolean;
  /** To any moment (the Ensayo's «ir a fase»). */
  seek(t: number): void;
  setRate(rate: number): void;
  pause(): void;
  resume(): void;
  /** The music, once its layers are ready (it joins at the layer the reveal is at). */
  setScore(score: Score): void;
  /** Where the music's layers go (its own bus under the music bus, so slow motion and pauses can hush it). */
  readonly scoreOut: AudioNode | null;
  stop(): void;
  readonly time: number;
  readonly phase: Phase;
}

export function createPlayer(deps: PlayerDeps): Player {
  const { script: s, rig, timeline, clock } = deps;
  const realNow = deps.now ?? (() => performance.now());
  const raf = deps.raf ?? ((cb) => requestAnimationFrame(cb));
  const caf = deps.caf ?? ((id) => cancelAnimationFrame(id));
  const audio = deps.audio ?? null;
  const summaryAt = s.phases.find((p) => p.kind === 'resumen')!.at;

  let cueBus: GainNode | null = null;
  const newCueBus = () => {
    if (!audio) return;
    const g = audio.ctx.createGain();
    g.gain.value = 1;
    g.connect(audio.sfx);
    cueBus = g;
  };
  newCueBus();
  const scoreBus: GainNode | null = audio ? audio.ctx.createGain() : null;
  if (audio && scoreBus) scoreBus.connect(audio.music);

  let score: Score | null = null;
  let cueAt = 0;
  let scoreAt = 0;
  let hushAt = 0;
  let lastT = -1;
  let lastPhase: Phase | null = null;
  let faceAt = 0;
  let raf0 = 0;
  let running = false;
  let lastFrame = 0;
  let guardUntil = 0;
  /** The card the clock is stopped for, and since when (real ms) — only once it has actually reached it. */
  let gate: { slot: number; at: number } | null = null;
  let waiting: { slot: number; since: number } | null = null;
  const forced = new Set<number>();

  const ctxTime = (t: number) => (audio ? audio.ctx.currentTime + clock.until(t) : 0);
  const levelAt = (t: number) => {
    let level: ScoreLevel = 0;
    for (const x of s.score) if (x.at <= t + 1e-9) level = x.level;
    return level;
  };
  /** The first hush that has not begun by `t`. */
  const hushFrom = (t: number) => {
    const i = s.hushes.findIndex((h) => h.at > t + 1e-9);
    return i < 0 ? s.hushes.length : i;
  };
  /** Ducks the music for whatever is left of a hush `t` falls inside (a jump into the middle of one). */
  const duckInside = (t: number) => {
    if (!score || !audio) return;
    const h = s.hushes.find((x) => x.at <= t + 1e-9 && t < x.at + x.dur - 1e-9);
    if (h) score.duck(audio.ctx.currentTime, (h.at + h.dur - t) / clock.rate, GUION.silencio.duck);
  };

  function play(id: ProSound, at: number, opts: CueOpts) {
    if (!audio || !deps.bank || !cueBus) return;
    deps.bank.play(id, at, cueBus, opts);
  }

  /** The next wait from `t`: the next hold phase, or a card whose image is late. */
  function updateHold(t: number) {
    let hold: number | null = null;
    for (const p of s.phases) {
      if (p.hold && p.at >= t - 1e-9) {
        hold = p.at;
        break;
      }
    }
    // The summary's end is the last wait: it stays there.
    hold = Math.min(hold ?? s.duration, s.duration);
    gate = null;
    const ready = deps.ready;
    if (ready) {
      for (const f of s.faces) {
        const at = Math.max(0, f.at - GATE_LEAD);
        if (at < t - 1e-9 || at > hold) continue;
        if (ready(f.slot) || forced.has(f.slot)) continue;
        hold = at;
        gate = { slot: f.slot, at };
        break;
      }
    }
    if (clock.held !== hold) clock.holdAt(hold);
  }

  function schedule(t: number) {
    // Sounds: everything due within the look-ahead, on the audio clock.
    const horizon = t + LOOKAHEAD * clock.rate;
    while (cueAt < s.cues.length && s.cues[cueAt]!.at <= horizon) {
      const c = s.cues[cueAt]!;
      if (clock.until(c.at) === Infinity) break;
      play(c.id, ctxTime(c.at), { tier: c.tier, dur: c.dur !== undefined ? c.dur / clock.rate : undefined });
      cueAt++;
    }
    // The music: it starts with the ignition and climbs with each rarer face.
    if (score) {
      while (scoreAt < s.score.length && s.score[scoreAt]!.at <= horizon) {
        const x = s.score[scoreAt]!;
        if (clock.until(x.at) === Infinity) break;
        if (x.level > 0) score.level(x.level, ctxTime(x.at));
        scoreAt++;
      }
      // A mythic's held breath: the music ducks for it.
      while (hushAt < s.hushes.length && s.hushes[hushAt]!.at <= horizon) {
        const h = s.hushes[hushAt]!;
        if (clock.until(h.at) === Infinity) break;
        score.duck(ctxTime(h.at), h.dur / clock.rate, GUION.silencio.duck);
        hushAt++;
      }
    }
  }

  function frame() {
    const now = realNow();
    const dt = lastFrame ? Math.min(0.1, (now - lastFrame) / 1000) : 0;
    lastFrame = now;
    let t = clock.now();
    updateHold(t);
    // The clock has reached a card whose image is late: it waits, and turns anyway after a while (its window shows
    // only stars until the image arrives).
    if (gate && !waiting && t >= gate.at - 1e-6) {
      waiting = { slot: gate.slot, since: now };
      deps.onWait?.(true);
    }
    if (waiting && deps.ready) {
      const done = deps.ready(waiting.slot);
      if (done || now - waiting.since > IMAGE_WAIT_MS) {
        if (!done) forced.add(waiting.slot);
        waiting = null;
        deps.onWait?.(false);
        updateHold(t);
      }
    }
    t = clock.now();
    timeline.time(t);
    deps.scene?.render(rig, t, dt);
    deps.paint?.(rig, t);
    schedule(t);
    const p = phaseAt(s, t);
    if (p !== lastPhase) {
      lastPhase = p;
      deps.onPhase?.(p);
    }
    while (faceAt < s.faces.length && s.faces[faceAt]!.at <= t + 1e-9) deps.onFace?.(s.faces[faceAt++]!);
    lastT = t;
  }

  function loop() {
    if (!running) return;
    frame();
    raf0 = raf(loop);
  }

  function jump(target: number) {
    const from = clock.now();
    // Silence what was scheduled (a quick fade, never a click) and start a fresh bus.
    if (audio && cueBus) {
      const old = cueBus;
      const at = audio.ctx.currentTime;
      old.gain.setValueAtTime(old.gain.value, at);
      old.gain.linearRampToValueAtTime(0.0001, at + 0.03);
      setTimeout(() => old.disconnect(), 120);
      newCueBus();
    }
    // A reveal jumped over is still heard (one of each), unless it is the summary's single chord that closes it.
    if (target > from && target < summaryAt - 1e-9) {
      const seen = new Map<ProSound, (typeof s.cues)[number]>();
      for (const c of s.cues) if (c.essential && c.at > from + 1e-9 && c.at < target - 1e-9) seen.set(c.id, c);
      const at = audio ? audio.ctx.currentTime + 0.02 : 0;
      for (const c of seen.values()) play(c.id, at, { tier: c.tier });
    }
    clock.seek(target);
    cueAt = s.cues.findIndex((c) => c.at >= target - 1e-9);
    if (cueAt < 0) cueAt = s.cues.length;
    scoreAt = s.score.findIndex((x) => x.at > target + 1e-9);
    if (scoreAt < 0) scoreAt = s.score.length;
    hushAt = hushFrom(target);
    if (score?.started && audio) {
      score.level(levelAt(target), audio.ctx.currentTime, 0.25);
      score.unduck(audio.ctx.currentTime);
      duckInside(target);
    }
    faceAt = s.faces.findIndex((f) => f.at > target + 1e-9);
    if (faceAt < 0) faceAt = s.faces.length;
    // Faces jumped over need no image wait any more.
    for (const f of s.faces) if (f.at <= target) forced.add(f.slot);
    if (waiting) {
      waiting = null;
      deps.onWait?.(false);
    }
    guardUntil = realNow() + GUARD_SEEK_MS;
    updateHold(target);
    frame();
  }

  return {
    start() {
      if (running) return;
      running = true;
      guardUntil = realNow() + GUARD_START_MS;
      updateHold(clock.now());
      raf0 = raf(loop);
    },
    frame,
    advance() {
      if (realNow() < guardUntil) return false;
      const t = clock.now();
      if (t >= summaryAt - 1e-9) return false;
      jump(nextStop(s, t));
      return true;
    },
    skip() {
      if (realNow() < guardUntil) return false;
      if (clock.now() >= summaryAt - 1e-9) return false;
      jump(summaryAt);
      return true;
    },
    seek(t) {
      jump(Math.max(0, Math.min(s.duration, t)));
    },
    setRate(rate) {
      clock.setRate(rate);
      // The music only makes sense at its own speed: the Ensayo's slow motion plays without it.
      if (scoreBus && audio) scoreBus.gain.setTargetAtTime(rate === 1 ? 1 : 0, audio.ctx.currentTime, 0.05);
    },
    pause() {
      clock.pause();
      if (scoreBus && audio) scoreBus.gain.setTargetAtTime(0, audio.ctx.currentTime, 0.1);
    },
    resume() {
      clock.resume();
      if (scoreBus && audio) scoreBus.gain.setTargetAtTime(clock.rate === 1 ? 1 : 0, audio.ctx.currentTime, 0.2);
    },
    setScore(next) {
      score = next;
      scoreAt = s.score.findIndex((x) => x.at > clock.now() + 1e-9);
      if (scoreAt < 0) scoreAt = s.score.length;
      hushAt = hushFrom(clock.now());
      if (audio) {
        score.start(audio.ctx.currentTime + 0.05, 2);
        const level = levelAt(clock.now());
        if (level > 0) score.level(level, audio.ctx.currentTime + 0.05, 0.6);
        duckInside(clock.now());
      }
    },
    stop() {
      running = false;
      caf(raf0);
      if (audio) {
        const at = audio.ctx.currentTime;
        score?.stop(at, 1);
        if (cueBus) {
          cueBus.gain.setValueAtTime(cueBus.gain.value, at);
          cueBus.gain.linearRampToValueAtTime(0.0001, at + 0.4);
        }
      }
    },
    get time() {
      return lastT < 0 ? clock.now() : lastT;
    },
    get scoreOut() {
      return scoreBus;
    },
    get phase() {
      return phaseAt(s, clock.now());
    },
  };
}
