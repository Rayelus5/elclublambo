import type { WeaponDef, WeaponLevel } from '../content/types';
import { angleTo, ANGLE_STEPS, cosA, degToSteps, sinA } from '../math/trig';
import type { ProbeState, Sim } from '../types';
import { ticks } from '../version';
import { dealDamage } from './combat';
import { elementCode } from './elements';
import {
  AREA,
  hitArea,
  lastHit,
  nearestEnemies,
  remember,
  SHOT,
  shotHooks,
  shotWeapon,
  spawnArea,
  spawnShot,
  ttlFor,
  weaponHooks,
} from './weapons';

// The M3b-1 arsenal (GDD §5.3): weapon kinds beyond M3a's, each with its own role — a beam that locks on and burns a
// line, a flamethrower cone, shards in every direction and seeking missiles. They plug into systems/weapons.ts
// through `weaponHooks`, like relics do through `shotHooks`.

const near: number[] = [];
/** How long the blast of a missile stays on screen. */
const BLAST_SHOW_TICKS = 12;
/** Missiles turn at most 240° per second. */
const MISSILE_TURN = Math.round(degToSteps(240) / 60);
/** A missile whose target is gone looks for another this close to it. */
const MISSILE_SEEK = 150;
const QUERY_PAD = 40;

function elementOf(def: WeaponDef): number {
  return elementCode(def.element ?? null);
}

function wrapDiff(d: number): number {
  let x = ((d % ANGLE_STEPS) + ANGLE_STEPS) % ANGLE_STEPS;
  if (x > ANGLE_STEPS / 2) x -= ANGLE_STEPS;
  return x;
}

/** The slot `e` still holds the enemy of generation `gen`. */
function sameEnemy(sim: Sim, e: number, gen: number): boolean {
  const en = sim.enemies;
  return e >= 0 && e < en.top && en.alive[e] === 1 && en.gen[e] === gen && en.fuseT[e] === 0 && en.hackT[e] === 0;
}

function fire(sim: Sim, p: ProbeState, wi: number, def: WeaponDef, lvl: WeaponLevel): boolean | null {
  const s = p.stats;
  const damage = lvl.damage * s.damage;
  switch (def.kind) {
    case 'beam': {
      const targets = nearestEnemies(sim, p.x, p.y, lvl.range, lvl.count + s.projectiles);
      if (targets.length === 0) return false;
      for (const e of targets) {
        const i = spawnShot(sim, p, SHOT.beam, p.x, p.y, angleTo(sim.enemies.x[e]! - p.x, sim.enemies.y[e]! - p.y), 0, damage, {
          ttl: Math.max(1, ticks(lvl.duration * s.duration)),
          reach: lvl.range,
          srcIdx: wi,
          element: elementOf(def),
        });
        if (i < 0) break;
        sim.shots.radius[i] = lvl.area * s.area;
        sim.shots.target[i] = e;
        sim.shots.bounces[i] = sim.enemies.gen[e]!;
      }
      return true;
    }
    case 'cone': {
      spawnArea(sim, p, AREA.cone, p.x, p.y, lvl.range * s.area, {
        ttl: Math.max(1, ticks(lvl.duration * s.duration)),
        damage,
        interval: Math.max(1, ticks(lvl.interval)),
        follow: true,
        angle: p.aim,
        arc: degToSteps(lvl.area),
        srcIdx: wi,
        element: elementOf(def),
      });
      return true;
    }
    case 'radial': {
      if (nearestEnemies(sim, p.x, p.y, lvl.range * s.velocity, 1).length === 0) return false;
      const n = lvl.count + s.projectiles;
      for (let k = 0; k < n; k++) {
        const a = Math.round((k * ANGLE_STEPS) / n);
        if (
          spawnShot(sim, p, SHOT.shard, p.x, p.y, a, lvl.speed * s.velocity, damage, {
            ttl: ttlFor(lvl.range * s.velocity, lvl.speed * s.velocity),
            pierce: lvl.pierce + s.pierce,
            srcIdx: wi,
            element: elementOf(def),
          }) < 0
        )
          break;
      }
      return n > 0;
    }
    case 'homing': {
      const [prey] = nearestEnemies(sim, p.x, p.y, lvl.range * s.velocity, 1);
      if (prey === undefined) return false;
      const n = lvl.count + s.projectiles;
      for (let k = 0; k < n; k++) {
        const a = p.aim + Math.round((k - (n - 1) / 2) * degToSteps(12));
        const i = spawnShot(sim, p, SHOT.missile, p.x, p.y, a, lvl.speed * s.velocity, damage, {
          ttl: ttlFor(lvl.range * s.velocity, lvl.speed * s.velocity),
          reach: lvl.area * s.area,
          srcIdx: wi,
          element: elementOf(def),
        });
        if (i < 0) break;
        sim.shots.target[i] = prey;
        sim.shots.bounces[i] = sim.enemies.gen[prey]!;
      }
      return n > 0;
    }
    default:
      return null;
  }
}

