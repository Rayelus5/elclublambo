import { createSim, step } from './sim';
import { CoopFeed } from './coop-feed';
import { DASH, MOVE, PICK, PICK_SEQ, PRESENCE } from './log';
import { IDLE, type InputLog, type ProbeInput, type Sim, type SimOptions } from './types';

// Recorded inputs (GDD §5.7, §14.7). A run keeps, per probe, the input in effect whenever it changes (movement and
// aim) and every level-up choice with the tick it was made at. That is enough to replay the run exactly: same
// options + same log → same state, tick by tick.
//
// Binary format, version 1: [1] [probes: varint] then events [Δtick: varint] [probe: varint] [kind: byte] and
//   kind 0 (move): [mx + 127: byte] [my + 127: byte] [aim + 1: varint]
//   kind 1 (pick): [index: byte]
// Version 2 (co-op, multiplayer plan) is the same with two more kinds; a log without them is still written as 1:
//   kind 2 (pick while the world runs): [index: byte] [offer sequence mod 256: byte]
//   kind 3 (presence): [0 here, 1 away, 2 left: byte]
// Both versions also have, since SIM 1.12.0, the player's dash (a solo kind too: a dash does not make a log co-op):
//   kind 4 (dash): [pointer angle + 1: varint]

const VERSION = 1;
const VERSION_COOP = 2;

function bad(): never {
  throw new RangeError('bad_log');
}

