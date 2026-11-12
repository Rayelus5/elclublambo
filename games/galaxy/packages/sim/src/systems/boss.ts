import type { BossDef, BossPattern } from '../content/types';
import { angleTo, ANGLE_STEPS, cosA, degToSteps, sinA } from '../math/trig';
import type { Sim } from '../types';
import { ticks } from '../version';
import { scaleAt } from './director';
import { angleDiff, fireFoeBullet, nearestProbe, probesCentre, spawnEnemy } from './enemies';
import { hurtProbe, PROBE_RADIUS } from './probes';
import { coopFactor } from './coop';

// The Static Core (GDD §5.5): a boss with phases that change with its life, and a cycle of patterns that are always
// announced before they hit (a burst warning, or the wind-up of a charge).

const SPAWN_DISTANCE = 260;

/** The Core of the current layer: the sector's, or its deep Core every `every` layers (GDD §5.5). */
export function bossDef(sim: Sim): BossDef | undefined {
  const deep = sim.sector.deepBoss;
  const id = deep && sim.layer % deep.every === 0 ? deep.boss : sim.sector.boss;
  return sim.content.bosses.find((b) => b.id === id);
}

/** True while the Core is away in a blink: it neither takes nor deals damage. */
export function bossAway(sim: Sim, e: number): boolean {
  return sim.boss !== null && sim.boss.index === e && sim.boss.active?.kind === 'blink';
}

/**
 * Damage multiplier of the boss: its layer, the sector's toughness, the group and the season's anomaly (Nov plan B1:
 * before, a Núcleo hit as hard in the hardest sector as in the first).
 */
function layerDamage(sim: Sim, def: BossDef): number {
  return (1 + def.scaling.damagePerLayer * (sim.layer - 1)) * sim.sector.enemyDamage * coopFactor(sim, 'enemyDamage') * (sim.anomaly?.enemyDamage ?? 1);
}

export function spawnBoss(sim: Sim): void {
  const def = bossDef(sim);
  if (!def) return;
  const en = sim.enemies;
  const i = en.spawn();
  if (i < 0) return;
  const c = probesCentre(sim);
  const a = sim.rng.spawn.int(ANGLE_STEPS);
  const hp = def.hp * (1 + def.scaling.hpPerLayer * (sim.layer - 1)) * coopFactor(sim, 'bossHp') * sim.sector.enemyHp * (sim.anomaly?.enemyHp ?? 1);
  en.type[i] = sim.content.bosses.indexOf(def);
  en.boss[i] = 1;
  en.x[i] = c.x + cosA(a) * SPAWN_DISTANCE;
  en.y[i] = c.y + sinA(a) * SPAWN_DISTANCE;
  en.px[i] = en.x[i]!;
  en.py[i] = en.y[i]!;
  en.hp[i] = hp;
  en.maxHp[i] = hp;
  en.radius[i] = def.radius;
  en.speed[i] = def.speed;
  en.damage[i] = def.damage * layerDamage(sim, def);
  en.facing[i] = angleTo(c.x - en.x[i]!, c.y - en.y[i]!);
  sim.boss = { index: i, def: def.id, phase: 0, t: ticks(def.phases[0]!.interval), cursor: 0, active: null };
  sim.events.push({ t: 'bossSpawn', boss: def.id, layer: sim.layer });
}

function patternFor(def: BossDef, phase: number, cursor: number): BossPattern {
  const list = def.phases[phase]!.patterns;
  return list[cursor % list.length]!;
}

