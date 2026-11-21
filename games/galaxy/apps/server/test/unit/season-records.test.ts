import { parseConfig, seasonConfigOf } from '@galaxy/shared';
import { describe, expect, test } from 'vitest';
import { HttpError } from '../../src/errors';
import { type SeasonRow, type SeasonStore, seasonAwareConfig } from '../../src/season/records';
import { fixedConfig } from '../helpers';

// Seasons as records (plan «temporadas como fichas», 2026-11-21): the live config keeps being read as before, but
// `season`, `seasonRoute`, `missions.season` and `lab.season` come from the season a moment belongs to. The old keys
// can no longer be published (seasons are prepared and scheduled as records).

const route = (name: string) => parseConfig('seasonRoute', { currency: { name, perPoint: 0.25, dustRate: 2 } });
const row = (id: string, startsAt: string, endsAt: string, over: Partial<SeasonRow> = {}): SeasonRow => {
  const { id: _i, name: _n, startsAt: _s, endsAt: _e, ...rules } = seasonConfigOf({ id, name: id.toUpperCase(), startsAt, endsAt, rules: { anomaly: 'contagion' } });
  return { id, name: id.toUpperCase(), startsAt, endsAt, state: 'scheduled', rules, route: route(`Moneda ${id}`), missions: [], lab: [], version: 1, announcedAt: null, ...over };
};
const store = (rows: SeasonRow[]): SeasonStore => ({ list: async () => rows, invalidate: () => {} });
const S1 = row('season-1', '2026-11-12T23:00:00.000Z', '2026-11-22T23:00:00.000Z');
const S2 = row('season-2', '2026-11-22T23:00:00.000Z', '2026-12-30T23:00:00.000Z', {
  missions: [parseConfig('missions', {}).daily.pool[0]!].map((m) => ({ ...m, id: 's2-runs' })),
});
const base = fixedConfig({ season: { id: 'legacy', name: 'Antigua', startsAt: '2026-01-01T00:00:00.000Z', endsAt: '2026-02-01T00:00:00.000Z' }, seasonRoute: { currency: { name: 'Vieja', perPoint: 1, dustRate: 1 } } });
const at = (iso: string) => () => new Date(iso);

describe('el lector de configuración con temporadas como fichas', () => {
  test('la temporada, la ruta, las misiones de temporada y el árbol de temporada salen de la ficha abierta', async () => {
    const config = seasonAwareConfig(base, store([S1, S2]), at('2026-11-25T12:00:00.000Z'));
    expect((await config.get('season')).id).toBe('season-2');
    expect((await config.get('season')).anomaly).toBe('contagion');
    expect((await config.get('seasonRoute')).currency.name).toBe('Moneda season-2');
    expect((await config.get('missions')).season.map((m) => m.id)).toEqual(['s2-runs']);
    expect((await config.get('missions')).daily).toEqual((await base.get('missions')).daily);
    expect((await config.get('lab')).season).toEqual([]);
  });

  test('a las 00:00 en punto pasa de una a otra', async () => {
    expect((await seasonAwareConfig(base, store([S1, S2]), at('2026-11-22T22:59:59.999Z')).get('season')).id).toBe('season-1');
    expect((await seasonAwareConfig(base, store([S1, S2]), at('2026-11-22T23:00:00.000Z')).get('season')).id).toBe('season-2');
  });

  test('entre temporadas se ve la última que acabó; sin fichas, lo de siempre', async () => {
    expect((await seasonAwareConfig(base, store([S1]), at('2026-11-28T00:00:00.000Z')).get('season')).id).toBe('season-1');
    expect((await seasonAwareConfig(base, store([]), at('2026-11-28T00:00:00.000Z')).get('season')).id).toBe('legacy');
    expect((await seasonAwareConfig(base, store([]), at('2026-11-28T00:00:00.000Z')).get('seasonRoute')).currency.name).toBe('Vieja');
  });

  test('getVersioned y active() dan lo mismo que get', async () => {
    const config = seasonAwareConfig(base, store([S1, S2]), at('2026-11-25T12:00:00.000Z'));
    expect((await config.getVersioned('season')).value.id).toBe('season-2');
    const keys = new Set(['season', 'seasonRoute', 'missions', 'lab']);
    const live = seasonAwareConfig({ ...base, active: async () => [...keys].map((key) => ({ key, version: 3, data: {} })) }, store([S1, S2]), at('2026-11-25T12:00:00.000Z'));
    const rows = await live.active();
    expect((rows.find((r) => r.key === 'season')!.data as { id: string }).id).toBe('season-2');
    expect((rows.find((r) => r.key === 'seasonRoute')!.data as { currency: { name: string } }).currency.name).toBe('Moneda season-2');
    expect((rows.find((r) => r.key === 'missions')!.data as { season: { id: string }[] }).season.map((m) => m.id)).toEqual(['s2-runs']);
  });

  test('ya no se publican la temporada, su ruta ni las misiones o el laboratorio de temporada a la antigua', async () => {
    const config = seasonAwareConfig(base, store([S1, S2]), at('2026-11-25T12:00:00.000Z'));
    const actor = { id: null, label: 'test' };
    for (const [key, data] of [['season', {}], ['seasonRoute', {}], ['missions', { season: [] }], ['lab', { season: S2.missions.length ? [{ id: 'x' }] : [{ id: 'x' }] }]] as const) {
      await expect(config.publish(key, data, actor, 'motivo')).rejects.toMatchObject({ code: 'season_managed' } satisfies Partial<HttpError>);
      await expect(config.publishMany([{ key, data }], actor, 'motivo')).rejects.toMatchObject({ code: 'season_managed' });
    }
    // A rollback copy (show-config --data) carries the season's own missions or tree as they are: those are let through.
    await expect(config.publish('missions', { daily: { count: 3 }, season: S2.missions }, actor, 'Vuelta atrás')).resolves.toEqual({ version: 0 });
    await expect(config.publish('lab', { season: [] }, actor, 'Vuelta atrás')).resolves.toEqual({ version: 0 });
    // The daily missions and the permanent lab tree keep being published as before.
    await expect(config.publish('missions', { daily: { count: 3 } }, actor, 'motivo')).resolves.toEqual({ version: 0 });
  });

  test('el árbol permanente nuevo tiene que caber con el árbol de cada temporada programada', async () => {
    const lab = parseConfig('lab', {});
    const hull = { id: 't-hull', branch: 'probe' as const, name: 'Casco', effect: { kind: 'stat' as const, stat: 'maxHp' as const }, per: 0.2, max: 4, requires: null, cost: { dust: 1, components: 0 }, growth: 1, falloff: 1, at: null };
    const config = seasonAwareConfig(base, store([S1, { ...S2, lab: [hull] }]), at('2026-11-20T12:00:00.000Z'));
    // 0.1 of the live tree + 0.2 here fits alone (budget 1), but not with the 0.8 of season-2's tree.
    const big = [...lab.nodes, { ...hull, id: 'p-hull', max: 1 }];
    expect(parseConfig('lab', { nodes: big }).nodes).toHaveLength(lab.nodes.length + 1);
    await expect(config.publish('lab', { nodes: big }, { id: null, label: 'test' }, 'motivo')).rejects.toMatchObject({ code: 'config_invalid' });
    await expect(config.publish('lab', { nodes: lab.nodes }, { id: null, label: 'test' }, 'motivo')).resolves.toEqual({ version: 0 });
  });
});
