import type { EliteDef, EnemyDef } from '../content/types';
import type { Rng } from '../math/rng';
import { angleTo, ANGLE_STEPS, cosA, degToSteps, sinA } from '../math/trig';
import type { ProbeState, Sim } from '../types';
import { ticks } from '../version';
import { hurtProbe, PROBE_RADIUS } from './probes';

// Fauna of the Static (GDD §5.5): spawning, behaviours (chase, warned charge, shooter, armour, summoner, orbit, support,
// warned blink and lance), separation, knockback, the volatile elite's delayed blast, relocation of stragglers and the
// enemies' bullets.

/** Multipliers from the minute and the layer (systems/director.ts). */
export interface Scale {
  hp: number;
  damage: number;
  speed: number;
}

export const NO_SCALE: Scale = Object.freeze({ hp: 1, damage: 1, speed: 1 });

export const ELITE_CODE = { shielded: 1, swift: 2, volatile: 3 } as const;

/** Behaviour states (aim: a lancer's line or a blink's mark is shown, at `tx, ty` for the blink). */
export const STATE = { move: 0, windup: 1, dash: 2, aim: 3 } as const;

const FOE_BULLET_RADIUS = 4;
const FOE_BULLET_SECONDS = 6;
const KNOCK_DECAY = 0.85;

/** Puts a species in the world; returns its slot, or −1 with the pool full. */
export function spawnEnemy(sim: Sim, def: EnemyDef, x: number, y: number, opts: { elite?: EliteDef; scale?: Scale } = {}): number {
  const en = sim.enemies;
  const i = en.spawn();
  if (i < 0) return -1;
  const scale = opts.scale ?? NO_SCALE;
  const elite = opts.elite;
  const e = sim.sector.elite;
  const hp = def.hp * scale.hp * (elite ? e.hp : 1);
  en.type[i] = sim.content.enemies.indexOf(def);
  en.x[i] = x;
  en.y[i] = y;
  en.px[i] = x;
  en.py[i] = y;
  en.hp[i] = hp;
  en.maxHp[i] = hp;
  en.radius[i] = def.radius * (elite ? e.radius : 1);
  en.speed[i] = def.speed * scale.speed * (elite ? elite.speed : 1);
  en.damage[i] = def.damage * scale.damage;
  en.elite[i] = elite ? ELITE_CODE[elite.id] : 0;
  en.shield[i] = elite ? hp * elite.shield : 0;
  const p = nearestProbe(sim, x, y);
  en.facing[i] = p ? angleTo(p.x - x, p.y - y) : 0;
  return i;
}

export function nearestProbe(sim: Sim, x: number, y: number): ProbeState | null {
  let best: ProbeState | null = null;
  let bestD2 = Infinity;
  for (const p of sim.probes) {
    if (!p.alive) continue;
    const d2 = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y);
    if (d2 < bestD2) {
      bestD2 = d2;
      best = p;
    }
  }
  return best;
}

/** Centre of the living probes (or of all of them once they are down). */
export function probesCentre(sim: Sim): { x: number; y: number } {
  let x = 0;
  let y = 0;
  let n = 0;
  for (const p of sim.probes) {
    if (!p.alive) continue;
    x += p.x;
    y += p.y;
    n++;
  }
  if (n === 0) return { x: sim.probes[0]!.x, y: sim.probes[0]!.y };
  return { x: x / n, y: y / n };
}

/**
 * A point just outside the largest view any player can have (content.arena), on the rectangle around the probes'
 * centre: spawns never pop up on screen, whatever the player's monitor.
 */
export function spawnPoint(sim: Sim, rng: Rng): { x: number; y: number } {
  if (sim.coop) return coopSpawnPoint(sim, rng);
  return rectPoint(sim, rng, probesCentre(sim));
}

