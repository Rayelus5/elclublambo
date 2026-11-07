import type { WeaponDef, WeaponLevel } from '../content/types';
import { angleTo, ANGLE_STEPS, cosA, degToSteps, sinA } from '../math/trig';
import type { HitSource, ProbeState, Sim } from '../types';
import { dealDamage } from './combat';
import { elementCode, elementOf } from './elements';

// The probe's weapons (GDD §5.3) and everything they put in the world: bullets, piercing lances, bouncing arcs,
// orbiting orbs, drones and damaging areas. Damage, cooldown, area and extra projectiles come from the probe's stats.

/** Shot kinds (sim.shots.kind): what the renderer draws and how the shot behaves. */
export const SHOT = {
  bolt: 0,
  lance: 1,
  arc: 2,
  droneBolt: 3,
  orb: 4,
  drone: 5,
  ray: 6,
  jet: 7,
  quasar: 8,
  chaos: 9,
  reflected: 10,
  blade: 11,
  beam: 12,
  missile: 13,
  shard: 14,
  mine: 15,
  disc: 16,
  turret: 17,
  split: 18,
} as const;
/** Area kinds (sim.areas.kind). */
export const AREA = { nova: 0, trail: 1, aura: 2, slowField: 3, blast: 4, supernova: 5, pulsar: 6, cone: 7, field: 8, strike: 9 } as const;

const RADIUS: Record<number, number> = { 0: 3, 1: 4, 2: 3, 3: 2.5, 4: 5, 5: 4, 6: 4, 7: 4, 8: 5, 9: 3, 10: 4, 11: 5, 12: 6, 13: 4, 14: 3, 15: 5, 16: 7, 17: 6, 18: 2.5 };
/** Reach to pick the first target of an arc. */
const ARC_ACQUIRE = 260;
const DRONE_ORBIT = 26;
const NOVA_SHOW_TICKS = 18;
/** The broadest enemy a shot query must consider (boss included). */
const QUERY_PAD = 40;

// Hit memory per shot: 8 (enemy key, tick) pairs, so a piercing shot never hits the same enemy twice and an orb
// waits its interval. Kept beside the sim (same lifetime) to keep the pools plain.
const memory = new WeakMap<Sim, Int32Array>();
const MEM = 8;

function memOf(sim: Sim): Int32Array {
  let m = memory.get(sim);
  if (!m) {
    m = new Int32Array(sim.shots.cap * MEM * 2).fill(-1);
    memory.set(sim, m);
  }
  return m;
}

function enemyKey(sim: Sim, e: number): number {
  return e * 65536 + sim.enemies.gen[e]!;
}

/** The tick enemy `e` was last hit by shot `i`, or −1. */
export function lastHit(sim: Sim, i: number, e: number): number {
  const m = memOf(sim);
  const key = enemyKey(sim, e);
  const base = i * MEM * 2;
  for (let k = 0; k < MEM; k++) if (m[base + k * 2] === key) return m[base + k * 2 + 1]!;
  return -1;
}

export function remember(sim: Sim, i: number, e: number): void {
  const m = memOf(sim);
  const key = enemyKey(sim, e);
  const base = i * MEM * 2;
  let slot = 0;
  let oldest = Infinity;
  for (let k = 0; k < MEM; k++) {
    if (m[base + k * 2] === key) {
      slot = k;
      break;
    }
    const t = m[base + k * 2 + 1]!;
    if (t < oldest) {
      oldest = t;
      slot = k;
    }
  }
  m[base + slot * 2] = key;
  m[base + slot * 2 + 1] = sim.tick;
}

