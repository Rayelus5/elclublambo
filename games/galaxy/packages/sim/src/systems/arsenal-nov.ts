import type { WeaponDef, WeaponLevel } from '../content/types';
import { angleTo, ANGLE_STEPS, cosA, degToSteps, sinA } from '../math/trig';
import type { HitSource, ProbeState, Sim } from '../types';
import { ticks } from '../version';
import { dealDamage, killEnemy } from './combat';
import { elementCode } from './elements';
import { heldBy, lureHooks } from './enemies';
import { hitPropsShot, touchProps } from './props';
import { AREA, enemiesNear, hitArea, nearestEnemies, SHOT, shotHooks, shotWeapon, spawnArea, spawnShot, ttlFor } from './weapons';

// The November arsenal (Nov plan B3): five weapons that play with the fauna itself. A magnetic harpoon that skewers an
// enemy and reels it in through the others, a gravity sling that throws an ordinary enemy at the crowd, a hologram
// that draws the fauna away from the probe (systems/enemies.ts heads them for it) and then blows up, a photon
// lighthouse whose long beam turns around the probe without end, and a cluster mortar lobbed ahead that scatters
// warned bomblets. They plug into systems/arsenal.ts like its kinds plug into systems/weapons.ts.

const QUERY_PAD = 40;
/** How long a blast stays on screen. */
const BLAST_SHOW_TICKS = 12;
/** A harpoon lets go of its catch this close to its probe: at its feet, not on top of it. */
const HARPOON_RELEASE = 28;
/** An elite on the line comes in at half the speed. */
const ELITE_REEL = 0.5;
/** A harpoon goes for the nearest enemy not already this close (one at the probe's feet has nowhere to be dragged). */
const HARPOON_NEAR = 2 * HARPOON_RELEASE;
/** Extra harpoons of a volley at the same target fan out by this much. */
const HARPOON_FAN = degToSteps(10);
/** The sling weighs the groups this far from what it throws (× its grab reach), the nearest 24 enemies. */
const SLING_SEEK = 1.5;
const SLING_CANDIDATES = 24;
/** A thrown body bursts on its own after flying this far (× the seek reach): nothing to hit. */
const SLING_FLIGHT = 1.5;
/** `vortex` (Catapulta de singularidad): the impact pulls what lies within twice its burst. */
const SINGULARITY_REACH = 2;
/** A volley's extra holograms stand this far around the probe. */
const DECOY_SPREAD = 26;
/** A cluster shell's bomblets: half its damage, a bit more than half its radius, around its landing, 3 ticks apart. */
const BOMBLET_SHARE = 0.5;
const BOMBLET_RADIUS = 0.55;
const BOMBLET_SPREAD = 0.95;
const BOMBLET_STAGGER = 3;
/** A lighthouse forgets the hits older than its interval once it remembers this many. */
const BOOK_PRUNE = 256;

// Exact hit memory per shot, beside the sim like weapons.ts's (whose 16 pairs a catch dragged through a crowd or a
// lighthouse beam would overflow): enemy key → the tick it was hit, renewed when the slot holds a new shot.
const books = new WeakMap<Sim, Map<number, { gen: number; seen: Map<number, number> }>>();

function bookOf(sim: Sim, i: number): Map<number, number> {
  let all = books.get(sim);
  if (!all) {
    all = new Map();
    books.set(sim, all);
  }
  const gen = sim.shots.gen[i]!;
  let b = all.get(i);
  if (!b || b.gen !== gen) {
    b = { gen, seen: new Map() };
    all.set(i, b);
  }
  return b.seen;
}

function keyOf(sim: Sim, e: number): number {
  return e * 65536 + sim.enemies.gen[e]!;
}

/** Enemy `e` can be hit and its edge is within `r` of (x, y). */
function touches(sim: Sim, x: number, y: number, r: number, e: number): boolean {
  const en = sim.enemies;
  if (!en.alive[e] || en.fuseT[e]! > 0 || en.hackT[e]! > 0) return false;
  const dx = en.x[e]! - x;
  const dy = en.y[e]! - y;
  const reach = r + en.radius[e]!;
  return dx * dx + dy * dy <= reach * reach;
}

/** The slot `e` still holds the enemy of generation `gen`. */
function sameEnemy(sim: Sim, e: number, gen: number): boolean {
  const en = sim.enemies;
  return e >= 0 && e < en.top && en.alive[e] === 1 && en.gen[e] === gen && en.fuseT[e] === 0;
}