/** A beam: follows its probe, keeps aiming at its target (or the next one) and burns its whole line. */
function updateBeam(sim: Sim, i: number): void {
  const s = sim.shots;
  const sw = shotWeapon(sim, i);
  const en = sim.enemies;
  s.ttl[i] = s.ttl[i]! - 1;
  if (!sw || !sw.p.alive || s.ttl[i]! < 0) {
    s.kill(i);
    return;
  }
  const { p, lvl } = sw;
  s.x[i] = p.x;
  s.y[i] = p.y;
  if (!sameEnemy(sim, s.target[i]!, s.bounces[i]!)) {
    const [next] = nearestEnemies(sim, p.x, p.y, lvl.range, 1);
    s.target[i] = next ?? -1;
    if (next !== undefined) s.bounces[i] = en.gen[next]!;
  }
  const t = s.target[i]!;
  if (t >= 0) s.angle[i] = angleTo(en.x[t]! - p.x, en.y[t]! - p.y);
  const len = s.reach[i]!;
  const dx = cosA(s.angle[i]!);
  const dy = sinA(s.angle[i]!);
  const interval = Math.max(1, ticks(lvl.interval));
  const n = sim.grid.query(p.x + (dx * len) / 2, p.y + (dy * len) / 2, len / 2 + s.radius[i]! + QUERY_PAD, near);
  for (let k = 0; k < n; k++) {
    const e = near[k]!;
    if (!en.alive[e] || en.fuseT[e]! > 0 || en.hackT[e]! > 0) continue;
    const ex = en.x[e]! - p.x;
    const ey = en.y[e]! - p.y;
    const along = Math.max(0, Math.min(len, ex * dx + ey * dy));
    const ox = ex - dx * along;
    const oy = ey - dy * along;
    const r = s.radius[i]! + en.radius[e]!;
    if (ox * ox + oy * oy > r * r) continue;
    const last = lastHit(sim, i, e);
    if (last >= 0 && sim.tick - last < interval) continue;
    remember(sim, i, e);
    dealDamage(sim, e, s.damage[i]!, { ...shotHooks.source(sim, i), x: p.x, y: p.y });
  }
}

/** A missile: steers towards its target (or a new one nearby), flies on, and blows up on the first enemy it touches. */
function updateMissile(sim: Sim, i: number): void {
  const s = sim.shots;
  const en = sim.enemies;
  if (!sameEnemy(sim, s.target[i]!, s.bounces[i]!)) {
    const [next] = nearestEnemies(sim, s.x[i]!, s.y[i]!, MISSILE_SEEK, 1);
    s.target[i] = next ?? -1;
    if (next !== undefined) s.bounces[i] = en.gen[next]!;
  }
  const t = s.target[i]!;
  const speed = Math.sqrt(s.vx[i]! * s.vx[i]! + s.vy[i]! * s.vy[i]!);
  if (t >= 0) {
    const want = angleTo(en.x[t]! - s.x[i]!, en.y[t]! - s.y[i]!);
    const turn = Math.max(-MISSILE_TURN, Math.min(MISSILE_TURN, wrapDiff(want - s.angle[i]!)));
    s.angle[i] = (((s.angle[i]! + turn) % ANGLE_STEPS) + ANGLE_STEPS) % ANGLE_STEPS;
    s.vx[i] = cosA(s.angle[i]!) * speed;
    s.vy[i] = sinA(s.angle[i]!) * speed;
  }
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
    if (dx * dx + dy * dy > r * r) continue;
    const x = s.x[i]!;
    const y = s.y[i]!;
    const p = sim.probes[s.owner[i]!];
    hitArea(sim, x, y, s.reach[i]!, s.damage[i]!, { ...shotHooks.source(sim, i), x, y });
    if (p) spawnArea(sim, p, AREA.blast, x, y, s.reach[i]!, { ttl: BLAST_SHOW_TICKS, srcIdx: s.srcIdx[i]! });
    s.kill(i);
    return;
  }
}

function update(sim: Sim, i: number): boolean {
  const kind = sim.shots.kind[i]!;
  if (kind === SHOT.beam) updateBeam(sim, i);
  else if (kind === SHOT.missile) updateMissile(sim, i);
  else return false;
  return true;
}

weaponHooks.fire = fire;
weaponHooks.update = update;
