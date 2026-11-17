import { expect, test } from 'vitest';
import { galaxyOfSeed, generateGalaxy, LEGENDARY, MYTHIC, SHOWCASE_SEEDS, showcaseExample } from '../src/index';

// The scanner's showcase (2026-11-17, the owner: «Escaparate de premios»): real legendaries and mythics found lately,
// topped up with fixed examples when there are not enough. An example is a known galaxy seed: its traits, name and tier
// come from the seed alone, exactly as the engine draws it.

test('una galaxia se rehace entera desde su semilla: rasgos, nombre, designación y rareza', () => {
  const g = generateGalaxy(20261117000n, LEGENDARY);
  const again = galaxyOfSeed(g.seed);
  expect(again.traits).toEqual(g.traits);
  expect(again.name).toBe(g.name);
  expect(again.designation).toBe(g.designation);
  expect(again.tier).toBe(LEGENDARY);
});

test('los ejemplos del escaparate son cuatro legendarias y dos míticas, de verdad', () => {
  expect(SHOWCASE_SEEDS.filter((s) => s.tier === LEGENDARY)).toHaveLength(4);
  expect(SHOWCASE_SEEDS.filter((s) => s.tier === MYTHIC)).toHaveLength(2);
  for (const s of SHOWCASE_SEEDS) expect(galaxyOfSeed(BigInt(s.seed)).tier).toBe(s.tier);
});

test('un ejemplo sale como una galaxia de tirada, marcada como ejemplo', () => {
  const ex = showcaseExample(SHOWCASE_SEEDS[0]!);
  expect(ex).toMatchObject({ id: `example-${SHOWCASE_SEEDS[0]!.seed}`, seed: SHOWCASE_SEEDS[0]!.seed, tier: 'legendary', finish: 'normal', featured: false, example: true });
  expect(ex.name.length).toBeGreaterThan(0);
});