/** A point on the rectangle just outside a view centred on `c`. */
function rectPoint(sim: Sim, rng: Rng, c: { x: number; y: number }): { x: number; y: number } {
  const { viewW, viewH, margin } = sim.content.arena;
  const hw = viewW / 2 + margin;
  const hh = viewH / 2 + margin;
  let t = rng.float() * 4 * (hw + hh);
  if (t < 2 * hw) return { x: c.x - hw + t, y: c.y - hh };
  t -= 2 * hw;
  if (t < 2 * hh) return { x: c.x + hw, y: c.y - hh + t };
  t -= 2 * hh;
  if (t < 2 * hw) return { x: c.x + hw - t, y: c.y + hh };
  t -= 2 * hw;
  return { x: c.x - hw, y: c.y + hh - t };
}

/**
 * Co-op (multiplayer plan): players may spread out, so each spawn picks a standing probe and comes in just outside
 * its view, never inside another standing probe's view (three tries, then the last one).
 */
function coopSpawnPoint(sim: Sim, rng: Rng): { x: number; y: number } {
  const up = sim.probes.filter((p) => p.alive);
  if (up.length === 0) return rectPoint(sim, rng, probesCentre(sim));
  const { viewW, viewH } = sim.content.arena;
  let point = { x: 0, y: 0 };
  for (let tries = 0; tries < 3; tries++) {
    const anchor = up[rng.int(up.length)]!;
    point = rectPoint(sim, rng, anchor);
    const seen = up.some((q) => Math.abs(q.x - point.x) < viewW / 2 && Math.abs(q.y - point.y) < viewH / 2);
    if (!seen) return point;
  }
  return point;
}

/** Fires one enemy bullet (speed in units per second); its slot, or −1 when the pool is full. */
export function fireFoeBullet(sim: Sim, x: number, y: number, angle: number, speed: number, damage: number): number {
  const fs = sim.foeShots;
  const i = fs.spawn();
  if (i < 0) return -1;
  fs.x[i] = x;
  fs.y[i] = y;
  fs.px[i] = x;
  fs.py[i] = y;
  fs.vx[i] = (cosA(angle) * speed) / 60;
  fs.vy[i] = (sinA(angle) * speed) / 60;
  fs.damage[i] = damage;
  fs.radius[i] = FOE_BULLET_RADIUS;
  fs.ttl[i] = ticks(FOE_BULLET_SECONDS);
  return i;
}

/** Smallest signed difference b − a between two angle steps, in (−2048, 2048]. */
export function angleDiff(a: number, b: number): number {
  let d = (((b - a) % ANGLE_STEPS) + ANGLE_STEPS) % ANGLE_STEPS;
  if (d > ANGLE_STEPS / 2) d -= ANGLE_STEPS;
  return d;
}

/** True when a hit coming from (ox, oy) lands on the armoured front of enemy `e`. */
export function hitsFront(sim: Sim, e: number, ox: number, oy: number): boolean {
  const def = sim.content.enemies[sim.enemies.type[e]!];
  if (!def || def.behavior.kind !== 'armored' || sim.enemies.boss[e]) return false;
  const dir = angleTo(ox - sim.enemies.x[e]!, oy - sim.enemies.y[e]!);
  return Math.abs(angleDiff(sim.enemies.facing[e]!, dir)) <= degToSteps(def.behavior.arc / 2);
}

/** A point that draws the fauna instead of the probes (a decoy, Nov plan B3) and how far it reaches. */
export interface Lure {
  x: number;
  y: number;
  reach: number;
}

/**
 * The lures of this tick (systems/arsenal-nov.ts fills it): an ordinary enemy or an elite within a lure's reach heads for
 * the nearest one instead of its probe. Núcleos never come here (systems/boss.ts), so they never take the bait.
 */
export const lureHooks: { collect: (sim: Sim, out: Lure[]) => void } = { collect: () => {} };
const lures: Lure[] = [];

/** The nearest lure that reaches enemy `e`, or null. */
function lureFor(sim: Sim, e: number): Lure | null {
  const en = sim.enemies;
  let best: Lure | null = null;
  let bestD2 = Infinity;
  for (const l of lures) {
    const dx = l.x - en.x[e]!;
    const dy = l.y - en.y[e]!;
    const d2 = dx * dx + dy * dy;
    if (d2 <= l.reach * l.reach && d2 < bestD2) {
      bestD2 = d2;
      best = l;
    }
  }
  return best;
}

