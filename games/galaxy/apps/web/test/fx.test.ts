import { expect, test } from 'vitest';
import { DEFAULT_CONTENT } from '@galaxy/sim';
import { createFx, reactionLabel } from '../src/arena/stage/fx';

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

test('cada reacción tiene su nombre y un color según lo que hace', () => {
  for (const r of DEFAULT_CONTENT.elements.reactions) {
    const l = reactionLabel(DEFAULT_CONTENT, r.id);
    expect(l.text).toBe(r.name);
    expect(l.color).toBeGreaterThan(0);
  }
  expect(reactionLabel(DEFAULT_CONTENT, 'short-circuit').color).toBe(reactionLabel(DEFAULT_CONTENT, 'storm').color);
  expect(reactionLabel(DEFAULT_CONTENT, 'nope')).toEqual({ text: '', color: 0xffffff });
});

test('las etiquetas de reacción suben, se apagan y nunca pasan de 6 a la vez', () => {
  const fx = createFx(false);
  for (let k = 0; k < 8; k++) fx.label(k * 10, 0, `R${k}`, 0xffffff);
  expect(fx.labels).toHaveLength(6);
  expect(fx.labels[0]!.text).toBe('R2');
  fx.update(0.3);
  expect(fx.labels[0]!.y).toBeLessThan(0);
  fx.update(1);
  expect(fx.labels).toHaveLength(0);
  const still = createFx(true);
  still.label(0, 0, 'R', 0xffffff);
  still.update(0.3);
  expect(still.labels[0]!.y).toBe(0);
});

test('un anillo de evolución crece y se apaga', () => {
  const fx = createFx(false);
  fx.ring(5, 5, 0xffc94a);
  fx.update(0.2);
  expect(fx.rings[0]!.radius).toBeGreaterThan(0);
  fx.update(1);
  expect(fx.rings).toHaveLength(0);
});

test('la turbina de una sonda que avanza echa partículas calientes por detrás, contra su marcha, a ritmo constante', () => {
  const fx = createFx(false);
  // Facing right: the puffs come out to its left and fly further left.
  for (let i = 0; i < 30; i++) fx.thrust(0, 100, 100, 0, 1 / 60);
  // 80 puffs a second over half a second (minus the briefest flames, already gone): a dense jet.
  const n = fx.particles.length;
  expect(n).toBeGreaterThanOrEqual(30);
  expect(n).toBeLessThanOrEqual(40);
  expect(fx.particles.every((p) => p.x < 100 && p.vx < 0)).toBe(true);
  expect(fx.particles.every((p) => Math.abs(p.y - 100) <= 2)).toBe(true);
  // Facing up (−90°): below it, flying down.
  const up = createFx(false);
  up.thrust(0, 50, 50, -Math.PI / 2, 0.5);
  expect(up.particles.length).toBeGreaterThan(0);
  expect(up.particles.every((p) => p.y > 50 && p.vy > 0)).toBe(true);
  // Short-lived: half a second later the first puffs are gone.
  fx.update(0.5);
  expect(fx.particles.length).toBe(0);
});

test('cada sonda lleva su propia turbina, y con movimiento reducido echa menos', () => {
  const fx = createFx(false);
  fx.thrust(0, 0, 0, 0, 0.25);
  fx.thrust(1, 200, 0, Math.PI, 0.25);
  expect(fx.particles.some((p) => p.x < 0)).toBe(true);
  expect(fx.particles.some((p) => p.x > 200)).toBe(true);
  const calm = createFx(true);
  calm.thrust(0, 0, 0, 0, 0.5);
  const lively = createFx(false);
  lively.thrust(0, 0, 0, 0, 0.5);
  expect(calm.particles.length).toBeGreaterThan(0);
  expect(calm.particles.length).toBeLessThan(lively.particles.length / 2);
});

test('la estela de un disparo suelta motas lentas a ritmo constante que se apagan pronto, y menos con movimiento reducido', () => {
  const fx = createFx(false);
  // A mortar shell (Nov plan B3): 40 motes a second over half a second.
  for (let i = 0; i < 30; i++) fx.trail(3, 10, 10, 0xff9a3c, 1 / 60);
  expect(fx.particles.length).toBeGreaterThanOrEqual(18);
  expect(fx.particles.length).toBeLessThanOrEqual(21);
  expect(fx.particles.every((p) => Math.abs(p.x - 10) <= 1 && Math.abs(p.y - 10) <= 1 && Math.hypot(p.vx, p.vy) <= 5)).toBe(true);
  expect(fx.particles.every((p) => p.color === 0xff9a3c)).toBe(true);
  fx.update(0.5);
  expect(fx.particles.length).toBe(0);
  const calm = createFx(true);
  calm.trail(0, 0, 0, 0xffffff, 0.5);
  const lively = createFx(false);
  lively.trail(0, 0, 0, 0xffffff, 0.5);
  expect(calm.particles.length).toBeGreaterThan(0);
  expect(calm.particles.length).toBeLessThan(lively.particles.length / 2);
});