/** Shot `i` takes enemy `e` (its knockback is dropped: the shot moves it now). */
function hold(sim: Sim, e: number, i: number): void {
  const en = sim.enemies;
  en.held[e] = i + 1;
  en.heldGen[e] = sim.shots.gen[i]!;
  en.kx[e] = 0;
  en.ky[e] = 0;
}

/**
 * What shot `i` holds, in slot order. A volatile elite that died on the line is dropped where it is: its blast stays
 * there, never brought to the probe.
 */
function holdOf(sim: Sim, i: number): number[] {
  const en = sim.enemies;
  const gen = sim.shots.gen[i]!;
  const out: number[] = [];
  for (let e = 0; e < en.top; e++) {
    if (!en.alive[e] || en.held[e] !== i + 1 || en.heldGen[e] !== gen) continue;
    if (en.fuseT[e]! > 0) en.held[e] = 0;
    else out.push(e);
  }
  return out;
}

/** Shot `i` lets go of everything it holds. */
function letGo(sim: Sim, i: number): void {
  for (const e of holdOf(sim, i)) sim.enemies.held[e] = 0;
}

/** Neither a Núcleo nor an elite, and free: the sling may take it. */
function ordinary(sim: Sim, e: number): boolean {
  const en = sim.enemies;
  return !en.boss[e] && en.elite[e] === 0 && heldBy(sim, e) < 0;
}

function source(sim: Sim, i: number, x: number, y: number): HitSource {
  return { ...shotHooks.source(sim, i), x, y };
}

/** Fires one of the November kinds; null: not one of them (the lighthouse is kept by systems/weapons.ts). */
export function fireNovember(sim: Sim, p: ProbeState, wi: number, def: WeaponDef, lvl: WeaponLevel): boolean | null {
  const s = p.stats;
  const damage = lvl.damage * s.damage;
  const element = elementCode(def.element ?? null);
  const en = sim.enemies;
  switch (def.kind) {
    case 'harpoon': {
      // A tow harpoon is one heavy line that drags `count` enemies; the plain one throws `count` lines.
      const n = (def.special === 'pierceAll' ? 1 : lvl.count) + s.projectiles;
      const reach = lvl.range * s.velocity;
      const speed = lvl.speed * s.velocity;
      const taken = (e: number) => heldBy(sim, e) >= 0;
      const near = (e: number) => (en.x[e]! - p.x) * (en.x[e]! - p.x) + (en.y[e]! - p.y) * (en.y[e]! - p.y) < HARPOON_NEAR * HARPOON_NEAR;
      let targets = nearestEnemies(sim, p.x, p.y, reach, n, (e) => taken(e) || near(e));
      if (targets.length === 0) targets = nearestEnemies(sim, p.x, p.y, reach, n, taken);
      if (targets.length === 0 || n <= 0) return false;
      // Out at its speed, back at its reel, with a second of slack for a probe that runs away.
      const ttl = Math.ceil((reach / Math.max(speed, 1) + (2 * reach) / Math.max(lvl.knockback, 1)) * 60) + 60;
      for (let k = 0; k < n; k++) {
        const e = targets[k % targets.length]!;
        const round = Math.floor(k / targets.length);
        const fan = round === 0 ? 0 : (round % 2 === 1 ? 1 : -1) * Math.ceil(round / 2) * HARPOON_FAN;
        const a = angleTo(en.x[e]! - p.x, en.y[e]! - p.y) + fan;
        const i = spawnShot(sim, p, SHOT.harpoon, p.x, p.y, a, speed, damage, { ttl, reach, srcIdx: wi, element });
        if (i < 0) break;
        sim.shots.target[i] = 0; // 0 flying out, 1 reeling in
        sim.shots.bounces[i] = 0; // enemies on its line
      }
      return true;
    }
    case 'sling': {
      const reach = lvl.range * s.velocity;
      const n = lvl.count + s.projectiles;
      const grabs = nearestEnemies(sim, p.x, p.y, reach, n, (e) => !ordinary(sim, e));
      if (grabs.length === 0 || n <= 0) return false;
      for (const body of grabs) throwBody(sim, p, wi, def, lvl, body, grabs, reach);
      return true;
    }
    case 'decoy': {
      const lure = lvl.range * s.area;
      if (nearestEnemies(sim, p.x, p.y, lure, 1).length === 0) return false;
      const n = lvl.count + s.projectiles;
      for (let k = 0; k < n; k++) {
        // The first where the probe is; the others around it, evenly, starting at its side.
        const a = p.facing + ANGLE_STEPS / 4 + Math.round(((k - 1) * ANGLE_STEPS) / Math.max(1, n - 1));
        const x = k === 0 ? p.x : p.x + cosA(a) * DECOY_SPREAD;
        const y = k === 0 ? p.y : p.y + sinA(a) * DECOY_SPREAD;
        const i = spawnShot(sim, p, SHOT.decoy, x, y, p.facing, 0, damage, { ttl: Math.max(1, ticks(lvl.duration * s.duration)), reach: lure, srcIdx: wi, element });
        if (i < 0) break;
        sim.shots.radius[i] = lvl.area * s.area;
        sim.shots.life[i] = sim.shots.ttl[i]!;
      }
      return n > 0;
    }
    case 'mortar': {
      const reach = lvl.range * s.velocity;
      const blast = lvl.area * s.area;
      if (nearestEnemies(sim, p.x, p.y, reach + blast, 1).length === 0) return false;
      // Ahead of where the probe goes; standing still, where it aims.
      const dir = p.moving ? p.facing : p.aim;
      const flight = ttlFor(reach, lvl.speed * s.velocity);
      const i = spawnShot(sim, p, SHOT.shell, p.x, p.y, dir, (reach / flight) * 60, damage, { ttl: flight, reach: blast, srcIdx: wi, element });
      if (i < 0) return false;
      const sh = sim.shots;
      sh.tx[i] = p.x + cosA(dir) * reach;
      sh.ty[i] = p.y + sinA(dir) * reach;
      sh.life[i] = flight;
      sh.bounces[i] = lvl.count + s.projectiles; // bomblets
      sh.target[i] = Math.max(1, ticks(lvl.interval)); // their warning
      return true;
    }
    default:
      return null;
  }
}

