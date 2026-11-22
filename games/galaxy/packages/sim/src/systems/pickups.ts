import { PICKUP, type PickupPool } from '../world/pools';
import type { Sim } from '../types';
import { ticks } from '../version';
import { PROBE_RADIUS } from './probes';
import { gainXp } from './xp';
import { healBlocked, healProbe } from './healing';

// Data fragments (XP), coins, star dust, repair kits, magnets and components on the ground (GDD §5.1). Within a probe's
// pickup radius they are pulled in, faster and faster, and collected on touch. Coins, dust and components count for
// the layer they are picked up in. A magnet (SIM 1.7.0) pulls every data fragment on the ground to whoever took it.
// Loose items that expire (the owner, 2026-11-22; SIM 1.21.0): data fragments and repair kits nobody took go after the
// content's `pickups.lifeSeconds` (the renderer blinks them in the last `fadeSeconds`); coins, dust, components, signals
// and magnets never do, nor anything already flying to a probe. With the pool full, anything worth more than a fragment
// takes the slot of the oldest fragment lying on the ground. All in whole ticks and slot order: solo, co-op lockstep and
// the server's referee play it the same.

const KIND_NAMES = ['xp', 'coin', 'dust', 'repair', 'magnet', 'component', 'signal'] as const;
/** Fragments a magnet pulls fly faster than the ones a probe's radius takes. */
const MAGNET_SPEED = 20;

/** Whether a pickup of this kind expires on the ground: data fragments and repair kits only. */
export function despawns(kind: number): boolean {
  return kind === PICKUP.xp || kind === PICKUP.repair;
}

/**
 * Ticks until pickup `i` expires (0 or less: it goes this tick), or Infinity when it never does: another kind, one
 * already flying to a probe, or content with `pickups.lifeSeconds` 0. The renderer's warning blink reads the same.
 */
export function pickupLeft(sim: Sim, i: number): number {
  const pk = sim.pickups;
  const life = sim.content.pickups.lifeSeconds;
  if (life <= 0 || !despawns(pk.kind[i]!) || pk.magnet[i] || pk.to[i]) return Infinity;
  return pk.born[i]! + Math.max(1, ticks(life)) - sim.tick;
}

/** The oldest data fragment lying on the ground (not flying to a probe): the lowest `born`, on a tie the lowest slot; −1 if none. */
function oldestFragment(pk: PickupPool): number {
  let best = -1;
  let bestBorn = Infinity;
  for (let j = 0; j < pk.top; j++) {
    if (!pk.alive[j] || pk.kind[j] !== PICKUP.xp || pk.magnet[j] || pk.to[j]) continue;
    if (pk.born[j]! < bestBorn) {
      bestBorn = pk.born[j]!;
      best = j;
    }
  }
  return best;
}

/**
 * Drops a pickup. With the pool full, anything but a fragment takes the oldest fragment's slot; a fragment, or anything
 * with no fragment to move, joins the first pickup of its kind and renews its life (or is lost if there is none).
 */
export function dropPickup(sim: Sim, kind: number, value: number, x: number, y: number): void {
  if (value <= 0) return;
  const pk = sim.pickups;
  let i = pk.spawn();
  if (i < 0 && kind !== PICKUP.xp) {
    const old = oldestFragment(pk);
    if (old >= 0) {
      pk.kill(old);
      i = pk.spawn();
    }
  }
  if (i >= 0) {
    pk.x[i] = x;
    pk.y[i] = y;
    pk.px[i] = x;
    pk.py[i] = y;
    pk.kind[i] = kind;
    pk.value[i] = value;
    pk.born[i] = sim.tick;
    return;
  }
  for (let j = 0; j < pk.top; j++) {
    if (pk.alive[j] && pk.kind[j] === kind) {
      pk.value[j] = pk.value[j]! + value;
      pk.born[j] = sim.tick;
      return;
    }
  }
}

export function updatePickups(sim: Sim): void {
  const pk = sim.pickups;
  for (let i = 0; i < pk.top; i++) {
    if (!pk.alive[i]) continue;
    if (pickupLeft(sim, i) <= 0) {
      pk.kill(i);
      continue;
    }
    let best = -1;
    let bestD2 = Infinity;
    const owner = pk.to[i]! > 0 ? sim.probes[pk.to[i]! - 1] : undefined;
    if (owner && owner.alive) {
      const dx = owner.x - pk.x[i]!;
      const dy = owner.y - pk.y[i]!;
      best = owner.index;
      bestD2 = dx * dx + dy * dy;
    } else {
      for (const p of sim.probes) {
        if (!p.alive) continue;
        const dx = p.x - pk.x[i]!;
        const dy = p.y - pk.y[i]!;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2) {
          bestD2 = d2;
          best = p.index;
        }
      }
    }
    if (best < 0) continue;
    const p = sim.probes[best]!;
    // A kit waits on the ground while the Static blocks this probe's healing (2026-11-16): nothing is wasted.
    if (pk.kind[i] === PICKUP.repair && healBlocked(sim, p)) continue;
    const r = p.stats.pickup;
    if (!pk.magnet[i] && bestD2 <= r * r) pk.magnet[i] = 1;
    if (!pk.magnet[i]) continue;
    const d = Math.sqrt(bestD2);
    if (d <= PROBE_RADIUS + 4) {
      collect(sim, i, best);
      continue;
    }
    const speed = Math.min(2 + pk.mt[i]! * 0.15, pk.to[i]! > 0 ? MAGNET_SPEED : 14);
    pk.mt[i] = pk.mt[i]! + 1;
    const step = Math.min(speed, d);
    pk.x[i] = pk.x[i]! + ((p.x - pk.x[i]!) / d) * step;
    pk.y[i] = pk.y[i]! + ((p.y - pk.y[i]!) / d) * step;
  }
}

function collect(sim: Sim, i: number, probe: number): void {
  const pk = sim.pickups;
  const p = sim.probes[probe]!;
  const kind = pk.kind[i]!;
  const value = pk.value[i]!;
  pk.kill(i);
  if (kind === PICKUP.xp) gainXp(sim, p, value * p.stats.xp);
  else if (kind === PICKUP.repair) healProbe(sim, p, p.stats.maxHp * sim.sector.drops.repairHeal * value, 'other');
  else if (kind === PICKUP.magnet) pullFragments(sim, probe);
  else {
    const bag = sim.loot[sim.layer - 1]!;
    if (kind === PICKUP.coin) bag.coins += value;
    else if (kind === PICKUP.component) bag.components += value;
    else if (kind === PICKUP.signal) bag.signals += value;
    else bag.dust += value;
  }
  sim.events.push({ t: 'pickup', probe, kind: KIND_NAMES[kind] ?? 'xp', value });
}

/** A magnet: every data fragment on the ground flies to `probe`. */
function pullFragments(sim: Sim, probe: number): void {
  const pk = sim.pickups;
  for (let i = 0; i < pk.top; i++) {
    if (!pk.alive[i] || pk.kind[i] !== PICKUP.xp) continue;
    pk.magnet[i] = 1;
    pk.to[i] = probe + 1;
  }
}
