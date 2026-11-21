import { TOURNAMENT_METRICS, tournamentFiltersSchema } from '@galaxy/shared';
import { DummyDriver, Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler, sql } from 'kysely';
import { afterEach, describe, expect, test } from 'vitest';
import type { DB } from '../../src/db/schema';
import {
  cachedTournamentRanking,
  filterSql,
  invalidateTournamentRankings,
  metricExpressions,
  orderRanking,
  type RankedEntrant,
  type TournamentRanking,
} from '../../src/tournaments/scoring';

// A tournament's ranking (plan «temporadas como fichas», part 5; GDD §13.3): what each measure adds up, the filters
// on the runs, the order (the score, then who got there first, then the name: no shared places, a prize per place) and
// a cache that a finished run clears only when its player is in the tournament.

const db = new Kysely<DB>({
  dialect: {
    createAdapter: () => new PostgresAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: (k) => new PostgresIntrospector(k),
    createQueryCompiler: () => new PostgresQueryCompiler(),
  },
});
const compiled = (frag: ReturnType<typeof filterSql>) => sql`select 1 from galaxy.runs r where true ${frag}`.compile(db);

describe('qué suma cada medida', () => {
  test('cada medida tiene su valor y cuándo se alcanzó', () => {
    for (const m of TOURNAMENT_METRICS) {
      const e = metricExpressions(m);
      expect(e.value, m).toMatch(/^(coalesce\()?(sum|max|count)\(/);
      expect(e.reached, m).toContain('c.finished_at');
    }
  });

  test('las sumas y los recuentos, y los máximos con la partida que los dio', () => {
    expect(metricExpressions('points').value).toBe('coalesce(sum(c.pts), 0)');
    expect(metricExpressions('season_points').value).toBe('coalesce(sum(c.pts), 0)');
    expect(metricExpressions('best_run').value).toBe('coalesce(max(c.pts), 0)');
    expect(metricExpressions('kills').value).toBe('coalesce(sum(c.kills), 0)');
    expect(metricExpressions('cores').value).toBe('coalesce(sum(c.boss_kills), 0)');
    expect(metricExpressions('runs').value).toBe('count(c.id)');
    expect(metricExpressions('extractions').value).toBe("count(c.id) filter (where c.outcome = 'extracted')");
    expect(metricExpressions('depth').value).toBe('coalesce(max(c.depth), 0)');
    // A sum is reached by the last run that added to it; a best, by the first run that gave it.
    expect(metricExpressions('kills').reached).toBe('max(c.finished_at) filter (where c.kills > 0)');
    expect(metricExpressions('depth').reached).toBe('(array_agg(c.finished_at order by c.depth desc, c.finished_at asc) filter (where c.id is not null))[1]');
  });
});

describe('los filtros', () => {
  test('sin filtros no añade nada', () => {
    const q = compiled(filterSql(tournamentFiltersSchema.parse({})));
    expect(q.sql).toBe('select 1 from galaxy.runs r where true ');
    expect(q.parameters).toEqual([]);
  });

  test('el sector, la sonda y el modo', () => {
    const q = compiled(filterSql(tournamentFiltersSchema.parse({ sector: 'outer-nebula', probe: 'lumen', mode: 'solo', minLevel: 9 })));
    expect(q.sql).toContain('and r.sector = $1');
    expect(q.sql).toContain('and r.probe = $2');
    expect(q.sql).toContain('and r.coop_run_id is null');
    // The level is checked when signing up, never on the runs.
    expect(q.parameters).toEqual(['outer-nebula', 'lumen']);
    expect(compiled(filterSql(tournamentFiltersSchema.parse({ mode: 'coop' }))).sql).toContain('and r.coop_run_id is not null');
  });
});

const entrant = (accountId: string, value: number, reached: string | null, username = accountId): RankedEntrant => ({ accountId, username, avatar: null, frame: null, eligible: true, value, runs: value > 0 ? 1 : 0, reached, rank: null });

describe('el orden', () => {
  test('primero la puntuación, después quien llegó antes y después el nombre; sin puntos no hay puesto', () => {
    const ranked = orderRanking([
      entrant('c', 50, '2026-12-05T10:00:00.000Z'),
      entrant('a', 80, '2026-12-05T12:00:00.000Z'),
      entrant('z', 50, '2026-12-05T09:00:00.000Z'),
      entrant('nadie', 0, null),
      entrant('y', 50, '2026-12-05T10:00:00.000Z'),
    ]);
    expect(ranked.map((r) => [r.accountId, r.rank])).toEqual([
      ['a', 1],
      ['z', 2],
      ['c', 3],
      ['y', 4],
    ]);
  });
});

describe('la caché', () => {
  afterEach(() => invalidateTournamentRankings());
  const result = (ids: string[]): TournamentRanking => {
    const all = ids.map((id) => entrant(id, 10, '2026-12-05T10:00:00.000Z'));
    return { rows: orderRanking(all), entrants: new Map(all.map((e) => [e.accountId, e])) };
  };

  test('lecturas a la vez comparten una consulta', async () => {
    let calls = 0;
    const compute = async () => {
      calls++;
      return result(['a']);
    };
    const [x, y] = await Promise.all([cachedTournamentRanking('t1', compute), cachedTournamentRanking('t1', compute)]);
    expect(x).toBe(y);
    expect(calls).toBe(1);
  });

  test('una partida de un inscrito la vacía; la de alguien de fuera, no', async () => {
    let calls = 0;
    const compute = async () => {
      calls++;
      return result(['a', 'b']);
    };
    await cachedTournamentRanking('t1', compute);
    invalidateTournamentRankings(['fuera']);
    await cachedTournamentRanking('t1', compute);
    expect(calls).toBe(1);
    invalidateTournamentRankings(['b']);
    await cachedTournamentRanking('t1', compute);
    expect(calls).toBe(2);
  });

  test('una lectura en curso cuando acaba una partida no se queda', async () => {
    let release: (r: TournamentRanking) => void = () => undefined;
    const stale = cachedTournamentRanking('t1', () => new Promise<TournamentRanking>((r) => (release = r)));
    invalidateTournamentRankings(['cualquiera']);
    release(result(['a']));
    await stale;
    let calls = 0;
    await cachedTournamentRanking('t1', async () => {
      calls++;
      return result(['a']);
    });
    expect(calls).toBe(1);
  });

  test('una consulta que falla no se queda', async () => {
    await expect(cachedTournamentRanking('t1', async () => Promise.reject(new Error('caída')))).rejects.toThrow('caída');
    expect((await cachedTournamentRanking('t1', async () => result(['b']))).rows[0]!.accountId).toBe('b');
  });
});
