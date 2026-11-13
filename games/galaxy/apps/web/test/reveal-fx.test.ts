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

// The «Mítica» (plan «rareza Mítica» M1): at least everything a legendary has, in the four iridescent tones.
test('una mítica estalla al menos como una legendaria: más partículas, destello, temblor y haces, en tonos iridiscentes', () => {
  const legendary = burstFor('legendary', '7', 1280, 720);
  const mythic = burstFor('mythic', '7', 1280, 720);
  expect(mythic.particles.length).toBeGreaterThan(legendary.particles.length);
  expect(mythic.rings.length).toBeGreaterThanOrEqual(legendary.rings.length);
  expect(mythic.flash).toBeGreaterThanOrEqual(legendary.flash);
  expect(mythic.flash).toBeLessThanOrEqual(0.7);
  expect(mythic.shake).toBe(true);
  expect(mythic.beams).toBeGreaterThan(0);
  const colors = new Set(mythic.particles.map((p) => p.color.toLowerCase()));
  for (const iris of ['#ff4fd8', '#6fe3ff', '#ffc94a', '#b39dff']) expect(colors.has(iris)).toBe(true);
});

// Plan «rareza Mítica» M2: on top of all that, a Mítica alone gets a single flash that sweeps through the four
// iridescent tones (never brighter than the legendary's), twice the beams and a longer shake (never a stronger one).
const IRIS = ['#ff4fd8', '#6fe3ff', '#ffc94a', '#b39dff'];

test('el destello de una mítica recorre los cuatro tonos iridiscentes, una sola vez y sin pasar del tope', () => {
  const mythic = burstFor('mythic', '7', 1280, 720);
  expect(mythic.flashTones).toEqual(IRIS);
  expect(mythic.flash).toBeGreaterThan(0);
  expect(mythic.flash).toBeLessThanOrEqual(0.7);
  // One flash, slow enough to never strobe: well over a third of a second, under one and a half.
  expect(mythic.flashMs).toBeGreaterThan(1000 / 3);
  expect(mythic.flashMs).toBeLessThanOrEqual(1500);
  for (const tier of TIERS.filter((t) => t !== 'mythic')) expect(burstFor(tier, '7', 1280, 720).flashTones).toEqual([]);
});

test('una mítica tiene el doble de haces que una legendaria; por debajo, como siempre', () => {
  const beams = TIERS.map((t) => burstFor(t, '7', 1280, 720).beams);
  expect(beams).toEqual([0, 0, 0, 1, 1, 2]);
});

test('una mítica tiembla más rato que una legendaria, nunca más fuerte; las demás no tiemblan', () => {
  const legendary = burstFor('legendary', '7', 1280, 720);
  const mythic = burstFor('mythic', '7', 1280, 720);
  expect(legendary.shakeMs).toBe(450);
  expect(mythic.shakeMs).toBeGreaterThan(legendary.shakeMs);
  expect(mythic.shakeMs).toBeLessThanOrEqual(1200);
  for (const tier of ['common', 'uncommon', 'rare', 'epic'] as const) expect(burstFor(tier, '7', 1280, 720).shakeMs).toBe(0);
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
