import { describe, expect, test } from 'vitest';
import {
  DEFAULT_CONTENT,
  debugEvent,
  type EventPlan,
  eventLootUpTo,
  eventReward,
  eventsForLayer,
  HAZARD_KINDS,
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
const duration = (kind: EventPlan['kind']) =>
  ({ wreck: T.wreck.life, capsule: T.capsule.warn + T.capsule.life, bounty: T.bounty.seconds, meteors: T.meteors.seconds, storm: T.storm.seconds, ambush: T.ambush.warn, well: T.well.seconds })[kind];

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
      for (const e of plan(seed, layer)) coins += eventReward(T, e.kind, layer).coins;
    }
    const bound = eventLootUpTo(seed, DEFAULT_CONTENT, SECTOR.id, { depth: 3, ticks: 3 * layerSeconds * 60, layerSeconds });
    expect(bound.coins).toBe(coins);
    expect(eventLootUpTo(seed, DEFAULT_CONTENT, SECTOR.id, { depth: 1, ticks: 60, layerSeconds }).coins).toBe(0);
  });
});

// The hazards (2026-11-16): nothing to win but getting through. A meteor shower, a Static storm that follows the probe,
// an ambush that closes round it and a gravity well that pulls it in; they drop nothing.
describe('los peligros', () => {
  test('la lluvia de meteoritos avisa cada impacto y golpea a quien se queda en el círculo', () => {
    const sim = world();
    debugEvent(sim, 'meteors');
    const p = sim.probes[0]!;
    const full = p.hp;
    // The first one falls on its first tick: put the probe on it.
    step(sim, [IDLE]);
    const warn = sim.events.find((e) => e.t === 'telegraph' && e.kind === 'meteor');
    expect(warn).toBeTruthy();
    if (warn?.t !== 'telegraph') return;
    p.x = warn.x;
    p.y = warn.y;
    let blasts = 0;
    for (let k = 0; k < warn.ticks + 1; k++) {
      step(sim, [IDLE]);
      blasts += sim.events.filter((e) => e.t === 'blast').length;
    }
    expect(blasts).toBeGreaterThan(0);
    expect(p.hp).toBeLessThan(full);
  });

  test('la tormenta sigue a la sonda, más despacio que ella, y hace daño dentro', () => {
    const sim = world();
    debugEvent(sim, 'storm');
    const s = sim.world.active[0]!;
    const p = sim.probes[0]!;
    const before = Math.hypot(s.x - p.x, s.y - p.y);
    seen(sim, 60);
    const after = Math.hypot(s.x - p.x, s.y - p.y);
    expect(before - after).toBeCloseTo(T.storm.speed, 0);
    const full = p.hp;
    p.x = s.x;
    p.y = s.y;
    seen(sim, 61);
    expect(p.hp).toBeLessThan(full);
  });

  test('la emboscada cierra un anillo de fauna alrededor de la sonda tras el aviso', () => {
    const sim = world();
    const p = sim.probes[0]!;
    const alive = () => {
      let n = 0;
      for (let i = 0; i < sim.enemies.top; i++) if (sim.enemies.alive[i]) n++;
      return n;
    };
    // The quiet world's fauna never comes on its own (no density); the ambush brings it.
    sim.sector.spawns = sim.sector.spawns.map((sp) => ({ ...sp, from: 0 }));
    const before = alive();
    debugEvent(sim, 'ambush');
    const events = seen(sim, Math.round(T.ambush.warn * 60) + 1);
    expect(events.map((e) => (e.t === 'worldEvent' ? e.what : ''))).toEqual(['done']);
    expect(alive() - before).toBe(T.ambush.count);
    for (let i = 0; i < sim.enemies.top; i++) {
      if (!sim.enemies.alive[i]) continue;
      const d = Math.hypot(sim.enemies.x[i]! - p.x, sim.enemies.y[i]! - p.y);
      if (d > T.ambush.distance - 30) expect(d).toBeLessThan(T.ambush.distance + 30);
    }
  });

  test('el pozo atrae a la sonda y al botín, y su corazón hace daño; se puede salir', () => {
    const sim = world();
    debugEvent(sim, 'well');
    const w = sim.world.active[0]!;
    const p = sim.probes[0]!;
    p.x = w.x + T.well.radius / 2;
    p.y = w.y;
    seen(sim, 30);
    expect(p.x - w.x).toBeLessThan(T.well.radius / 2);
    // Walking out beats the pull.
    const inside = p.x;
    seen(sim, 60, { ...IDLE, mx: 127 });
    expect(p.x).toBeGreaterThan(inside);
    const full = p.hp;
    p.x = w.x;
    p.y = w.y;
    seen(sim, 31);
    expect(p.hp).toBeLessThan(full);
  });

  test('no sueltan nada y, si se aguantan, terminan sin aviso de botín', () => {
    for (const kind of HAZARD_KINDS) expect(eventReward(T, kind, 3)).toEqual({ coins: 0, dust: 0, components: 0 });
    const sim = world();
    debugEvent(sim, 'storm');
    sim.probes[0]!.x += 10_000;
    const events = seen(sim, Math.round(T.storm.seconds * 60) + 1);
    expect(events.find((e) => e.t === 'worldEvent' && e.what === 'done')).toMatchObject({ kind: 'storm' });
    expect(events.some((e) => e.t === 'worldEvent' && e.what === 'done' && (e.coins ?? 0) > 0)).toBe(false);
  });
});

