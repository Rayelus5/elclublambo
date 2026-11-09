import { ANGLE_STEPS, cosA, sinA } from '../math/trig';
import { PICKUP } from '../world/pools';
import type { HitSource, Sim } from '../types';
import { ticks } from '../version';
import { spawnBoss } from './boss';
import { layerSeconds } from './director';
import { probesCentre } from './enemies';
import { dropPickup } from './pickups';
import { PROBE_RADIUS } from './probes';

// Layers (GDD §5.1): each layer lasts layerSeconds and ends with the Static Core. Beating it drops a chest and opens
// the extraction beacon: every living probe inside its radius for `hold` seconds extracts the run with all its loot;
// if it closes first, the run goes one layer deeper (harder, and its loot counts more on the server).

const CHEST_PIECES = 10;

export function updateLayer(sim: Sim): void {
  if (sim.status !== 'running') return;
  if (sim.phase === 'waves') {
    if (layerSeconds(sim) >= sim.sector.layerSeconds) {
      sim.phase = 'boss';
      sim.phaseTick = 0;
      spawnBoss(sim);
    }
    return;
  }
  if (sim.phase === 'beacon' && sim.beacon) {
    const b = sim.beacon;
    b.t--;
    let alive = 0;
    let inside = 0;
    for (const p of sim.probes) {
      if (!p.alive) continue;
      alive++;
      const dx = p.x - b.x;
      const dy = p.y - b.y;
      const r = b.radius + PROBE_RADIUS;
      if (dx * dx + dy * dy <= r * r) inside++;
    }
    if (alive > 0 && inside === alive) b.hold++;
    if (b.hold >= b.holdNeeded) {
      sim.status = 'extracted';
      sim.events.push({ t: 'extracted' });
      return;
    }
    if (b.t <= 0) {
      sim.events.push({ t: 'beaconClosed' });
      nextLayer(sim);
    }
  }
}

export function nextLayer(sim: Sim): void {
  sim.layer++;
  sim.loot.push({ coins: 0, dust: 0, components: 0 });
  sim.clocks['layerStart'] = sim.tick;
  sim.phase = 'waves';
  sim.phaseTick = 0;
  sim.beacon = null;
  sim.events.push({ t: 'layer', layer: sim.layer });
}

/** Spreads `total` over up to CHEST_PIECES pickups in a small ring. */
function chest(sim: Sim, kind: number, total: number, x: number, y: number, turn: number): void {
  if (total <= 0) return;
  const pieces = Math.min(CHEST_PIECES, total);
  const base = Math.floor(total / pieces);
  let extra = total - base * pieces;
  for (let k = 0; k < pieces; k++) {
    const a = Math.round((k * ANGLE_STEPS) / pieces) + turn;
    const value = base + (extra > 0 ? 1 : 0);
    if (extra > 0) extra--;
    dropPickup(sim, kind, value, x + cosA(a) * 16, y + sinA(a) * 16);
  }
}

/** The boss is down: credit, its data fragments, the chest and the beacon. */
export function onBossDown(sim: Sim, e: number, src: HitSource): void {
  const en = sim.enemies;
  const def = sim.content.bosses[en.type[e]!];
  const x = en.x[e]!;
  const y = en.y[e]!;
  sim.kills++;
  sim.bossKills++;
  const p = sim.probes[src.probe];
  if (p) p.kills++;
  en.kill(e);
  sim.boss = null;
  sim.events.push({ t: 'bossDown', x, y });
  if (def) dropPickup(sim, PICKUP.xp, def.xp, x, y);
  chest(sim, PICKUP.coin, sim.sector.drops.bossCoins, x, y, 0);
  chest(sim, PICKUP.dust, sim.sector.drops.bossDust, x, y, ANGLE_STEPS / 20);
  // The chest always holds a magnet: the Core's data and everything left on the ground come home.
  dropPickup(sim, PICKUP.magnet, 1, x, y + 22);
  const bc = sim.sector.beacon;
  const c = probesCentre(sim);
  const a = sim.rng.spawn.int(ANGLE_STEPS);
  sim.beacon = {
    x: c.x + cosA(a) * bc.distance,
    y: c.y + sinA(a) * bc.distance,
    t: ticks(bc.seconds),
    hold: 0,
    holdNeeded: ticks(bc.hold),
    radius: bc.radius,
  };
  sim.phase = 'beacon';
  sim.phaseTick = 0;
  sim.events.push({ t: 'beaconOpen', x: sim.beacon.x, y: sim.beacon.y });
}
