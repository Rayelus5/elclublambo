import { DASH } from '../log';
import { cosA, sinA } from '../math/trig';
import { IDLE, type ProbeInput, type ProbeState, type Sim } from '../types';
import { ticks } from '../version';
import { cometHit, cometRelics } from './relics';
import { nearestEnemies } from './weapons';

// The player's dash (owner's plan 2026-11-13, SIM 1.12.0): «no sea algo que ocurre con el tiempo, sino por decisión del
// jugador». Every probe has it: SHIFT, Space or the pad's A ask for one (ProbeInput.dash). It goes where the probe
// moves; still, towards the pointer (the angle sent with the press) or where it aims. It has charges that come back
// one at a time, a short pause between two dashes, and it is invulnerable while it lasts and a moment more. Spark's
// quirk makes it more agile; each comet relic adds a charge and makes it hit what it crosses. Never while a level-up
// choice freezes the world (step() does not get here) nor while the probe is down.

export interface DashRules {
  /** Charges when full. */
  max: number;
  /** Ticks for one charge to come back (the cooldown stat applies), and the least ticks between two dashes. */
  recharge: number;
  pause: number;
  /** Ticks a dash lasts and the units it covers each of them. */
  steps: number;
  per: number;
  /** Ticks of invulnerability after it ends. */
  invuln: number;
}

/** A dash's rules for this probe: the content's, with its quirk and its comet relics. */
export function dashRules(sim: Sim, p: ProbeState): DashRules {
  const D = sim.content.dash;
  const q = p.def.quirk?.kind === 'dash' ? p.def.quirk : null;
  const comets = cometRelics(sim, p).count;
  const steps = Math.max(1, ticks(D.seconds));
  return {
    max: D.charges + (q?.charges ?? 0) + Math.min(D.cometMax, comets * D.cometCharges),
    recharge: Math.max(1, Math.round((q?.recharge ?? D.recharge) * 60 * p.stats.cooldown)),
    pause: ticks(q?.pause ?? D.pause),
    steps,
    per: D.distance / steps,
    invuln: ticks(q?.invuln ?? D.invuln),
  };
}

/** A whole angle step, or −1 (none). */
function angleOf(v: number | undefined): number {
  return v !== undefined && Number.isInteger(v) && v >= 0 && v < 4096 ? v : -1;
}

/** At the start of a tick: the pause runs out and the next charge comes back. */
export function tickDash(sim: Sim, p: ProbeState): void {
  const d = p.dash;
  if (d.pause > 0) d.pause--;
  if (d.recharge > 0 && --d.recharge === 0) {
    const r = dashRules(sim, p);
    d.charges = Math.min(r.max, d.charges + 1);
    if (d.charges < r.max) d.recharge = r.recharge;
  }
}

/** After the probes moved: each dash asked for this tick starts if it can (a charge, past the pause, not dashing). */
export function startDashes(sim: Sim, inputs: readonly ProbeInput[]): void {
  for (const p of sim.probes) {
    const input = inputs[p.index] ?? IDLE;
    if (input.dash === undefined || !p.alive || p.life !== 'up') continue;
    const d = p.dash;
    if (d.charges <= 0 || d.pause > 0 || d.t > 0) continue;
    const r = dashRules(sim, p);
    const pointer = angleOf(input.dash);
    d.dir = p.moving ? p.facing : pointer >= 0 ? pointer : p.aim;
    d.charges--;
    if (d.recharge === 0) d.recharge = r.recharge;
    d.pause = r.pause;
    d.t = r.steps;
    p.invulnT = Math.max(p.invulnT, r.steps + r.invuln);
    hit.set(p, new Set());
    if (sim.log) sim.log.events.push(sim.tick, p.index, DASH, pointer, 0, 0);
    const reach = r.per * r.steps;
    sim.events.push({
      t: 'dash',
      probe: p.index,
      kind: cometRelics(sim, p).count > 0 ? 'comet' : 'player',
      fx: p.x,
      fy: p.y,
      tx: p.x + cosA(d.dir) * reach,
      ty: p.y + sinA(d.dir) * reach,
      ticks: r.steps,
    });
  }
}

/** Enemies a comet dash already hit (each once per dash): slot × 65536 + generation. */
const hit = new WeakMap<ProbeState, Set<number>>();

/** One tick of a dash in course (with the grid of this tick): it moves on and, with a comet relic, hits. */
export function moveDash(sim: Sim, p: ProbeState): void {
  const d = p.dash;
  if (d.t <= 0) return;
  if (!p.alive) {
    d.t = 0;
    return;
  }
  const r = dashRules(sim, p);
  p.x += cosA(d.dir) * r.per;
  p.y += sinA(d.dir) * r.per;
  d.t--;
  if (cometRelics(sim, p).count === 0) return;
  const seen = hit.get(p) ?? new Set<number>();
  hit.set(p, seen);
  const en = sim.enemies;
  for (const e of nearestEnemies(sim, p.x, p.y, 12, 64)) {
    const key = e * 65536 + en.gen[e]!;
    if (seen.has(key)) continue;
    seen.add(key);
    cometHit(sim, p, e);
  }
}
