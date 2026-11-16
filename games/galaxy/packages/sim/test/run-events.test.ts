import { describe, expect, test } from 'vitest';
import {
  DEFAULT_CONTENT,
  debugEvent,
  type EventPlan,
  eventLootUpTo,
  eventsForLayer,
  IDLE,
  PICKUP,
  type Sim,
  type SimEvent,
  step,
  worldSchedule,
} from '../src/index';
import { quietSim, run } from './fixtures';

// In-run events (2026-11-16): besides the satellite, loot events — an abandoned ship (stay a few seconds to loot it), a
// supply capsule (it lands, touch it) and a bounty hunter (a marked enemy that flees: kill it) — fixed by the run's
// seed, about 5–10 in a 25–30 minute run, apart from each other and never during the Núcleo. Their loot is exact, so
// the server bounds it from the seed alone (`eventLootUpTo`).

const T = DEFAULT_CONTENT.events;
const SECTOR = DEFAULT_CONTENT.sectors[0]!;
const satelliteTimes = (seed: string, layer: number) => worldSchedule(seed, DEFAULT_CONTENT.satellites).filter((s) => s.layer === layer).map((s) => s.at);
const plan = (seed: string, layer: number): EventPlan[] => eventsForLayer(seed, T, SECTOR.id, layer, SECTOR.layerSeconds, satelliteTimes(seed, layer));
const duration = (kind: EventPlan['kind']) => (kind === 'wreck' ? T.wreck.life : kind === 'capsule' ? T.capsule.warn + T.capsule.life : T.bounty.seconds);

describe('el calendario', () => {
  test('de media salen entre 5 y 10 en las 4 primeras capas', () => {
    let total = 0;
    for (let s = 0; s < 200; s++) for (let layer = 1; layer <= 4; layer++) total += plan(String(1000 + s), layer).length;
    expect(total / 200).toBeGreaterThanOrEqual(5);
    expect(total / 200).toBeLessThanOrEqual(10);
  });

  test('separados entre sí y del satélite, y terminan antes del Núcleo', () => {
    for (let s = 0; s < 200; s++) {
      const seed = String(2000 + s);
      for (let layer = 1; layer <= 4; layer++) {
        const p = plan(seed, layer);
        for (let k = 1; k < p.length; k++) expect(p[k]!.at).toBeGreaterThanOrEqual(p[k - 1]!.at + duration(p[k - 1]!.kind) + T.gap - 1e-9);
        for (const e of p) {
          expect(e.at + duration(e.kind) + T.endBy).toBeLessThanOrEqual(SECTOR.layerSeconds + 1e-9);
          for (const at of satelliteTimes(seed, layer)) expect(Math.abs(e.at - at)).toBeGreaterThanOrEqual(T.gap - 1e-9);
        }
      }
    }
  });

  test('es el mismo para la misma semilla y no toca el del satélite', () => {
    expect(plan('77', 2)).toEqual(plan('77', 2));
    expect(worldSchedule('77', DEFAULT_CONTENT.satellites)).toEqual(worldSchedule('77', DEFAULT_CONTENT.satellites));
  });
});

/** A world with the events on and nothing else going on. */
function world(): Sim {
  const sim = quietSim((c) => {
    c.events = structuredClone(DEFAULT_CONTENT.events);
    c.events.slots = [];
  });
  run(sim, 1);
  return sim;
}
const seen = (sim: Sim, n: number, input = IDLE): SimEvent[] => {
  const out: SimEvent[] = [];
  for (let k = 0; k < n; k++) {
    step(sim, [input]);
    out.push(...sim.events.filter((e) => e.t === 'worldEvent'));
  }
  return out;
};
const pickups = (sim: Sim, kind: number) => {
  let total = 0;
  for (let i = 0; i < sim.pickups.top; i++) if (sim.pickups.alive[i] && sim.pickups.kind[i] === kind) total += sim.pickups.value[i]!;
  return total;
};

