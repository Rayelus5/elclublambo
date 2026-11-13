import type { ElementId } from '../content/types';
import type { ProbeState, Sim } from '../types';
import { ticks } from '../version';
import { PICKUP } from '../world/pools';
import { dealDamage } from './combat';
import { dropPickup } from './pickups';
import { refreshStats } from './stats';

// Probe quirks (GDD §6: «una peculiaridad»). Each probe has one; the numbers are data (content.probes[].quirk) and what
// each kind does lives here. The other systems call these hooks at the right moments.

function quirkOf<K extends NonNullable<ProbeState['def']['quirk']>['kind']>(p: ProbeState, kind: K) {
  const q = p.def.quirk;
  return q && q.kind === kind ? (q as Extract<NonNullable<ProbeState['def']['quirk']>, { kind: K }>) : null;
}

/** One tick of a probe's quirk clocks (magnet, afterburner). Spark's dash is the player's now (systems/dash.ts). */
export function tickQuirk(sim: Sim, p: ProbeState): void {
  const magnet = quirkOf(p, 'magnet');
  if (magnet) {
    const t = (p.fx['quirkMagnetT'] ?? ticks(magnet.every)) - 1;
    p.fx['quirkMagnetT'] = t;
    if (t <= 0) {
      p.fx['quirkMagnetT'] = ticks(magnet.every);
      const pk = sim.pickups;
      const r2 = magnet.radius * magnet.radius;
      for (let i = 0; i < pk.top; i++) {
        if (!pk.alive[i] || pk.kind[i] !== PICKUP.xp) continue;
        const dx = pk.x[i]! - p.x;
        const dy = pk.y[i]! - p.y;
        if (dx * dx + dy * dy <= r2) pk.magnet[i] = 1;
      }
      sim.events.push({ t: 'quirk', probe: p.index, kind: 'magnet' });
    }
  }
  if ((p.fx['quirkBurnT'] ?? 0) > 0) {
    p.fx['quirkBurnT'] = p.fx['quirkBurnT']! - 1;
    if (p.fx['quirkBurnT'] === 0) refreshStats(sim, p);
  }
}

/** Life is gone: a second wind not yet used brings the probe back (true: still alive). */
export function rescue(sim: Sim, p: ProbeState): boolean {
  const wind = quirkOf(p, 'second-wind');
  if (!wind || p.fx['quirkWind']) return false;
  p.fx['quirkWind'] = 1;
  p.hp = p.stats.maxHp * wind.hp;
  p.invulnT = ticks(2);
  sim.events.push({ t: 'quirk', probe: p.index, kind: 'second-wind' });
  return true;
}

/** An enemy touched the probe for `amount`: thorns send part of it back. */
export function onContact(sim: Sim, p: ProbeState, e: number, amount: number): void {
  const thorns = quirkOf(p, 'thorns');
  if (thorns) dealDamage(sim, e, amount * thorns.share, { probe: p.index, weapon: null, relic: null, element: null });
}

/** The probe got a kill at (x, y): afterburner and salvage. */
export function onKill(sim: Sim, p: ProbeState, x: number, y: number): void {
  const burn = quirkOf(p, 'afterburner');
  if (burn) {
    const was = (p.fx['quirkBurnT'] ?? 0) > 0;
    p.fx['quirkBurnT'] = ticks(burn.seconds);
    if (!was) refreshStats(sim, p);
  }
  const salvage = quirkOf(p, 'salvage');
  if (salvage) {
    const n = (p.fx['quirkSalvage'] ?? 0) + 1;
    p.fx['quirkSalvage'] = n;
    if (n % salvage.kills === 0) dropPickup(sim, PICKUP.repair, 1, x, y);
  }
}

/** Extra drones for weapons that keep drones (overwatch). */
export function extraDrones(p: ProbeState): number {
  return quirkOf(p, 'overwatch')?.drones ?? 0;
}

/** Afterburner's speed while it lasts. */
export function quirkSpeed(p: ProbeState): number {
  const burn = quirkOf(p, 'afterburner');
  return burn && (p.fx['quirkBurnT'] ?? 0) > 0 ? burn.bonus : 0;
}

/** Prism touch: a weapon hit with no element may take the next of the probe's cycle. */
export function prismTouch(sim: Sim, p: ProbeState): ElementId | null {
  const touch = quirkOf(p, 'prism-touch');
  if (!touch || touch.cycle.length === 0 || !sim.rng.combat.chance(touch.chance)) return null;
  const turn = p.fx['quirkPrism'] ?? 0;
  p.fx['quirkPrism'] = turn + 1;
  return touch.cycle[turn % touch.cycle.length]!;
}

