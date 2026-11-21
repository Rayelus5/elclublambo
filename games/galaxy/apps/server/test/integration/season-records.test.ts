import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseConfig } from '@galaxy/shared';
import type { ControlledTransaction, Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { runCli } from '../../src/cli';
import { createConfigService } from '../../src/config/service';
import { createDb } from '../../src/db';
import type { DB } from '../../src/db/schema';
import { allSeasons, extendSeason, importSeasons, saveSeasonDraft, scheduleSeason, type SeasonContext, unscheduleSeason } from '../../src/season/records';
import { testEnv } from '../helpers';

// Seasons as records (plan «temporadas como fichas», 2026-11-21): saved as drafts, scheduled, moved; never two at once;
// every change a revision; the first deploy imports what was live; the CLI drives it. The local DB is the user's:
// everything here runs on one transaction that is rolled back when the file ends.

let db: Kysely<DB>;
let trx: ControlledTransaction<DB>;
const actor = { id: null, label: 'test' };
const dir = mkdtempSync(join(tmpdir(), 'galaxy-seasons-'));
const file = (name: string, data: unknown) => {
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(data));
  return path;
};
const cli = async (argv: string[]) => {
  const lines: string[] = [];
  const code = await runCli(argv, { db: trx, env: testEnv(), out: (s) => lines.push(s) });
  return { code, out: lines.join('\n') };
};
const ctx: SeasonContext = { labNodes: parseConfig('lab', {}).nodes, anomalies: ['contagion', 'swarm'] };
// Far in the future, so nothing else in the database meets these windows.
const record = (id: string, startsAt: string, endsAt: string) => ({ id, name: `Prueba ${id}`, startsAt, endsAt, rules: { anomaly: 'contagion' } });
const A = record('t-a', '2091-01-31T23:00:00.000Z', '2091-02-28T23:00:00.000Z');
const B = record('t-b', '2091-02-28T23:00:00.000Z', '2091-03-31T22:00:00.000Z');

beforeAll(async () => {
  db = createDb(testEnv().DATABASE_URL, { max: 1 });
  trx = await db.startTransaction().execute();
  // Each test sees only its own seasons.
  await trx.deleteFrom('galaxy.seasons').execute();
});
afterAll(async () => {
  await trx.rollback().execute();
  await db.destroy();
});

/** One step on a savepoint: a step that fails leaves the file's transaction usable for the next. */
async function committed<T>(fn: () => Promise<T>): Promise<T> {
  const sp = await trx.savepoint('season_step').execute();
  try {
    const out = await fn();
    await sp.releaseSavepoint('season_step').execute();
    return out;
  } catch (err) {
    await sp.rollbackToSavepoint('season_step').execute();
    throw err;
  }
}

describe('fichas de temporada', () => {
  test('un borrador se guarda con su revisión, se programa y queda en la lista', async () => {
    const saved = await committed(() => saveSeasonDraft(trx, A, ctx, actor, 'Primera'));
    expect(saved).toMatchObject({ id: 't-a', state: 'draft', version: 1 });
    const again = await committed(() => saveSeasonDraft(trx, { ...A, name: 'Prueba A bis' }, ctx, actor, 'Segunda'));
    expect(again).toMatchObject({ name: 'Prueba A bis', version: 2 });
    const scheduled = await committed(() => scheduleSeason(trx, 't-a', ctx, actor, 'A su hora'));
    expect(scheduled).toMatchObject({ state: 'scheduled', version: 3 });
    const revisions = await trx.selectFrom('galaxy.season_revisions').select(['version', 'note']).where('season', '=', 't-a').orderBy('version').execute();
    expect(revisions.map((r) => r.note)).toEqual(['Primera', 'Segunda', 'A su hora']);
    await expect(committed(() => saveSeasonDraft(trx, A, ctx, actor, 'Encima'))).rejects.toMatchObject({ code: 'season_not_draft' });
  });

  test('las revisiones no se cambian ni se borran', async () => {
    await expect(committed(() => trx.updateTable('galaxy.season_revisions').set({ note: 'otra' }).where('season', '=', 't-a').execute())).rejects.toThrow(/season_revisions_append_only/);
  });

  test('dos temporadas programadas no se solapan; seguidas sí caben', async () => {
    await committed(() => saveSeasonDraft(trx, record('t-x', '2091-02-14T23:00:00.000Z', '2091-03-14T23:00:00.000Z'), ctx, actor, 'Solapa'));
    await expect(committed(() => scheduleSeason(trx, 't-x', ctx, actor, 'Solapa'))).rejects.toMatchObject({ code: 'season_overlap' });
    await committed(() => saveSeasonDraft(trx, B, ctx, actor, 'Seguida'));
    await expect(committed(() => scheduleSeason(trx, 't-b', ctx, actor, 'Seguida'))).resolves.toMatchObject({ state: 'scheduled' });
  });

  test('alargar una temporada empuja el inicio de la siguiente en la misma transacción', async () => {
    const moved = await committed(() => extendSeason(trx, 't-a', '2091-03-07T23:00:00.000Z', { moveNext: true }, actor, 'Una semana más', new Date('2091-02-10T00:00:00.000Z')));
    expect(moved.endsAt).toBe('2091-03-07T23:00:00.000Z');
    const b = (await allSeasons(trx)).find((s) => s.id === 't-b')!;
    expect(b.startsAt).toBe('2091-03-07T23:00:00.000Z');
    // Without moving the next one, it would overlap it.
    await expect(committed(() => extendSeason(trx, 't-a', '2091-03-14T23:00:00.000Z', { moveNext: false }, actor, 'Choca', new Date('2091-02-10T00:00:00.000Z')))).rejects.toMatchObject({ code: 'season_overlap' });
  });

  test('una temporada que ya empezó no vuelve a borrador; una futura sí', async () => {
    await expect(committed(() => unscheduleSeason(trx, 't-a', actor, 'Atrás', new Date('2091-02-10T00:00:00.000Z')))).rejects.toMatchObject({ code: 'season_started' });
    await expect(committed(() => unscheduleSeason(trx, 't-b', actor, 'Atrás', new Date('2091-02-10T00:00:00.000Z')))).resolves.toMatchObject({ state: 'draft' });
  });

  test('una ficha que no vale no se guarda y dice dónde falla', async () => {
    await expect(committed(() => saveSeasonDraft(trx, { ...A, id: 't-mal', startsAt: '2091-02-01T10:00:00.000Z' }, ctx, actor, 'Mal'))).rejects.toMatchObject({ code: 'season_invalid' });
  });
});