describe('la nave abandonada', () => {
  test('quedándose dentro unos segundos se saquea y suelta su botín', () => {
    const sim = world();
    expect(debugEvent(sim, 'wreck')).toBe('ok');
    const w = sim.world.active[0]!;
    const p = sim.probes[0]!;
    p.x = w.x;
    p.y = w.y;
    const events = seen(sim, Math.round(T.wreck.hold * 60) + 2);
    const done = events.find((e) => e.t === 'worldEvent' && e.what === 'done');
    expect(done).toMatchObject({ kind: 'wreck', coins: T.wreck.coins, dust: T.wreck.dust, components: T.wreck.components });
    expect(pickups(sim, PICKUP.coin)).toBe(T.wreck.coins);
    expect(sim.world.active).toHaveLength(0);
  });

  test('fuera de ella no avanza, y al acabarse su tiempo se va sin botín', () => {
    const sim = world();
    debugEvent(sim, 'wreck');
    expect(sim.events.filter((e) => e.t === 'worldEvent').map((e) => (e.t === 'worldEvent' ? e.what : ''))).toEqual(['appear']);
    const events = seen(sim, Math.round(T.wreck.life * 60) + 2);
    expect(events.map((e) => (e.t === 'worldEvent' ? e.what : ''))).toEqual(['fail']);
    expect(pickups(sim, PICKUP.coin)).toBe(0);
  });
});

describe('la cápsula de suministros', () => {
  test('aterriza tras el aviso y se abre al tocarla', () => {
    const sim = world();
    debugEvent(sim, 'capsule');
    const c = sim.world.active[0]!;
    const p = sim.probes[0]!;
    p.x = c.x;
    p.y = c.y;
    // Still landing: nothing yet.
    expect(seen(sim, Math.round(T.capsule.warn * 60) - 5).some((e) => e.t === 'worldEvent' && e.what === 'done')).toBe(false);
    const events = seen(sim, 10);
    expect(events.find((e) => e.t === 'worldEvent' && e.what === 'done')).toMatchObject({ kind: 'capsule', coins: T.capsule.coins });
  });
});

describe('el cazarrecompensas', () => {
  test('huye de la sonda; si se le mata suelta su premio', () => {
    const sim = world();
    debugEvent(sim, 'bounty');
    const b = sim.world.active[0]!;
    const e = b.enemy;
    expect(sim.enemies.alive[e]).toBe(1);
    const p = sim.probes[0]!;
    const before = Math.hypot(sim.enemies.x[e]! - p.x, sim.enemies.y[e]! - p.y);
    seen(sim, 30);
    expect(Math.hypot(sim.enemies.x[e]! - p.x, sim.enemies.y[e]! - p.y)).toBeGreaterThan(before);
    sim.enemies.hp[e] = 0.5;
    const events = seen(sim, 1);
    // Killed by any hit: simulate it with the pool, as a shot would.
    sim.enemies.kill(e);
    const after = seen(sim, 2);
    expect([...events, ...after].find((x) => x.t === 'worldEvent' && x.what === 'done')).toMatchObject({ kind: 'bounty', coins: T.bounty.coins });
  });

  test('si se acaba su tiempo se escapa sin premio', () => {
    const sim = world();
    debugEvent(sim, 'bounty');
    const e = sim.world.active[0]!.enemy;
    const events = seen(sim, Math.round(T.bounty.seconds * 60) + 2);
    expect(events.map((x) => (x.t === 'worldEvent' ? x.what : ''))).toEqual(['fail']);
    expect(sim.enemies.alive[e]).toBe(0);
  });
});

describe('nunca durante el Núcleo', () => {
  test('al salir el Núcleo los eventos en curso terminan', () => {
    const sim = world();
    debugEvent(sim, 'wreck');
    sim.phase = 'boss';
    const events = seen(sim, 1);
    expect(events.map((e) => (e.t === 'worldEvent' ? e.what : ''))).toEqual(['end']);
    expect(sim.world.active).toHaveLength(0);
  });
});

describe('el límite del servidor', () => {
  test('suma el botín de los eventos que su semilla tenía en las capas y el tiempo jugados', () => {
    const seed = '4242';
    const layerSeconds = SECTOR.layerSeconds;
    let coins = 0;
    for (let layer = 1; layer <= 3; layer++) {
      for (const e of plan(seed, layer)) {
        const k = T[e.kind];
        coins += Math.floor(k.coins * (1 + k.perLayer * (layer - 1)));
      }
    }
    const bound = eventLootUpTo(seed, DEFAULT_CONTENT, SECTOR.id, { depth: 3, ticks: 3 * layerSeconds * 60, layerSeconds });
    expect(bound.coins).toBe(coins);
    expect(eventLootUpTo(seed, DEFAULT_CONTENT, SECTOR.id, { depth: 1, ticks: 60, layerSeconds }).coins).toBe(0);
  });
});
