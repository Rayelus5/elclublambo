import type { SoloFeedState, SoloWatchMessage } from '@galaxy/shared';
import { createLiveReplayer, decodeEvents, decodeLog, fromBase64, type LiveReplayer, logTicks, type Sim, type SimEvent } from '@galaxy/sim';
import { replayOptionsOf } from './playback';

// A solo run watched live from the panel (plan «escáner pro», part G): the staff socket's messages turned into a
// simulation that follows the player's. The hello brings the start and the whole log so far, each piece the rest; the
// screen advances it a few steps per frame (many while it catches up) and it waits at the live edge, or at a level-up
// whose pick has not arrived, instead of stopping. Pure: no socket, no canvas, so it is tested on its own.

type Hello = Extract<SoloWatchMessage, { t: 'hello' }>;
/** Before the hello, the player's state, the run over (its result saved), or a log that did not read. */
export type LiveFeedState = 'connecting' | SoloFeedState | 'ended' | 'broken';

export interface LiveFeed {
  readonly hello: Hello | null;
  readonly sim: Sim | null;
  readonly state: LiveFeedState;
  /** The tick the player's run had reached. */
  readonly to: number;
  /** Ticks between the replay and the player. */
  readonly behind: number;
  /** At a level-up, waiting for the pick. */
  readonly waiting: boolean;
  apply(msg: SoloWatchMessage): void;
  /** Up to `max` steps towards the player, each step's events to `onStep`; how many it took. */
  advance(max: number, onStep?: (events: readonly SimEvent[]) => void): number;
}

export function createLiveFeed(): LiveFeed {
  let hello: Hello | null = null;
  let live: LiveReplayer | null = null;
  let state: LiveFeedState = 'connecting';
  let to = 0;
  let prevTick = 0;
  let last: 'stepped' | 'wait' | 'over' = 'wait';

  function apply(msg: SoloWatchMessage): void {
    if (state === 'broken') return;
    try {
      if (msg.t === 'hello') {
        const log = decodeLog(fromBase64(msg.log));
        live = createLiveReplayer(replayOptionsOf(msg.start));
        live.push(log.events);
        prevTick = logTicks(log);
        hello = msg;
        to = msg.to;
        state = msg.s;
      } else if (msg.t === 'f') {
        if (!live) return;
        const read = decodeEvents(fromBase64(msg.b), prevTick, 1);
        live.push(read.events);
        prevTick = read.tick;
        to = Math.max(to, msg.to);
        state = msg.s;
      } else if (msg.t === 'st') {
        state = msg.s;
      } else {
        state = 'ended';
      }
    } catch {
      state = 'broken';
    }
  }

  function advance(max: number, onStep?: (events: readonly SimEvent[]) => void): number {
    if (!live || state === 'broken') return 0;
    let n = 0;
    while (n < max) {
      last = live.next(to);
      if (last !== 'stepped') break;
      n++;
      if (live.sim.events.length) onStep?.(live.sim.events);
    }
    return n;
  }

  return {
    get hello() {
      return hello;
    },
    get sim() {
      return live?.sim ?? null;
    },
    get state() {
      return state;
    },
    get to() {
      return to;
    },
    get behind() {
      return live ? Math.max(0, to - live.sim.tick) : 0;
    },
    get waiting() {
      return !!live && last === 'wait' && live.sim.status === 'choosing';
    },
    apply,
    advance,
  };
}