/** The shot holding enemy `e` (a harpoon's catch, a thrown body), or −1: a hold whose shot is gone is no hold. */
export function heldBy(sim: Sim, e: number): number {
  const h = sim.enemies.held[e]!;
  if (h === 0) return -1;
  const s = h - 1;
  return sim.shots.alive[s] && sim.shots.gen[s] === sim.enemies.heldGen[e] ? s : -1;
}

/** Speed after statuses: a slowed enemy (element slow) moves at 1 − factor. */
export const statusHooks: { speedFactor: (sim: Sim, e: number) => number } = {
  speedFactor: (sim, e) => (sim.enemies.slowT[e]! > 0 ? 1 - sim.content.elements.slow.factor : 1),
};

function moveToward(sim: Sim, e: number, tx: number, ty: number, speed: number): void {
  const en = sim.enemies;
  const dx = tx - en.x[e]!;
  const dy = ty - en.y[e]!;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d < 1e-9) return;
  const stepLen = Math.min(speed / 60, d);
  en.x[e] = en.x[e]! + (dx / d) * stepLen;
  en.y[e] = en.y[e]! + (dy / d) * stepLen;
  en.facing[e] = angleTo(dx, dy);
}

function explode(sim: Sim, e: number): void {
  const en = sim.enemies;
  const blast = sim.content.elites.find((x) => x.id === 'volatile')?.explode;
  if (blast) {
    // It shows and sounds where it goes off (2026-11-14), and leaves `keep` of the life of whoever it reaches.
    sim.events.push({ t: 'blast', x: en.x[e]!, y: en.y[e]!, radius: blast.radius });
    for (const p of sim.probes) {
      if (!p.alive) continue;
      const r = blast.radius + PROBE_RADIUS;
      const dx = p.x - en.x[e]!;
      const dy = p.y - en.y[e]!;
      if (dx * dx + dy * dy <= r * r) hurtProbe(sim, p, blast.damage * damageScale(sim, e), { keep: blast.keep });
    }
  }
  en.kill(e);
}

/** The minute/layer multiplier an enemy was spawned with (its damage over the species' base). */
function damageScale(sim: Sim, e: number): number {
  const def = sim.content.enemies[sim.enemies.type[e]!]!;
  return def.damage > 0 ? sim.enemies.damage[e]! / def.damage : 1;
}

const near: number[] = [];

function separate(sim: Sim, e: number): void {
  const en = sim.enemies;
  const r = en.radius[e]!;
  const n = sim.grid.query(en.x[e]!, en.y[e]!, r * 2 + 8, near);
  for (let k = 0; k < n; k++) {
    const o = near[k]!;
    if (o === e || !en.alive[o] || en.fuseT[o]! > 0) continue;
    const dx = en.x[e]! - en.x[o]!;
    const dy = en.y[e]! - en.y[o]!;
    const min = r + en.radius[o]!;
    const d2 = dx * dx + dy * dy;
    if (d2 >= min * min) continue;
    const d = Math.sqrt(d2);
    if (d < 1e-6) {
      // Exactly on top of each other: part along a direction that depends only on the slots.
      const a = ((e * 977 + o * 131) % ANGLE_STEPS + ANGLE_STEPS) % ANGLE_STEPS;
      en.x[e] = en.x[e]! + cosA(a) * min * 0.5;
      en.y[e] = en.y[e]! + sinA(a) * min * 0.5;
      continue;
    }
    const push = (min - d) * 0.5;
    en.x[e] = en.x[e]! + (dx / d) * push;
    en.y[e] = en.y[e]! + (dy / d) * push;
  }
}

