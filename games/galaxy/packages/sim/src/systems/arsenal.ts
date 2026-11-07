import type { WeaponDef, WeaponLevel } from '../content/types';
import { angleTo, ANGLE_STEPS, cosA, degToSteps, sinA } from '../math/trig';
import type { HitSource, ProbeState, Sim } from '../types';
import { ticks } from '../version';
import { combatHooks, dealDamage } from './combat';
import { elementCode, elementOf as elementOfCode } from './elements';
import {
  AREA,
  enemiesNear,
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
  weaponSource,
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
/** Mines arm half a second after they are dropped. */
const MINE_ARM = ticks(0.5);
/** Where the extra mines of a volley go, around the probe. */
const MINE_SPREAD = 16;
/** A returning disc is caught this close to its probe. */
const DISC_CATCH = 10;
/** `vortex` areas pull at this speed (units per second). */
const VORTEX_PULL = 70;
/** A pulling cone gathers its catch at this fraction of its reach in front of the probe. */
const CONE_FOCUS = 0.35;
/** `split`: three fragments fanned 25° apart, at half damage, for 0.4 s. */
const SPLIT_FAN = degToSteps(25);
const SPLIT_SHARE = 0.5;
const SPLIT_TICKS = ticks(0.4);
const SPLIT_MIN_SPEED = 200;
/** `chain`: each hit jumps to 2 neighbours within 80 units at half damage. */
const CHAIN_TARGETS = 2;
const CHAIN_RANGE = 80;
const CHAIN_SHARE = 0.5;

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
        pull: def.special === 'vortex' ? VORTEX_PULL : 0,
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
    case 'mine': {
      const n = lvl.count + s.projectiles;
      for (let k = 0; k < n; k++) {
        const a = Math.round((k * ANGLE_STEPS) / Math.max(1, n - 1)) + p.facing;
        const x = k === 0 ? p.x : p.x + cosA(a) * MINE_SPREAD;
        const y = k === 0 ? p.y : p.y + sinA(a) * MINE_SPREAD;
        const i = spawnShot(sim, p, SHOT.mine, x, y, 0, 0, damage, {
          ttl: Math.max(1, ticks(lvl.duration * s.duration)),
          reach: lvl.area * s.area,
          srcIdx: wi,
          element: elementOf(def),
        });
        if (i < 0) break;
        sim.shots.target[i] = MINE_ARM;
      }
      return n > 0;
    }
    case 'boomerang': {
      const n = lvl.count + s.projectiles;
      const targets = nearestEnemies(sim, p.x, p.y, lvl.range * s.velocity, n);
      if (targets.length === 0 || n <= 0) return false;
      for (let k = 0; k < n; k++) {
        const e = targets[k % targets.length]!;
        const round = Math.floor(k / targets.length);
        const a = angleTo(sim.enemies.x[e]! - p.x, sim.enemies.y[e]! - p.y) + round * degToSteps(25);
        const i = spawnShot(sim, p, SHOT.disc, p.x, p.y, a, lvl.speed * s.velocity, damage, {
          ttl: ttlFor(lvl.range * s.velocity * 4, lvl.speed * s.velocity),
          reach: lvl.range * s.velocity,
          srcIdx: wi,
          element: elementOf(def),
        });
        if (i < 0) break;
        sim.shots.target[i] = 0; // 0 outward, 1 coming back
      }
      return true;
    }
    case 'field': {
      const [e] = nearestEnemies(sim, p.x, p.y, lvl.range, 1);
      if (e === undefined) return false;
      spawnArea(sim, p, AREA.field, sim.enemies.x[e]!, sim.enemies.y[e]!, lvl.area * s.area, {
        ttl: Math.max(1, ticks(lvl.duration * s.duration)),
        damage,
        interval: Math.max(1, ticks(lvl.interval)),
        pull: lvl.knockback,
        srcIdx: wi,
        element: elementOf(def),
      });
      return true;
    }
    case 'strike': {
      const pool = nearestEnemies(sim, p.x, p.y, lvl.range, 64);
      if (pool.length === 0) return false;
      pool.sort((a, b) => a - b);
      const n = Math.min(pool.length, lvl.count + s.projectiles);
      // A partial Fisher–Yates on the slot-ordered candidates: n distinct marks, the same for the same seed.
      for (let k = 0; k < n; k++) {
        const j = k + sim.rng.combat.int(pool.length - k);
        const e = pool[j]!;
        pool[j] = pool[k]!;
        pool[k] = e;
        spawnArea(sim, p, AREA.strike, sim.enemies.x[e]!, sim.enemies.y[e]!, lvl.area * s.area, {
          ttl: Math.max(1, ticks(lvl.interval)),
          knockback: damage, // the blast's damage, dealt when the warning ends
          srcIdx: wi,
          element: elementOf(def),
        });
      }
      return true;
    }
    case 'turret': {
      const max = Math.max(1, lvl.count + s.projectiles);
      const mine: number[] = [];
      const sh = sim.shots;
      for (let i = 0; i < sh.top; i++) if (sh.alive[i] && sh.kind[i] === SHOT.turret && sh.owner[i] === p.index && sh.srcKind[i] === 0 && sh.srcIdx[i] === wi) mine.push(i);
      // The oldest (least time left) goes first.
      mine.sort((a, b) => sh.ttl[a]! - sh.ttl[b]! || a - b);
      while (mine.length >= max) sh.kill(mine.shift()!);
      const i = spawnShot(sim, p, SHOT.turret, p.x, p.y, 0, 0, damage, {
        ttl: Math.max(1, ticks(lvl.duration * s.duration)),
        srcIdx: wi,
        element: elementOf(def),
      });
      if (i >= 0) sh.target[i] = 0;
      return i >= 0;
    }
    default:
      return null;
  }
}