describe('la CLI de temporadas', () => {
  test('season-import guarda un borrador (también desde un lote de ops-bundle), season-schedule lo programa y season-list lo enseña', async () => {
    const r = await cli(['season-import', file('t.json', { temporada: record('t-cli', '2092-01-31T23:00:00.000Z', '2092-02-29T23:00:00.000Z') }), '--reason', 'Desde la carpeta']);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain('borrador');
    const s = await cli(['season-schedule', 't-cli', '--reason', 'A su hora']);
    expect(s.code, s.out).toBe(0);
    const list = await cli(['season-list']);
    expect(list.out).toMatch(/t-cli\s+Prueba t-cli\s+programada/);
    expect((await cli(['season-show', 't-cli'])).out).toContain('"state": "scheduled"');
  });

  test('con temporadas como fichas, publish-config y check-config rechazan la temporada a la antigua', async () => {
    const r = await cli(['publish-config', 'season', file('s.json', { name: 'Otra' }), '--reason', 'A la antigua']);
    expect(r.code).toBe(1);
    expect(r.out).toContain('season-import');
    const c = await cli(['check-config', file('b.json', { seasonRoute: { currency: { name: 'X', perPoint: 1, dustRate: 1 } } })]);
    expect(c.code).toBe(1);
    expect(c.out).toContain('season-import');
  });

  test('check-config comprueba la temporada de un lote junto a las programadas', async () => {
    const ok = await cli(['check-config', file('ok.json', { temporada: record('t-chk', '2093-01-31T23:00:00.000Z', '2093-02-28T23:00:00.000Z') })]);
    expect(ok.out).toContain('Temporada t-chk');
    const bad = await cli(['check-config', file('bad.json', { temporada: { ...record('t-chk', '2093-01-31T23:00:00.000Z', '2093-02-28T23:00:00.000Z'), rules: { anomaly: 'no-existe' } } })]);
    expect(bad.code).toBe(1);
    expect(bad.out).toContain('season_anomaly_unknown');
  });
});

describe('la importación del primer despliegue', () => {
  test('la temporada viva pasa a ficha programada con su ruta, sus misiones y su árbol; una archivada, a cerrada', async () => {
    await trx.deleteFrom('galaxy.seasons').execute();
    const base = createConfigService(trx, { ttlMs: 0 });
    const live = { id: 'imp-live', name: 'Viva', startsAt: '2094-01-31T23:00:00.000Z', endsAt: '2094-02-28T23:00:00.000Z', anomaly: 'contagion' };
    await base.publish('season', live, actor, 'Para importar');
    await base.publish('seasonRoute', { currency: { name: 'Fragmentos', perPoint: 0.5, dustRate: 3 } }, actor, 'Para importar');
    await trx
      .insertInto('galaxy.season_archive')
      .values({ season: 'imp-old', name: 'Vieja', starts_at: '2093-12-31T23:00:00.000Z', ends_at: '2094-02-10T23:00:00.000Z', closed_at: new Date('2094-01-20T00:00:00.000Z') })
      .execute();
    expect(await importSeasons(trx, base)).toBe('imported');
    const all = await allSeasons(trx);
    const viva = all.find((s) => s.id === 'imp-live')!;
    expect(viva).toMatchObject({ state: 'scheduled', startsAt: live.startsAt, endsAt: live.endsAt });
    expect(viva.route.currency.name).toBe('Fragmentos');
    expect(viva.missions).toEqual((await base.get('missions')).season);
    // Closed early: its end is cut at its close, so it does not overlap the live one.
    expect(all.find((s) => s.id === 'imp-old')).toMatchObject({ state: 'closed', endsAt: '2094-01-20T00:00:00.000Z' });
    expect(await importSeasons(trx, base)).toBe('present');
  });
});
