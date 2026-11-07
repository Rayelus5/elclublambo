import { expect, test } from 'vitest';
import { createFx } from '../src/arena/stage/fx';

// Combat juice that is pure state (DESIGN_SYSTEM §8 quater): the shake decays to rest, damage numbers rise and fade
// with a cap, particles age out, and reduced motion removes the shake and halves the particles.

test('la sacudida es proporcional y decae hasta parar', () => {
  const fx = createFx(false);
  fx.shake(6);
  const first = fx.update(1 / 60);
  expect(Math.hypot(first.x, first.y)).toBeGreaterThan(0);
  expect(Math.hypot(first.x, first.y)).toBeLessThanOrEqual(6);
  let last = first;
  for (let i = 0; i < 90; i++) last = fx.update(1 / 60);
  expect(last).toEqual({ x: 0, y: 0 });
});

test('con movimiento reducido no hay sacudida y salen la mitad de partículas', () => {
  const calm = createFx(true);
  calm.shake(6);
  expect(calm.update(1 / 60)).toEqual({ x: 0, y: 0 });
  calm.burst(0, 0, 0xffffff, 10);
  const lively = createFx(false);
  lively.burst(0, 0, 0xffffff, 10);
  expect(calm.particles.length).toBe(5);
  expect(lively.particles.length).toBe(10);
});

test('los números suben, se apagan en 0,6 s y nunca pasan de 60 a la vez', () => {
  const fx = createFx(false);
  fx.number(10, 10, 12, false);
  const n = fx.numbers[0]!;
  fx.update(0.3);
  expect(n.y).toBeLessThan(10);
  expect(n.alpha).toBeLessThan(1);
  fx.update(0.31);
  expect(fx.numbers).toHaveLength(0);
  for (let i = 0; i < 80; i++) fx.number(0, 0, 1, false);
  expect(fx.numbers).toHaveLength(60);
  expect(fx.numbers.at(-1)!.value).toBe(21);
});

test('las partículas envejecen y desaparecen', () => {
  const fx = createFx(false);
  fx.burst(0, 0, 0xff00ff, 8);
  for (let i = 0; i < 120; i++) fx.update(1 / 60);
  expect(fx.particles).toHaveLength(0);
});
