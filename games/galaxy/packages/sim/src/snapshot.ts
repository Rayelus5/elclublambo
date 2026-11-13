import { dashRules } from './systems/dash';
import { layerSeconds } from './systems/director';
import type { Offer, Phase, ProbeState, Sim, SimStatus } from './types';

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
  loot: { coins: number; dust: number; components: number; signals: number };
  weapons: { id: string; level: number; evolved: boolean }[];
  passives: { id: string; level: number }[];
  boss: { name: string; title: string; hp: number; maxHp: number; phase: number } | null;
  /** The beacon relative to the probe (dx, dy), how long it has been held and how long is left (seconds). */
  beacon: { x: number; y: number; dx: number; dy: number; hold: number; holdNeeded: number; left: number } | null;
  /** The nearest abandoned satellite drifting by, relative to the probe (SIM 1.10.0), for its arrow at the edge. */
  satellite: { dx: number; dy: number } | null;
  offer: Offer[] | null;
  status: SimStatus;
  /**
   * The player's dash (SIM 1.12.0): charges ready of `max`, seconds until the next comes back (0 while full) of its
   * `rechargeTotal`, and seconds before another is allowed of its `pauseTotal`.
   */
  dash: { charges: number; max: number; recharge: number; rechargeTotal: number; pause: number; pauseTotal: number };
  /** Co-op (multiplayer plan): seconds left to pick, where this probe stands, its countdown and revive (0–1), and
   * every probe of the team. Absent in solo. */
  coop?: {
    pickLeft: number | null;
    offerSeq: number;
    life: ProbeState['life'];
    downLeft: number;
    revive: number;
    team: { index: number; hp: number; maxHp: number; life: ProbeState['life']; x: number; y: number; level: number }[];
  };
}

function nearestSatellite(sim: Sim, x: number, y: number): HudSnapshot['satellite'] {
  let best: HudSnapshot['satellite'] = null;
  let bestD = Infinity;
  for (const s of sim.world.satellites) {
    const d = (s.x - x) * (s.x - x) + (s.y - y) * (s.y - y);
    if (d < bestD) {
      bestD = d;
      best = { dx: s.x - x, dy: s.y - y };
    }
  }
  return best;
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
  const dash = dashRules(sim, p);
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
    loot: sim.loot.reduce((a, l) => ({ coins: a.coins + l.coins, dust: a.dust + l.dust, components: a.components + l.components, signals: a.signals + l.signals }), { coins: 0, dust: 0, components: 0, signals: 0 }),
    weapons: p.weapons.map((w) => ({ id: w.id, level: w.level, evolved: !!sim.content.weapons.find((d) => d.id === w.id)?.evolution })),
    passives: p.passives.map((s) => ({ id: s.id, level: s.level })),
    boss,
    beacon: b ? { x: b.x, y: b.y, dx: b.x - p.x, dy: b.y - p.y, hold: b.hold / 60, holdNeeded: b.holdNeeded / 60, left: b.t / 60 } : null,
    satellite: nearestSatellite(sim, p.x, p.y),
    offer: p.offer,
    status: sim.status,
    dash: {
      charges: p.dash.charges,
      max: dash.max,
      recharge: p.dash.recharge / 60,
      rechargeTotal: dash.recharge / 60,
      pause: p.dash.pause / 60,
      pauseTotal: dash.pause / 60,
    },
    ...(sim.coop
      ? {
          coop: {
            pickLeft: p.offer ? Math.max(0, (p.offerUntil - sim.tick) / 60) : null,
            offerSeq: p.offerSeq & 255,
            life: p.life,
            downLeft: p.life === 'down' ? p.downT / 60 : 0,
            revive: p.life === 'down' ? Math.min(1, p.reviveT / Math.max(1, sim.coop.reviveSeconds * 60)) : 0,
            team: sim.probes.map((q) => ({ index: q.index, hp: q.hp, maxHp: q.stats.maxHp, life: q.life, x: q.x, y: q.y, level: q.level })),
          },
        }
      : {}),
  };
}
