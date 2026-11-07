import { layerSeconds } from './systems/director';
import type { Offer, Phase, Sim, SimStatus } from './types';

/** What the HUD shows for one probe (GDD §5.1): read a few times per second, never every tick. */
export interface HudSnapshot {
  hp: number;
  maxHp: number;
  shield: number;
  level: number;
  xp: number;
  xpNext: number;
  tick: number;
  layer: number;
  phase: Phase;
  /** Seconds left in this phase: the layer's time before its boss, or the beacon's time; 0 during the boss. */
  phaseLeft: number;
  kills: number;
  loot: { coins: number; dust: number };
  weapons: { id: string; level: number }[];
  passives: { id: string; level: number }[];
  boss: { name: string; title: string; hp: number; maxHp: number; phase: number } | null;
  /** The beacon relative to the probe (dx, dy), how long it has been held and how long is left (seconds). */
  beacon: { x: number; y: number; dx: number; dy: number; hold: number; holdNeeded: number; left: number } | null;
  offer: Offer[] | null;
  status: SimStatus;
}

export function hudSnapshot(sim: Sim, probe: number): HudSnapshot {
  const p = sim.probes[probe]!;
  let phaseLeft = 0;
  if (sim.phase === 'waves') phaseLeft = Math.max(0, sim.sector.layerSeconds - layerSeconds(sim));
  else if (sim.phase === 'beacon' && sim.beacon) phaseLeft = sim.beacon.t / 60;
  let boss: HudSnapshot['boss'] = null;
  if (sim.boss) {
    const def = sim.content.bosses.find((b) => b.id === sim.boss!.def);
    const i = sim.boss.index;
    if (def) boss = { name: def.name, title: def.title, hp: Math.max(0, sim.enemies.hp[i]!), maxHp: sim.enemies.maxHp[i]!, phase: sim.boss.phase };
  }
  const b = sim.beacon;
  return {
    hp: p.hp,
    maxHp: p.stats.maxHp,
    shield: p.shield,
    level: p.level,
    xp: p.xp,
    xpNext: p.xpNext,
    tick: sim.tick,
    layer: sim.layer,
    phase: sim.phase,
    phaseLeft,
    kills: sim.kills,
    loot: sim.loot.reduce((a, l) => ({ coins: a.coins + l.coins, dust: a.dust + l.dust }), { coins: 0, dust: 0 }),
    weapons: p.weapons.map((w) => ({ id: w.id, level: w.level })),
    passives: p.passives.map((s) => ({ id: s.id, level: s.level })),
    boss,
    beacon: b ? { x: b.x, y: b.y, dx: b.x - p.x, dy: b.y - p.y, hold: b.hold / 60, holdNeeded: b.holdNeeded / 60, left: b.t / 60 } : null,
    offer: p.offer,
    status: sim.status,
  };
}
