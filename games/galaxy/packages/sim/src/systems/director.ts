import { ANGLE_STEPS, cosA, sinA } from '../math/trig';
import type { Sim } from '../types';
import { probesCentre, type Scale, spawnEnemy, spawnPoint, STATE } from './enemies';
import { coopFactor } from './coop';

// The spawn director (GDD §5.5–5.6): density grows with the run's minutes, species join over the first layer (from
// layer 2 on, all from the start), fixed waves arrive on schedule in every layer, and life, damage, speed and the
// elite chance scale with the minute and the layer.

/** Seconds since the current layer began. */
export function layerSeconds(sim: Sim): number {
  return (sim.tick - (sim.clocks['layerStart'] ?? 0)) / 60;
}

export function scaleAt(sim: Sim): Scale & { elite: number } {
  const s = sim.sector.scaling;
  const minutes = sim.tick / 3600;
  const deeper = sim.layer - 1;
  const elite = Math.min(s.eliteMax, s.eliteBase + s.elitePerMinute * minutes);
  const scale = {
    hp: (1 + s.hpPerMinute * minutes) * (1 + s.hpPerLayer * deeper),
    damage: (1 + s.damagePerMinute * minutes) * (1 + s.damagePerLayer * deeper),
    speed: 1 + s.speedPerLayer * deeper,
    elite,
  };
  // The sector's own toughness (open beta): 1 for content published before.
  scale.hp *= sim.sector.enemyHp;
  scale.damage *= sim.sector.enemyDamage;
  // Co-op (multiplayer plan): tougher by the players in the run; 1 in solo.
  scale.hp *= coopFactor(sim, 'enemyHp');
  scale.damage *= coopFactor(sim, 'enemyDamage');
  // The season's anomaly (M7d-3) multiplies on top; without one nothing changes.
  const a = sim.anomaly;
  if (a) {
    scale.hp *= a.enemyHp;
    scale.damage *= a.enemyDamage;
    scale.speed *= a.enemySpeed;
    scale.elite = Math.min(1, elite * a.elite);
  }
  return scale;
}

/** The Static signal (curse) of the run: the highest among living probes. */
export function curseOf(sim: Sim): number {
  let c = 0;
  for (const p of sim.probes) if (p.alive && p.stats.curse > c) c = p.stats.curse;
  return c;
}

function aliveFauna(sim: Sim): number {
  return sim.enemies.count - (sim.boss ? 1 : 0);
}

function spawnGroup(sim: Sim): void {
  const sector = sim.sector;
  const cap = Math.min(sim.content.limits.enemies, Math.floor(sector.density.cap * (1 + curseOf(sim)) * coopFactor(sim, 'density')));
  if (aliveFauna(sim) >= cap) return;
  const now = layerSeconds(sim);
  const open = sector.spawns.filter((s) => sim.layer >= 2 || now >= s.from);
  if (open.length === 0) return;
  const rng = sim.rng.spawn;
  const total = open.reduce((a, s) => a + s.weight, 0);
  let r = rng.float() * total;
  let entry = open[open.length - 1]!;
  for (const s of open) {
    r -= s.weight;
    if (r < 0) {
      entry = s;
      break;
    }
  }
  const def = sim.content.enemies.find((e) => e.id === entry.enemy);
  if (!def) return;
  const [min, max] = entry.group;
  const size = min + rng.int(max - min + 1);
  const origin = spawnPoint(sim, rng);
  const scale = scaleAt(sim);
  for (let k = 0; k < size; k++) {
    const elite = sim.content.elites.length > 0 && rng.chance(scale.elite) ? rng.pick(sim.content.elites) : undefined;
    spawnEnemy(sim, def, origin.x + rng.range(-16, 16), origin.y + rng.range(-16, 16), { elite, scale });
  }
}

function fireWaves(sim: Sim): void {
  const now = layerSeconds(sim);
  const { viewW, viewH, margin } = sim.content.arena;
  sim.sector.waves.forEach((w, i) => {
    const key = 'wave' + i;
    if ((sim.clocks[key] ?? 0) >= sim.layer || now < w.at) return;
    sim.clocks[key] = sim.layer;
    const def = sim.content.enemies.find((e) => e.id === w.enemy);
    if (!def) return;
    const rng = sim.rng.spawn;
    const scale = scaleAt(sim);
    const radius = Math.max(viewW, viewH) / 2 + margin;
    // Co-op: one ring (or group) per standing probe, the wave shared among them; solo: around the probe as before.
    const anchors = sim.coop ? sim.probes.filter((p) => p.alive).map((p) => ({ x: p.x, y: p.y })) : [probesCentre(sim)];
    if (anchors.length === 0) anchors.push(probesCentre(sim));
    const count = sim.coop ? Math.ceil((w.count * coopFactor(sim, 'density')) / anchors.length) : w.count;
    for (const c of anchors) {
      const start = rng.int(ANGLE_STEPS);
      for (let k = 0; k < count; k++) {
        if (w.kind === 'ring') {
          const a = start + Math.floor((k * ANGLE_STEPS) / count);
          spawnEnemy(sim, def, c.x + cosA(a) * radius, c.y + sinA(a) * radius, { scale });
        } else {
          const bx = c.x + cosA(start) * radius;
          const by = c.y + sinA(start) * radius;
          spawnEnemy(sim, def, bx + rng.range(-40, 40), by + rng.range(-40, 40), { scale });
        }
      }
    }
  });
}

/** One tick of the director. */
export function direct(sim: Sim): void {
  const d = sim.sector.density;
  let rate = Math.min(d.max, d.base + (d.perMinute * sim.tick) / 3600);
  if (sim.phase === 'boss') rate *= d.bossFactor;
  rate *= 1 + curseOf(sim);
  if (sim.anomaly) rate *= sim.anomaly.spawn;
  rate *= coopFactor(sim, 'density');
  let acc = (sim.clocks['spawnAcc'] ?? 0) + rate / 60;
  while (acc >= 1) {
    acc -= 1;
    spawnGroup(sim);
  }
  sim.clocks['spawnAcc'] = acc;
  fireWaves(sim);
}

/** A straggler too far from every probe goes back to the edge of the view. */
export function relocate(sim: Sim, e: number): void {
  const en = sim.enemies;
  const p = spawnPoint(sim, sim.rng.spawn);
  en.x[e] = p.x;
  en.y[e] = p.y;
  en.px[e] = p.x;
  en.py[e] = p.y;
  en.kx[e] = 0;
  en.ky[e] = 0;
  en.state[e] = STATE.move;
}
