import { TIERS } from '@galaxy/shared';
import { expect, test } from 'vitest';
import { burstFor, stepParticles } from '../src/scanner/fx';

// The reveal's burst (open beta): more sparks, confetti and rings the rarer the galaxy, a flash and a shake only for
// the top ones, the same burst for the same pull (no Math.random), and particles that fall and fade away.

test('cuanto más rara, más partículas, y confeti solo desde rara', () => {
  const bursts = TIERS.map((t) => burstFor(t, '42', 1280, 720));
  for (let i = 1; i < bursts.length; i++) expect(bursts[i]!.particles.length).toBeGreaterThan(bursts[i - 1]!.particles.length);
  expect(bursts[0]!.particles.some((p) => p.kind === 'confetti')).toBe(false);
  expect(bursts[2]!.particles.some((p) => p.kind === 'confetti')).toBe(true);
  expect(bursts[4]!.rings.length).toBeGreaterThan(bursts[1]!.rings.length);
});

test('solo la épica y la legendaria destellan, y solo la legendaria hace temblar la pantalla', () => {
  const [common, , rare, epic, legendary] = TIERS.map((t) => burstFor(t, '7', 1280, 720));
  expect(common!.flash).toBe(0);
  expect(rare!.flash).toBe(0);
  expect(epic!.flash).toBeGreaterThan(0);
  expect(legendary!.flash).toBeGreaterThan(epic!.flash);
  expect(epic!.shake).toBe(false);
  expect(legendary!.shake).toBe(true);
});

test('la misma tirada da siempre el mismo estallido', () => {
  expect(burstFor('legendary', '12345', 1280, 720)).toEqual(burstFor('legendary', '12345', 1280, 720));
  expect(burstFor('legendary', '12345', 1280, 720)).not.toEqual(burstFor('legendary', '54321', 1280, 720));
});

test('las partículas caen, se apagan y desaparecen', () => {
  let ps = burstFor('rare', '9', 1280, 720).particles;
  const y0 = ps[0]!.y;
  ps = stepParticles(ps, 0.2);
  expect(ps[0]!.life).toBeCloseTo(0.2, 6);
  expect(ps[0]!.y).not.toBe(y0);
  for (let i = 0; i < 60; i++) ps = stepParticles(ps, 0.1);
  expect(ps).toHaveLength(0);
});
