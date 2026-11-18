import { describe, expect, test } from 'vitest';
import {
  aliveCap,
  createSim,
  debugClear,
  debugGrant,
  debugHeal,
  debugInfo,
  debugLevelUp,
  debugSkipLayer,
  debugSummonCore,
  DEFAULT_COOP_RULES,
  fireFoeBullet,
  hurtProbe,
  layerSeconds,
  setGod,
  shieldCapacity,
  type Sim,
  spawnEnemy,
  spawnRate,
  stateHash,
  step,
} from '../src/index';
import { options, quietSim, run, tinyContent } from './fixtures';

// Admin debug mode (2026-11-15): helpers the client applies between steps of a solo test run. They never touch a run
// that does not use them, and they refuse co-op.

const dummy = (sim: Sim) => sim.content.enemies.find((e) => e.id === 'dummy')!;
const probe = (sim: Sim) => sim.probes[0]!;

describe('subir de nivel', () => {
  test('da niveles pendientes y las cartas salen con el flujo normal', () => {
    const sim = quietSim();
    run(sim, 1);
    const p = probe(sim);
    const level = p.level;
    expect(debugLevelUp(sim, 0, 3)).toBe('ok');
    expect(p.level).toBe(level + 3);
    expect(p.pendingLevels).toBe(3);
    expect(sim.events.filter((e) => e.t === 'levelUp')).toHaveLength(3);
    run(sim, 1);
    expect(sim.status).toBe('choosing');
    for (let k = 0; k < 3; k++) step(sim, [{ mx: 0, my: 0, aim: -1, pick: 0 }]);
    expect(sim.status).toBe('running');
    expect(p.pendingLevels).toBe(0);
  });

  test('not_running mientras se elige', () => {
    const sim = quietSim();
    run(sim, 1);
    debugLevelUp(sim, 0, 1);
    run(sim, 1);
    expect(sim.status).toBe('choosing');
    expect(debugLevelUp(sim, 0, 1)).toBe('not_running');
    expect(debugHeal(sim, 0)).toBe('not_running');
    expect(debugClear(sim)).toBe('not_running');
    expect(debugSummonCore(sim)).toBe('not_running');
    expect(debugSkipLayer(sim)).toBe('not_running');
    expect(debugGrant(sim, 0, { kind: 'weapon', id: 'nova', level: 1 })).toBe('not_running');
  });
});

describe('invulnerable', () => {
  test('ningún golpe hace daño ni deja rastro', () => {
    const sim = quietSim();
    run(sim, 1);
    const p = probe(sim);
    expect(setGod(sim, true)).toBe('ok');
    const before = { hp: p.hp, shield: p.shield, invulnT: p.invulnT };
    hurtProbe(sim, p, 50);
    expect({ hp: p.hp, shield: p.shield, invulnT: p.invulnT }).toEqual(before);
    expect(sim.events.filter((e) => e.t === 'hurt' || e.t === 'evade')).toHaveLength(0);
    setGod(sim, false);
    hurtProbe(sim, p, 50);
    expect(p.hp).toBeLessThan(before.hp);
  });

  test('el hash no cambia por tener la marca apagada', () => {
    const a = quietSim();
    const b = quietSim();
    run(a, 30);
    run(b, 30);
    setGod(b, false);
    expect(stateHash(b)).toBe(stateHash(a));
  });
});

describe('curar y limpiar', () => {
  test('curar llena la vida y el escudo', () => {
    const sim = quietSim();
    run(sim, 1);
    const p = probe(sim);
    p.hp = 1;
    expect(debugHeal(sim, 0)).toBe('ok');
    expect(p.hp).toBe(p.stats.maxHp);
    expect(p.shield).toBe(shieldCapacity(sim, p));
  });

  test('limpiar quita la fauna, las balas y las explosiones sin botín, y deja el Núcleo', () => {
    const sim = quietSim();
    run(sim, 1);
    for (let k = 0; k < 5; k++) spawnEnemy(sim, dummy(sim), 100 + k * 10, 0);
    expect(debugSummonCore(sim)).toBe('ok');
    fireFoeBullet(sim, 50, 50, 0, 10, 5);
    sim.blasts.push({ x: 0, y: 0, radius: 20, damage: 5, at: sim.tick + 60 });
    const kills = sim.kills;
    sim.events.length = 0;
    expect(debugClear(sim)).toBe('ok');
    expect(sim.enemies.count).toBe(1);
    expect(sim.boss).not.toBeNull();
    expect(sim.enemies.alive[sim.boss!.index]).toBe(1);
    expect(sim.foeShots.count).toBe(0);
    expect(sim.blasts).toHaveLength(0);
    expect(sim.kills).toBe(kills);
    expect(sim.events.filter((e) => e.t === 'kill')).toHaveLength(0);
  });
});