/** A mine: arms, then blows up when an enemy comes within its trigger radius; it expires on its own. */
function updateMine(sim: Sim, i: number): void {
  const s = sim.shots;
  const en = sim.enemies;
  s.ttl[i] = s.ttl[i]! - 1;
  if (s.ttl[i]! <= 0) {
    s.kill(i);
    return;
  }
  if (s.target[i]! > 0) {
    s.target[i] = s.target[i]! - 1;
    return;
  }
  const sw = shotWeapon(sim, i);
  const trigger = sw ? sw.lvl.range : 18;
  const n = sim.grid.query(s.x[i]!, s.y[i]!, trigger + QUERY_PAD, near);
  for (let k = 0; k < n; k++) {
    const e = near[k]!;
    if (!en.alive[e] || en.fuseT[e]! > 0 || en.hackT[e]! > 0) continue;
    const r = trigger + en.radius[e]!;
    const dx = en.x[e]! - s.x[i]!;
    const dy = en.y[e]! - s.y[i]!;
    if (dx * dx + dy * dy > r * r) continue;
    blast(sim, i);
    return;
  }
}

/** A shot blows up where it is: damage in `reach`, a blast on screen, gone. */
function blast(sim: Sim, i: number): void {
  const s = sim.shots;
  const x = s.x[i]!;
  const y = s.y[i]!;
  const p = sim.probes[s.owner[i]!];
  hitArea(sim, x, y, s.reach[i]!, s.damage[i]!, { ...shotHooks.source(sim, i), x, y });
  splitAt(sim, i, -1, x, y);
  if (p) spawnArea(sim, p, AREA.blast, x, y, s.reach[i]!, { ttl: BLAST_SHOW_TICKS, srcIdx: s.srcIdx[i]! });
  s.kill(i);
}

/** A disc: flies out to its reach, comes back to its probe, and cuts everything on the way (once per interval). */
function updateDisc(sim: Sim, i: number): void {
  const s = sim.shots;
  const en = sim.enemies;
  const sw = shotWeapon(sim, i);
  const p = sim.probes[s.owner[i]!];
  s.ttl[i] = s.ttl[i]! - 1;
  if (!p || !p.alive || s.ttl[i]! <= 0) {
    s.kill(i);
    return;
  }
  const speed = Math.sqrt(s.vx[i]! * s.vx[i]! + s.vy[i]! * s.vy[i]!);
  if (s.target[i] === 0) {
    s.reach[i] = s.reach[i]! - speed;
    if (s.reach[i]! <= 0) s.target[i] = 1;
  }
  if (s.target[i] === 1) {
    const dx = p.x - s.x[i]!;
    const dy = p.y - s.y[i]!;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d <= DISC_CATCH + speed) {
      s.kill(i);
      return;
    }
    s.vx[i] = (dx / d) * speed;
    s.vy[i] = (dy / d) * speed;
    s.angle[i] = angleTo(dx, dy);
  }
  s.x[i] = s.x[i]! + s.vx[i]!;
  s.y[i] = s.y[i]! + s.vy[i]!;
  const interval = Math.max(1, ticks(sw ? sw.lvl.interval || 0.3 : 0.3));
  for (const e of enemiesNear(sim, s.x[i]!, s.y[i]!, s.radius[i]! + QUERY_PAD)) {
    if (!en.alive[e] || en.fuseT[e]! > 0 || en.hackT[e]! > 0) continue;
    const r = s.radius[i]! + en.radius[e]!;
    const ex = en.x[e]! - s.x[i]!;
    const ey = en.y[e]! - s.y[i]!;
    if (ex * ex + ey * ey > r * r) continue;
    const last = lastHit(sim, i, e);
    if (last >= 0 && sim.tick - last < interval) continue;
    remember(sim, i, e);
    dealDamage(sim, e, s.damage[i]!, shotHooks.source(sim, i));
  }
}