/**
 * The sling throws `body` at the densest group near it (the most enemies within its burst, the nearest of those), or
 * the way the probe aims when nobody else is there. The shot carries the body: it is the projectile.
 */
function throwBody(sim: Sim, p: ProbeState, wi: number, def: WeaponDef, lvl: WeaponLevel, body: number, thrown: readonly number[], reach: number): void {
  const en = sim.enemies;
  const bx = en.x[body]!;
  const by = en.y[body]!;
  const burst = lvl.area * p.stats.area;
  const seek = reach * SLING_SEEK;
  const pool = nearestEnemies(sim, bx, by, seek, SLING_CANDIDATES, (e) => thrown.includes(e) || heldBy(sim, e) >= 0);
  let aim = -1;
  let most = 0;
  for (const c of pool) {
    let n = 0;
    for (const o of pool) {
      const dx = en.x[o]! - en.x[c]!;
      const dy = en.y[o]! - en.y[c]!;
      if (dx * dx + dy * dy <= burst * burst) n++;
    }
    if (n > most) {
      most = n;
      aim = c;
    }
  }
  const tx = aim >= 0 ? en.x[aim]! : bx + cosA(p.aim) * reach;
  const ty = aim >= 0 ? en.y[aim]! : by + sinA(p.aim) * reach;
  const speed = lvl.speed * p.stats.velocity;
  const i = spawnShot(sim, p, SHOT.sling, bx, by, angleTo(tx - bx, ty - by), speed, lvl.damage * p.stats.damage, {
    ttl: ttlFor(seek * SLING_FLIGHT, speed),
    reach: burst,
    srcIdx: wi,
    element: elementCode(def.element ?? null),
  });
  if (i < 0) return;
  const s = sim.shots;
  s.target[i] = aim;
  s.bounces[i] = aim >= 0 ? en.gen[aim]! : 0;
  s.tx[i] = tx;
  s.ty[i] = ty;
  s.radius[i] = en.radius[body]!;
  hold(sim, body, i);
}

