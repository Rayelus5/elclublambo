import { describe, expect, test } from 'vitest';
import { configSchemas, currentSeason, isMadridMidnight, madridDayOf, madridMidnightOf, parseConfig, seasonCalendarWarnings, seasonConfigOf, seasonRecordIssues, seasonRecordSchema, shownSeason } from '../src';

// Seasons as records (plan «temporadas como fichas», 2026-11-21): a season is a row with its dates, rules, route,
// missions and lab tree; the season a moment belongs to is the scheduled one open then, or between seasons the last
// that ended.

const T2 = {
  id: 'season-2',
  name: 'Temporada 2',
  startsAt: '2026-11-22T23:00:00.000Z',
  endsAt: '2026-12-30T23:00:00.000Z',
  rules: { points: { layer: 20, core: 100, extraction: 50 }, tiers: [2000, 8000, 22000, 55000, 135000], top: 100, capPerMinute: 20, anomaly: 'contagion', finish: 'rift', finishChance: 0.02 },
};

describe('la ficha de una temporada', () => {
  test('una ficha mínima se completa con los valores por defecto de la ruta, las misiones y el laboratorio', () => {
    const r = seasonRecordSchema.parse(T2);
    expect(r.route.currency.name).toBe('Esquirlas');
    expect(r.missions).toEqual([]);
    expect(r.lab).toEqual([]);
  });

  test('sus reglas, con id, nombre y fechas, son exactamente lo que leía la clave season', () => {
    const r = seasonRecordSchema.parse(T2);
    expect(seasonConfigOf(r)).toEqual(parseConfig('season', { ...T2.rules, id: T2.id, name: T2.name, startsAt: T2.startsAt, endsAt: T2.endsAt }));
  });

  test('las reglas se comprueban con el esquema de la temporada (tramos crecientes, anomalía con forma de id)', () => {
    const bad = seasonRecordIssues({ ...T2, rules: { ...T2.rules, tiers: [5, 4, 3, 2, 1] } });
    expect(bad.map((i) => i.path)).toContain('rules.tiers');
  });

  test('las reglas no repiten id, nombre ni fechas (van fuera)', () => {
    expect(seasonRecordIssues({ ...T2, rules: { ...T2.rules, id: 'otra' } }).map((i) => i.message)).toContain('season_rules_field:id');
  });

  test('empieza y acaba a medianoche de Madrid, y acaba después de empezar', () => {
    expect(seasonRecordIssues({ ...T2, startsAt: '2026-11-23T10:00:00.000Z' }).map((i) => i.message)).toContain('season_midnight');
    expect(seasonRecordIssues({ ...T2, endsAt: T2.startsAt }).map((i) => i.message)).toContain('season_dates');
  });

  test('las misiones de la temporada no repiten id', () => {
    const m = { id: 's-runs', name: 'Juega', stat: 'runs', target: 10, reward: { coins: 10 } };
    expect(seasonRecordIssues({ ...T2, missions: [m, m] }).map((i) => i.message)).toContain('mission_duplicate:s-runs');
  });

  test('su árbol de laboratorio cabe con el árbol permanente vivo (el mismo presupuesto que la clave lab)', () => {
    const lab = parseConfig('lab', {});
    const huge = [{ id: 't-hull', branch: 'probe', name: 'Casco', effect: { kind: 'stat', stat: 'maxHp' }, per: 0.2, max: 10, cost: { dust: 1, components: 0 }, requires: null, growth: 1 }];
    const issues = seasonRecordIssues({ ...T2, lab: huge }, { labNodes: lab.nodes });
    expect(issues.some((i) => i.path === 'lab' && i.message.startsWith('lab_stat_cap'))).toBe(true);
  });

  test('la anomalía tiene que existir en el contenido cuando se sabe cuál hay', () => {
    expect(seasonRecordIssues({ ...T2, rules: { ...T2.rules, anomaly: 'no-existe' } }, { anomalies: ['contagion'] }).map((i) => i.message)).toContain('season_anomaly_unknown');
    expect(seasonRecordIssues(T2, { anomalies: ['contagion'] })).toEqual([]);
  });
});

