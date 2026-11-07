import type { StatKey } from '@galaxy/sim';
import { describe, expect, test } from 'vitest';
import { labCost, labEffects, labNodeStatus, labUpgradeSchema, parseConfig, probeLevelBonuses } from '../src/index';

// The Laboratorio (GDD §10.6): an upgrade tree with four branches (probe, relics, station, extraction), many small
// nodes with levels and rising costs, paid with star dust and components; its effects reach the runs, the station and
// the collection, always through the brakes of §8.6.

const cfg = parseConfig('lab', {});
const node = (id: string) => cfg.nodes.find((n) => n.id === id)!;
const all = Object.fromEntries(cfg.nodes.map((n) => [n.id, n.max]));

describe('el árbol', () => {
  test('16 nodos, 4 por rama, y una raíz en cada rama', () => {
    expect(cfg.nodes).toHaveLength(16);
    for (const branch of ['probe', 'relics', 'station', 'extraction'] as const) {
      const nodes = cfg.nodes.filter((n) => n.branch === branch);
      expect(nodes, branch).toHaveLength(4);
      expect(nodes.filter((n) => n.requires === null), branch).toHaveLength(1);
      for (const n of nodes) if (n.requires) expect(node(n.requires).branch, n.id).toBe(branch);
    }
  });

  test('cada nivel cuesta más que el anterior', () => {
    expect(labCost(node('hull'), 1)).toEqual({ dust: 40, components: 15 });
    expect(labCost(node('hull'), 5)).toEqual({ dust: 262, components: 98 });
    expect(labCost(node('reactor'), 1)).toEqual({ dust: 100, components: 40 });
  });

  test('un nodo se abre cuando su requisito tiene nivel y deja de crecer en su máximo', () => {
    expect(labNodeStatus(node('thrusters'), {}, cfg)).toMatchObject({ level: 0, max: 5, unlocked: false });
    expect(labNodeStatus(node('thrusters'), { hull: 1 }, cfg)).toMatchObject({ level: 0, unlocked: true, next: { dust: 60, components: 20 } });
    expect(labNodeStatus(node('hull'), { hull: 5 }, cfg)).toMatchObject({ level: 5, unlocked: true, next: null });
  });
});

describe('los efectos', () => {
  test('lo comprado se suma por efecto', () => {
    const fx = labEffects({ hull: 2, targeting: 5, ledger: 3, throughput: 4, silos: 1, receiver: 2, recycling: 5, 'stable-fusion': 1, nope: 3, thrusters: 9 }, cfg);
    const stat = (s: StatKey) => fx.bonuses.find((b) => b.stat === s)?.value;
    expect(stat('maxHp')).toBeCloseTo(0.04, 9);
    expect(stat('damage')).toBeCloseTo(0.1, 9);
    // A level above the node's max is clipped (thrusters: 5 × 1 %).
    expect(stat('speed')).toBeCloseTo(0.05, 9);
    expect(fx.payout.coins).toBeCloseTo(0.06, 9);
    expect(fx.payout.dust).toBe(0);
    expect(fx.refinery.rate).toBeCloseTo(0.2, 9);
    expect(fx.refinery.queue).toBeCloseTo(0.1, 9);
    expect(fx.antenna).toBeCloseTo(0.1, 9);
    expect(fx.disintegrate).toBeCloseTo(0.2, 9);
    expect(fx.fusion).toBeCloseTo(0.04, 9);
  });

  test('sin nada comprado, nada', () => {
    const fx = labEffects({}, cfg);
    expect(fx.bonuses).toEqual([]);
    expect(fx.payout).toEqual({ coins: 0, dust: 0, material: 0 });
    expect(fx.refinery).toEqual({ rate: 0, queue: 0 });
    expect([fx.antenna, fx.disintegrate, fx.fusion]).toEqual([0, 0, 0]);
  });

  test('todo al máximo más el nivel 10 de la sonda son los bonos del campo de pruebas', () => {
    // packages/sim/test/proving.ts VETERAN: the ceilings hold for the strongest probe the player can have.
    const total = new Map<string, number>();
    for (const b of [...probeLevelBonuses(10, parseConfig('probes', {})), ...labEffects(all, cfg).bonuses]) total.set(b.stat, (total.get(b.stat) ?? 0) + b.value);
    const expected: Record<string, number> = { maxHp: 0.37, damage: 0.28, speed: 0.05, cooldown: 0.05, elemental: 0.15, luck: 0.15, pickup: 0.2, xp: 0.1 };
    expect([...total.keys()].sort()).toEqual(Object.keys(expected).sort());
    for (const [stat, value] of Object.entries(expected)) expect(total.get(stat), stat).toBeCloseTo(value, 9);
  });
});

describe('la configuración', () => {
  const tree = (nodes: unknown[]) => () => parseConfig('lab', { nodes });
  const n = (over: Record<string, unknown>) => ({
    id: 'a',
    branch: 'probe',
    name: 'A',
    effect: { kind: 'stat', stat: 'maxHp' },
    per: 0.02,
    max: 5,
    requires: null,
    cost: { dust: 10, components: 5 },
    growth: 1.5,
    ...over,
  });

  test('rechaza un requisito que no existe, un ciclo, un efecto grande y una fusión de más de la mitad', () => {
    expect(tree([n({}), n({ id: 'b', requires: 'zz' })])).toThrow();
    expect(tree([n({ requires: 'b' }), n({ id: 'b', requires: 'a' })])).toThrow();
    expect(tree([n({ per: 0.3 })])).toThrow();
    expect(tree([n({ effect: { kind: 'fusion' }, per: 0.12, max: 5 })])).toThrow();
    expect(tree([n({ effect: { kind: 'payout', currency: 'coins' }, per: 0.11, max: 5 })])).toThrow();
    expect(tree([n({}), n({ id: 'a' })])).toThrow();
    expect(tree([n({}), n({ id: 'b', requires: 'a', effect: { kind: 'refinery', field: 'rate' } })])).not.toThrow();
  });

  test('mejorar un nodo dice a qué nivel', () => {
    expect(labUpgradeSchema.parse({ level: 1 })).toEqual({ level: 1 });
    expect(() => labUpgradeSchema.parse({ level: 0 })).toThrow();
    expect(() => labUpgradeSchema.parse({ level: 2, x: 1 })).toThrow();
  });
});
