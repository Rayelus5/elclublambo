import { describe, expect, test } from 'vitest';
import { DEFAULT_CONTENT, hurtProbe, IDLE, refreshStats, type RelicInput, relicSkill, shieldCapacity, SHOT, type Sim, spawnEnemy, step } from '../src/index';
import { move, quietSim, run } from './fixtures';

// Galaxies as relics (GDD §8.2–8.4 bis): the galaxy type picks the family, the other traits shape it (arms → count,
// size and core → magnitude, density → frequency, inclination → shape, palette → element, background → a bonus,
// phenomenon → a unique ability), and rarity and level make it stronger.

const C = DEFAULT_CONTENT;
const relic = (traits: Record<string, string>, tier = 0, level = 1): RelicInput => ({
  id: 'r' + Object.values(traits).join('-'),
  seed: '1',
  tier,
  level,
  traits: { size: 'medium', core: 'bright', star_density: 'normal', palette: 'monochrome', background: 'deep_void', phenomenon: 'none', ...traits },
});
const skill = (r: RelicInput, all: RelicInput[] = [r]) => relicSkill(r, all, C);

/** A quiet world with these relics equipped, sturdy targets and no criticals. */
function equipped(...relics: RelicInput[]): Sim {
  const sim = quietSim(
    (c) => {
      for (const e of c.enemies) e.hp = 1000;
      c.enemies.find((e) => e.id === 'dummy')!.speed = 0;
    },
    { probes: [{ probe: 'lumen', relics }] },
  );
  sim.rng.combat.chance = () => false;
  return sim;
}
const target = (sim: Sim, x: number, y: number) => spawnEnemy(sim, sim.content.enemies.find((e) => e.id === 'dummy')!, x, y);
const lost = (sim: Sim, e: number) => 1000 - sim.enemies.hp[e]!;
const shotsOf = (sim: Sim, kind: number) => {
  const out: number[] = [];
  for (let i = 0; i < sim.shots.top; i++) if (sim.shots.alive[i] && sim.shots.kind[i] === kind) out.push(i);
  return out;
};

describe('rasgos → habilidad', () => {
  test('el tipo de galaxia elige la familia', () => {
    const families = ['spiral', 'barred_spiral', 'elliptical', 'lenticular', 'irregular', 'ring', 'dwarf', 'merger'].map(
      (galaxy_type) => skill(relic({ galaxy_type, arms: '2', inclination: 'face_on' })).family,
    );
    expect(families).toEqual(['blades', 'ray', 'shield', 'lens', 'chaos', 'aura', 'scout', 'echo']);
  });

  test('los brazos dan la cantidad de cuchillas o rayos', () => {
    expect(skill(relic({ galaxy_type: 'spiral', arms: '5' })).count).toBe(5);
    expect(skill(relic({ galaxy_type: 'barred_spiral', arms: '3' })).count).toBe(3);
    expect(skill(relic({ galaxy_type: 'elliptical' })).count).toBe(1);
  });

  test('rareza, tamaño y núcleo multiplican la magnitud; la densidad, la frecuencia', () => {
    expect(skill(relic({ galaxy_type: 'ring' })).magnitude).toBe(1);
    expect(skill(relic({ galaxy_type: 'ring' }, 4)).magnitude).toBe(2);
    expect(skill(relic({ galaxy_type: 'ring', size: 'large', core: 'quasar' }, 4)).magnitude).toBeCloseTo(2 * 1.15 * 1.15, 12);
    expect(skill(relic({ galaxy_type: 'ring', size: 'compact', core: 'faint' })).magnitude).toBeCloseTo(0.85 * 0.85, 12);
    expect(skill(relic({ galaxy_type: 'ring', star_density: 'saturated' })).frequency).toBe(1.3);
  });

  test('el nivel suma con rendimiento decreciente', () => {
    const at = (level: number) => skill(relic({ galaxy_type: 'ring' }, 0, level)).magnitude;
    expect(at(2)).toBeCloseTo(1.04, 12);
    const tenth = at(10) - 1;
    expect(tenth).toBeLessThan(0.36);
    expect(tenth).toBeGreaterThan(0.25);
    for (let l = 2; l <= 10; l++) expect(at(l) - at(l - 1)).toBeLessThanOrEqual(at(2) - at(1) + 1e-12);
  });

  test('la inclinación da la forma, el núcleo marca el cuásar y el doble disparo', () => {
    expect(skill(relic({ galaxy_type: 'barred_spiral', inclination: 'face_on' })).shape).toBe('circle');
    expect(skill(relic({ galaxy_type: 'barred_spiral', inclination: 'tilted' })).shape).toBe('cone');
    expect(skill(relic({ galaxy_type: 'barred_spiral', inclination: 'edge_on' })).shape).toBe('line');
    expect(skill(relic({ galaxy_type: 'elliptical' })).shape).toBe('circle');
    expect(skill(relic({ galaxy_type: 'ring', core: 'quasar' })).quasar).toBe(true);
    expect(skill(relic({ galaxy_type: 'ring', core: 'double_nucleus' })).double).toBe(true);
  });

  test('la paleta da el elemento, el fondo su bonus y el fenómeno su habilidad', () => {
    const s = skill(relic({ galaxy_type: 'ring', palette: 'solar_gold', background: 'nebular_dust', phenomenon: 'pulsar' }));
    expect(s.element).toBe('burn');
    expect(s.background).toEqual({ stat: 'pickup', value: 0.25 });
    expect(s.phenomenon).toBe('pulsar');
  });

  test('una fusión copia la familia de la siguiente reliquia al 80 % y, sola, es caos', () => {
    const merger = relic({ galaxy_type: 'merger' });
    const spiral = relic({ galaxy_type: 'spiral', arms: '3' });
    const s = skill(merger, [merger, spiral]);
    expect(s.family).toBe('echo');
    expect(s.copies).toBe('blades');
    expect(s.share).toBe(0.8);
    expect(skill(merger, [merger]).copies).toBe('chaos');
  });

  test('rasgos desconocidos dan una reliquia neutra en vez de romper', () => {
    const s = skill(relic({ galaxy_type: 'hypergiant', size: 'enorme', palette: 'plaid', phenomenon: 'wormhole', background: 'void2' }));
    expect(s.magnitude).toBe(1);
    expect(s.element).toBeNull();
    expect(s.phenomenon).toBeNull();
    expect(s.background).toBeNull();
    expect(s.family).toBe('chaos');
  });
});

