import { expect, test } from 'vitest';
import { bossIdAt, contentSchema, createSim, DEFAULT_CONTENT, IDLE, scaleAt, type Sim, spawnBoss, step } from '../src/index';
import { quietSim } from './fixtures';

// Each sector's own toughness (open beta launch): its enemies' life and damage are multiplied, from the first sector
// (easiest) to the season's (hardest); content published before keeps 1 for both, so it plays as it did.

test('el sector multiplica la vida y el daño de sus enemigos', () => {
  const base = quietSim();
  const tough = quietSim((c) => {
    c.sectors[0]!.enemyHp = 1.3;
    c.sectors[0]!.enemyDamage = 1.12;
  });
  expect(scaleAt(tough).hp).toBeCloseTo(scaleAt(base).hp * 1.3, 10);
  expect(scaleAt(tough).damage).toBeCloseTo(scaleAt(base).damage * 1.12, 10);
  expect(scaleAt(tough).speed).toBe(scaleAt(base).speed);
});

test('el Núcleo del sector también aguanta más', () => {
  const withBoss = (enemyHp: number): Sim => {
    const sim = quietSim((c) => {
      c.sectors[0]!.layerSeconds = 1;
      c.sectors[0]!.enemyHp = enemyHp;
    });
    sim.probes[0]!.hp = 1e9;
    for (let i = 0; i < 70 && !sim.boss; i++) step(sim, [IDLE]);
    return sim;
  };
  const plain = withBoss(1);
  const tough = withBoss(1.3);
  expect(tough.enemies.hp[tough.boss!.index]).toBeCloseTo(plain.enemies.hp[plain.boss!.index]! * 1.3, 6);
});

// Nov plan B1: how hard a sector plays is its base damage AND how it grows by the minute, measured as a whole by the bot
// (difficulty.test.ts, GALAXY_CALIBRATE=1): the base damage alone no longer rises sector by sector. What stays fixed
// here is the life, rising, and the season's sector at the top of it.
test('del primer sector al de temporada la vida sube y el de temporada es el más duro', () => {
  const sectors = DEFAULT_CONTENT.sectors;
  const hp = sectors.map((s) => s.enemyHp);
  for (let i = 1; i < sectors.length; i++) expect(hp[i]!).toBeGreaterThan(hp[i - 1]!);
  const season = sectors.find((s) => s.season)!;
  expect(season.enemyHp).toBe(Math.max(...hp));
  expect(Math.max(...hp)).toBeLessThanOrEqual(1.35);
});

test('un contenido publicado antes, sin estos campos, juega con 1', () => {
  const old = structuredClone(DEFAULT_CONTENT) as unknown as { sectors: Record<string, unknown>[] };
  for (const s of old.sectors) {
    delete s['enemyHp'];
    delete s['enemyDamage'];
    delete s['coreDamage'];
  }
  const parsed = contentSchema.parse(old);
  expect(parsed.sectors.every((s) => s.enemyHp === 1 && s.enemyDamage === 1 && s.coreDamage === 1)).toBe(true);
});

// Review B, I2: the Núcleo's damage is the sector's own `coreDamage`, rising from the first sector to the season's.
test('el daño de los Núcleos sube de sector en sector y el de temporada es el mayor', () => {
  const sectors = DEFAULT_CONTENT.sectors;
  const core = sectors.filter((s) => !s.season).map((s) => s.coreDamage);
  for (let i = 1; i < core.length; i++) expect(core[i]!).toBeGreaterThan(core[i - 1]!);
  const season = sectors.find((s) => s.season)!;
  expect(season.coreDamage).toBe(Math.max(...sectors.map((s) => s.coreDamage)));
});

// Nov plan B4: the forms take turns, but the Core still grows with every layer and with the sector, whichever form comes.
test('en cada sector la vida del Núcleo sigue creciendo capa a capa, venga la forma que venga, y sigue la dureza del sector', () => {
  for (const s of DEFAULT_CONTENT.sectors) {
    const hpAt = (layer: number) => {
      const sim = createSim({ seed: '1', content: DEFAULT_CONTENT, sector: s.id, probes: [{ probe: 'lumen', relics: [] }] });
      sim.layer = layer;
      spawnBoss(sim);
      expect(sim.boss!.def, `${s.id} capa ${layer}`).toBe(bossIdAt(s, layer));
      const def = DEFAULT_CONTENT.bosses.find((b) => b.id === sim.boss!.def)!;
      expect(sim.enemies.maxHp[sim.boss!.index]).toBeCloseTo(def.hp * (1 + def.scaling.hpPerLayer * (layer - 1)) * s.enemyHp, 6);
      return sim.enemies.maxHp[sim.boss!.index]!;
    };
    const sectorLayers = [1, 2, 3, 5, 6, 7, 9].filter((l) => !s.deepBoss || l % s.deepBoss.every !== 0);
    const hp = sectorLayers.map(hpAt);
    for (let k = 1; k < hp.length; k++) expect(hp[k]!, `${s.id} capa ${sectorLayers[k]}`).toBeGreaterThan(hp[k - 1]!);
    if (s.deepBoss) {
      const deep = [4, 8, 12].map(hpAt);
      expect(deep[1]!).toBeGreaterThan(deep[0]!);
      expect(deep[2]!).toBeGreaterThan(deep[1]!);
    }
  }
});
