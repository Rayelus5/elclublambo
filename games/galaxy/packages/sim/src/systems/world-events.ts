import type { SatellitesTuning } from '../content/types';
import { Rng } from '../math/rng';
import { ANGLE_STEPS, cosA, sinA } from '../math/trig';
import type { Sim } from '../types';
import { PICKUP } from '../world/pools';
import { layerSeconds } from './director';
import { dropPickup } from './pickups';

// World events (plan «banda sonora, skins, perfil y entorno», part E; SIM 1.10.0): things that happen in the arena on
// their own, fixed by the run's seed when it starts. The first one is the abandoned satellite: in about one run in
// three one drifts by (rarely two or three, one per layer), a probe can break it, and it drops a signal for the deep
// scanner. Each layer's satellite comes at a moment of its waves, from its own stream of the seed: the server reads the
// same schedule (`worldSchedule`) to never pay a satellite that was not in the run. Future events join the schedule as
// one more kind.

export interface WorldEventPlan {
  kind: 'satellite';
  /** The layer it comes in, and when: seconds into that layer (always in its waves). */
  layer: number;
  at: number;
}

/**
 * A run's world events from its seed alone (pure: the simulation and the server agree). One roll says how many
 * satellites come (`chances[k]`: the chance of at least k + 1); the k-th comes in layer k + 1.
 */
export function worldSchedule(seed: string, tuning: SatellitesTuning): WorldEventPlan[] {
  const rng = Rng.fromSeed(seed, 'world');
  const roll = rng.float();
  const out: WorldEventPlan[] = [];
  for (let k = 0; k < tuning.chances.length; k++) {
    const at = tuning.earliest + rng.float() * (tuning.latest - tuning.earliest);
    if (roll < tuning.chances[k]!) out.push({ kind: 'satellite', layer: k + 1, at });
  }
  return out;
}

/**
 * How many satellite signals a run could have had (the server's bound): the ones its seed had in the layers it reached,
 * and only those whose time had come in the ticks it played. A layer L never starts before (L − 1) × `layerSeconds`,
 * so an honest run is never refused one it saw.
 */
export function satelliteSignalsUpTo(seed: string, tuning: SatellitesTuning, run: { depth: number; ticks: number; layerSeconds: number }): number {
  return worldSchedule(seed, tuning).filter((e) => e.kind === 'satellite' && e.layer <= run.depth && ((e.layer - 1) * run.layerSeconds + e.at) * 60 <= run.ticks).length;
}

export interface SatelliteState {
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  hp: number;
  maxHp: number;
  radius: number;
  /** The tick it drifts away. */
  until: number;
  flashT: number;
  /** The last shot that hit it (1 + slot, and that slot's generation), and its contact cooldown (orbs). */
  shot: number;
  shotGen: number;
  touchT: number;
}

export interface WorldState {
  plan: WorldEventPlan[];
  /** The next plan entry still to come. */
  next: number;
  satellites: SatelliteState[];
}

const FLASH_TICKS = 6;
const ORB_TICKS = 15;

export function createWorld(seed: string, tuning: SatellitesTuning): WorldState {
  return { plan: worldSchedule(seed, tuning), next: 0, satellites: [] };
}

/** The probe a satellite comes to: the first one still flying. */
function anchor(sim: Sim) {
  return sim.probes.find((p) => p.alive && (!sim.coop || p.life === 'up')) ?? sim.probes[0]!;
}