describe('familias en partida', () => {
  test('cuchillas orbitales: tantas como brazos, giran y golpean', () => {
    const sim = equipped(relic({ galaxy_type: 'spiral', arms: '3' }));
    const e = target(sim, 40, 0);
    run(sim, 120);
    expect(shotsOf(sim, SHOT.blade)).toHaveLength(3);
    expect(lost(sim, e)).toBeGreaterThanOrEqual(9);
  });

  test('rayo perforante en abanico, en cono o en línea', () => {
    const sim = equipped(relic({ galaxy_type: 'barred_spiral', arms: '4', inclination: 'face_on' }));
    step(sim, [IDLE]);
    const angles = shotsOf(sim, SHOT.ray).map((i) => sim.shots.angle[i]!).sort((a, b) => a - b);
    expect(angles).toEqual([0, 1024, 2048, 3072]);
    const line = equipped(relic({ galaxy_type: 'barred_spiral', arms: '4', inclination: 'edge_on' }));
    step(line, [move(127, 0)]);
    const rays = shotsOf(line, SHOT.ray);
    expect(rays.map((i) => line.shots.angle[i])).toEqual([0, 0, 0, 0]);
    expect(Math.min(...rays.map((i) => line.shots.pierce[i]!))).toBeGreaterThan(1000);
  });

  test('escudo: absorbe el daño y se recarga 5 s después del último golpe', () => {
    const sim = equipped(relic({ galaxy_type: 'elliptical' }));
    step(sim, [IDLE]);
    const p = sim.probes[0]!;
    expect(p.shield).toBe(24);
    const e = target(sim, 0, 0);
    step(sim, [IDLE]);
    expect(p.hp).toBe(100);
    expect(p.shield).toBeCloseTo(24 - 10 * (1 - 0.08), 9);
    sim.enemies.kill(e);
    run(sim, 4 * 60);
    expect(p.shield).toBeLessThan(24);
    run(sim, 2 * 60);
    expect(p.shield).toBe(24);
  });

  test('lente crítica y explorador cambian las estadísticas', () => {
    const lens = equipped(relic({ galaxy_type: 'lenticular', inclination: 'face_on' }));
    expect(lens.probes[0]!.stats.crit).toBeGreaterThan(0.14);
    expect(lens.probes[0]!.stats.critDamage).toBeCloseTo(1.8, 9);
    const scout = equipped(relic({ galaxy_type: 'dwarf' }));
    expect(scout.probes[0]!.stats.pickup).toBeGreaterThan(30 * 1.29);
    expect(scout.probes[0]!.stats.speed).toBeGreaterThan(60 * 1.07);
  });

  test('aura: daña cada 0,5 s a lo que tienes cerca', () => {
    const sim = equipped(relic({ galaxy_type: 'ring', inclination: 'face_on' }));
    const near = target(sim, 40, 0);
    const far = target(sim, 120, 0);
    run(sim, 61);
    expect(lost(sim, near)).toBe(3 * 5);
    expect(lost(sim, far)).toBe(0);
  });

  test('caos: cada 4 s hace una de sus cuatro cosas', () => {
    const sim = equipped(relic({ galaxy_type: 'irregular' }));
    target(sim, 50, 0);
    let acted = 0;
    for (let t = 0; t < 4 * 60 * 3 + 2; t++) {
      step(sim, [IDLE]);
      if (sim.events.some((ev) => ev.t === 'fire' && ev.weapon === 'relic:chaos')) acted++;
    }
    expect(acted).toBe(4);
  });

  test('el cuásar añade un rayo cada 3 s y el doble núcleo dispara dos veces', () => {
    const quasar = equipped(relic({ galaxy_type: 'elliptical', core: 'quasar' }));
    let beams = 0;
    for (let t = 0; t < 361; t++) {
      step(quasar, [IDLE]);
      beams += quasar.events.filter((ev) => ev.t === 'fire' && ev.weapon === 'relic:quasar').length;
    }
    expect(beams).toBe(3);
    const twice = equipped(relic({ galaxy_type: 'barred_spiral', arms: '2', inclination: 'face_on', core: 'double_nucleus' }));
    run(twice, 7);
    expect(shotsOf(twice, SHOT.ray)).toHaveLength(4);
  });

  test('el anillo de Einstein suma un proyectil a las armas', () => {
    const sim = equipped(relic({ galaxy_type: 'elliptical', phenomenon: 'einstein_ring' }));
    expect(sim.probes[0]!.stats.projectiles).toBe(1);
  });

  test('el fondo da su bonus', () => {
    const sim = equipped(relic({ galaxy_type: 'elliptical', background: 'nebular_dust' }));
    expect(sim.probes[0]!.stats.pickup).toBeCloseTo(30 * 1.25, 9);
  });
});