export function spawnShot(
  sim: Sim,
  p: ProbeState,
  kind: number,
  x: number,
  y: number,
  angle: number,
  speed: number,
  damage: number,
  opts: { ttl: number; pierce?: number; bounces?: number; reach?: number; srcKind?: number; srcIdx?: number; element?: number },
): number {
  const s = sim.shots;
  const i = s.spawn();
  if (i < 0) return -1;
  s.x[i] = x;
  s.y[i] = y;
  s.px[i] = x;
  s.py[i] = y;
  s.vx[i] = (cosA(angle) * speed) / 60;
  s.vy[i] = (sinA(angle) * speed) / 60;
  s.angle[i] = angle;
  s.damage[i] = damage;
  s.radius[i] = RADIUS[kind] ?? 3;
  s.ttl[i] = opts.ttl;
  s.pierce[i] = opts.pierce ?? 0;
  s.bounces[i] = opts.bounces ?? 0;
  s.reach[i] = opts.reach ?? 0;
  s.owner[i] = p.index;
  s.kind[i] = kind;
  s.srcKind[i] = opts.srcKind ?? 0;
  s.srcIdx[i] = opts.srcIdx ?? 0;
  s.element[i] = opts.element ?? 0;
  s.target[i] = -1;
  memOf(sim).fill(-1, i * MEM * 2, (i + 1) * MEM * 2);
  return i;
}

export function spawnArea(
  sim: Sim,
  p: ProbeState,
  kind: number,
  x: number,
  y: number,
  radius: number,
  opts: { ttl: number; damage?: number; interval?: number; follow?: boolean; angle?: number; arc?: number; knockback?: number; slow?: number; srcKind?: number; srcIdx?: number; element?: number },
): number {
  const a = sim.areas;
  const i = a.spawn();
  if (i < 0) return -1;
  a.x[i] = x;
  a.y[i] = y;
  a.px[i] = x;
  a.py[i] = y;
  a.radius[i] = radius;
  a.damage[i] = opts.damage ?? 0;
  a.ttl[i] = opts.ttl;
  a.interval[i] = opts.interval ?? 0;
  a.tickT[i] = 0;
  a.owner[i] = p.index;
  a.kind[i] = kind;
  a.follow[i] = opts.follow ? 1 : 0;
  a.angle[i] = opts.angle ?? 0;
  a.arc[i] = opts.arc ?? 0;
  a.knockback[i] = opts.knockback ?? 0;
  a.slow[i] = opts.slow ?? 0;
  a.srcKind[i] = opts.srcKind ?? 0;
  a.srcIdx[i] = opts.srcIdx ?? 0;
  a.element[i] = opts.element ?? 0;
  return i;
}

const near: number[] = [];
const ranked: number[] = [];

/** Up to `n` distinct targets within `range` of (x, y), nearest first (ties: lower slot). */
export function nearestEnemies(sim: Sim, x: number, y: number, range: number, n: number, skip?: (e: number) => boolean): number[] {
  const en = sim.enemies;
  const count = sim.grid.query(x, y, range + QUERY_PAD, near);
  ranked.length = 0;
  for (let k = 0; k < count; k++) {
    const e = near[k]!;
    if (!en.alive[e] || en.fuseT[e]! > 0 || en.hackT[e]! > 0 || (skip && skip(e))) continue;
    const dx = en.x[e]! - x;
    const dy = en.y[e]! - y;
    const r = range + en.radius[e]!;
    if (dx * dx + dy * dy <= r * r && !ranked.includes(e)) ranked.push(e);
  }
  const d2 = (e: number) => (en.x[e]! - x) * (en.x[e]! - x) + (en.y[e]! - y) * (en.y[e]! - y);
  ranked.sort((a, b) => d2(a) - d2(b) || a - b);
  return ranked.slice(0, n);
}

/** Damages every enemy within `radius` (and inside the cone when `arc` > 0); returns how many it hit. */
export function hitArea(sim: Sim, x: number, y: number, radius: number, damage: number, src: HitSource, opts: { knockback?: number; angle?: number; arc?: number } = {}): number {
  const en = sim.enemies;
  const n = sim.grid.query(x, y, radius + QUERY_PAD, near);
  let hits = 0;
  for (let k = 0; k < n; k++) {
    const e = near[k]!;
    if (!en.alive[e] || en.fuseT[e]! > 0 || en.hackT[e]! > 0) continue;
    const dx = en.x[e]! - x;
    const dy = en.y[e]! - y;
    const r = radius + en.radius[e]!;
    const d2 = dx * dx + dy * dy;
    if (d2 > r * r) continue;
    if (opts.arc && opts.arc > 0 && d2 > 1e-9) {
      let diff = (((angleTo(dx, dy) - (opts.angle ?? 0)) % ANGLE_STEPS) + ANGLE_STEPS) % ANGLE_STEPS;
      if (diff > ANGLE_STEPS / 2) diff -= ANGLE_STEPS;
      if (Math.abs(diff) > opts.arc / 2) continue;
    }
    if (opts.knockback && !en.boss[e]) {
      const d = Math.sqrt(d2) || 1;
      // A geometric push: the first tick moves 15 % of the total, then 85 % of the last.
      en.kx[e] = en.kx[e]! + (dx / d) * opts.knockback * 0.15;
      en.ky[e] = en.ky[e]! + (dy / d) * opts.knockback * 0.15;
    }
    dealDamage(sim, e, damage, src);
    hits++;
  }
  return hits;
}