/** One tick of a species' behaviour towards `target`: its probe, or a lure that drew it. */
function behave(sim: Sim, e: number, def: EnemyDef, target: { x: number; y: number }): void {
  const en = sim.enemies;
  const speed = en.speed[e]! * statusHooks.speedFactor(sim, e);
  const dx = target.x - en.x[e]!;
  const dy = target.y - en.y[e]!;
  const d = Math.sqrt(dx * dx + dy * dy);
  const b = def.behavior;
  if (en.timer[e]! > 0) en.timer[e] = en.timer[e]! - 1;
  switch (b.kind) {
    case 'chase':
      moveToward(sim, e, target.x, target.y, speed);
      return;
    case 'charge': {
      const state = en.state[e]!;
      if (state === STATE.windup) {
        if (en.timer[e] === 0) {
          en.state[e] = STATE.dash;
          en.timer[e] = ticks(b.dashTime);
        }
        return;
      }
      if (state === STATE.dash) {
        const a = en.angle[e]!;
        en.x[e] = en.x[e]! + (cosA(a) * b.dashSpeed) / 60;
        en.y[e] = en.y[e]! + (sinA(a) * b.dashSpeed) / 60;
        if (en.timer[e] === 0) {
          en.state[e] = STATE.move;
          en.timer[e] = ticks(b.cooldown);
        }
        return;
      }
      if (en.timer[e] === 0 && d <= b.range) {
        en.state[e] = STATE.windup;
        en.timer[e] = ticks(b.windup);
        const a = angleTo(dx, dy);
        en.angle[e] = a;
        en.facing[e] = a;
        en.tx[e] = target.x;
        en.ty[e] = target.y;
        sim.events.push({ t: 'telegraph', kind: 'charge', x: en.x[e]!, y: en.y[e]!, angle: a, ticks: ticks(b.windup), radius: b.dashSpeed * b.dashTime });
        return;
      }
      moveToward(sim, e, target.x, target.y, speed);
      return;
    }
    case 'shooter': {
      if (d > b.range) moveToward(sim, e, target.x, target.y, speed);
      else if (d < b.range * 0.75) moveToward(sim, e, en.x[e]! - dx, en.y[e]! - dy, speed);
      else en.facing[e] = angleTo(dx, dy);
      if (en.timer[e] === 0 && d <= b.range) {
        en.timer[e] = ticks(b.cooldown);
        const centre = angleTo(dx, dy);
        const step = degToSteps(b.spread);
        const bulletDamage = b.bulletDamage * damageScale(sim, e);
        for (let k = 0; k < b.count; k++) {
          const a = centre + Math.round((k - (b.count - 1) / 2) * step);
          fireFoeBullet(sim, en.x[e]!, en.y[e]!, a, b.bulletSpeed, bulletDamage);
        }
      }
      return;
    }
    case 'armored': {
      const want = angleTo(dx, dy);
      const turn = Math.max(1, Math.round(degToSteps(b.turnRate) / 60));
      const diff = angleDiff(en.facing[e]!, want);
      const delta = Math.abs(diff) <= turn ? diff : diff >= 0 ? turn : -turn;
      const f = (((en.facing[e]! + delta) % ANGLE_STEPS) + ANGLE_STEPS) % ANGLE_STEPS;
      en.facing[e] = f;
      en.x[e] = en.x[e]! + (cosA(f) * speed) / 60;
      en.y[e] = en.y[e]! + (sinA(f) * speed) / 60;
      return;
    }
    case 'summoner': {
      moveToward(sim, e, target.x, target.y, speed);
      if (en.timer[e] === 0) {
        en.timer[e] = ticks(b.cooldown);
        const minion = sim.content.enemies.find((x) => x.id === b.minion);
        if (minion) {
          for (let k = 0; k < b.count; k++) {
            const a = sim.rng.ai.int(ANGLE_STEPS);
            spawnEnemy(sim, minion, en.x[e]! + cosA(a) * 18, en.y[e]! + sinA(a) * 18);
          }
        }
      }
      return;
    }
    case 'orbit': {
      if (en.state[e] === STATE.dash) {
        const a = en.angle[e]!;
        en.x[e] = en.x[e]! + (cosA(a) * b.diveSpeed) / 60;
        en.y[e] = en.y[e]! + (sinA(a) * b.diveSpeed) / 60;
        if (en.timer[e] === 0) {
          en.state[e] = STATE.move;
          en.timer[e] = ticks(b.every);
        }
        return;
      }
      if (en.timer[e] === 0 && d <= b.radius * 1.3) {
        const a = angleTo(dx, dy);
        en.state[e] = STATE.dash;
        en.timer[e] = ticks(b.diveTime);
        en.angle[e] = a;
        en.facing[e] = a;
        return;
      }
      // Towards the point of the ring a little ahead of where it is now: far away that is an approach, on the ring a turn.
      const around = angleTo(en.x[e]! - target.x, en.y[e]! - target.y) + degToSteps(b.turn) / 60;
      moveToward(sim, e, target.x + cosA(around) * b.radius, target.y + sinA(around) * b.radius, speed);
      return;
    }
    case 'support': {
      if (d > b.keep * 1.1) moveToward(sim, e, target.x, target.y, speed);
      else if (d < b.keep * 0.9) moveToward(sim, e, en.x[e]! - dx, en.y[e]! - dy, speed);
      else en.facing[e] = angleTo(dx, dy);
      if (en.timer[e] === 0) {
        en.timer[e] = ticks(b.cooldown);
        tend(sim, e, b.effect, b.amount, b.range);
      }
      return;
    }
    case 'blink': {
      if (en.state[e] === STATE.aim) {
        if (en.timer[e] === 0) {
          const fx = en.x[e]!;
          const fy = en.y[e]!;
          en.x[e] = en.tx[e]!;
          en.y[e] = en.ty[e]!;
          // No interpolation streak across the jump.
          en.px[e] = en.x[e]!;
          en.py[e] = en.y[e]!;
          en.state[e] = STATE.move;
          en.timer[e] = ticks(b.cooldown);
          sim.events.push({ t: 'blink', fx, fy, tx: en.x[e]!, ty: en.y[e]! });
        }
        return;
      }
      if (en.timer[e] === 0 && d <= b.range) {
        // Behind the probe, as seen from the enemy: the probe dodges by moving, not by standing still.
        const a = angleTo(dx, dy);
        en.tx[e] = target.x + cosA(a) * b.offset;
        en.ty[e] = target.y + sinA(a) * b.offset;
        en.state[e] = STATE.aim;
        en.timer[e] = ticks(b.windup);
        en.facing[e] = a;
        sim.events.push({ t: 'telegraph', kind: 'blink', x: en.tx[e]!, y: en.ty[e]!, angle: a, ticks: ticks(b.windup), radius: en.radius[e]! });
        return;
      }
      moveToward(sim, e, target.x, target.y, speed);
      return;
    }
    case 'lancer': {
      if (en.state[e] === STATE.aim) {
        if (en.timer[e] === 0) {
          fireFoeBullet(sim, en.x[e]!, en.y[e]!, en.angle[e]!, b.bulletSpeed, b.bulletDamage * damageScale(sim, e));
          en.state[e] = STATE.move;
          en.timer[e] = ticks(b.cooldown);
        }
        return;
      }
      if (d > b.range) moveToward(sim, e, target.x, target.y, speed);
      else if (d < b.range * 0.75) moveToward(sim, e, en.x[e]! - dx, en.y[e]! - dy, speed);
      else en.facing[e] = angleTo(dx, dy);
      if (en.timer[e] === 0 && d <= b.range) {
        const a = angleTo(dx, dy);
        en.angle[e] = a;
        en.facing[e] = a;
        en.state[e] = STATE.aim;
        en.timer[e] = ticks(b.windup);
        sim.events.push({ t: 'telegraph', kind: 'lance', x: en.x[e]!, y: en.y[e]!, angle: a, ticks: ticks(b.windup), radius: b.range * 1.5 });
      }
      return;
    }
  }
}