describe('fenómenos en partida', () => {
  const quiet = (phenomenon: string) => relic({ galaxy_type: 'elliptical', phenomenon });

  test('supernova: una nova de 40 en 120 cada 8 s', () => {
    const sim = equipped(quiet('supernova'));
    const e = target(sim, 100, 0);
    step(sim, [IDLE]);
    expect(lost(sim, e)).toBe(40);
    run(sim, 8 * 60 - 1);
    expect(lost(sim, e)).toBe(40);
    run(sim, 1);
    expect(lost(sim, e)).toBe(80);
  });

  test('galaxia satélite: un dron que dispara', () => {
    const sim = equipped(quiet('satellite_galaxy'));
    const e = target(sim, 120, 0);
    run(sim, 90);
    expect(shotsOf(sim, SHOT.drone)).toHaveLength(1);
    expect(lost(sim, e)).toBeGreaterThanOrEqual(8);
  });

  test('cúmulo globular: 4 orbes que giran', () => {
    const sim = equipped(quiet('globular_cluster'));
    step(sim, [IDLE]);
    expect(shotsOf(sim, SHOT.orb)).toHaveLength(4);
  });

  test('cometa: una embestida de 90 u si te mueves, invulnerable y dañando lo que toca', () => {
    const sim = equipped(quiet('comet'));
    const e = target(sim, 50, 0);
    const p = sim.probes[0]!;
    run(sim, 30);
    expect(p.x).toBe(0);
    run(sim, 13, move(127, 0));
    expect(p.x).toBeGreaterThan(90);
    expect(lost(sim, e)).toBe(30);
    expect(p.hp).toBe(100);
  });

  test('chorros relativistas: dos lanzas opuestas', () => {
    const sim = equipped(quiet('relativistic_jets'));
    step(sim, [move(127, 0)]);
    expect(shotsOf(sim, SHOT.jet).map((i) => sim.shots.angle[i]).sort((a, b) => a! - b!)).toEqual([0, 2048]);
  });

  test('púlsar: una onda de 8 en 70 cada 1,2 s', () => {
    const sim = equipped(quiet('pulsar'));
    const near = target(sim, 60, 0);
    const far = target(sim, 100, 0);
    run(sim, 73);
    expect(lost(sim, near)).toBe(16);
    expect(lost(sim, far)).toBe(0);
  });

  test('anomalía: cada 5 s algo impredecible (aquí, congela lo cercano)', () => {
    const sim = equipped(quiet('anomaly'));
    sim.rng.relic.int = () => 1;
    const e = spawnEnemy(sim, sim.content.enemies.find((x) => x.id === 'mite')!, 80, 0);
    step(sim, [IDLE]);
    expect(sim.enemies.freezeT[e]).toBeGreaterThan(0);
    const x = sim.enemies.x[e]!;
    run(sim, 60);
    expect(sim.enemies.x[e]).toBe(x);
  });

  test('antimateria: las balas enemigas cercanas pueden volverse', () => {
    const sim = equipped(relic({ galaxy_type: 'elliptical', palette: 'antimatter' }));
    sim.rng.combat.chance = (p: number) => p === 0.4;
    const spitter = spawnEnemy(sim, sim.content.enemies.find((x) => x.id === 'spitter')!, 140, 0);
    let seen = false;
    for (let t = 0; t < 120; t++) {
      step(sim, [IDLE]);
      seen ||= shotsOf(sim, SHOT.reflected).length > 0;
    }
    expect(seen).toBe(true);
    // A returned bullet hits the coral that fired it: 9 × 2.
    expect(lost(sim, spitter)).toBeGreaterThanOrEqual(18);
  });
});

