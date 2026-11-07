import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { ANGLE_STEPS, angleTo, cosA, degToSteps, diminish, Rng, sinA, ticks } from '../src/index';

// Deterministic maths for the run simulation (GDD §18.4): the same seed and inputs must give the same run in every
// browser and on the server, so the simulation never uses Math.random or the engine-dependent Math.sin/atan2/pow.

describe('Rng', () => {
  test('la misma semilla y flujo repite la secuencia y otro flujo no', () => {
    const a = Rng.fromSeed('987654321', 'spawn');
    const b = Rng.fromSeed('987654321', 'spawn');
    const c = Rng.fromSeed('987654321', 'combat');
    const xs = Array.from({ length: 50 }, () => a.next());
    expect(Array.from({ length: 50 }, () => b.next())).toEqual(xs);
    expect(Array.from({ length: 50 }, () => c.next())).not.toEqual(xs);
  });

  test('los valores fijados del Rng no cambian (sfc32 sembrado con splitmix32, igual que la referencia en Python)', () => {
    const r = Rng.fromSeed('12345', 'spawn');
    expect(Array.from({ length: 5 }, () => r.next())).toEqual([3171520484, 1863137819, 4290821711, 3498710259, 194973012]);
    const top = Rng.fromSeed('18446744073709551615', 'combat');
    expect(Array.from({ length: 3 }, () => top.next())).toEqual([212652456, 2333134678, 2933557749]);
  });

  test('float está en [0,1) e int en [0,n)', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: (1n << 64n) - 1n }), fc.integer({ min: 1, max: 1000 }), (seed, n) => {
        const r = Rng.fromSeed(seed.toString(), 'x');
        for (let i = 0; i < 20; i++) {
          const f = r.float();
          const k = r.int(n);
          if (f < 0 || f >= 1 || !Number.isInteger(k) || k < 0 || k >= n) return false;
        }
        return true;
      }),
      { numRuns: 300 },
    );
  });

  test('pick, chance y range respetan sus límites', () => {
    const r = Rng.fromSeed('42', 'x');
    for (let i = 0; i < 200; i++) {
      expect(['a', 'b', 'c']).toContain(r.pick(['a', 'b', 'c']));
      const v = r.range(-3, 5);
      expect(v).toBeGreaterThanOrEqual(-3);
      expect(v).toBeLessThan(5);
    }
    expect(Array.from({ length: 100 }, () => r.chance(0)).some(Boolean)).toBe(false);
    expect(Array.from({ length: 100 }, () => r.chance(1)).every(Boolean)).toBe(true);
  });
});

describe('trigonometría por tabla', () => {
  test('la tabla de senos coincide con Math.sin a 1e-9 en las 4096 posiciones', () => {
    expect(ANGLE_STEPS).toBe(4096);
    for (let i = 0; i < 4096; i++) {
      const rad = (i * 2 * Math.PI) / 4096;
      expect(Math.abs(sinA(i) - Math.sin(rad))).toBeLessThan(1e-9);
      expect(Math.abs(cosA(i) - Math.cos(rad))).toBeLessThan(1e-9);
    }
    expect(sinA(1024)).toBe(1);
    expect(sinA(4096 + 1024)).toBe(1);
    expect(sinA(-1024)).toBe(-1);
  });

  test('angleTo se equivoca como mucho en 1 paso frente a Math.atan2', () => {
    fc.assert(
      fc.property(fc.double({ min: -1e4, max: 1e4, noNaN: true }), fc.double({ min: -1e4, max: 1e4, noNaN: true }), (dx, dy) => {
        fc.pre(Math.abs(dx) + Math.abs(dy) > 1e-6);
        const a = angleTo(dx, dy);
        const want = (((Math.atan2(dy, dx) * 4096) / (2 * Math.PI)) % 4096 + 4096) % 4096;
        const diff = Math.abs(a - want);
        return Number.isInteger(a) && a >= 0 && a < 4096 && Math.min(diff, 4096 - diff) <= 1;
      }),
      { numRuns: 500 },
    );
    expect(angleTo(1, 0)).toBe(0);
    expect(angleTo(0, 1)).toBe(1024);
    expect(angleTo(-1, 0)).toBe(2048);
    expect(angleTo(0, -1)).toBe(3072);
    expect(angleTo(0, 0)).toBe(0);
  });

  test('degToSteps y ticks redondean a enteros', () => {
    expect(degToSteps(90)).toBe(1024);
    expect(degToSteps(20)).toBe(228);
    expect(ticks(0.7)).toBe(42);
    expect(ticks(300)).toBe(18000);
  });
});

describe('diminish (rendimiento decreciente, GDD §8.6)', () => {
  test('un solo valor pequeño rinde casi lo mismo y nunca pasa del tope', () => {
    expect(diminish([], 0.6)).toBe(0);
    expect(diminish([0.06], 0.6)).toBeCloseTo(0.06, 12);
    expect(diminish([0.3, 0.3], 0.6)).toBeCloseTo(0.45, 12);
    expect(diminish([1, 1, 1], 0.6)).toBe(0.6);
    expect(diminish([-0.2], 0.6)).toBe(0);
  });

  test('crece, nunca pasa del tope y cada añadido rinde menos', () => {
    fc.assert(
      fc.property(fc.array(fc.double({ min: 0, max: 2, noNaN: true }), { maxLength: 12 }), fc.double({ min: 0.01, max: 5, noNaN: true }), fc.double({ min: 0, max: 2, noNaN: true }), (vs, cap, extra) => {
        const before = diminish(vs, cap);
        const after = diminish([...vs, extra], cap);
        return before >= 0 && after <= cap + 1e-12 && after >= before - 1e-12 && after - before <= extra + 1e-12;
      }),
      { numRuns: 300 },
    );
  });
});