export function weaponDef(sim: Sim, id: string): WeaponDef | undefined {
  return sim.content.weapons.find((w) => w.id === id);
}

/** Kinds beyond M3a's live in systems/arsenal.ts, which fills these hooks (null: not one of its kinds). */
export const weaponHooks: {
  fire: (sim: Sim, p: ProbeState, wi: number, def: WeaponDef, lvl: WeaponLevel) => boolean | null;
  update: (sim: Sim, i: number) => boolean;
} = { fire: () => null, update: () => false };

export function levelOf(def: WeaponDef, level: number): WeaponLevel {
  return def.levels[Math.max(1, Math.min(level, def.levels.length)) - 1]!;
}

export function weaponSource(p: ProbeState, def: WeaponDef, x: number, y: number): HitSource {
  return { probe: p.index, weapon: def.id, relic: null, element: null, x, y };
}

export function ttlFor(range: number, speed: number): number {
  return speed > 0 ? Math.max(1, Math.ceil((range / speed) * 60)) : 1;
}

/** Fires once if the weapon can; false keeps it ready (no target, not moving…). */
function fireOnce(sim: Sim, p: ProbeState, wi: number, def: WeaponDef, lvl: WeaponLevel): boolean {
  const s = p.stats;
  const damage = lvl.damage * s.damage;
  switch (def.kind) {
    case 'bolt': {
      const n = lvl.count + s.projectiles;
      const range = lvl.range * s.velocity;
      const speed = lvl.speed * s.velocity;
      const targets = nearestEnemies(sim, p.x, p.y, range, n);
      if (targets.length === 0 || n <= 0) return false;
      for (let k = 0; k < n; k++) {
        const e = targets[k % targets.length]!;
        const round = Math.floor(k / targets.length);
        const spread = round === 0 ? 0 : (round % 2 === 1 ? 1 : -1) * Math.ceil(round / 2) * degToSteps(6);
        const a = angleTo(sim.enemies.x[e]! - p.x, sim.enemies.y[e]! - p.y) + spread;
        spawnShot(sim, p, SHOT.bolt, p.x, p.y, a, speed, damage, { ttl: ttlFor(range * 1.3, speed), pierce: lvl.pierce + s.pierce, srcIdx: wi, element: elementCode(def.element ?? null) });
      }
      return true;
    }
    case 'nova': {
      const radius = lvl.area * s.area;
      hitArea(sim, p.x, p.y, radius, damage, { ...weaponSource(p, def, p.x, p.y), element: def.element ?? null }, { knockback: lvl.knockback });
      spawnArea(sim, p, AREA.nova, p.x, p.y, radius, { ttl: NOVA_SHOW_TICKS, follow: true, srcIdx: wi });
      return true;
    }
    case 'lance': {
      const n = lvl.count + s.projectiles;
      for (let k = 0; k < n; k++) {
        const a = p.aim + Math.round((k - (n - 1) / 2) * degToSteps(8));
        spawnShot(sim, p, SHOT.lance, p.x, p.y, a, lvl.speed * s.velocity, damage, {
          ttl: ttlFor(lvl.range * s.velocity, lvl.speed * s.velocity),
          pierce: lvl.pierce + s.pierce,
          srcIdx: wi,
          element: elementCode(def.element ?? null),
        });
      }
      return n > 0;
    }
    case 'trail': {
      if (!p.moving) return false;
      spawnArea(sim, p, AREA.trail, p.x, p.y, lvl.area * s.area, {
        ttl: Math.max(1, Math.round(lvl.duration * s.duration * 60)),
        element: elementCode(def.element ?? null),
        damage,
        interval: Math.max(1, Math.round(lvl.interval * 60)),
        srcIdx: wi,
      });
      return true;
    }
    case 'ricochet': {
      const [e] = nearestEnemies(sim, p.x, p.y, ARC_ACQUIRE, 1);
      if (e === undefined) return false;
      const a = angleTo(sim.enemies.x[e]! - p.x, sim.enemies.y[e]! - p.y);
      spawnShot(sim, p, SHOT.arc, p.x, p.y, a, lvl.speed * s.velocity, damage, {
        ttl: ttlFor(ARC_ACQUIRE * 1.5, lvl.speed * s.velocity),
        element: elementCode(def.element ?? null),
        bounces: lvl.bounces,
        reach: lvl.range,
        srcIdx: wi,
      });
      return true;
    }
    default:
      return weaponHooks.fire(sim, p, wi, def, lvl) ?? false;
  }
}