function spawnSatellite(sim: Sim, plan: WorldEventPlan): void {
  const T = sim.content.satellites;
  const a = anchor(sim);
  // Where and which way it drifts: from the seed too, not from the run's other streams.
  const rng = Rng.fromSeed(sim.opts.seed, `world:${plan.layer}`);
  const angle = rng.int(ANGLE_STEPS);
  const side = rng.chance(0.5) ? 1 : -1;
  const cos = cosA(angle);
  const sin = sinA(angle);
  const x = a.x + cos * T.distance;
  const y = a.y + sin * T.distance;
  // Across the probe's view and slightly towards it, so it passes by instead of away.
  const v = T.speed / 60;
  const vx = (-sin * side - cos * 0.35) * v;
  const vy = (cos * side - sin * 0.35) * v;
  const hp = T.hp * (1 + T.hpPerLayer * (sim.layer - 1));
  sim.world.satellites.push({ x, y, px: x, py: y, vx, vy, hp, maxHp: hp, radius: T.radius, until: sim.tick + Math.round(T.drift * 60), flashT: 0, shot: 0, shotGen: 0, touchT: 0 });
  sim.events.push({ t: 'satellite', what: 'appear', x, y });
}

/** Brings the world events due, drifts the satellites and lets the ones whose time is up go. */
export function updateWorld(sim: Sim): void {
  const w = sim.world;
  while (w.next < w.plan.length && w.plan[w.next]!.layer < sim.layer) w.next++;
  const due = w.plan[w.next];
  if (due && sim.phase === 'waves' && due.layer === sim.layer && layerSeconds(sim) >= due.at) {
    w.next++;
    spawnSatellite(sim, due);
  }
  for (let k = w.satellites.length - 1; k >= 0; k--) {
    const s = w.satellites[k]!;
    s.px = s.x;
    s.py = s.y;
    s.x += s.vx;
    s.y += s.vy;
    if (s.flashT > 0) s.flashT--;
    if (s.touchT > 0) s.touchT--;
    if (sim.tick >= s.until) {
      w.satellites.splice(k, 1);
      sim.events.push({ t: 'satellite', what: 'gone', x: s.x, y: s.y });
    }
  }
}

function damageSatellite(sim: Sim, k: number, amount: number): void {
  const s = sim.world.satellites[k];
  if (!s || !(amount > 0)) return;
  s.hp -= amount;
  s.flashT = FLASH_TICKS;
  if (s.hp > 0) return;
  sim.world.satellites.splice(k, 1);
  dropPickup(sim, PICKUP.signal, 1, s.x, s.y);
  sim.events.push({ t: 'satellite', what: 'break', x: s.x, y: s.y });
}

function near(s: SatelliteState, x: number, y: number, radius: number, inside?: (dx: number, dy: number) => boolean): boolean {
  const dx = s.x - x;
  const dy = s.y - y;
  const r = radius + s.radius;
  return dx * dx + dy * dy <= r * r && (!inside || inside(dx, dy));
}

/** An area's damage tick or a blast (like the props): every satellite inside takes it. */
export function hitSatellitesArea(sim: Sim, x: number, y: number, radius: number, damage: number, inside?: (dx: number, dy: number) => boolean): void {
  const list = sim.world.satellites;
  for (let k = list.length - 1; k >= 0; k--) if (near(list[k]!, x, y, radius, inside)) damageSatellite(sim, k, damage);
}

/** A flying shot passing over a satellite: it takes the shot's damage once, and the shot flies on. */
export function hitSatellitesShot(sim: Sim, shot: number): void {
  const sh = sim.shots;
  const list = sim.world.satellites;
  for (let k = list.length - 1; k >= 0; k--) {
    const s = list[k]!;
    if (!near(s, sh.x[shot]!, sh.y[shot]!, sh.radius[shot]!)) continue;
    if (s.shot === shot + 1 && s.shotGen === sh.gen[shot]) continue;
    s.shot = shot + 1;
    s.shotGen = sh.gen[shot]!;
    damageSatellite(sim, k, sh.damage[shot]!);
  }
}

/** Something in contact (orbs): it hits a satellite every few ticks. */
export function touchSatellites(sim: Sim, x: number, y: number, radius: number, damage: number): void {
  const list = sim.world.satellites;
  for (let k = list.length - 1; k >= 0; k--) {
    const s = list[k]!;
    if (s.touchT > 0 || !near(s, x, y, radius)) continue;
    s.touchT = ORB_TICKS;
    damageSatellite(sim, k, damage);
  }
}