describe('qué temporada se ve en cada momento', () => {
  const s1 = { id: 'season-1', state: 'closed' as const, startsAt: '2026-11-12T23:00:00.000Z', endsAt: '2026-11-22T23:00:00.000Z' };
  const s2 = { id: 'season-2', state: 'scheduled' as const, startsAt: '2026-11-22T23:00:00.000Z', endsAt: '2026-12-30T23:00:00.000Z' };
  const s3 = { id: 'season-3', state: 'draft' as const, startsAt: '2026-12-30T23:00:00.000Z', endsAt: '2027-02-28T23:00:00.000Z' };
  const at = (iso: string) => Date.parse(iso);

  test('a las 00:00 en punto cambia de la que acaba a la que empieza', () => {
    expect(currentSeason([s1, s2], at('2026-11-22T22:59:59.999Z'))?.id).toBeUndefined();
    expect(currentSeason([{ ...s1, state: 'scheduled' }, s2], at('2026-11-22T22:59:59.999Z'))?.id).toBe('season-1');
    expect(currentSeason([s1, s2], at('2026-11-22T23:00:00.000Z'))?.id).toBe('season-2');
  });

  test('entre temporadas se ve la última que acabó (su nombre y su moneda); un borrador nunca cuenta', () => {
    expect(shownSeason([s1, s2, s3], at('2027-01-05T00:00:00.000Z'))?.id).toBe('season-2');
    expect(currentSeason([s1, s2, s3], at('2027-01-05T00:00:00.000Z'))).toBeNull();
  });

  test('antes de la primera no hay ninguna', () => {
    expect(shownSeason([s2], at('2026-11-01T00:00:00.000Z'))).toBeNull();
  });
});

test('isMadridMidnight: las 00:00 de Madrid en invierno son las 23:00 UTC del día anterior', () => {
  expect(isMadridMidnight('2026-11-22T23:00:00.000Z')).toBe(true);
  expect(isMadridMidnight('2026-11-23T00:00:00.000Z')).toBe(false);
  expect(isMadridMidnight('2026-07-31T22:00:00.000Z')).toBe(true);
});

test('el esquema de la temporada sigue siendo el de la clave season', () => {
  expect(configSchemas.season.safeParse({ ...T2.rules, id: T2.id, name: T2.name, startsAt: T2.startsAt, endsAt: T2.endsAt }).success).toBe(true);
});

describe('el calendario de temporadas en el panel', () => {
  test('el día de Madrid y su medianoche, en invierno y en verano', () => {
    expect(madridMidnightOf('2026-11-23')).toBe('2026-11-22T23:00:00.000Z');
    expect(madridMidnightOf('2027-07-01')).toBe('2027-06-30T22:00:00.000Z');
    expect(madridDayOf('2026-11-22T23:00:00.000Z')).toBe('2026-11-23');
    expect(() => madridMidnightOf('no-es-un-dia')).toThrow();
  });

  test('avisa de los días sin temporada por delante y de que no hay otra programada cuando la actual acaba pronto', () => {
    const now = Date.parse('2026-12-20T12:00:00.000Z');
    const s2 = { id: 'season-2', state: 'scheduled' as const, startsAt: '2026-11-22T23:00:00.000Z', endsAt: '2026-12-30T23:00:00.000Z' };
    expect(seasonCalendarWarnings([s2], now)).toEqual([{ kind: 'nothing_next', after: 'season-2', endsAt: s2.endsAt }]);
    const s3 = { id: 'season-3', state: 'scheduled' as const, startsAt: '2027-01-01T23:00:00.000Z', endsAt: '2027-02-28T23:00:00.000Z' };
    expect(seasonCalendarWarnings([s2, s3], now)).toEqual([{ kind: 'gap', after: 'season-2', before: 'season-3', from: s2.endsAt, to: s3.startsAt }]);
    expect(seasonCalendarWarnings([s2, { ...s3, startsAt: s2.endsAt }], now)).toEqual([]);
    // A draft does not count.
    expect(seasonCalendarWarnings([s2, { ...s3, startsAt: s2.endsAt, state: 'draft' as const }], now)).toEqual([{ kind: 'nothing_next', after: 'season-2', endsAt: s2.endsAt }]);
  });
});