/** Keeps exactly `count` persistent shots of `kind` for weapon `wi` (orbs, drones). */
function keepPersistent(sim: Sim, p: ProbeState, wi: number, kind: number, count: number): void {
  const s = sim.shots;
  const mine: number[] = [];
  for (let i = 0; i < s.top; i++) {
    if (s.alive[i] && s.kind[i] === kind && s.owner[i] === p.index && s.srcKind[i] === 0 && s.srcIdx[i] === wi) mine.push(i);
  }
  if (mine.length === count) return;
  for (const i of mine) s.kill(i);
  for (let k = 0; k < count; k++) {
    const i = spawnShot(sim, p, kind, p.x, p.y, 0, 0, 0, { ttl: 1, srcIdx: wi });
    if (i < 0) return;
    s.reach[i] = (k * ANGLE_STEPS) / count; // orbit angle in steps (fractional)
    s.target[i] = 0; // drones: ticks until the next shot
  }
}

/** Fires or maintains every weapon of a probe for one tick. */
export function fireWeapons(sim: Sim, p: ProbeState): void {
  if (!p.alive) return;
  p.weapons.forEach((w, wi) => {
    const def = weaponDef(sim, w.id);
    if (!def) return;
    const lvl = levelOf(def, w.level);
    if (def.kind === 'orbit') {
      keepPersistent(sim, p, wi, SHOT.orb, lvl.count);
      return;
    }
    if (def.kind === 'drone') {
      keepPersistent(sim, p, wi, SHOT.drone, lvl.count + p.stats.projectiles);
      return;
    }
    if (w.t > 0) {
      w.t--;
      if (w.t > 0) return;
    }
    if (fireOnce(sim, p, wi, def, lvl)) {
      w.t = Math.max(1, Math.round(lvl.cooldown * 60 * p.stats.cooldown));
      sim.events.push({ t: 'fire', weapon: def.id, x: p.x, y: p.y });
    }
  });
}

/** Weapon level for a shot fired by a weapon (orbs and drones read it live, so level-ups apply at once). */
export function shotWeapon(sim: Sim, i: number): { p: ProbeState; def: WeaponDef; lvl: WeaponLevel } | null {
  const s = sim.shots;
  const p = sim.probes[s.owner[i]!];
  if (!p || s.srcKind[i] !== 0) return null;
  const w = p.weapons[s.srcIdx[i]!];
  if (!w) return null;
  const def = weaponDef(sim, w.id);
  if (!def) return null;
  return { p, def, lvl: levelOf(def, w.level) };
}

/** Hooks for relic shots (systems/relics.ts) and element procs (systems/elements.ts). */
export const shotHooks: {
  persistent: (sim: Sim, i: number) => boolean;
  source: (sim: Sim, i: number) => HitSource;
} = {
  persistent: () => false,
  source: (sim, i) => {
    const s = sim.shots;
    const sw = shotWeapon(sim, i);
    return {
      probe: s.owner[i]!,
      weapon: sw ? sw.def.id : null,
      relic: s.srcKind[i] === 1 ? s.srcIdx[i]! : null,
      element: elementOf(s.element[i]!),
      x: s.x[i]! - s.vx[i]!,
      y: s.y[i]! - s.vy[i]!,
    };
  },
};

