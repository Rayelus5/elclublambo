import { ANGLE_STEPS, cosA, sinA } from '../math/trig';
import type { Sim } from '../types';
import { probesCentre, type Scale, spawnEnemy, spawnPoint, STATE } from './enemies';
import { coopFactor } from './coop';

// The spawn director (GDD §5.5–5.6): density grows with the run's minutes, species join over the first layer (from
// layer 2 on, all from the start), fixed waves arrive on schedule in every layer, and life, damage, speed and the
// elite chance scale with the minute and the layer, and life with the team's level too.

/** Seconds since the current layer began. */
export function layerSeconds(sim: Sim): number {
  return (sim.tick - (sim.clocks['layerStart'] ?? 0)) / 60;
}

/**
 * The team's level: the highest any probe still in the run has reached (a fallen probe still counts; one whose player
 * left the group does not, so those who stay do not face enemies sized for them).
 */
export function teamLevel(sim: Sim): number {
  let level = 1;
  for (const p of sim.probes) if (p.life !== 'left' && p.level > level) level = p.level;
  return level;
}

/**
 * Enemy life plan (2026-11-15): enemies and Núcleos last longer as the team levels up past `levelFrom`, compounding,
 * (1 + hpPerLevel)^(level − levelFrom). The levels a new player reaches count nothing; a long run's keep the enemies
 * at its build's pace. Multiplied in a loop, not with Math.pow, so every engine gets the same bits. The Núcleos have
 * their own, linear one (`coreLevelFactor`).
 */
export function levelFactor(sim: Sim): number {
  const { hpPerLevel: r, levelFrom, hpLevelMax } = sim.sector.scaling;
  if (r <= 0) return 1;
  let f = 1;
  for (let l = teamLevel(sim); l > levelFrom; l--) {
    f *= 1 + r;
    // Its ceiling (2026-11-16): a very long run's enemies stop growing there.
    if (f >= hpLevelMax) return hpLevelMax;
  }
  return f;
}

/** The fauna's life growth now, before the truce: the run's minutes × the layer × the team's level. */
export function lifeGrowth(sim: Sim): number {
  const s = sim.sector.scaling;
  return (1 + s.hpPerMinute * (sim.tick / 3600)) * (1 + s.hpPerLayer * (sim.layer - 1)) * levelFactor(sim);
}

function truceOn(sim: Sim): boolean {
  const s = sim.sector.scaling;
  return s.hpHoldUntil > s.hpHoldFrom;
}

/**
 * The truce of life (the owner, 2026-11-18): on the first tick of minute `hpHoldFrom` the director keeps the life
 * growth of that moment in `clocks.hpHeld`, once. Sim state: replays and co-op lockstep take it at the same tick.
 */
export function holdLife(sim: Sim): void {
  if (!truceOn(sim) || (sim.clocks['hpHeld'] ?? 0) > 0) return;
  if (sim.tick >= sim.sector.scaling.hpHoldFrom * 3600) sim.clocks['hpHeld'] = lifeGrowth(sim);
}

/** 2^x for x ≥ 0 without Math.pow (not the same bits in every engine): whole doublings, then a straight line between them. */
function doublings(x: number): number {
  const whole = Math.floor(x);
  let f = 1;
  for (let i = 0; i < whole; i++) f *= 2;
  return f * (1 + (x - whole));
}

/**
 * The fauna's life multiplier with the truce: the growth as always until minute `hpHoldFrom`; from there the value it
 * had then (at most `hpHoldMax` when set) until minute `hpHoldUntil`; after it, doubling every `hpDoubleEvery` minutes,
 * so a long run ends in extracting or falling. Without the truce (hpHoldUntil ≤ hpHoldFrom), the growth as always.
 */
export function truceGrowth(sim: Sim): number {
  const s = sim.sector.scaling;
  const minutes = sim.tick / 3600;
  if (!truceOn(sim) || minutes < s.hpHoldFrom) return lifeGrowth(sim);
  // The director keeps it on the minute's first tick; something scaled earlier in that same tick reads the same value.
  let held = sim.clocks['hpHeld'] ?? 0;
  if (held <= 0) held = lifeGrowth(sim);
  if (s.hpHoldMax > 0 && held > s.hpHoldMax) held = s.hpHoldMax;
  if (minutes < s.hpHoldUntil) return held;
  return held * doublings((minutes - s.hpHoldUntil) / s.hpDoubleEvery);
}

