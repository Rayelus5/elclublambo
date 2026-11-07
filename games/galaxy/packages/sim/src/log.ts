import { IDLE, type InputLog, type ProbeInput, type Sim } from './types';

// Writing the input log during a run (the format and the replay live in recording.ts).

export const MOVE = 0;
export const PICK = 1;

const lastMove = new WeakMap<InputLog, number[]>();

function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(lo, Math.min(hi, Math.trunc(v)));
}

/** Called by step() after the probes moved: logs each probe's input if it changed. */
export function recordMoves(sim: Sim, inputs: readonly ProbeInput[]): void {
  const log = sim.log;
  if (!log) return;
  let last = lastMove.get(log);
  if (!last) {
    last = Array.from({ length: log.probes * 3 }, (_, i) => (i % 3 === 2 ? -1 : 0));
    lastMove.set(log, last);
  }
  for (const p of sim.probes) {
    const input = inputs[p.index] ?? IDLE;
    const mx = clamp(input.mx, -127, 127);
    const my = clamp(input.my, -127, 127);
    const aim = Number.isInteger(input.aim) && input.aim >= 0 && input.aim < 4096 ? input.aim : -1;
    const k = p.index * 3;
    if (last[k] === mx && last[k + 1] === my && last[k + 2] === aim) continue;
    last[k] = mx;
    last[k + 1] = my;
    last[k + 2] = aim;
    log.events.push(sim.tick, p.index, MOVE, mx, my, aim);
  }
}