function updateOrb(sim: Sim, i: number): void {
  const s = sim.shots;
  const sw = shotWeapon(sim, i);
  if (!sw || sw.def.kind !== 'orbit') {
    s.kill(i);
    return;
  }
  const { p, lvl } = sw;
  s.reach[i] = (s.reach[i]! + (lvl.speed * ANGLE_STEPS) / 360 / 60) % ANGLE_STEPS;
  const radius = lvl.area * p.stats.area;
  const a = Math.round(s.reach[i]!);
  s.x[i] = p.x + cosA(a) * radius;
  s.y[i] = p.y + sinA(a) * radius;
  if (!p.alive) return;
  const interval = Math.max(1, Math.round(lvl.interval * 60));
  const en = sim.enemies;
  const n = sim.grid.query(s.x[i]!, s.y[i]!, s.radius[i]! + QUERY_PAD, near);
  for (let k = 0; k < n; k++) {
    const e = near[k]!;
    if (!en.alive[e] || en.fuseT[e]! > 0 || en.hackT[e]! > 0) continue;
    const r = s.radius[i]! + en.radius[e]!;
    const dx = en.x[e]! - s.x[i]!;
    const dy = en.y[e]! - s.y[i]!;
    if (dx * dx + dy * dy > r * r) continue;
    const last = lastHit(sim, i, e);
    if (last >= 0 && sim.tick - last < interval) continue;
    remember(sim, i, e);
    dealDamage(sim, e, lvl.damage * p.stats.damage, { ...shotHooks.source(sim, i), x: p.x, y: p.y });
  }
}

function updateDrone(sim: Sim, i: number): void {
  const s = sim.shots;
  const sw = shotWeapon(sim, i);
  if (!sw || sw.def.kind !== 'drone') {
    s.kill(i);
    return;
  }
  const { p, def, lvl } = sw;
  s.reach[i] = (s.reach[i]! + 0.6) % ANGLE_STEPS;
  const a = Math.round(s.reach[i]!);
  const tx = p.x + cosA(a) * DRONE_ORBIT;
  const ty = p.y + sinA(a) * DRONE_ORBIT;
  s.x[i] = s.x[i]! + (tx - s.x[i]!) * 0.2;
  s.y[i] = s.y[i]! + (ty - s.y[i]!) * 0.2;
  if (!p.alive) return;
  if (s.target[i]! > 0) s.target[i] = s.target[i]! - 1;
  if (s.target[i]! > 0) return;
  const [e] = nearestEnemies(sim, s.x[i]!, s.y[i]!, lvl.range, 1);
  if (e === undefined) return;
  const ang = angleTo(sim.enemies.x[e]! - s.x[i]!, sim.enemies.y[e]! - s.y[i]!);
  spawnShot(sim, p, SHOT.droneBolt, s.x[i]!, s.y[i]!, ang, lvl.speed * p.stats.velocity, lvl.damage * p.stats.damage, {
    ttl: ttlFor(lvl.range * 1.3, lvl.speed * p.stats.velocity),
    element: elementCode(def.element ?? null),
    srcIdx: s.srcIdx[i]!,
  });
  s.target[i] = Math.max(1, Math.round(lvl.cooldown * 60 * p.stats.cooldown));
  sim.events.push({ t: 'fire', weapon: def.id, x: s.x[i]!, y: s.y[i]! });
}

