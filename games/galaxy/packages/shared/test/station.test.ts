import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { advanceRefinery, antennaAccrued, parseConfig, ROOM_IDS, roomStatus, runMaterial } from '../src/index';

// The station (GDD §10, §11): the machines process, they do not generate. The refinery turns queued raw material into
// components at its rate, in server time and lazily; the antenna drips a few signals, capped at 8 h; the runs bring the
// material, paid like the loot.

const cfg = parseConfig('station', {});
const runs = parseConfig('runs', {});
const H = 3_600_000;
const t0 = new Date('2026-11-07T10:00:00.000Z');
const at = (hours: number) => new Date(t0.getTime() + hours * H);

describe('la refinería', () => {
  test('a 20 por hora, una hora convierte 20', () => {
    expect(advanceRefinery({ queue: 50, ready: 0, clock: t0 }, 1, cfg, at(1))).toEqual({ queue: 30, ready: 20, clock: at(1) });
  });

  test('no fabrica más de lo que tiene en cola, aunque pase un día', () => {
    expect(advanceRefinery({ queue: 5, ready: 2, clock: t0 }, 1, cfg, at(24))).toEqual({ queue: 0, ready: 7, clock: at(24) });
  });

  test('media hora y otra media dan lo mismo que una hora, y las fracciones no se pierden', () => {
    const half = advanceRefinery({ queue: 50, ready: 0, clock: t0 }, 1, cfg, at(0.5));
    expect(advanceRefinery(half, 1, cfg, at(1))).toEqual(advanceRefinery({ queue: 50, ready: 0, clock: t0 }, 1, cfg, at(1)));
    // 30 per hour at level 2: one minute is half a unit; two minutes, one.
    let row = { queue: 10, ready: 0, clock: t0 };
    row = advanceRefinery(row, 2, cfg, at(1 / 60));
    row = advanceRefinery(row, 2, cfg, at(2 / 60));
    expect(row.ready).toBe(1);
  });

  test('una hora anterior al reloj no cambia nada; con la cola vacía, el reloj espera', () => {
    const row = { queue: 50, ready: 3, clock: t0 };
    expect(advanceRefinery(row, 1, cfg, at(-1))).toEqual(row);
    // Idle hours never count for a later load.
    expect(advanceRefinery({ queue: 0, ready: 3, clock: t0 }, 1, cfg, at(5))).toEqual({ queue: 0, ready: 3, clock: at(5) });
  });

  test('cola + listos nunca crece, los listos nunca bajan y la cola nunca es negativa', () => {
    fc.assert(
      fc.property(fc.nat(600), fc.array(fc.double({ min: -2, max: 30, noNaN: true }), { maxLength: 12 }), fc.integer({ min: 1, max: 5 }), (queue, hours, level) => {
        let row = { queue, ready: 0, clock: t0 };
        for (const h of hours) {
          const next = advanceRefinery(row, level, cfg, at(h));
          if (next.queue + next.ready > row.queue + row.ready || next.ready < row.ready || next.queue < 0) return false;
          row = next;
        }
        return true;
      }),
    );
  });
});

describe('la antena', () => {
  test('a 0,125 por hora, 8 h dan una señal y una semana también: el tope es de 8 h', () => {
    expect(antennaAccrued(t0, 1, cfg, at(8)).signals).toBe(1);
    expect(antennaAccrued(t0, 1, cfg, at(24 * 7)).signals).toBe(1);
  });

  test('cobra las señales enteras y conserva el tiempo de la fracción, dentro del tope', () => {
    // Level 2, 0.15 per hour: 8 h (the cap of 12) are 1.2 signals; 1 is paid and the 0.2 (1 h 20 min) stays.
    const { signals, clock } = antennaAccrued(t0, 2, cfg, at(12));
    expect(signals).toBe(1);
    expect(at(12).getTime() - clock.getTime()).toBeCloseTo((0.2 / 0.15) * H, -3);
    // Collecting again at once gives nothing.
    expect(antennaAccrued(clock, 2, cfg, at(12)).signals).toBe(0);
  });

  test('rota (nivel 0) no da nada, y un reloj que retrocede tampoco', () => {
    expect(antennaAccrued(t0, 0, cfg, at(100)).signals).toBe(0);
    expect(antennaAccrued(t0, 1, cfg, at(-5)).signals).toBe(0);
  });
});

describe('las salas', () => {
  test('diez salas: cinco funcionan, la Antena está rota y cuatro llegan más adelante', () => {
    expect(ROOM_IDS).toHaveLength(10);
    expect(roomStatus('hangar', 1, cfg)).toEqual({ state: 'working', level: 1, maxLevel: 1, next: null });
    expect(roomStatus('lab', 0, cfg)).toMatchObject({ state: 'future', next: null });
    expect(roomStatus('antenna', 0, cfg)).toEqual({ state: 'broken', level: 0, maxLevel: 5, next: { cost: { components: 30, coins: 0 } } });
    expect(roomStatus('refinery', 1, cfg)).toEqual({ state: 'working', level: 1, maxLevel: 5, next: { cost: { components: 40, coins: 500 } } });
    expect(roomStatus('refinery', 5, cfg).next).toBeNull();
  });

  test('la clave rechaza costes negativos, niveles que bajan y campos de más', () => {
    const bad = structuredClone(cfg) as { refinery: { rate: number; queue: number; cost: { components: number; coins: number } }[] };
    bad.refinery[1]!.cost.components = -1;
    expect(() => parseConfig('station', bad)).toThrow();
    const down = structuredClone(cfg) as { refinery: { rate: number }[] };
    down.refinery[2]!.rate = 1;
    expect(() => parseConfig('station', down)).toThrow();
    expect(() => parseConfig('station', { ...cfg, extra: 1 })).toThrow();
  });
});

describe('el material de las incursiones', () => {
  const claim = { outcome: 'extracted' as const, ticks: 60 * 60 * 15, depth: 3, kills: 600, bossKills: 2, level: 20, loot: [], hash: '0123456789abcdef' };

  test('capa 3, 2 Núcleos y 600 bajas extraída: 50; muerta, la mitad', () => {
    expect(runMaterial(claim, runs, 1, false)).toBe(50);
    expect(runMaterial({ ...claim, outcome: 'died' }, runs, 1, false)).toBe(25);
  });

  test('sigue al rendimiento diario y a la parte de morir si es tramposa, y nunca pasa de su tope', () => {
    expect(runMaterial(claim, runs, 0.5, false)).toBe(25);
    expect(runMaterial(claim, runs, 1, true)).toBe(25);
    expect(runMaterial({ ...claim, depth: 400, bossKills: 400 }, runs, 1, false)).toBe(500);
  });
});