/** A harpoon: out in a straight line, then reeled in with its catch, which hits what it drags through. */
function updateHarpoon(sim: Sim, i: number): void {
  const s = sim.shots;
  const en = sim.enemies;
  const sw = shotWeapon(sim, i);
  s.ttl[i] = s.ttl[i]! - 1;
  if (!sw || sw.def.kind !== 'harpoon' || !sw.p.alive || s.ttl[i]! <= 0) {
    letGo(sim, i);
    s.kill(i);
    return;
  }
  const { p, def, lvl } = sw;
  const seen = bookOf(sim, i);
  if (s.target[i] === 0) {
    const caught = holdOf(sim, i);
    s.x[i] = s.x[i]! + s.vx[i]!;
    s.y[i] = s.y[i]! + s.vy[i]!;
    s.reach[i] = s.reach[i]! - Math.sqrt(s.vx[i]! * s.vx[i]! + s.vy[i]! * s.vy[i]!);
    const tow = def.special === 'pierceAll';
    for (const e of enemiesNear(sim, s.x[i]!, s.y[i]!, s.radius[i]! + QUERY_PAD)) {
      if (caught.includes(e) || !touches(sim, s.x[i]!, s.y[i]!, s.radius[i]!, e) || seen.has(keyOf(sim, e))) continue;
      seen.set(keyOf(sim, e), sim.tick);
      dealDamage(sim, e, s.damage[i]!, shotHooks.source(sim, i));
      // It goes through and takes it; a Núcleo only takes the hit (and a plain harpoon comes back empty).
      const catchable = en.alive[e] === 1 && !en.boss[e] && en.fuseT[e] === 0 && heldBy(sim, e) < 0;
      if (tow) {
        // A tow harpoon skewers the whole line and keeps the first `count`.
        if (catchable && s.bounces[i]! < lvl.count) {
          hold(sim, e, i);
          s.bounces[i] = s.bounces[i]! + 1;
        }
        continue;
      }
      if (catchable) hold(sim, e, i);
      s.target[i] = 1;
      break;
    }
    hitPropsShot(sim, i);
    if (s.reach[i]! <= 0) s.target[i] = 1;
    return;
  }
  const caught = holdOf(sim, i);
  const dx = p.x - s.x[i]!;
  const dy = p.y - s.y[i]!;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d <= HARPOON_RELEASE) {
    letGo(sim, i);
    s.kill(i);
    return;
  }
  const slow = caught.some((e) => en.elite[e]! > 0);
  const move = Math.min((lvl.knockback / 60) * (slow ? ELITE_REEL : 1), d - HARPOON_RELEASE);
  const mx = (dx / d) * move;
  const my = (dy / d) * move;
  s.x[i] = s.x[i]! + mx;
  s.y[i] = s.y[i]! + my;
  // The head points away from the probe, its line back to it.
  s.angle[i] = angleTo(-dx, -dy);
  for (const e of caught) {
    en.x[e] = en.x[e]! + mx;
    en.y[e] = en.y[e]! + my;
    // At the probe's feet it is let go; the rest of the catch comes on.
    const ox = p.x - en.x[e]!;
    const oy = p.y - en.y[e]!;
    if (ox * ox + oy * oy <= HARPOON_RELEASE * HARPOON_RELEASE) en.held[e] = 0;
  }
  // The line and its catch hit what they touch on the way, each enemy once a throw.
  drag(sim, i, s.x[i]!, s.y[i]!, s.radius[i]!, caught, seen);
  for (const e of caught) if (en.alive[e]) drag(sim, i, en.x[e]!, en.y[e]!, en.radius[e]!, caught, seen);
}

/** What a harpoon's line or catch at (x, y) touches takes the harpoon's hit, once a throw. */
function drag(sim: Sim, i: number, x: number, y: number, r: number, caught: readonly number[], seen: Map<number, number>): void {
  for (const o of enemiesNear(sim, x, y, r + QUERY_PAD)) {
    if (caught.includes(o) || !touches(sim, x, y, r, o) || seen.has(keyOf(sim, o))) continue;
    seen.set(keyOf(sim, o), sim.tick);
    dealDamage(sim, o, sim.shots.damage[i]!, source(sim, i, x, y));
  }
}