/** A turret: stays put, fires at the nearest enemy at its rate, and expires. */
function updateTurret(sim: Sim, i: number): void {
  const s = sim.shots;
  const sw = shotWeapon(sim, i);
  s.ttl[i] = s.ttl[i]! - 1;
  if (!sw || s.ttl[i]! <= 0) {
    s.kill(i);
    return;
  }
  const { p, def, lvl } = sw;
  if (s.target[i]! > 0) s.target[i] = s.target[i]! - 1;
  if (s.target[i]! > 0) return;
  const [e] = nearestEnemies(sim, s.x[i]!, s.y[i]!, lvl.range, 1);
  if (e === undefined) return;
  const a = angleTo(sim.enemies.x[e]! - s.x[i]!, sim.enemies.y[e]! - s.y[i]!);
  s.angle[i] = a;
  spawnShot(sim, p, SHOT.droneBolt, s.x[i]!, s.y[i]!, a, lvl.speed * p.stats.velocity, s.damage[i]!, {
    ttl: ttlFor(lvl.range * 1.3, lvl.speed * p.stats.velocity),
    srcIdx: s.srcIdx[i]!,
    element: s.element[i]!,
  });
  s.target[i] = Math.max(1, ticks(lvl.interval * p.stats.cooldown));
  sim.events.push({ t: 'fire', weapon: def.id, x: s.x[i]!, y: s.y[i]! });
}

/** A gravity well pulls every enemy inside (bosses stay) towards its centre, never past it. */
function pull(sim: Sim, i: number): void {
  const a = sim.areas;
  const en = sim.enemies;
  const step = a.pull[i]! / 60;
  if (!(step > 0)) return;
  const cone = a.arc[i]! > 0;
  // A well pulls to its centre; a cone to a point in front of the probe, so what it draws in stays in the fire
  // (pulled onto the probe, crowding would push it out behind, where the cone neither burns nor pulls).
  const fx = cone ? a.x[i]! + cosA(a.angle[i]!) * a.radius[i]! * CONE_FOCUS : a.x[i]!;
  const fy = cone ? a.y[i]! + sinA(a.angle[i]!) * a.radius[i]! * CONE_FOCUS : a.y[i]!;
  for (const e of enemiesNear(sim, a.x[i]!, a.y[i]!, a.radius[i]! + QUERY_PAD)) {
    if (!en.alive[e] || en.boss[e] || en.fuseT[e]! > 0) continue;
    const ox = en.x[e]! - a.x[i]!;
    const oy = en.y[e]! - a.y[i]!;
    const od = Math.sqrt(ox * ox + oy * oy);
    if (od > a.radius[i]! + en.radius[e]!) continue;
    // A cone pulls only what is inside it, never what is behind the probe.
    if (cone && od > 1e-9 && Math.abs(wrapDiff(angleTo(ox, oy) - a.angle[i]!)) > a.arc[i]! / 2) continue;
    const dx = fx - en.x[e]!;
    const dy = fy - en.y[e]!;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < 1e-9) continue;
    const move = Math.min(step, d);
    en.x[e] = en.x[e]! + (dx / d) * move;
    en.y[e] = en.y[e]! + (dy / d) * move;
  }
}

