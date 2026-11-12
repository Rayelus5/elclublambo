import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { contentSchema, dealDamage, DEFAULT_CONTENT, deriveStats, hurtProbe, type Sim, spawnEnemy } from '../src/index';
import { quietSim } from './fixtures';

// The five passives of the November plan (spec §5 B2): each raises a stat no other passive touches. Fase cuántica
// (evasion), Cazanúcleos (bossDamage), Protocolo de purga (execute), Repulsor (knockback) and Inercia (movingDamage).

const species = (sim: Sim, id: string) => sim.content.enemies.find((e) => e.id === id)!;
/** Sturdy still targets; combat rolls answer `yes` (no criticals unless asked). */
function world(yes = false): Sim {
  const sim = quietSim((c) => {
    for (const e of c.enemies) e.hp = 1000;
    c.enemies.find((e) => e.id === 'dummy')!.speed = 0;
  });
  sim.rng.combat.chance = () => yes;
  return sim;
}
const hit = (sim: Sim, e: number, amount: number) => dealDamage(sim, e, amount, { probe: 0, weapon: null, relic: null, element: null, x: sim.probes[0]!.x, y: sim.probes[0]!.y });

describe('las cinco pasivas nuevas', () => {
  test('existen, cada una con su stat y sin repetir ninguna de las de antes', () => {
    const want = { 'quantum-phase': 'evasion', 'core-hunter': 'bossDamage', 'purge-protocol': 'execute', repulsor: 'knockback', inertia: 'movingDamage' } as const;
    for (const [id, stat] of Object.entries(want)) expect(DEFAULT_CONTENT.passives.find((p) => p.id === id)?.stat, id).toBe(stat);
    const stats = DEFAULT_CONTENT.passives.map((p) => p.stat);
    expect(new Set(stats).size).toBe(stats.length);
    expect(DEFAULT_CONTENT.passives).toHaveLength(25);
  });

  test('sin ellas, las stats nuevas valen 0', () => {
    const sim = quietSim();
    const s = deriveStats(sim, sim.probes[0]!);
    expect([s.evasion, s.bossDamage, s.execute, s.knockback, s.movingDamage]).toEqual([0, 0, 0, 0, 0]);
  });

  test('sus topes son bajos: nada pasa de lo que dicen los caps', () => {
    const sim = quietSim();
    const p = sim.probes[0]!;
    p.upgrades.push({ stat: 'evasion', value: 9 }, { stat: 'execute', value: 9 }, { stat: 'bossDamage', value: 9 }, { stat: 'movingDamage', value: 9 }, { stat: 'knockback', value: 9 });
    const s = deriveStats(sim, p);
    const caps = sim.content.caps;
    expect(s.evasion).toBeLessThanOrEqual(caps.evasion);
    expect(s.execute).toBeLessThanOrEqual(caps.execute);
    expect(caps.evasion).toBeLessThanOrEqual(0.25);
    expect(caps.execute).toBeLessThanOrEqual(0.12);
  });
});

describe('Fase cuántica: esquivar un golpe', () => {
  test('un golpe esquivado no quita vida, avisa y da el respiro de siempre', () => {
    const sim = world(true);
    const p = sim.probes[0]!;
    p.stats.evasion = 0.2;
    hurtProbe(sim, p, 30);
    expect(p.hp).toBe(p.stats.maxHp);
    expect(sim.events).toContainEqual({ t: 'evade', probe: 0 });
    expect(p.invulnT).toBeGreaterThan(0);
  });
  test('sin esquiva el golpe entra', () => {
    const sim = world(true);
    const p = sim.probes[0]!;
    hurtProbe(sim, p, 30);
    expect(p.hp).toBeLessThan(p.stats.maxHp);
  });
});

describe('Cazanúcleos: más daño a jefes y élites', () => {
  test('una élite recibe más, un enemigo normal lo mismo', () => {
    const sim = world();
    sim.probes[0]!.stats.bossDamage = 0.5;
    const normal = spawnEnemy(sim, species(sim, 'dummy'), 200, 0);
    const elite = spawnEnemy(sim, species(sim, 'mite'), 300, 0, { elite: sim.content.elites[1]! });
    expect(hit(sim, normal, 10)).toBeCloseTo(10);
    expect(hit(sim, elite, 10)).toBeCloseTo(15);
  });
});

describe('Protocolo de purga: rematar a los débiles', () => {
  test('un enemigo normal por debajo del umbral muere; una élite no', () => {
    const sim = world();
    sim.probes[0]!.stats.execute = 0.1;
    const normal = spawnEnemy(sim, species(sim, 'dummy'), 200, 0);
    hit(sim, normal, 905);
    expect(sim.enemies.alive[normal]).toBe(0);
    const elite = spawnEnemy(sim, species(sim, 'mite'), 300, 0, { elite: sim.content.elites[1]! });
    const max = sim.enemies.maxHp[elite]!;
    hit(sim, elite, max * 0.95);
    expect(sim.enemies.alive[elite]).toBe(1);
  });
  test('por encima del umbral sigue vivo', () => {
    const sim = world();
    sim.probes[0]!.stats.execute = 0.1;
    const normal = spawnEnemy(sim, species(sim, 'dummy'), 200, 0);
    hit(sim, normal, 800);
    expect(sim.enemies.alive[normal]).toBe(1);
  });
});

describe('Repulsor: los golpes empujan', () => {
  test('el golpe aleja al enemigo de la sonda; sin Repulsor no lo mueve', () => {
    const sim = world();
    const e = spawnEnemy(sim, species(sim, 'dummy'), 200, 0);
    hit(sim, e, 1);
    expect(sim.enemies.kx[e]).toBe(0);
    sim.probes[0]!.stats.knockback = 1;
    sim.enemies.flashT[e] = 0;
    hit(sim, e, 1);
    expect(sim.enemies.kx[e]).toBeGreaterThan(0);
  });
});

describe('Inercia: más daño en marcha', () => {
  test('moviéndose pega más; quieta, lo de siempre', () => {
    const sim = world();
    const p = sim.probes[0]!;
    p.stats.movingDamage = 0.2;
    const e = spawnEnemy(sim, species(sim, 'dummy'), 200, 0);
    p.moving = false;
    expect(hit(sim, e, 10)).toBeCloseTo(10);
    p.moving = true;
    expect(hit(sim, e, 10)).toBeCloseTo(12);
  });
});

test('el contenido publicado antes de las stats nuevas sigue valiendo y toma sus topes por defecto', () => {
  const live = JSON.parse(readFileSync(new URL('../../../ops/launch/2026-11-10/content.json', import.meta.url), 'utf8'));
  const parsed = contentSchema.safeParse(live);
  expect(parsed.success, JSON.stringify(parsed.error?.issues?.slice(0, 3))).toBe(true);
  expect(parsed.data!.caps.evasion).toBe(DEFAULT_CONTENT.caps.evasion);
});