/** A thrown body: flies at its mark (it follows it if it moves), grazes what it touches and bursts on impact. */
function updateSling(sim: Sim, i: number): void {
  const s = sim.shots;
  const en = sim.enemies;
  s.ttl[i] = s.ttl[i]! - 1;
  const [body] = holdOf(sim, i);
  // Killed in the air by something else: what is left bursts where it is.
  if (body === undefined) {
    burst(sim, i, -1);
    return;
  }
  const mark = s.target[i]!;
  const marked = mark >= 0 && sameEnemy(sim, mark, s.bounces[i]!);
  if (marked) {
    s.tx[i] = en.x[mark]!;
    s.ty[i] = en.y[mark]!;
  }
  const speed = Math.sqrt(s.vx[i]! * s.vx[i]! + s.vy[i]! * s.vy[i]!);
  const dx = s.tx[i]! - s.x[i]!;
  const dy = s.ty[i]! - s.y[i]!;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d > 1e-9) {
    const step = Math.min(speed, d);
    s.x[i] = s.x[i]! + (dx / d) * step;
    s.y[i] = s.y[i]! + (dy / d) * step;
    s.vx[i] = (dx / d) * speed;
    s.vy[i] = (dy / d) * speed;
    s.angle[i] = angleTo(dx, dy);
  }
  en.x[body] = s.x[i]!;
  en.y[body] = s.y[i]!;
  const seen = bookOf(sim, i);
  const r = en.radius[body]!;
  for (const o of enemiesNear(sim, s.x[i]!, s.y[i]!, r + QUERY_PAD)) {
    if (o === body || !touches(sim, s.x[i]!, s.y[i]!, r, o)) continue;
    if (marked && o === mark) {
      burst(sim, i, body);
      return;
    }
    if (seen.has(keyOf(sim, o))) continue;
    seen.set(keyOf(sim, o), sim.tick);
    dealDamage(sim, o, s.damage[i]!, source(sim, i, s.x[i]!, s.y[i]!));
  }
  hitPropsShot(sim, i);
  if (d <= speed || s.ttl[i]! <= 0) burst(sim, i, en.alive[body] ? body : -1);
}

/** The thrown body dies (with its credit and loot) and bursts; a `vortex` sling leaves a brief singularity. */
function burst(sim: Sim, i: number, body: number): void {
  const s = sim.shots;
  const en = sim.enemies;
  const sw = shotWeapon(sim, i);
  const p = sim.probes[s.owner[i]!];
  const x = s.x[i]!;
  const y = s.y[i]!;
  const src = source(sim, i, x, y);
  letGo(sim, i);
  if (body >= 0 && en.alive[body] && en.fuseT[body] === 0) killEnemy(sim, body, src);
  hitArea(sim, x, y, s.reach[i]!, s.damage[i]!, src);
  if (p) {
    spawnArea(sim, p, AREA.blast, x, y, s.reach[i]!, { ttl: BLAST_SHOW_TICKS, srcIdx: s.srcIdx[i]! });
    if (sw && sw.def.special === 'vortex') {
      spawnArea(sim, p, AREA.field, x, y, s.reach[i]! * SINGULARITY_REACH, {
        ttl: Math.max(1, ticks(sw.lvl.duration * p.stats.duration)),
        pull: sw.lvl.knockback,
        srcIdx: s.srcIdx[i]!,
        element: s.element[i]!,
      });
    }
  }
  s.kill(i);
}

/** A hologram stays put (systems/enemies.ts draws the fauna to it) and blows up when its time is up. */
function updateDecoy(sim: Sim, i: number): void {
  const s = sim.shots;
  s.ttl[i] = s.ttl[i]! - 1;
  if (s.ttl[i]! > 0) return;
  const p = sim.probes[s.owner[i]!];
  const x = s.x[i]!;
  const y = s.y[i]!;
  hitArea(sim, x, y, s.radius[i]!, s.damage[i]!, source(sim, i, x, y));
  if (p) spawnArea(sim, p, AREA.blast, x, y, s.radius[i]!, { ttl: BLAST_SHOW_TICKS, srcIdx: s.srcIdx[i]! });
  s.kill(i);
}

/**
 * A lighthouse beam: turns around its probe at its speed and hits what lies on it or what it swept over this tick (a
 * fast turn never skips anything), each enemy at most once per interval.
 */