/** A support pulse: heals or shields (× max life, a shield of at most one life) the living, non-boss allies in range. */
function tend(sim: Sim, e: number, effect: 'heal' | 'shield', amount: number, range: number): void {
  const en = sim.enemies;
  const x = en.x[e]!;
  const y = en.y[e]!;
  // A copy: separate() reuses the shared buffer.
  const allies = near.slice(0, sim.grid.query(x, y, range, near));
  for (const o of allies) {
    if (o === e || !en.alive[o] || en.boss[o] || en.fuseT[o]! > 0) continue;
    const ox = en.x[o]! - x;
    const oy = en.y[o]! - y;
    if (ox * ox + oy * oy > range * range) continue;
    const max = en.maxHp[o]!;
    if (effect === 'heal') en.hp[o] = Math.min(max, en.hp[o]! + amount * max);
    else en.shield[o] = Math.min(max, en.shield[o]! + amount * max);
  }
  sim.events.push({ t: 'support', x, y, range, effect });
}

/**
 * A frozen or hacked enemy drops the strike it was winding up: its warning ran on and is gone, so the strike has to be
 * warned again (GDD §5.5, §17.3: nothing hits without a warning on screen).
 */
function dropWindup(en: Sim['enemies'], e: number): void {
  if (en.state[e] === STATE.move) return;
  en.state[e] = STATE.move;
  en.timer[e] = 0;
}