describe('barrera (Deflector) y escudo en una sola reserva', () => {
  const shielded = (barrier: number, ...relics: RelicInput[]) => {
    const sim = equipped(...relics);
    const p = sim.probes[0]!;
    p.passives.push({ id: 'deflector', level: 1 });
    sim.content.passives.find((x) => x.id === 'deflector')!.levels[0] = barrier;
    refreshStats(sim, p);
    return { sim, p };
  };

  test('se recarga al 10 % por segundo tras 3 s sin daño y absorbe antes que la vida', () => {
    const { sim, p } = shielded(0.2);
    expect(shieldCapacity(sim, p)).toBeCloseTo(20, 9);
    // Never hurt yet: it charges from the start, 2 per second.
    run(sim, 60);
    expect(p.shield).toBeCloseTo(2, 6);
    run(sim, 600);
    expect(p.shield).toBeCloseTo(20, 6);
    hurtProbe(sim, p, 15);
    expect(p.hp).toBe(100);
    expect(p.shield).toBeCloseTo(5, 6);
    run(sim, 175);
    expect(p.shield).toBeCloseTo(5, 6);
    run(sim, 65);
    expect(p.shield).toBeGreaterThan(5.5);
  });

  test('se suma al escudo elíptico y ninguna recarga recorta a la otra', () => {
    const { sim, p } = shielded(0.2, relic({ galaxy_type: 'elliptical' }));
    run(sim, 2);
    expect(shieldCapacity(sim, p)).toBeCloseTo(44, 9);
    run(sim, 1500);
    expect(p.shield).toBeCloseTo(44, 6);
  });
});

describe('reliquias de la misma familia (M4c-1, §8.6: el mismo efecto rinde menos cuanto más se acumula)', () => {
  test('a partir de la tercera de la misma familia, cada una rinde la mitad que la anterior; las dos primeras, enteras', () => {
    const same = [0, 1, 2, 3].map((k) => ({ ...relic({ galaxy_type: 'lenticular', palette: 'solar_gold' }, 4, 10), id: `l${k}` }));
    const m = same.map((r) => skill(r, same).magnitude);
    expect(m[1]).toBeCloseTo(m[0]!, 9);
    expect(m[2]! / m[0]!).toBeCloseTo(0.5, 9);
    expect(m[3]! / m[0]!).toBeCloseTo(0.25, 9);
  });

  test('otra familia en medio no cuenta: la tercera de una familia es la tercera de las suyas', () => {
    const a = (id: string) => ({ ...relic({ galaxy_type: 'spiral' }, 2, 5), id });
    const b = { ...relic({ galaxy_type: 'ring' }, 2, 5), id: 'r' };
    const all = [a('s1'), b, a('s2')];
    expect(skill(all[2]!, all).magnitude).toBeCloseTo(skill(all[0]!, all).magnitude, 9);
  });
});
