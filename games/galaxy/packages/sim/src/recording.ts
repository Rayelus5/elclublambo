import { createSim, step } from './sim';
import { MOVE, PICK } from './log';
import { IDLE, type InputLog, type ProbeInput, type Sim, type SimOptions } from './types';

// Recorded inputs (GDD §5.7, §14.7). A run keeps, per probe, the input in effect whenever it changes (movement and
// aim) and every level-up choice with the tick it was made at. That is enough to replay the run exactly: same
// options + same log → same state, tick by tick.
//
// Binary format, version 1: [1] [probes: varint] then events [Δtick: varint] [probe: varint] [kind: byte] and
//   kind 0 (move): [mx + 127: byte] [my + 127: byte] [aim + 1: varint]
//   kind 1 (pick): [index: byte]

const VERSION = 1;

function bad(): never {
  throw new RangeError('bad_log');
}

export function encodeLog(log: InputLog): Uint8Array {
  const out: number[] = [VERSION];
  const varint = (n: number) => {
    let v = n;
    while (v >= 0x80) {
      out.push((v & 0x7f) | 0x80);
      v = Math.floor(v / 128);
    }
    out.push(v);
  };
  varint(log.probes);
  let prev = 0;
  const ev = log.events;
  for (let i = 0; i + 5 < ev.length; i += 6) {
    const tick = ev[i]!;
    varint(tick - prev);
    prev = tick;
    varint(ev[i + 1]!);
    const kind = ev[i + 2]!;
    out.push(kind);
    if (kind === MOVE) {
      out.push(ev[i + 3]! + 127, ev[i + 4]! + 127);
      varint(ev[i + 5]! + 1);
    } else out.push(ev[i + 3]!);
  }
  return Uint8Array.from(out);
}

export function decodeLog(bytes: Uint8Array): InputLog {
  let pos = 0;
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
  if (byte() !== VERSION) bad();
  const probes = varint();
  if (probes < 1 || probes > 16) bad();
  const events: number[] = [];
  let tick = 0;
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
    } else bad();
  }
  return { probes, events };
}

/** The last tick the log mentions (0 when empty). */
export function logTicks(log: InputLog): number {
  return log.events.length >= 6 ? log.events[log.events.length - 6]! : 0;
}

/**
 * Replays a run from its options and log up to `untilTick` (or until it ends). The options must be the run's own
 * (seed, content, sector, probes and relics). Moves logged at tick T drive the step that simulates T; choices logged at
 * tick T were made while the world was frozen after T, so they come after T's moves in the log.
 */
export function replay(opts: SimOptions, log: InputLog, untilTick: number): Sim {
  const sim = createSim({ ...opts, record: false });
  if (log.probes !== sim.probes.length) bad();
  const current: ProbeInput[] = sim.probes.map(() => ({ ...IDLE }));
  const ev = log.events;
  let i = 0;
  while (sim.status === 'running' || sim.status === 'choosing') {
    if (sim.status === 'choosing') {
      if (!(i + 5 < ev.length) || ev[i + 2] !== PICK || ev[i]! !== sim.tick) break; // the log ends (or disagrees) here
      const inputs = sim.probes.map(() => IDLE);
      inputs[ev[i + 1]!] = { ...IDLE, pick: ev[i + 3]! };
      i += 6;
      step(sim, inputs);
      continue;
    }
    if (sim.tick >= untilTick) break;
    const next = sim.tick + 1;
    while (i + 5 < ev.length && ev[i + 2] === MOVE && ev[i]! <= next) {
      current[ev[i + 1]!] = { mx: ev[i + 3]!, my: ev[i + 4]!, aim: ev[i + 5]!, pick: -1 };
      i += 6;
    }
    step(sim, current);
  }
  return sim;
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
