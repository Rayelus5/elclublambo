import { recordMoves } from './log';
import { Rng } from './math/rng';
import { direct, relocate } from './systems/director';
import { updateBoss } from './systems/boss';
import { updateEnemies, updateFoeShots } from './systems/enemies';
import { updateLayer } from './systems/layers';
import { tickStatuses } from './systems/elements';
import { contactDamage, moveProbes, tickProbes } from './systems/probes';
import { updatePickups } from './systems/pickups';
import { updateRelics } from './systems/relics';
import { refreshStats } from './systems/stats';
import { applyOffer, offerFor } from './systems/upgrades';
import { fireWeapons, updateAreas, updateShots } from './systems/weapons';
import { xpFor } from './systems/xp';
import { IDLE, type ProbeInput, type ProbeState, type Sim, type SimOptions } from './types';
import { SpatialGrid } from './world/grid';
import { createPools } from './world/pools';

// The run simulation (GDD §5, §5.7, §18.4): a fixed 60 Hz step fed with one input per probe per tick. Same options and
// same inputs → the same run, on every machine. While a level-up choice is open the world is frozen: only choices
// are applied and the tick does not advance.

const SPACING = 24;

export function createSim(opts: SimOptions): Sim {
  const content = opts.content;
  const sector = content.sectors.find((s) => s.id === opts.sector);
  if (!sector) throw new RangeError('unknown_sector:' + opts.sector);
  if (opts.probes.length === 0) throw new RangeError('no_probes');
  const rng = {
    spawn: Rng.fromSeed(opts.seed, 'spawn'),
    combat: Rng.fromSeed(opts.seed, 'combat'),
    loot: Rng.fromSeed(opts.seed, 'loot'),
    offer: Rng.fromSeed(opts.seed, 'offer'),
    ai: Rng.fromSeed(opts.seed, 'ai'),
    relic: Rng.fromSeed(opts.seed, 'relic'),
  };
  const sim: Sim = {
    opts,
    content,
    sector,
    tick: 0,
    status: 'running',
    layer: 1,
    phase: 'waves',
    phaseTick: 0,
    rng,
    probes: [],
    ...createPools(content.limits),
    grid: new SpatialGrid(48),
    boss: null,
    beacon: null,
    loot: [{ coins: 0, dust: 0 }],
    kills: 0,
    bossKills: 0,
    events: [],
    log: opts.record ? { probes: opts.probes.length, events: [] } : null,
    clocks: {},
  };
  const n = opts.probes.length;
  sim.probes = opts.probes.map((setup, index) => {
    const def = content.probes.find((p) => p.id === setup.probe);
    if (!def) throw new RangeError('unknown_probe:' + setup.probe);
    const x = (index - (n - 1) / 2) * SPACING;
    const p: ProbeState = {
      index,
      def,
      x,
      y: 0,
      px: x,
      py: 0,
      hp: def.hp,
      alive: true,
      invulnT: 0,
      facing: 0,
      aim: 0,
      moving: false,
      level: 1,
      xp: 0,
      xpNext: xpFor(sim, 1),
      weapons: [{ id: def.weapon, level: 1, t: 0 }],
      passives: [],
      relics: setup.relics,
      offer: null,
      pendingLevels: 0,
      stats: { maxHp: def.hp } as ProbeState['stats'],
      shield: 0,
      kills: 0,
      fx: {},
    };
    return p;
  });
  for (const p of sim.probes) {
    refreshStats(sim, p);
    p.hp = p.stats.maxHp;
  }
  return sim;
}

/** Largest radius any enemy can have (contact queries). */
function maxEnemyRadius(sim: Sim): number {
  let r = 0;
  for (const e of sim.content.enemies) r = Math.max(r, e.radius * sim.sector.elite.radius);
  for (const b of sim.content.bosses) r = Math.max(r, b.radius);
  return r;
}

/** Positions at the start of the tick = current positions (nothing to interpolate). */
function settle(sim: Sim): void {
  for (const p of sim.probes) {
    p.px = p.x;
    p.py = p.y;
  }
  for (const pool of [sim.enemies, sim.shots, sim.foeShots, sim.pickups, sim.areas]) {
    for (let i = 0; i < pool.top; i++) {
      pool.px[i] = pool.x[i]!;
      pool.py[i] = pool.y[i]!;
    }
  }
}

function resolveChoices(sim: Sim, inputs: readonly ProbeInput[]): void {
  for (const p of sim.probes) {
    if (!p.offer) continue;
    const pick = (inputs[p.index] ?? IDLE).pick;
    if (!Number.isInteger(pick) || pick < 0 || pick >= p.offer.length) continue;
    if (sim.log) sim.log.events.push(sim.tick, p.index, 1, pick, 0, 0);
    applyOffer(sim, p, p.offer[pick]!);
    p.pendingLevels--;
    p.offer = p.pendingLevels > 0 ? offerFor(sim, p) : null;
  }
  if (sim.probes.every((p) => !p.offer)) sim.status = 'running';
}

function openChoices(sim: Sim): void {
  for (const p of sim.probes) {
    if (p.alive && p.pendingLevels > 0 && !p.offer) p.offer = offerFor(sim, p);
  }
  if (sim.status === 'running' && sim.probes.some((p) => p.offer)) sim.status = 'choosing';
}

function rebuildGrid(sim: Sim): void {
  const en = sim.enemies;
  sim.grid.clear();
  for (let i = 0; i < en.top; i++) if (en.alive[i]) sim.grid.insert(i, en.x[i]!, en.y[i]!);
}

function tickFlashes(sim: Sim): void {
  const en = sim.enemies;
  for (let i = 0; i < en.top; i++) if (en.alive[i] && en.flashT[i]! > 0) en.flashT[i] = en.flashT[i]! - 1;
}

/** Advances the run by one tick (or applies level-up choices while one is open). */
export function step(sim: Sim, inputs: readonly ProbeInput[]): void {
  sim.events.length = 0;
  if (sim.status === 'extracted' || sim.status === 'dead') return;
  if (sim.status === 'choosing') {
    settle(sim);
    resolveChoices(sim, inputs);
    return;
  }
  sim.tick++;
  sim.phaseTick++;
  settle(sim);
  tickProbes(sim);
  moveProbes(sim, inputs);
  recordMoves(sim, inputs);
  tickFlashes(sim);
  direct(sim);
  updateEnemies(sim, relocate);
  updateBoss(sim);
  tickStatuses(sim);
  updateFoeShots(sim);
  rebuildGrid(sim);
  for (const p of sim.probes) {
    fireWeapons(sim, p);
    updateRelics(sim, p);
  }
  updateShots(sim);
  updateAreas(sim);
  contactDamage(sim, maxEnemyRadius(sim));
  updatePickups(sim);
  updateLayer(sim);
  if (sim.status === 'running') openChoices(sim);
}