describe('Núcleo y capas', () => {
  test('el Núcleo aparece ya sin mover el reloj de la capa', () => {
    const sim = quietSim();
    run(sim, 1);
    const start = sim.clocks['layerStart'];
    expect(debugSummonCore(sim)).toBe('ok');
    expect(sim.phase).toBe('boss');
    expect(sim.boss).not.toBeNull();
    expect(sim.clocks['layerStart']).toBe(start);
    expect(debugSummonCore(sim)).toBe('not_waves');
  });

  test('las oleadas pendientes no saltan de golpe al llamar al Núcleo', () => {
    const sim = quietSim((c) => {
      c.sectors[0]!.waves = [{ at: 200, enemy: 'dummy', count: 6, kind: 'ring' }];
    });
    run(sim, 1);
    debugSummonCore(sim);
    const count = sim.enemies.count;
    run(sim, 2);
    expect(sim.enemies.count).toBe(count);
  });

  test('pasar de capa quita el Núcleo y la fauna, y empieza la siguiente', () => {
    const sim = quietSim();
    run(sim, 10);
    for (let k = 0; k < 4; k++) spawnEnemy(sim, dummy(sim), 100 + k * 10, 0);
    debugSummonCore(sim);
    const { layer, bossKills } = sim;
    const loot = sim.loot.length;
    expect(debugSkipLayer(sim)).toBe('ok');
    expect(sim.layer).toBe(layer + 1);
    expect(sim.loot).toHaveLength(loot + 1);
    expect(sim.clocks['layerStart']).toBe(sim.tick);
    expect(sim.boss).toBeNull();
    expect(sim.enemies.count).toBe(0);
    expect(sim.phase).toBe('waves');
    expect(sim.bossKills).toBe(bossKills);
  });
});

describe('dar mejoras', () => {
  test('un arma nueva entra en una ranura libre con el nivel recortado', () => {
    const sim = quietSim();
    run(sim, 1);
    const max = sim.content.weapons.find((w) => w.id === 'nova')!.levels.length;
    expect(debugGrant(sim, 0, { kind: 'weapon', id: 'nova', level: 99 })).toBe('ok');
    expect(probe(sim).weapons.find((w) => w.id === 'nova')?.level).toBe(max);
  });

  test('con las ranuras llenas pide cuál sustituir', () => {
    const sim = quietSim();
    run(sim, 1);
    const p = probe(sim);
    const free = sim.content.weapons.filter((w) => !w.evolution && !w.variant && w.id !== 'dud' && !p.weapons.some((o) => o.id === w.id));
    while (p.weapons.length < sim.content.limits.weapons) expect(debugGrant(sim, 0, { kind: 'weapon', id: free.shift()!.id, level: 1 })).toBe('ok');
    const extra = free.shift()!.id;
    expect(debugGrant(sim, 0, { kind: 'weapon', id: extra, level: 1 })).toBe('slots_full');
    expect(debugGrant(sim, 0, { kind: 'weapon', id: extra, level: 2, replace: 0 })).toBe('ok');
    expect(p.weapons[0]).toMatchObject({ id: extra, level: 2 });
    expect(p.weapons).toHaveLength(sim.content.limits.weapons);
  });

  test('una variante no se da y la base de una variante en propiedad tampoco', () => {
    const sim = quietSim();
    run(sim, 1);
    const variant = sim.content.weapons.find((w) => w.variant)!;
    expect(debugGrant(sim, 0, { kind: 'weapon', id: variant.id, level: 1 })).toBe('unknown');
    probe(sim).weapons.push({ id: variant.id, level: 1, t: 0 });
    expect(debugGrant(sim, 0, { kind: 'weapon', id: variant.variant!.of, level: 1 })).toBe('family_owned');
  });

  test('una evolución con la base en propiedad la evoluciona', () => {
    const sim = quietSim();
    run(sim, 1);
    debugGrant(sim, 0, { kind: 'weapon', id: 'pulse', level: 1 });
    sim.events.length = 0;
    expect(debugGrant(sim, 0, { kind: 'evolution', id: 'pulse-storm', level: 1 })).toBe('ok');
    const p = probe(sim);
    expect(p.weapons.some((w) => w.id === 'pulse')).toBe(false);
    expect(p.weapons.find((w) => w.id === 'pulse-storm')?.level).toBe(1);
    expect(sim.events.some((e) => e.t === 'evolve')).toBe(true);
  });

  test('una evolución sin la base ocupa una ranura libre', () => {
    const sim = quietSim();
    run(sim, 1);
    const slots = probe(sim).weapons.length;
    expect(debugGrant(sim, 0, { kind: 'evolution', id: 'pulse-storm', level: 1 })).toBe('ok');
    expect(probe(sim).weapons).toHaveLength(slots + 1);
    expect(probe(sim).weapons.some((w) => w.id === 'pulse-storm')).toBe(true);
  });

  test('las pasivas entran nuevas o suben de nivel', () => {
    const sim = quietSim();
    run(sim, 1);
    expect(debugGrant(sim, 0, { kind: 'passive', id: 'capacitor', level: 1 })).toBe('ok');
    expect(debugGrant(sim, 0, { kind: 'passive', id: 'capacitor', level: 3 })).toBe('ok');
    expect(probe(sim).passives.find((s) => s.id === 'capacitor')?.level).toBe(3);
  });

  // Pending minor (2026-11-16): an evolution may come from a variant; granting it while owning its family's other
  // evolution would put the family twice.
  test('una evolución hermana (desde una variante) no duplica la familia', () => {
    const sim = quietSim((c) => {
      const variant = c.weapons.find((w) => w.variant?.of === 'pulse')!;
      const evo = c.weapons.find((w) => w.id === 'pulse-storm')!;
      c.weapons.push({ ...structuredClone(evo), id: 'pulse-storm-v', name: 'Tormenta variante', evolution: { from: variant.id, requires: evo.evolution!.requires } });
    });
    run(sim, 1);
    expect(debugGrant(sim, 0, { kind: 'evolution', id: 'pulse-storm', level: 1 })).toBe('ok');
    const slots = probe(sim).weapons.length;
    expect(debugGrant(sim, 0, { kind: 'evolution', id: 'pulse-storm-v', level: 1 })).toBe('family_owned');
    expect(probe(sim).weapons).toHaveLength(slots);
  });

  test('un id que no existe no hace nada', () => {
    const sim = quietSim();
    run(sim, 1);
    expect(debugGrant(sim, 0, { kind: 'weapon', id: 'nope', level: 1 })).toBe('unknown');
    expect(debugGrant(sim, 0, { kind: 'passive', id: 'nope', level: 1 })).toBe('unknown');
    expect(debugGrant(sim, 0, { kind: 'evolution', id: 'nova', level: 1 })).toBe('unknown');
  });
});

