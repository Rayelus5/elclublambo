import { type Content, contentSchema, createSim, DEFAULT_CONTENT, IDLE, type ProbeInput, type Sim, type SimOptions, step } from '../src/index';

/**
 * A quiet test world: the default catalogs, but nothing spawns on its own, the layer never ends and the probe's
 * starting weapon does nothing. Each test adds what it is about, so calibrating DEFAULT_CONTENT never breaks a
 * mechanics test. `over` edits the clone in place.
 */
export function tinyContent(over?: (c: Content) => void): Content {
  const c = structuredClone(DEFAULT_CONTENT);
  c.weapons.push({
    id: 'dud',
    name: 'Nada',
    kind: 'bolt',
    icon: 'icon-pulse',
    description: 'No dispara',
    levels: [{ damage: 0, cooldown: 1000, count: 0, pierce: 0, speed: 0, area: 0, duration: 0, range: 0, bounces: 0, knockback: 0, interval: 0 }],
  });
  c.probes = [{ ...c.probes[0]!, hp: 100, speed: 60, pickup: 30, armor: 0, regen: 0, weapon: 'dud', bonus: {}, quirk: null }];
  c.enemies.push({ id: 'dummy', name: 'Diana', family: 'swarm', sprite: 'mite', hp: 10, speed: 0, damage: 10, radius: 6, xp: 20, behavior: { kind: 'chase' } });
  const s = c.sectors[0]!;
  s.layerSeconds = 100_000;
  s.spawns = s.spawns.map((sp) => ({ ...sp, from: 1_000_000 }));
  s.waves = [];
  s.density = { ...s.density, base: 0, perMinute: 0, max: 0 };
  s.scaling = { ...s.scaling, eliteBase: 0, elitePerMinute: 0, eliteMax: 0 };
  s.drops = { ...s.drops, coin: 0, dust: 0, repair: 0, bossCoins: 0, bossDust: 0 };
  // Pinned: mechanics tests do not follow calibration.
  c.bosses[0]!.hp = 1800;
  c.bosses[0]!.scaling = { hpPerLayer: 0.7, damagePerLayer: 0.25 };
  s.scaling = { ...s.scaling, hpPerMinute: 0.08, damagePerMinute: 0.04, hpPerLayer: 0.5, damagePerLayer: 0.2, speedPerLayer: 0.05 };
  c.weapons.find((w) => w.id === 'pulse')!.levels.forEach((l) => (l.cooldown = 0.9));
  over?.(c);
  return contentSchema.parse(c);
}

export function options(content: Content, over: Partial<SimOptions> = {}): SimOptions {
  return { seed: '424242', content, sector: content.sectors[0]!.id, probes: [{ probe: content.probes[0]!.id, relics: [] }], ...over };
}

/** Steps `n` ticks with the same input for every probe. */
export function run(sim: Sim, n: number, input: ProbeInput = IDLE): void {
  const inputs = sim.probes.map(() => input);
  for (let i = 0; i < n; i++) step(sim, inputs);
}

export function quietSim(over?: (c: Content) => void, opts: Partial<SimOptions> = {}): Sim {
  return createSim(options(tinyContent(over), opts));
}

export const move = (mx: number, my: number): ProbeInput => ({ ...IDLE, mx, my });
export const pick = (i: number): ProbeInput => ({ ...IDLE, pick: i });