function fire(sim: Sim, def: BossDef, p: BossPattern): void {
  const b = sim.boss!;
  const en = sim.enemies;
  const x = en.x[b.index]!;
  const y = en.y[b.index]!;
  const dmg = layerDamage(sim, def);
  const target = nearestProbe(sim, x, y);
  const aim = target ? angleTo(target.x - x, target.y - y) : en.facing[b.index]!;
  switch (p.kind) {
    case 'radial':
      for (let k = 0; k < p.count; k++) fireFoeBullet(sim, x, y, aim + Math.round((k * ANGLE_STEPS) / p.count), p.speed, p.damage * dmg);
      return;
    case 'aimed': {
      const spread = degToSteps(p.spread);
      for (let k = 0; k < p.count; k++) {
        const off = p.count > 1 ? Math.round((k - (p.count - 1) / 2) * (spread / (p.count - 1))) : 0;
        fireFoeBullet(sim, x, y, aim + off, p.speed, p.damage * dmg);
      }
      return;
    }
    case 'summon': {
      const minion = sim.content.enemies.find((e) => e.id === p.enemy);
      if (!minion) return;
      const scale = scaleAt(sim);
      for (let k = 0; k < p.count; k++) {
        const a = Math.round((k * ANGLE_STEPS) / p.count);
        spawnEnemy(sim, minion, x + cosA(a) * (en.radius[b.index]! + 14), y + sinA(a) * (en.radius[b.index]! + 14), { scale });
      }
      return;
    }
    case 'spiral':
      b.active = { kind: 'spiral', t: ticks(p.duration), a: aim };
      return;
    case 'charge':
      b.active = { kind: 'windup', t: ticks(p.windup), a: aim };
      sim.events.push({ t: 'telegraph', kind: 'charge', x, y, angle: aim, ticks: ticks(p.windup), radius: p.dashSpeed * p.dashTime });
      return;
    case 'wall': {
      // A ring with a hole somewhere: the way out is there, not behind.
      const hole = sim.rng.ai.int(ANGLE_STEPS);
      const half = degToSteps(p.gap) / 2;
      for (let k = 0; k < p.count; k++) {
        const a = aim + Math.round((k * ANGLE_STEPS) / p.count);
        if (Math.abs(angleDiff(a, hole)) <= half) continue;
        fireFoeBullet(sim, x, y, a, p.speed, p.damage * dmg);
      }
      return;
    }
    case 'mines': {
      if (!target) return;
      const at = sim.tick + ticks(p.delay);
      for (let k = 0; k < p.count; k++) {
        const a = sim.rng.ai.int(ANGLE_STEPS);
        // Uniform over the disc: the square root keeps them from crowding the centre.
        const r = p.spread * Math.sqrt(sim.rng.ai.float());
        const mx = target.x + cosA(a) * r;
        const my = target.y + sinA(a) * r;
        sim.blasts.push({ x: mx, y: my, radius: p.radius, damage: p.damage * dmg, at });
        sim.events.push({ t: 'telegraph', kind: 'explode', x: mx, y: my, angle: 0, ticks: ticks(p.delay), radius: p.radius });
      }
      return;
    }
    case 'blink': {
      const centre = target ?? { x, y };
      const a = sim.rng.ai.int(ANGLE_STEPS);
      en.tx[b.index] = centre.x + cosA(a) * p.offset;
      en.ty[b.index] = centre.y + sinA(a) * p.offset;
      b.active = { kind: 'blink', t: ticks(p.windup), a };
      sim.events.push({ t: 'telegraph', kind: 'blink', x: en.tx[b.index]!, y: en.ty[b.index]!, angle: a, ticks: ticks(p.windup), radius: en.radius[b.index]! });
      return;
    }
  }
}

