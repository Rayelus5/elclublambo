import type { AdminRunReplay } from '@galaxy/shared';
import { createReplayer, type InputLog, type Replayer, runSummary, type Sim, type SimEvent, type SimOptions } from '@galaxy/sim';

// The panel's replayer (GDD §16.2, §16.6; M6d-3): a recorded run played forwards a few ticks per frame, sought
// backwards by rebuilding it from tick 0 (the simulation cannot run backwards, and a full run replays in a second or
// two), never past the run's last tick, and compared at the end with what the server kept.

/** A replay's start as simulation options: its seed, content and sector, and the probe with its snapshot. */
export function replayOptionsOf(start: AdminRunReplay['start']): SimOptions {
  return {
    seed: start.seed,
    content: start.content,
    sector: start.sector,
    probes: [{ probe: start.probe, relics: start.relics, bonuses: start.bonuses, variant: start.variant }],
    record: false,
  };
}

export interface Playback {
  readonly sim: Sim;
  readonly tick: number;
  /** The run reached its last tick (or the log stopped it): nothing more to play until a seek. */
  readonly ended: boolean;
  /** Plays `ticks` world ticks (level-up choices on the way do not count), handing each step's events to `onStep`. */
  advance(ticks: number, onStep?: (events: readonly SimEvent[]) => void): void;
  /** Goes back to tick 0, as at the start. */
  rewind(): void;
  /** Lands on `tick` (rebuilt from 0 when it is behind), without handing over events. */
  seek(tick: number): void;
}

export function createPlayback(opts: SimOptions, log: InputLog, until: number): Playback {
  let r: Replayer = createReplayer(opts, log, until);
  let ended = false;
  const advance = (ticks: number, onStep?: (events: readonly SimEvent[]) => void) => {
    const target = r.sim.tick + Math.max(0, ticks);
    while (!ended && r.sim.tick < target) {
      if (!r.next()) {
        ended = true;
        break;
      }
      onStep?.(r.sim.events);
    }
    // At the last tick with nothing left to choose, the run is over even if this call did not try a step past it.
    if (r.sim.tick >= until && r.sim.status !== 'choosing') ended = true;
  };
  const rewind = () => {
    r = createReplayer(opts, log, until);
    ended = false;
  };
  return {
    get sim() {
      return r.sim;
    },
    get tick() {
      return r.sim.tick;
    },
    get ended() {
      return ended;
    },
    advance,
    rewind,
    seek(tick: number) {
      if (tick < r.sim.tick) rewind();
      advance(tick - r.sim.tick);
    },
  };
}

export type CheckKey = 'hash' | 'ticks' | 'kills' | 'depth' | 'level';
export interface CheckRow {
  key: CheckKey;
  saved: string | number | null;
  replayed: string | number;
  same: boolean;
}

/** The replay's end against what the server kept: the state's hash decides, the rest says where it parted. */
export function checkReplay(sim: Sim, run: AdminRunReplay['run']): { matches: boolean; rows: CheckRow[] } {
  const s = runSummary(sim);
  const rows: CheckRow[] = (
    [
      ['hash', run.hash, s.hash],
      ['ticks', run.ticks, s.ticks],
      ['kills', run.kills, s.kills],
      ['depth', run.depth, s.depth],
      ['level', run.level, s.level],
    ] as const
  ).map(([key, saved, replayed]) => ({ key, saved, replayed, same: saved === replayed }));
  return { matches: rows.every((r) => r.same), rows };
}