describe('información', () => {
  test('resume el estado con los mismos números que usa el director', () => {
    const sim = quietSim();
    run(sim, 120);
    spawnEnemy(sim, dummy(sim), 100, 0);
    const info = debugInfo(sim, 0);
    expect(info.cap).toBe(aliveCap(sim));
    expect(info.rate).toBe(spawnRate(sim));
    expect(info.alive).toBe(1);
    expect(info.fauna).toBe(1);
    expect(info.teamLevel).toBe(probe(sim).level);
    expect(info.toCore).toBeCloseTo(sim.sector.layerSeconds - layerSeconds(sim));
    expect(info.boss).toBeNull();
    expect(info.god).toBe(false);
  });

  // The truce of life (2026-11-18): the panel says where the run is in it.
  test('dice en qué punto de la tregua de vida está la incursión', () => {
    const sim = quietSim((c) => {
      c.sectors[0]!.scaling = { ...c.sectors[0]!.scaling, hpHoldFrom: 8, hpHoldUntil: 30 };
    });
    expect(debugInfo(sim, 0).truce).toBe('before');
    sim.tick = 10 * 3600;
    expect(debugInfo(sim, 0).truce).toBe('held');
    sim.tick = 31 * 3600;
    expect(debugInfo(sim, 0).truce).toBe('rising');
    expect(debugInfo(quietSim(), 0).truce).toBe('off');
  });
});

describe('en grupo no existe', () => {
  test('todas las funciones se niegan', () => {
    const content = tinyContent();
    const sim = createSim(options(content, { coop: DEFAULT_COOP_RULES, probes: [0, 1].map(() => ({ probe: content.probes[0]!.id, relics: [] })) }));
    run(sim, 1);
    expect(() => debugLevelUp(sim, 0, 1)).toThrow('debug_coop');
    expect(() => setGod(sim, true)).toThrow('debug_coop');
    expect(() => debugHeal(sim, 0)).toThrow('debug_coop');
    expect(() => debugClear(sim)).toThrow('debug_coop');
    expect(() => debugSummonCore(sim)).toThrow('debug_coop');
    expect(() => debugSkipLayer(sim)).toThrow('debug_coop');
    expect(() => debugGrant(sim, 0, { kind: 'weapon', id: 'nova', level: 1 })).toThrow('debug_coop');
  });
});