/** An orbital strike blows up when its warning ends. */
function expire(sim: Sim, i: number): void {
  const a = sim.areas;
  if (a.kind[i] !== AREA.strike) return;
  const p = sim.probes[a.owner[i]!];
  if (!p) return;
  const x = a.x[i]!;
  const y = a.y[i]!;
  const def = p.weapons[a.srcIdx[i]!] ? sim.content.weapons.find((w) => w.id === p.weapons[a.srcIdx[i]!]!.id) : undefined;
  const src = def ? weaponSource(p, def, x, y) : { probe: p.index, weapon: null, relic: null, element: null, x, y };
  hitArea(sim, x, y, a.radius[i]!, a.knockback[i]!, { ...src, element: elementOfCode(a.element[i]!) });
  spawnArea(sim, p, AREA.blast, x, y, a.radius[i]!, { ttl: BLAST_SHOW_TICKS, srcIdx: a.srcIdx[i]! });
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
  // A pulse clock (in the pierce field: beams never pierce): the whole line burns once per interval, whatever the
  // crowd (a per-enemy memory would overflow with more than a handful of enemies on the line).
  if (s.pierce[i]! > 0) {
    s.pierce[i] = s.pierce[i]! - 1;
    return;
  }
  s.pierce[i] = Math.max(1, ticks(lvl.interval)) - 1;
  for (const e of enemiesNear(sim, p.x + (dx * len) / 2, p.y + (dy * len) / 2, len / 2 + s.radius[i]! + QUERY_PAD)) {
    if (!en.alive[e] || en.fuseT[e]! > 0 || en.hackT[e]! > 0) continue;
    const ex = en.x[e]! - p.x;
    const ey = en.y[e]! - p.y;
    const along = Math.max(0, Math.min(len, ex * dx + ey * dy));
    const ox = ex - dx * along;
    const oy = ey - dy * along;
    const r = s.radius[i]! + en.radius[e]!;
    if (ox * ox + oy * oy > r * r) continue;
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
    blast(sim, i);
    return;
  }
}

function update(sim: Sim, i: number): boolean {
  const kind = sim.shots.kind[i]!;
  if (kind === SHOT.beam) updateBeam(sim, i);
  else if (kind === SHOT.missile) updateMissile(sim, i);
  else if (kind === SHOT.mine) updateMine(sim, i);
  else if (kind === SHOT.disc) updateDisc(sim, i);
  else if (kind === SHOT.turret) updateTurret(sim, i);
  else return false;
  return true;
}

weaponHooks.fire = fire;
/** `split`: a shot's first hit (or blast) throws three fragments, once; fragments never split. */
function splitAt(sim: Sim, i: number, hitEnemy: number, x: number, y: number): void {
  const s = sim.shots;
  if (s.kind[i] === SHOT.split || (s.flags[i]! & 1) !== 0) return;
  const sw = shotWeapon(sim, i);
  if (!sw || sw.def.special !== 'split') return;
  s.flags[i] = s.flags[i]! | 1;
  const speed = Math.max(SPLIT_MIN_SPEED, Math.sqrt(s.vx[i]! * s.vx[i]! + s.vy[i]! * s.vy[i]!) * 60);
  for (const turn of [-SPLIT_FAN, 0, SPLIT_FAN]) {
    const f = spawnShot(sim, sw.p, SHOT.split, x, y, s.angle[i]! + turn, speed, s.damage[i]! * SPLIT_SHARE, {
      ttl: SPLIT_TICKS,
      pierce: sw.p.stats.pierce,
      srcIdx: s.srcIdx[i]!,
      element: s.element[i]!,
    });
    if (f < 0) return;
    if (hitEnemy >= 0) remember(sim, f, hitEnemy);
  }
}

/** `chain`: a weapon hit jumps to two neighbours at half damage; the jumps carry no weapon, so they never jump again. */
function chainFrom(sim: Sim, e: number, dealt: number, x: number, y: number, src: HitSource): void {
  if (!src.weapon || !(dealt > 0)) return;
  const def = sim.content.weapons.find((w) => w.id === src.weapon);
  if (def?.special !== 'chain') return;
  const next = nearestEnemies(sim, x, y, CHAIN_RANGE, CHAIN_TARGETS + 1, (o) => o === e);
  for (const o of next.slice(0, CHAIN_TARGETS)) dealDamage(sim, o, dealt * CHAIN_SHARE, { ...src, weapon: null, element: null, x, y });
}

weaponHooks.update = update;
weaponHooks.afterHit = (sim, i, e, x, y) => splitAt(sim, i, e, x, y);
combatHooks.afterHit = chainFrom;
weaponHooks.expire = expire;
weaponHooks.pull = pull;