/** Moves a flying shot and resolves its hits: pierce, bounce or vanish. */
function updateFlying(sim: Sim, i: number): void {
  const s = sim.shots;
  const en = sim.enemies;
  s.x[i] = s.x[i]! + s.vx[i]!;
  s.y[i] = s.y[i]! + s.vy[i]!;
  s.ttl[i] = s.ttl[i]! - 1;
  if (s.ttl[i]! <= 0) {
    s.kill(i);
    return;
  }
  const n = sim.grid.query(s.x[i]!, s.y[i]!, s.radius[i]! + QUERY_PAD, near);
  for (let k = 0; k < n; k++) {
    const e = near[k]!;
    if (!en.alive[e] || en.fuseT[e]! > 0 || en.hackT[e]! > 0) continue;
    const r = s.radius[i]! + en.radius[e]!;
    const dx = en.x[e]! - s.x[i]!;
    const dy = en.y[e]! - s.y[i]!;
    if (dx * dx + dy * dy > r * r || lastHit(sim, i, e) >= 0) continue;
    remember(sim, i, e);
    const hx = en.x[e]!;
    const hy = en.y[e]!;
    dealDamage(sim, e, s.damage[i]!, shotHooks.source(sim, i));
    if (s.pierce[i]! > 0) {
      s.pierce[i] = s.pierce[i]! - 1;
      continue;
    }
    if (s.bounces[i]! > 0) {
      s.bounces[i] = s.bounces[i]! - 1;
      const [next] = nearestEnemies(sim, hx, hy, s.reach[i]!, 1, (o) => lastHit(sim, i, o) >= 0);
      if (next !== undefined) {
        const a = angleTo(en.x[next]! - s.x[i]!, en.y[next]! - s.y[i]!);
        const speed = Math.sqrt(s.vx[i]! * s.vx[i]! + s.vy[i]! * s.vy[i]!);
        s.vx[i] = cosA(a) * speed;
        s.vy[i] = sinA(a) * speed;
        s.angle[i] = a;
        s.ttl[i] = Math.max(s.ttl[i]!, Math.ceil((s.reach[i]! * 1.5) / Math.max(speed, 1e-9)));
        return;
      }
    }
    s.kill(i);
    return;
  }
}

export function updateShots(sim: Sim): void {
  const s = sim.shots;
  for (let i = 0; i < s.top; i++) {
    if (!s.alive[i]) continue;
    const kind = s.kind[i]!;
    if (s.srcKind[i] === 1 && shotHooks.persistent(sim, i)) continue;
    if (kind === SHOT.orb) updateOrb(sim, i);
    else if (kind === SHOT.drone) updateDrone(sim, i);
    else if (!weaponHooks.update(sim, i)) updateFlying(sim, i);
  }
}

/** Damaging and visual areas: they follow their probe if told to, tick their damage and expire. */
export function updateAreas(sim: Sim, areaHit: (sim: Sim, i: number) => void = defaultAreaHit): void {
  const a = sim.areas;
  for (let i = 0; i < a.top; i++) {
    if (!a.alive[i]) continue;
    const p = sim.probes[a.owner[i]!];
    if (a.follow[i] && p) {
      a.x[i] = p.x;
      a.y[i] = p.y;
      // A flamethrower turns with its probe's aim.
      if (a.kind[i] === AREA.cone) a.angle[i] = p.aim;
    }
    if (a.damage[i]! > 0 || a.slow[i]! > 0) {
      if (a.tickT[i]! > 0) a.tickT[i] = a.tickT[i]! - 1;
      if (a.tickT[i]! <= 0) {
        a.tickT[i] = Math.max(1, a.interval[i]!);
        areaHit(sim, i);
      }
    }
    a.ttl[i] = a.ttl[i]! - 1;
    if (a.ttl[i]! <= 0) a.kill(i);
  }
}

function defaultAreaHit(sim: Sim, i: number): void {
  const a = sim.areas;
  const en = sim.enemies;
  if (a.slow[i]! > 0) {
    // Slowing fields keep everything inside slowed until the next field tick.
    for (const e of nearestEnemies(sim, a.x[i]!, a.y[i]!, a.radius[i]!, 400)) en.slowT[e] = Math.max(en.slowT[e]!, a.interval[i]! + 1);
  }
  if (!(a.damage[i]! > 0)) return;
  const p = sim.probes[a.owner[i]!];
  hitArea(
    sim,
    a.x[i]!,
    a.y[i]!,
    a.radius[i]!,
    a.damage[i]!,
    {
      probe: a.owner[i]!,
      weapon: a.srcKind[i] === 0 && p ? (p.weapons[a.srcIdx[i]!]?.id ?? null) : null,
      relic: a.srcKind[i] === 1 ? a.srcIdx[i]! : null,
      element: elementOf(a.element[i]!),
      x: a.x[i]!,
      y: a.y[i]!,
    },
    { angle: a.angle[i]!, arc: a.arc[i]!, knockback: a.knockback[i]! },
  );
}
