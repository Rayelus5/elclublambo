import { describe, expect, test } from 'vitest';
import { configIssues, labEffects, labNodeStatus, labUpgradeSchema, nodeNextGain, nodeTotal, openSeasonId, parseConfig } from '../src/index';

// The Laboratorio has two cores (shop and lab plan, F2a): the permanent tree, kept forever, and the season's tree,
// renewed every season (its levels are kept by season id, so a new season starts it empty). Both add up within the
// same brakes; the season's tree only gives what a run uses (stats and pay), never the station's machines (they run
// lazily over time, and a reset in the middle would change the past) nor the collection. Each node can give a little
// less per level (`falloff`).

const base = parseConfig('lab', {});
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
const lab = (season: unknown[], nodes: unknown[] = base.nodes) => parseConfig('lab', { nodes, season });
const messages = (data: unknown) => configIssues('lab', data).map((i) => i.message);

describe('los dos núcleos en la configuración', () => {
  test('el de temporada está vacío por defecto y lo publicado antes sigue valiendo, con los nodos de siempre', () => {
    expect(base.season).toEqual([]);
    // A config published before the seasonal core: no `season`, no `falloff`/`at` on its nodes.
    const old = parseConfig('lab', { nodes: [n({})] });
    expect(old.season).toEqual([]);
    expect(old.nodes[0]).toMatchObject({ falloff: 1, at: null });
  });

  test('los ids no se repiten entre los dos árboles y cada requisito está en su propio árbol', () => {
    expect(messages({ nodes: [n({})], season: [n({})] })).toContain('lab_duplicate:a');
    expect(messages({ nodes: [n({})], season: [n({ id: 's', requires: 'a' })] })).toContain('lab_requires:s');
    expect(messages({ nodes: [n({})], season: [n({ id: 's' }), n({ id: 't', requires: 's' })] })).toEqual([]);
  });

  test('el de temporada solo da estadísticas y cobro de partida: ni las máquinas de la estación ni la colección', () => {
    for (const effect of [{ kind: 'refinery', field: 'rate' }, { kind: 'antenna' }, { kind: 'disintegrate' }, { kind: 'fusion' }]) {
      expect(messages({ nodes: [n({})], season: [n({ id: 's', effect })] })).toContain('lab_season_kind:s');
    }
    expect(messages({ nodes: [n({})], season: [n({ id: 's', effect: { kind: 'payout', currency: 'dust' } })] })).toEqual([]);
    expect(messages({ nodes: [n({})], season: [n({ id: 's', effect: { kind: 'stat', stat: 'luck' } })] })).toEqual([]);
  });

  test('el tope de cobro se suma entre los dos árboles', () => {
    const coins = (id: string) => n({ id, effect: { kind: 'payout', currency: 'coins' }, per: 0.06, max: 5 });
    expect(messages({ nodes: [coins('a')], season: [coins('s')] })).toContain('lab_payout_cap:coins');
  });

  test('una estadística no puede pasar de su presupuesto con los dos árboles al máximo', () => {
    const big = (id: string) => n({ id, per: 0.1, max: 6 });
    expect(messages({ nodes: [big('a')], season: [] })).toEqual([]);
    expect(messages({ nodes: [big('a')], season: [big('s')] })).toContain('lab_stat_cap:maxHp');
  });
});

describe('el rendimiento por nivel', () => {
  test('con falloff 1 cada nivel da lo mismo, como hasta ahora', () => {
    const a = lab([], [n({})]).nodes[0]!;
    expect(nodeTotal(a, 3)).toBeCloseTo(0.06, 9);
    expect(nodeNextGain(a, 3)).toBeCloseTo(0.02, 9);
    expect(nodeNextGain(a, 5)).toBe(0);
  });

  test('con falloff cada nivel da un poco menos que el anterior', () => {
    const a = lab([], [n({ falloff: 0.5 })]).nodes[0]!;
    expect(nodeTotal(a, 1)).toBeCloseTo(0.02, 9);
    expect(nodeTotal(a, 3)).toBeCloseTo(0.02 + 0.01 + 0.005, 9);
    expect(nodeNextGain(a, 3)).toBeCloseTo(0.0025, 9);
  });
});

describe('los efectos de los dos núcleos', () => {
  const cfg = lab([n({ id: 'swarm', effect: { kind: 'stat', stat: 'damage' }, per: 0.03 }), n({ id: 'harvest', effect: { kind: 'payout', currency: 'dust' }, per: 0.04 })]);

  test('el de temporada suma su propia bonificación, aparte de la permanente (la simulación las suaviza juntas)', () => {
    const fx = labEffects({ targeting: 2 }, cfg, { swarm: 3, harvest: 2 });
    expect(fx.bonuses.filter((b) => b.stat === 'damage').map((b) => b.value)).toEqual([expect.closeTo(0.04, 9), expect.closeTo(0.09, 9)]);
    expect(fx.payout.dust).toBeCloseTo(0.08, 9);
  });

  test('sin temporada abierta, el de temporada no da nada', () => {
    const fx = labEffects({ targeting: 2 }, cfg, null);
    expect(fx.bonuses.filter((b) => b.stat === 'damage')).toHaveLength(1);
    expect(fx.payout.dust).toBe(0);
  });

  test('un nodo de temporada se abre cuando su requisito de la temporada tiene nivel', () => {
    const tree = lab([n({ id: 's' }), n({ id: 't', requires: 's' })]).season;
    expect(labNodeStatus(tree[1]!, {}, tree)).toMatchObject({ unlocked: false });
    expect(labNodeStatus(tree[1]!, { s: 1 }, tree)).toMatchObject({ unlocked: true });
  });
});

describe('la temporada abierta', () => {
  const season = parseConfig('season', { id: 'season-2', startsAt: '2026-12-07T23:00:00.000Z', endsAt: '2027-01-04T23:00:00.000Z' });

  test('el id de la temporada solo mientras está abierta', () => {
    expect(openSeasonId(season, new Date('2026-12-20T12:00:00Z'))).toBe('season-2');
    expect(openSeasonId(season, new Date('2026-12-07T22:59:59Z'))).toBeNull();
    expect(openSeasonId(season, new Date('2027-01-04T23:00:00Z'))).toBeNull();
  });

  test('mejorar un nodo de temporada dice de qué temporada es', () => {
    expect(labUpgradeSchema.parse({ level: 2, season: 'season-2' })).toEqual({ level: 2, season: 'season-2' });
    expect(labUpgradeSchema.parse({ level: 2 })).toEqual({ level: 2 });
    expect(() => labUpgradeSchema.parse({ level: 2, season: 'Mal Id' })).toThrow();
  });
});
