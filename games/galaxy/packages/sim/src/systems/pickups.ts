import { PICKUP } from '../world/pools';
import type { Sim } from '../types';
import { PROBE_RADIUS } from './probes';
import { gainXp } from './xp';

// Data fragments (XP), coins, star dust, repair kits, magnets and components on the ground (GDD §5.1). Within a probe's
// pickup radius they are pulled in, faster and faster, and collected on touch. Coins, dust and components count for
// the layer they are picked up in. A magnet (SIM 1.7.0) pulls every data fragment on the ground to whoever took it.

const KIND_NAMES = ['xp', 'coin', 'dust', 'repair', 'magnet', 'component'] as const;
/** Fragments a magnet pulls fly faster than the ones a probe's radius takes. */
const MAGNET_SPEED = 20;

/** Drops a pickup; with the pool full, its value joins the first pickup of the same kind (nothing is created). */
export function dropPickup(sim: Sim, kind: number, value: number, x: number, y: number): void {
  if (value <= 0) return;
  const pk = sim.pickups;
  const i = pk.spawn();
  if (i >= 0) {
    pk.x[i] = x;
    pk.y[i] = y;
    pk.px[i] = x;
    pk.py[i] = y;
    pk.kind[i] = kind;
    pk.value[i] = value;
    return;
  }
  for (let j = 0; j < pk.top; j++) {
    if (pk.alive[j] && pk.kind[j] === kind) {
      pk.value[j] = pk.value[j]! + value;
      return;
    }
  }
}

export function updatePickups(sim: Sim): void {
  const pk = sim.pickups;
  for (let i = 0; i < pk.top; i++) {
    if (!pk.alive[i]) continue;
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
  else if (kind === PICKUP.repair) p.hp = Math.min(p.stats.maxHp, p.hp + p.stats.maxHp * sim.sector.drops.repairHeal * value);
  else if (kind === PICKUP.magnet) pullFragments(sim, probe);
  else {
    const bag = sim.loot[sim.layer - 1]!;
    if (kind === PICKUP.coin) bag.coins += value;
    else if (kind === PICKUP.component) bag.components += value;
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
