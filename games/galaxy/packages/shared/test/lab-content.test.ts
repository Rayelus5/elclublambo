import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { DEFAULT_LAB_NODES, labCost, type LabNode, nodeTotal, parseConfig } from '../src/index';

// The expanded Laboratorio (shop and lab plan, F2b), as ops/launch/2026-11-12-laboratorio/lab.json brings it and the
// Season 2 template's core (ops/plantillas/temporada/lab.json): today's 16 nodes stay exactly as they are, the new
// ones hang from them a little weaker each level and dearer each ring, no node uses a stat that a percentage would
// misname, the permanent tree takes an active player about six months and the season's about 80 % of a season.

const OPS = new URL('../../../ops/', import.meta.url);
const read = (path: string) => JSON.parse(readFileSync(new URL(path, OPS), 'utf8'));
const permanent = parseConfig('lab', read('launch/2026-11-12-laboratorio/lab.json')).nodes;
const season = parseConfig('lab', { ...read('plantillas/temporada/lab.json'), nodes: permanent }).season;

/** What reaching every level of the nodes costs. */
function costOf(nodes: readonly LabNode[]): { dust: number; components: number } {
  let dust = 0;
  let components = 0;
  for (const n of nodes) {
    for (let l = 1; l <= n.max; l++) {
      const c = labCost(n, l);
      dust += c.dust;
      components += c.components;
    }
  }
  return { dust, components };
}

/** How deep a node hangs in its tree (0: a root). */
function depthOf(n: LabNode, tree: readonly LabNode[]): number {
  let d = 0;
  let at: LabNode | undefined = n;
  while (at?.requires) {
    at = tree.find((x) => x.id === at!.requires);
    d++;
  }
  return d;
}

test('los 16 nodos de hoy siguen idénticos y los nuevos cuelgan de ellos', () => {
  for (const n of DEFAULT_LAB_NODES) expect(permanent.find((x) => x.id === n.id)).toEqual(n);
  expect(permanent.length).toBeGreaterThanOrEqual(100);
  const branches = new Map<string, number>();
  for (const n of permanent) branches.set(n.branch, (branches.get(n.branch) ?? 0) + 1);
  for (const count of branches.values()) expect(count).toBeGreaterThanOrEqual(24);
  // Every new node hangs from another (only today's four roots stand alone).
  expect(permanent.filter((n) => n.requires === null).map((n) => n.id).sort()).toEqual(['hull', 'magnet', 'resonance', 'throughput']);
});

test('los nuevos dan algo menos cada nivel y cuestan más cuanto más hondos', () => {
  const fresh = permanent.filter((n) => !DEFAULT_LAB_NODES.some((d) => d.id === n.id));
  for (const n of fresh) {
    expect(n.falloff).toBeGreaterThanOrEqual(0.85);
    expect(n.falloff).toBeLessThan(1);
  }
  const byDepth = new Map<number, number[]>();
  for (const n of fresh) byDepth.set(depthOf(n, permanent), [...(byDepth.get(depthOf(n, permanent)) ?? []), n.cost.components]);
  const depths = [...byDepth.keys()].sort((a, b) => a - b);
  for (let i = 1; i < depths.length; i++) expect(Math.min(...byDepth.get(depths[i]!)!)).toBeGreaterThanOrEqual(Math.max(...byDepth.get(depths[i - 1]!)!));
});

test('ningún nodo usa una estadística que un porcentaje nombraría mal', () => {
  for (const n of [...permanent, ...season]) {
    if (n.effect.kind === 'stat') expect(['regen', 'projectiles', 'pierce', 'curse']).not.toContain(n.effect.stat);
  }
});

test('el árbol permanente lleva unos seis meses a un jugador activo', () => {
  // PRE, November 2026: an active player earns ~2,600 dust and ~260 components a day; half the dust goes to the lab.
  const { dust, components } = costOf(permanent);
  const days = Math.max(dust / 1300, components / 260);
  expect(days).toBeGreaterThan(150);
  expect(days).toBeLessThan(220);
});

test('el núcleo de temporada: 36 nodos de partida, y un jugador activo completa en torno al 80 % en cuatro semanas', () => {
  expect(season).toHaveLength(36);
  for (const n of season) expect(['stat', 'payout']).toContain(n.effect.kind);
  const { dust, components } = costOf(season);
  // A season is 28 days; beside the permanent tree, ~700 dust and ~60 components a day go to the season's core.
  const days80 = Math.max((0.8 * dust) / 700, (0.8 * components) / 60);
  expect(days80).toBeGreaterThan(20);
  expect(days80).toBeLessThan(32);
});

test('al máximo, los combates no cambian de golpe: cada estadística sube poco sobre lo de hoy', () => {
  const sum = (nodes: readonly LabNode[], stat: string) => nodes.filter((n) => n.effect.kind === 'stat' && n.effect.stat === stat).reduce((a, n) => a + nodeTotal(n, n.max), 0);
  const both = [...permanent, ...season];
  expect(sum(both, 'damage') - sum(DEFAULT_LAB_NODES, 'damage')).toBeLessThan(0.12);
  expect(sum(both, 'maxHp') - sum(DEFAULT_LAB_NODES, 'maxHp')).toBeLessThan(0.22);
  expect(sum(both, 'cooldown')).toBeLessThan(0.13);
  expect(sum(both, 'barrier')).toBeLessThan(0.12);
});
