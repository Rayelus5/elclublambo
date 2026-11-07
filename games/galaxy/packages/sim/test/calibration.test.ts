import { drawTraits, subRng } from '@galaxy/engine';
import { describe, expect, test } from 'vitest';
import { botInput, botPick, createSim, DEFAULT_CONTENT, deriveStats, type RelicInput, type Sim, spawnEnemy, step } from '../src/index';

// Calibration with bots (GDD §5.6, §8.6): a normal run should reach layer 2–4 in 5–20 minutes, and no random set of
// relics may break the game. The short checks run in every CI; GALAXY_CALIBRATE=1 runs the long ones.

const LONG = process.env['GALAXY_CALIBRATE'] === '1';

/** Bot run until death or `maxTicks` (it never extracts: calibration measures how deep a run gets). */
function botRun(seed: string, maxTicks: number, relics: RelicInput[] = []): Sim {
  const sim = createSim({ seed, content: DEFAULT_CONTENT, sector: 'outer-nebula', probes: [{ probe: 'lumen', relics }] });
  while (sim.tick < maxTicks && (sim.status === 'running' || sim.status === 'choosing')) {
    const p = sim.probes[0]!;
    if (sim.status === 'choosing') step(sim, [{ mx: 0, my: 0, aim: -1, pick: p.offer ? botPick(p.offer) : -1 }]);
    else step(sim, [botInput(sim, 0, 99)]);
  }
  return sim;
}

/** Random relics from the engine's own trait rules (tier and level at random too). */
function randomRelics(k: number, n: number): RelicInput[] {
  return Array.from({ length: n }, (_, j) => {
    const seed = BigInt(k * 97 + j * 13 + 1);
    const traits = drawTraits(subRng(seed, 'traits')) as unknown as Record<string, string>;
    return { id: `${k}-${j}`, seed: seed.toString(), tier: Number(seed % 5n), level: 1 + Number(seed % 10n), traits };
  });
}

/** Damage per second against a field of sturdy, still targets around the probe (no movement, no danger). */
function fieldDps(relics: RelicInput[], seconds: number): number {
  const content = structuredClone(DEFAULT_CONTENT);
  content.sectors[0]!.density = { ...content.sectors[0]!.density, base: 0, perMinute: 0, max: 0 };
  content.sectors[0]!.waves = [];
  content.sectors[0]!.layerSeconds = 100_000;
  content.enemies.push({ ...content.enemies[0]!, id: 'post', hp: 1e9, speed: 0 });
  const post = content.enemies[content.enemies.length - 1]!;
  const sim = createSim({ seed: '5', content, sector: 'outer-nebula', probes: [{ probe: 'lumen', relics }] });
  for (let r = 1; r <= 4; r++) for (let k = 0; k < 8; k++) spawnEnemy(sim, post, Math.cos((k * Math.PI) / 4) * r * 45, Math.sin((k * Math.PI) / 4) * r * 45);
  sim.probes[0]!.hp = 1e12;
  let dealt = 0;
  for (let t = 0; t < seconds * 60; t++) {
    step(sim, [{ mx: 0, my: 0, aim: -1, pick: -1 }]);
    for (const e of sim.events) if (e.t === 'hit') dealt += e.amount;
  }
  return dealt / seconds;
}

describe('calibración corta (CI)', () => {
  test('con la sonda inicial y sin reliquias, el bot aguanta 3 minutos de la capa 1', () => {
    for (const seed of ['1', '2', '3']) {
      const sim = botRun(seed, 3 * 3600);
      expect(sim.status, `semilla ${seed}`).not.toBe('dead');
    }
  });

  test('ninguna combinación al azar pasa de 8× el daño mediano, las extremas de 40×, y nadie rompe los topes', () => {
    const random: RelicInput[][] = Array.from({ length: 24 }, (_, k) => randomRelics(k, 2 + (k % 5)));
    // The extremes: six Legendary galaxies at level 10 with every multiplier at its best (GDD §8.6: the brakes stop
    // a build from breaking the game, not a Legendary from shining).
    const legend = (type: string, extra: Record<string, string>): RelicInput[] =>
      Array.from({ length: 6 }, (_, j) => ({
        id: `${type}${j}`,
        seed: '9',
        tier: 4,
        level: 10,
        traits: { galaxy_type: type, size: 'colossal', core: 'quasar', star_density: 'saturated', palette: 'solar_gold', background: 'cmb', phenomenon: 'supernova', ...extra },
      }));
    const extremes = [legend('spiral', { arms: '6', inclination: 'face_on' }), legend('barred_spiral', { arms: '6', inclination: 'edge_on' })];
    const dps = random.map((b) => fieldDps(b, 10));
    const median = [...dps].sort((a, b) => a - b)[Math.floor(dps.length / 2)]!;
    expect(Math.max(...dps)).toBeLessThanOrEqual(8 * median);
    for (const b of extremes) expect(fieldDps(b, 10)).toBeLessThanOrEqual(40 * median);
    for (const b of [...random, ...extremes]) {
      const sim = createSim({ seed: '1', content: DEFAULT_CONTENT, sector: 'outer-nebula', probes: [{ probe: 'lumen', relics: b }] });
      const s = deriveStats(sim, sim.probes[0]!);
      expect(s.cooldown).toBeGreaterThanOrEqual(0.4);
      expect(s.projectiles).toBeLessThanOrEqual(6);
      expect(s.armor).toBeLessThanOrEqual(0.7);
    }
  });
});

describe.skipIf(!LONG)('calibración larga (GALAXY_CALIBRATE=1)', () => {
  test('una partida normal llega a la capa 2–4 en 5–20 minutos', () => {
    // A normal player's build: the welcome scan guarantees a Legendary, plus an Uncommon from the same pulls.
    const typical = (seed: string): RelicInput[] =>
      [4, 1].map((tier, j) => {
        const s = BigInt(seed) * 31n + BigInt(j);
        return { id: `${seed}-${j}`, seed: s.toString(), tier, level: 1, traits: drawTraits(subRng(s, 'traits')) as unknown as Record<string, string> };
      });
    const runs = ['11', '12', '13', '14', '15'].map((seed) => botRun(seed, 40 * 3600, typical(seed)));
    const minutes = runs.map((s) => s.tick / 3600);
    const layers = runs.map((s) => s.layer);
    console.log('calibración:', runs.map((s, i) => `capa ${layers[i]} a los ${minutes[i]!.toFixed(1)} min, nivel ${s.probes[0]!.level}`).join(' · '));
    const avgMin = minutes.reduce((a, b) => a + b, 0) / runs.length;
    const avgLayer = layers.reduce((a, b) => a + b, 0) / runs.length;
    expect(avgMin).toBeGreaterThanOrEqual(5);
    expect(avgMin).toBeLessThanOrEqual(20);
    expect(avgLayer).toBeGreaterThanOrEqual(2);
    expect(avgLayer).toBeLessThanOrEqual(4);
  }, 600_000);

  test('200 combinaciones al azar en 20 s tampoco pasan de 8× la mediana', () => {
    const dps = Array.from({ length: 200 }, (_, k) => fieldDps(randomRelics(k + 1000, 2 + (k % 5)), 20));
    const sorted = [...dps].sort((a, b) => a - b);
    expect(Math.max(...dps)).toBeLessThanOrEqual(8 * sorted[100]!);
  }, 600_000);
});