export function scaleAt(sim: Sim): Scale & { elite: number } {
  const s = sim.sector.scaling;
  const minutes = sim.tick / 3600;
  const deeper = sim.layer - 1;
  const elite = Math.min(s.eliteMax, s.eliteBase + s.elitePerMinute * minutes);
  const scale = {
    hp: truceGrowth(sim),
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

/**
 * More enemies at once in the deep layers (enemy life plan, 2026-11-15): the alive cap and the spawn rate's ceiling grow
 * by `density.perLayer` every layer past the first, where only strong players get; a new player's first layers stay.
 * Not while the Núcleo is up: a horde shielding it made the fight unwinnable.
 */
export function layerCrowd(sim: Sim): number {
  if (sim.phase === 'boss') return 1;
  return 1 + sim.sector.density.perLayer * (sim.layer - 1);
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

/**
 * How many fauna may be alive at once now. While the Núcleo is up the alive cap drops with `bossFactor`, like the spawn
 * rate: a Núcleo walled in by tough fauna could not be reached and the fight went on for minutes (enemy life plan,
 * 2026-11-15).
 */
export function aliveCap(sim: Sim): number {
  const sector = sim.sector;
  const fight = sim.phase === 'boss' ? sector.density.bossFactor : 1;
  return Math.min(sim.content.limits.enemies, Math.floor(sector.density.cap * layerCrowd(sim) * fight * (1 + curseOf(sim)) * coopFactor(sim, 'density')));
}

/**
 * How much of its weight a swarm species keeps now (2026-11-16): all of it until minute `fadeFrom` of the run, then a
 * `fadePerMinute` less each minute down to `fadeFloor`.
 */
export function swarmWeight(sim: Sim): number {
  const { fadeFrom, fadePerMinute, fadeFloor } = sim.sector.swarm;
  const past = sim.tick / 3600 - fadeFrom;
  return past <= 0 ? 1 : Math.max(fadeFloor, 1 - fadePerMinute * past);
}

/** How many of the swarm family are alive (any of them: from groups, waves, splits or summons). */
function aliveSwarm(sim: Sim): number {
  const en = sim.enemies;
  const defs = sim.content.enemies;
  let n = 0;
  for (let e = 0; e < en.top; e++) if (en.alive[e] && !en.boss[e] && defs[en.type[e]!]?.family === 'swarm') n++;
  return n;
}

function spawnGroup(sim: Sim): void {
  const sector = sim.sector;
  if (aliveFauna(sim) >= aliveCap(sim)) return;
  const now = layerSeconds(sim);
  const open = sector.spawns.filter((s) => sim.layer >= 2 || now >= s.from);
  if (open.length === 0) return;
  // The swarm kept in check: none while too many of it are alive (the cap grows with a group like the rest of the
  // crowd), and less of it as the run goes on; the other species take its share.
  const { cap } = sector.swarm;
  const full = cap > 0 && aliveSwarm(sim) >= Math.round(cap * coopFactor(sim, 'density'));
  const fade = swarmWeight(sim);
  const isSwarm = (id: string) => sim.content.enemies.find((e) => e.id === id)?.family === 'swarm';
  const weightOf = (s: (typeof open)[number]) => (isSwarm(s.enemy) ? (full ? 0 : s.weight * fade) : s.weight);
  const total = open.reduce((a, s) => a + weightOf(s), 0);
  if (!(total > 0)) return;
  const rng = sim.rng.spawn;
  let r = rng.float() * total;
  let entry = open.findLast((s) => weightOf(s) > 0)!;
  for (const s of open) {
    r -= weightOf(s);
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

/** Groups spawned per second now. */
export function spawnRate(sim: Sim): number {
  const d = sim.sector.density;
  let rate = Math.min(d.max * layerCrowd(sim), d.base + (d.perMinute * sim.tick) / 3600);
  if (sim.phase === 'boss') rate *= d.bossFactor;
  rate *= 1 + curseOf(sim);
  if (sim.anomaly) rate *= sim.anomaly.spawn;
  rate *= coopFactor(sim, 'density');
  return rate;
}

/** One tick of the director. */
export function direct(sim: Sim): void {
  holdLife(sim);
  let acc = (sim.clocks['spawnAcc'] ?? 0) + spawnRate(sim) / 60;
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