function pushVarint(out: number[], n: number): void {
  let v = n;
  while (v >= 0x80) {
    out.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  out.push(v);
}

/** Writes `ev`'s events after `prevTick` (no header); `solo` refuses the co-op kinds. The last tick written. */
function writeEvents(out: number[], ev: readonly number[], prevTick: number, solo: boolean): number {
  let prev = prevTick;
  for (let i = 0; i + 5 < ev.length; i += 6) {
    const tick = ev[i]!;
    const kind = ev[i + 2]!;
    if (tick < prev || (solo && kind !== MOVE && kind !== PICK && kind !== DASH)) bad();
    pushVarint(out, tick - prev);
    prev = tick;
    pushVarint(out, ev[i + 1]!);
    out.push(kind);
    if (kind === MOVE) {
      out.push(ev[i + 3]! + 127, ev[i + 4]! + 127);
      pushVarint(out, ev[i + 5]! + 1);
    } else if (kind === PICK_SEQ) out.push(ev[i + 3]!, ev[i + 4]!);
    else if (kind === DASH) pushVarint(out, ev[i + 3]! + 1);
    else out.push(ev[i + 3]!);
  }
  return prev;
}

export function encodeLog(log: InputLog): Uint8Array {
  let coop = false;
  for (let i = 2; i < log.events.length; i += 6) if (log.events[i] === PICK_SEQ || log.events[i] === PRESENCE) coop = true;
  const out: number[] = [coop ? VERSION_COOP : VERSION];
  pushVarint(out, log.probes);
  writeEvents(out, log.events, 0, false);
  return Uint8Array.from(out);
}

/**
 * A piece of a solo run's log (plan «escáner pro», part G): `events` encoded as encodeLog does, without its header and
 * counting ticks from `prevTick` (the tick the previous piece reached). The pieces of a log one after another, behind
 * encodeLog's header, are encodeLog's bytes. Only the solo kinds (moves and picks), in tick order.
 */
export function encodeEvents(events: readonly number[], prevTick: number): { bytes: Uint8Array; tick: number } {
  const out: number[] = [];
  const tick = writeEvents(out, events, prevTick, true);
  return { bytes: Uint8Array.from(out), tick };
}

/** Reads events from `pos` to the end, counting ticks from `tick`. */
function readEvents(bytes: Uint8Array, start: number, tick0: number, probes: number, coop: boolean): { events: number[]; tick: number } {
  let pos = start;
  const byte = () => (pos < bytes.length ? bytes[pos++]! : bad());
  const varint = () => {
    let n = 0;
    let mul = 1;
    for (let k = 0; k < 5; k++) {
      const b = byte();
      n += (b & 0x7f) * mul;
      if (b < 0x80) return n;
      mul *= 128;
    }
    return bad();
  };
  const events: number[] = [];
  let tick = tick0;
  while (pos < bytes.length) {
    tick += varint();
    const probe = varint();
    if (probe >= probes) bad();
    const kind = byte();
    if (kind === MOVE) {
      const mx = byte() - 127;
      const my = byte() - 127;
      const aim = varint() - 1;
      if (mx > 127 || my > 127 || aim > 4095) bad();
      events.push(tick, probe, MOVE, mx, my, aim);
    } else if (kind === PICK) {
      const pick = byte();
      if (pick > 15) bad();
      events.push(tick, probe, PICK, pick, 0, 0);
    } else if (kind === PICK_SEQ && coop) {
      const pick = byte();
      const seq = byte();
      if (pick > 15) bad();
      events.push(tick, probe, PICK_SEQ, pick, seq, 0);
    } else if (kind === PRESENCE && coop) {
      const state = byte();
      if (state > 2) bad();
      events.push(tick, probe, PRESENCE, state, 0, 0);
    } else if (kind === DASH) {
      const angle = varint() - 1;
      if (angle > 4095) bad();
      events.push(tick, probe, DASH, angle, 0, 0);
    } else bad();
  }
  return { events, tick };
}

export function decodeLog(bytes: Uint8Array): InputLog {
  if (bytes.length === 0) bad();
  const version = bytes[0]!;
  if (version !== VERSION && version !== VERSION_COOP) bad();
  let pos = 1;
  let probes = 0;
  let mul = 1;
  for (let k = 0; ; k++) {
    if (k >= 5 || pos >= bytes.length) bad();
    const b = bytes[pos++]!;
    probes += (b & 0x7f) * mul;
    if (b < 0x80) break;
    mul *= 128;
  }
  if (probes < 1 || probes > 16) bad();
  return { probes, events: readEvents(bytes, pos, 0, probes, version === VERSION_COOP).events };
}

/**
 * Reads a piece written by encodeEvents (part G), counting ticks from `prevTick`, for a run of `probes` probes. Throws
 * on anything that is not a solo run's moves, picks and dashes: co-op kinds, a probe the run does not have, a cut-short
 * event.
 */
export function decodeEvents(bytes: Uint8Array, prevTick: number, probes: number): { events: number[]; tick: number } {
  return readEvents(bytes, 0, prevTick, probes, false);
}

/** The last tick the log mentions (0 when empty). */
export function logTicks(log: InputLog): number {
  return log.events.length >= 6 ? log.events[log.events.length - 6]! : 0;
}

/** A recorded run stepped one `step()` at a time (the panel's replayer draws it as it goes, M6d-3). */
export interface Replayer {
  readonly sim: Sim;
  /**
   * One step: the level-up choice the log made while the world was frozen, or one world tick with the moves in effect.
   * False once the run is over, the log disagrees at a choice (or ends there), or the world reached `until`.
   */
  next(): boolean;
}

/**
 * Replays a run from its options and log, one step per `next()`, up to `until` (or until it ends). The options must be
 * the run's own (seed, content, sector, probes and relics). Moves logged at tick T drive the step that simulates T;
 * choices logged at tick T were made while the world was frozen after T, so they come after T's moves in the log.
 */
export function createReplayer(opts: SimOptions, log: InputLog, until: number): Replayer {
  const sim = createSim({ ...opts, record: false });
  if (log.probes !== sim.probes.length) bad();
  if (sim.coop) return coopReplayer(sim, log, until);
  const current: ProbeInput[] = sim.probes.map(() => ({ ...IDLE }));
  const ev = log.events;
  let i = 0;
  let stopped = false;
  function next(): boolean {
    if (stopped || (sim.status !== 'running' && sim.status !== 'choosing')) return false;
    if (sim.status === 'choosing') {
      if (!(i + 5 < ev.length) || ev[i + 2] !== PICK || ev[i]! !== sim.tick) {
        stopped = true; // the log ends (or disagrees) here
        return false;
      }
      const inputs = sim.probes.map(() => IDLE);
      inputs[ev[i + 1]!] = { ...IDLE, pick: ev[i + 3]! };
      i += 6;
      step(sim, inputs);
      return true;
    }
    if (sim.tick >= until) return false;
    i = worldStep(sim, current, ev, i);
    return true;
  }
  return { sim, next };
}

/**
 * One world tick of a solo replay: the moves logged up to it (sticky) and the dashes logged on it (that tick only),
 * then the step. Where the log goes on.
 */
function worldStep(sim: Sim, current: ProbeInput[], ev: readonly number[], from: number): number {
  let i = from;
  const nextTick = sim.tick + 1;
  let dashes: Map<number, number> | null = null;
  while (i + 5 < ev.length && (ev[i + 2] === MOVE || ev[i + 2] === DASH) && ev[i]! <= nextTick) {
    const p = ev[i + 1]!;
    if (ev[i + 2] === MOVE) current[p] = { mx: ev[i + 3]!, my: ev[i + 4]!, aim: ev[i + 5]!, pick: -1 };
    else (dashes ??= new Map()).set(p, ev[i + 3]!);
    i += 6;
  }
  const asked = dashes;
  step(sim, asked ? current.map((c, k) => (asked.has(k) ? { ...c, dash: asked.get(k)! } : c)) : current);
  return i;
}

/** A solo run replayed as its log arrives (part G). */
export interface LiveReplayer {
  readonly sim: Sim;
  /** More of the log, in order (decodeEvents' events). */
  push(events: readonly number[]): void;
  /**
   * One step towards `to`, the tick the player had reached when it sent what arrived: 'stepped'; 'wait' at `to`, or at a
   * level-up choice whose pick has not arrived yet; 'over' once the run ended or the log disagrees at a choice.
   */
  next(to: number): 'stepped' | 'wait' | 'over';
}

/**
 * The live viewer's replayer (part G): `createReplayer` that never stops for lack of log, it waits for more. Moves logged
 * at tick T drive the step that simulates T, so it only steps up to the tick the player had reached; a choice waits for
 * its pick.
 */
export function createLiveReplayer(opts: SimOptions): LiveReplayer {
  const sim = createSim({ ...opts, record: false });
  if (sim.coop) bad();
  const current: ProbeInput[] = sim.probes.map(() => ({ ...IDLE }));
  const ev: number[] = [];
  let i = 0;
  let over = false;
  function next(to: number): 'stepped' | 'wait' | 'over' {
    if (over || (sim.status !== 'running' && sim.status !== 'choosing')) return 'over';
    if (sim.status === 'choosing') {
      if (!(i + 5 < ev.length)) return 'wait';
      if (ev[i + 2] !== PICK || ev[i]! !== sim.tick) {
        over = true;
        return 'over';
      }
      const inputs = sim.probes.map(() => IDLE);
      inputs[ev[i + 1]!] = { ...IDLE, pick: ev[i + 3]! };
      i += 6;
      step(sim, inputs);
      return 'stepped';
    }
    if (sim.tick >= to) return 'wait';
    i = worldStep(sim, current, ev, i);
    return 'stepped';
  }
  return {
    sim,
    push(events) {
      for (const n of events) ev.push(n);
    },
    next,
  };
}

/**
 * A co-op run replayed (multiplayer plan): the world never pauses, so every step is one tick. Moves and presence
 * logged at tick T are in effect from T on (sticky); a pick logged at T is given at T only, with its offer.
 */
function coopReplayer(sim: Sim, log: InputLog, until: number): Replayer {
  const feed = new CoopFeed(sim.probes.length);
  feed.push(log.events);
  function next(): boolean {
    if (sim.status !== 'running' || sim.tick >= until) return false;
    step(sim, feed.inputsFor(sim.tick + 1));
    return true;
  }
  return { sim, next };
}

/** Replays a run from its options and log up to `untilTick` (or until it ends): `createReplayer` run to its end. */
export function replay(opts: SimOptions, log: InputLog, untilTick: number): Sim {
  const r = createReplayer(opts, log, untilTick);
  while (r.next());
  return r.sim;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_INDEX = new Int16Array(128).fill(-1);
for (let k = 0; k < B64.length; k++) B64_INDEX[B64.charCodeAt(k)] = k;

/** Standard base64 with padding (no Buffer, no btoa: the same code in the browser and on the server). */
export function toBase64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]! + B64[n & 63]!;
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i]! << 16;
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + '==';
  } else if (rest === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]! + '=';
  }
  return out;
}

export function fromBase64(s: string): Uint8Array {
  if (s.length % 4 !== 0) throw new RangeError('bad_base64');
  const pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((s.length / 4) * 3 - pad);
  let o = 0;
  for (let i = 0; i < s.length; i += 4) {
    let n = 0;
    for (let k = 0; k < 4; k++) {
      const c = s.charCodeAt(i + k);
      const isPad = c === 61 && i + k >= s.length - pad;
      const v = isPad ? 0 : c < 128 ? B64_INDEX[c]! : -1;
      if (v < 0) throw new RangeError('bad_base64');
      n = n * 64 + v;
    }
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}
