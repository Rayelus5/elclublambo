import { describe, expect, test } from 'vitest';
import { createSim, DEFAULT_COOP_RULES, hudSnapshot, hurtProbe, IDLE, type ProbeInput, setGod, type Sim, type SimEvent, step } from '../src/index';
import { options, quietSim, run, tinyContent } from './fixtures';

// «La Estática te alcanza» (2026-11-16): a probe that stays in a small area gets a warning after `warn` seconds, and
// from `hurt` seconds the Static hurts it more and more and blocks its healing, until it leaves the area. Never while
// it holds the beacon or revives a teammate, nor in a group while it picks a card.

const TUNED = { radius: 56, warn: 8, hurt: 12, damage: 0.02, growth: 0.02, max: 0.15 };

function world(over: Partial<typeof TUNED> = {}): Sim {
  const sim = quietSim((c) => {
    c.stillness = { ...TUNED, ...over };
  });
  run(sim, 1);
  return sim;
}
const statics = (events: readonly SimEvent[]) => events.filter((e) => e.t === 'static').map((e) => (e.t === 'static' ? e.what : ''));
function idle(sim: Sim, n: number): string[] {
  const seen: string[] = [];
  for (let k = 0; k < n; k++) {
    step(sim, sim.probes.map(() => IDLE));
    seen.push(...statics(sim.events));
  }
  return seen;
}

describe('quieto', () => {
  test('avisa a los 8 s y empieza a hacer daño a los 12 s, cada vez más', () => {
    const sim = world();
    const p = sim.probes[0]!;
    const full = p.hp;
    expect(idle(sim, 60 * 8)).toEqual(['warn']);
    expect(p.hp).toBe(full);
    expect(idle(sim, 60 * 4)).toEqual(['start']);
    const first = p.hp;
    idle(sim, 60);
    const lostFirst = first - p.hp;
    expect(lostFirst).toBeGreaterThan(0);
    const second = p.hp;
    idle(sim, 60);
    expect(second - p.hp).toBeGreaterThan(lostFirst);
  });

  test('salir de la zona lo para y vuelve a contar desde cero', () => {
    const sim = world();
    const p = sim.probes[0]!;
    idle(sim, 60 * 12 + 30);
    const hurt = p.hp;
    p.x += 200;
    const seen = idle(sim, 1);
    expect(seen).toEqual(['stop']);
    idle(sim, 60 * 7);
    expect(p.hp).toBe(hurt);
    expect(p.still.t).toBeLessThan(60 * 8);
  });

  test('moverse dentro de la zona no cuenta como salir', () => {
    const sim = world();
    const p = sim.probes[0]!;
    const right: ProbeInput = { ...IDLE, mx: 127 };
    const left: ProbeInput = { ...IDLE, mx: -127 };
    const seen: string[] = [];
    for (let k = 0; k < 60 * 12 + 10; k++) {
      step(sim, [Math.floor(k / 20) % 2 === 0 ? right : left]);
      seen.push(...statics(sim.events));
    }
    expect(seen).toContain('start');
    expect(Math.abs(p.x - p.still.x)).toBeLessThan(TUNED.radius);
  });

  test('dentro de la baliza no cuenta', () => {
    const sim = world();
    const p = sim.probes[0]!;
    sim.beacon = { x: p.x, y: p.y, t: 60 * 60, hold: 0, holdNeeded: 60 * 60, radius: 70 };
    const before = p.still.t;
    expect(idle(sim, 60 * 13)).toEqual([]);
    expect(p.still.t).toBe(before);
  });

  test('invulnerable en depuración avisa pero no hace daño', () => {
    const sim = world();
    setGod(sim, true);
    const p = sim.probes[0]!;
    const full = p.hp;
    idle(sim, 60 * 14);
    expect(p.hp).toBe(full);
  });

  test('puede matar: de varios segundos, no de golpe', () => {
    const sim = world({ damage: 0.5, growth: 0.5, max: 1 });
    idle(sim, 60 * 12 + 30);
    expect(sim.status).toBe('running');
    idle(sim, 60 * 6);
    expect(sim.status).toBe('dead');
  });

  test('con hurt 0 está apagada (el contenido de antes, los tests de mecánicas)', () => {
    const sim = world({ warn: 0, hurt: 0 });
    const p = sim.probes[0]!;
    const full = p.hp;
    expect(idle(sim, 60 * 20)).toEqual([]);
    expect(p.hp).toBe(full);
  });
});

describe('en la HUD', () => {
  test('dice si avisa o ya hace daño, dónde está la zona y cuánto falta', () => {
    const sim = world();
    expect(hudSnapshot(sim, 0).still).toMatchObject({ level: 0 });
    idle(sim, 60 * 9);
    const warned = hudSnapshot(sim, 0).still;
    expect(warned.level).toBe(1);
    expect(warned.left).toBeCloseTo(3, 0);
    expect(warned).toMatchObject({ x: sim.probes[0]!.still.x, y: sim.probes[0]!.still.y, radius: TUNED.radius });
    idle(sim, 60 * 4);
    expect(hudSnapshot(sim, 0).still).toMatchObject({ level: 2, left: 0 });
  });
});

describe('en grupo', () => {
  const team = () => {
    const content = tinyContent((c) => {
      c.stillness = TUNED;
    });
    const sim = createSim(options(content, { coop: DEFAULT_COOP_RULES, probes: [0, 1].map(() => ({ probe: content.probes[0]!.id, relics: [] })) }));
    step(sim, sim.probes.map(() => IDLE));
    return sim;
  };

  test('mientras reanima a un compañero caído no cuenta: se le puede reanimar sin castigo', () => {
    const sim = team();
    const [a, b] = sim.probes;
    b!.x = a!.x + 10;
    b!.y = a!.y;
    idle(sim, 60 * 6);
    const before = a!.still.t;
    expect(before).toBeGreaterThan(60 * 5);
    hurtProbe(sim, b!, b!.hp * 10);
    expect(b!.life).toBe('down');
    let n = 0;
    while (b!.life !== 'up' && n < 60 * 20) {
      step(sim, [IDLE, IDLE]);
      n++;
    }
    expect(b!.life).toBe('up');
    expect(n).toBeGreaterThan(30);
    expect(a!.still.t).toBe(before);
  });

  test('cada sonda lleva su cuenta', () => {
    const sim = team();
    const [a, b] = sim.probes;
    b!.x = a!.x + 500;
    for (let k = 0; k < 60 * 9; k++) step(sim, [IDLE, { ...IDLE, mx: k % 120 < 60 ? 127 : -127 }]);
    expect(a!.still.t).toBeGreaterThanOrEqual(60 * 8);
    expect(b!.still.t).toBeLessThan(60 * 8);
  });
});