function updatePhoton(sim: Sim, i: number): void {
  const s = sim.shots;
  const en = sim.enemies;
  const sw = shotWeapon(sim, i);
  if (!sw || sw.def.kind !== 'lighthouse') {
    s.kill(i);
    return;
  }
  const { p, lvl } = sw;
  const turn = (lvl.speed * ANGLE_STEPS) / 360 / 60;
  const from = s.reach[i]!;
  s.reach[i] = (from + turn) % ANGLE_STEPS;
  const a = Math.round(s.reach[i]!);
  const cx = cosA(a);
  const cy = sinA(a);
  const len = lvl.range * p.stats.area;
  s.x[i] = p.x;
  s.y[i] = p.y;
  s.angle[i] = a;
  s.radius[i] = lvl.area;
  s.tx[i] = p.x + cx * len;
  s.ty[i] = p.y + cy * len;
  if (!p.alive) return;
  const interval = Math.max(1, ticks(lvl.interval));
  const seen = bookOf(sim, i);
  const damage = lvl.damage * p.stats.damage;
  for (const e of enemiesNear(sim, p.x + (cx * len) / 2, p.y + (cy * len) / 2, len / 2 + QUERY_PAD)) {
    if (!en.alive[e] || en.fuseT[e]! > 0 || en.hackT[e]! > 0) continue;
    const ex = en.x[e]! - p.x;
    const ey = en.y[e]! - p.y;
    const r = en.radius[e]!;
    const along = ex * cx + ey * cy;
    const off = ey * cx - ex * cy;
    let hit = along >= -r && along <= len + r && Math.abs(off) <= lvl.area + r;
    if (!hit && ex * ex + ey * ey <= (len + r) * (len + r)) {
      const swept = (((angleTo(ex, ey) - from) % ANGLE_STEPS) + ANGLE_STEPS) % ANGLE_STEPS;
      hit = swept < turn;
    }
    if (!hit) continue;
    const key = keyOf(sim, e);
    const last = seen.get(key);
    if (last !== undefined && sim.tick - last < interval) continue;
    seen.set(key, sim.tick);
    dealDamage(sim, e, damage, source(sim, i, p.x, p.y));
  }
  if (seen.size > BOOK_PRUNE) for (const [key, at] of seen) if (sim.tick - at >= interval) seen.delete(key);
  // Rocks along it break too (each at its own pace, like under an orb).
  for (const k of [1, 2, 3]) touchProps(sim, p.x + (cx * len * k) / 3, p.y + (cy * len * k) / 3, lvl.area + 4, damage, p.index);
}

/** A mortar shell: flies over everything to its landing point, blows up and scatters its warned bomblets. */
function updateShell(sim: Sim, i: number): void {
  const s = sim.shots;
  s.x[i] = s.x[i]! + s.vx[i]!;
  s.y[i] = s.y[i]! + s.vy[i]!;
  s.ttl[i] = s.ttl[i]! - 1;
  if (s.ttl[i]! > 0) return;
  const x = s.tx[i]!;
  const y = s.ty[i]!;
  s.x[i] = x;
  s.y[i] = y;
  const p = sim.probes[s.owner[i]!];
  const blast = s.reach[i]!;
  hitArea(sim, x, y, blast, s.damage[i]!, source(sim, i, x, y));
  if (p) {
    spawnArea(sim, p, AREA.blast, x, y, blast, { ttl: BLAST_SHOW_TICKS, srcIdx: s.srcIdx[i]! });
    const n = s.bounces[i]!;
    for (let k = 0; k < n; k++) {
      // Around the landing, every other one a little closer, each going off a moment after the last.
      const a = s.angle[i]! + Math.round(((k + 0.5) * ANGLE_STEPS) / n);
      const r = blast * BOMBLET_SPREAD * (k % 2 === 0 ? 1 : 0.7);
      spawnArea(sim, p, AREA.bomblet, x + cosA(a) * r, y + sinA(a) * r, blast * BOMBLET_RADIUS, {
        ttl: s.target[i]! + k * BOMBLET_STAGGER,
        knockback: s.damage[i]! * BOMBLET_SHARE, // its damage, dealt when the warning ends (systems/arsenal.ts)
        srcIdx: s.srcIdx[i]!,
        element: s.element[i]!,
      });
    }
  }
  s.kill(i);
}

/** Moves one of the November shots; false: not one of them. */
export function updateNovember(sim: Sim, i: number): boolean {
  const kind = sim.shots.kind[i]!;
  if (kind === SHOT.harpoon) updateHarpoon(sim, i);
  else if (kind === SHOT.sling) updateSling(sim, i);
  else if (kind === SHOT.decoy) updateDecoy(sim, i);
  else if (kind === SHOT.photon) updatePhoton(sim, i);
  else if (kind === SHOT.shell) updateShell(sim, i);
  else return false;
  return true;
}

// The holograms draw the fauna (systems/enemies.ts asks for them once a tick).
lureHooks.collect = (sim, out) => {
  const s = sim.shots;
  for (let i = 0; i < s.top; i++) if (s.alive[i] && s.kind[i] === SHOT.decoy) out.push({ x: s.x[i]!, y: s.y[i]!, reach: s.reach[i]! });
};