/** Runs the pattern in progress (spiral, charge); true while the boss must not walk. */
function runActive(sim: Sim, def: BossDef): boolean {
  const b = sim.boss!;
  const act = b.active;
  if (!act) return false;
  const en = sim.enemies;
  const e = b.index;
  const p = patternFor(def, b.phase, b.cursor - 1);
  act.t--;
  if (act.kind === 'spiral' && p.kind === 'spiral') {
    const every = Math.max(1, ticks(p.every));
    const elapsed = ticks(p.duration) - act.t - 1;
    if (elapsed % every === 0) {
      fireFoeBullet(sim, en.x[e]!, en.y[e]!, act.a, p.speed, p.damage * layerDamage(sim, def));
      act.a = (act.a + degToSteps(p.step)) % ANGLE_STEPS;
    }
    if (act.t <= 0) b.active = null;
    return false;
  }
  if (act.kind === 'blink' && p.kind === 'blink') {
    if (act.t > 0) return true;
    const fx = en.x[e]!;
    const fy = en.y[e]!;
    en.x[e] = en.tx[e]!;
    en.y[e] = en.ty[e]!;
    en.px[e] = en.x[e]!;
    en.py[e] = en.y[e]!;
    b.active = null;
    sim.events.push({ t: 'blink', fx, fy, tx: en.x[e]!, ty: en.y[e]! });
    const dmg = layerDamage(sim, def);
    for (let k = 0; k < p.count; k++) fireFoeBullet(sim, en.x[e]!, en.y[e]!, act.a + Math.round((k * ANGLE_STEPS) / p.count), p.speed, p.damage * dmg);
    return true;
  }
  if (act.kind === 'windup' && p.kind === 'charge') {
    if (act.t <= 0) b.active = { kind: 'dash', t: ticks(p.dashTime), a: act.a };
    return true;
  }
  if (act.kind === 'dash' && p.kind === 'charge') {
    en.x[e] = en.x[e]! + (cosA(act.a) * p.dashSpeed) / 60;
    en.y[e] = en.y[e]! + (sinA(act.a) * p.dashSpeed) / 60;
    for (const probe of sim.probes) {
      if (!probe.alive) continue;
      const r = PROBE_RADIUS + en.radius[e]!;
      const dx = probe.x - en.x[e]!;
      const dy = probe.y - en.y[e]!;
      if (dx * dx + dy * dy <= r * r) hurtProbe(sim, probe, p.damage * layerDamage(sim, def));
    }
    if (act.t <= 0) b.active = null;
    return true;
  }
  b.active = null;
  return false;
}

/** One tick of the boss: phase changes, its pattern clock and its walk. */
export function updateBoss(sim: Sim): void {
  const b = sim.boss;
  if (!b) return;
  const def = sim.content.bosses.find((x) => x.id === b.def);
  const en = sim.enemies;
  if (!def || !en.alive[b.index] || !en.boss[b.index]) return;
  const e = b.index;
  // Stunned (a reaction): no movement, no patterns, the clocks stand still.
  if (en.freezeT[e]! > 0) {
    en.freezeT[e] = en.freezeT[e]! - 1;
    // A charge being wound up is dropped: its warning runs on without it (a blink, already away, is never stunned).
    if (b.active?.kind === 'windup') b.active = null;
    return;
  }

  const frac = en.hp[e]! / en.maxHp[e]!;
  let changed = false;
  while (b.phase + 1 < def.phases.length && frac <= def.phases[b.phase + 1]!.below) {
    b.phase++;
    changed = true;
  }
  if (changed) {
    b.cursor = 0;
    b.active = null;
    b.t = ticks(def.phases[b.phase]!.interval);
    sim.events.push({ t: 'bossPhase', phase: b.phase });
  }
  const phase = def.phases[b.phase]!;

  const busy = runActive(sim, def);
  if (!busy) {
    const target = nearestProbe(sim, en.x[e]!, en.y[e]!);
    if (target) {
      const dx = target.x - en.x[e]!;
      const dy = target.y - en.y[e]!;
      const d = Math.sqrt(dx * dx + dy * dy);
      const reach = en.radius[e]! + PROBE_RADIUS;
      if (d > reach) {
        const stepLen = Math.min((en.speed[e]! * phase.speed) / 60, d - reach);
        en.x[e] = en.x[e]! + (dx / d) * stepLen;
        en.y[e] = en.y[e]! + (dy / d) * stepLen;
      }
      en.facing[e] = angleTo(dx, dy);
    }
  }
  if (b.active) return;
  b.t--;
  const next = patternFor(def, b.phase, b.cursor);
  const warn = ticks(phase.telegraph);
  if (b.t === warn && next.kind !== 'charge') {
    sim.events.push({ t: 'telegraph', kind: 'burst', x: en.x[e]!, y: en.y[e]!, angle: en.facing[e]!, ticks: warn, radius: en.radius[e]! * 2 });
  }
  if (b.t <= 0) {
    b.cursor++;
    fire(sim, def, next);
    b.t = ticks(phase.interval);
  }
}