/** Moves every non-boss enemy one tick (bosses: systems/boss.ts). */
export function updateEnemies(sim: Sim, relocate: (sim: Sim, e: number) => void): void {
  const en = sim.enemies;
  const despawn = sim.content.arena.despawn;
  lures.length = 0;
  lureHooks.collect(sim, lures);
  for (let e = 0; e < en.top; e++) {
    if (!en.alive[e] || en.boss[e]) continue;
    if (en.fuseT[e]! > 0) {
      en.fuseT[e] = en.fuseT[e]! - 1;
      if (en.fuseT[e] === 0) explode(sim, e);
      continue;
    }
    // On a harpoon's line or in flight from the sling: the shot moves it (systems/arsenal-nov.ts).
    if (en.held[e]! > 0) {
      if (heldBy(sim, e) >= 0) {
        // No push piles up while it is held (review B, M2): it would fire all at once on release.
        en.kx[e] = 0;
        en.ky[e] = 0;
        continue;
      }
      en.held[e] = 0;
    }
    // Knockback
    if (en.kx[e] !== 0 || en.ky[e] !== 0) {
      en.x[e] = en.x[e]! + en.kx[e]!;
      en.y[e] = en.y[e]! + en.ky[e]!;
      en.kx[e] = Math.abs(en.kx[e]!) < 0.01 ? 0 : en.kx[e]! * KNOCK_DECAY;
      en.ky[e] = Math.abs(en.ky[e]!) < 0.01 ? 0 : en.ky[e]! * KNOCK_DECAY;
    }
    if (en.freezeT[e]! > 0) {
      en.freezeT[e] = en.freezeT[e]! - 1;
      dropWindup(en, e);
      continue;
    }
    if (en.hackT[e]! > 0) {
      // Hacked: systems/elements.ts drives it.
      dropWindup(en, e);
      continue;
    }
    const target = nearestProbe(sim, en.x[e]!, en.y[e]!);
    if (!target) continue;
    const ddx = target.x - en.x[e]!;
    const ddy = target.y - en.y[e]!;
    if (ddx * ddx + ddy * ddy > despawn * despawn) {
      relocate(sim, e);
      continue;
    }
    behave(sim, e, sim.content.enemies[en.type[e]!]!, (lures.length > 0 ? lureFor(sim, e) : null) ?? target);
    separate(sim, e);
  }
}

/** Enemy bullets: fly, expire, and hit the first probe they touch. */
export function updateFoeShots(sim: Sim): void {
  const fs = sim.foeShots;
  for (let i = 0; i < fs.top; i++) {
    if (!fs.alive[i]) continue;
    fs.x[i] = fs.x[i]! + fs.vx[i]!;
    fs.y[i] = fs.y[i]! + fs.vy[i]!;
    fs.ttl[i] = fs.ttl[i]! - 1;
    if (fs.ttl[i]! <= 0) {
      fs.kill(i);
      continue;
    }
    for (const p of sim.probes) {
      if (!p.alive) continue;
      const r = PROBE_RADIUS + fs.radius[i]!;
      const dx = p.x - fs.x[i]!;
      const dy = p.y - fs.y[i]!;
      if (dx * dx + dy * dy <= r * r) {
        hurtProbe(sim, p, fs.damage[i]!);
        fs.kill(i);
        break;
      }
    }
  }
}
