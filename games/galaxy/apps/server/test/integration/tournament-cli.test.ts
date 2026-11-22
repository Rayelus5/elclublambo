import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseConfig } from '@galaxy/shared';
import type { ControlledTransaction, Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { runCli } from '../../src/cli';
import { createDb } from '../../src/db';
import type { DB } from '../../src/db/schema';
import { saveSeasonDraft, scheduleSeason } from '../../src/season/records';
import { testEnv } from '../helpers';

// The tournament commands of the container CLI (skill galaxy-torneo, 2026-11-22): a `torneo.json` goes to PRE as a draft
// (new, or replacing the draft with its slug), never further; check-config checks it against what is live. The local
// DB is the user's: everything here runs on one transaction that is rolled back when the file ends.

let db: Kysely<DB>;
let trx: ControlledTransaction<DB>;
const dir = mkdtempSync(join(tmpdir(), 'galaxy-tournament-cli-'));
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
// Far in the future, so nothing else in the database meets this season.
const SEASON = 'tc-season';
const record = (over: Record<string, unknown> = {}) => ({
  slug: 'tc-copa-prueba',
  seasonId: SEASON,
  title: 'Copa de prueba',
  summary: 'Una copa para probar la consola',
  startsAt: '2088-02-06T19:00:00.000Z',
  endsAt: '2088-02-09T23:00:00.000Z',
  metric: 'points',
  prizes: [
    { from: 1, to: 1, gifts: [{ kind: 'currency', currency: 'coins', amount: 5000 }] },
    { from: 2, to: 10, gifts: [{ kind: 'currency', currency: 'dust', amount: 500 }] },
  ],
  ...over,
});

beforeAll(async () => {
  db = createDb(testEnv().DATABASE_URL, { max: 1 });
  trx = await db.startTransaction().execute();
  const ctx = { labNodes: parseConfig('lab', {}).nodes, anomalies: [] };
  const actor = { id: null, label: 'test' };
  await saveSeasonDraft(trx, { id: SEASON, name: 'Temporada de la consola', startsAt: '2088-01-31T23:00:00.000Z', endsAt: '2088-02-28T23:00:00.000Z', rules: { anomaly: null } }, ctx, actor, 'Prueba');
  await scheduleSeason(trx, SEASON, ctx, actor, 'Prueba');
});
afterAll(async () => {
  await trx.rollback().execute();
  await db.destroy();
});

describe('la CLI de torneos', () => {
  test('tournament-draft guarda un borrador desde un lote de ops-bundle, lo cambia por su slug y tournament-list y tournament-show lo enseñan', async () => {
    const first = await cli(['tournament-draft', file('a.json', { torneo: record() }), '--reason', 'Desde la carpeta']);
    expect(first.code, first.out).toBe(0);
    expect(first.out).toContain('Guardado como borrador: tc-copa-prueba');
    expect(first.out).toContain('Administración › Torneos');

    const again = await cli(['tournament-draft', file('b.json', record({ title: 'Copa cambiada' })), '--reason', 'Otro título']);
    expect(again.code, again.out).toBe(0);
    expect(again.out).toContain('Borrador cambiado');
    expect(again.out).toContain('v2');

    const list = await cli(['tournament-list']);
    expect(list.out).toMatch(/tc-copa-prueba\s+Copa cambiada\s+borrador/);
    const show = await cli(['tournament-show', 'tc-copa-prueba']);
    expect(show.out).toContain('"state": "draft"');
    expect(show.out).toContain('"title": "Copa cambiada"');
    expect(JSON.parse(show.out).record.slug).toBe('tc-copa-prueba');
  });

  test('un torneo que no vale no se guarda y dice dónde falla', async () => {
    const bad = await cli(['tournament-draft', file('c.json', record({ slug: 'tc-mal', prizes: [{ from: 2, to: 3, gifts: [{ kind: 'currency', currency: 'coins', amount: 10 }] }] })), '--reason', 'Mal']);
    expect(bad.code).toBe(1);
    expect(bad.out).toContain('prizes.0.from: prizes_start');
    const outside = await cli(['tournament-draft', file('d.json', record({ slug: 'tc-fuera', endsAt: '2088-03-05T23:00:00.000Z' })), '--reason', 'Fuera']);
    expect(outside.code).toBe(1);
    expect(outside.out).toContain('tournament_outside_season');
    expect((await cli(['tournament-show', 'tc-mal'])).code).toBe(1);
  });

  test('un torneo que ya no es un borrador no se toca desde la consola', async () => {
    await cli(['tournament-draft', file('e.json', record({ slug: 'tc-programado' })), '--reason', 'Prepara']);
    await trx.updateTable('galaxy.tournaments').set({ state: 'scheduled' }).where('slug', '=', 'tc-programado').execute();
    const r = await cli(['tournament-draft', file('f.json', record({ slug: 'tc-programado', title: 'Otro' })), '--reason', 'Cambia']);
    expect(r.code).toBe(1);
    expect(r.out).toContain('ya no es un borrador');
  });

  test('check-config comprueba el torneo de un lote contra lo vivo sin guardarlo', async () => {
    // Whether the rest of what is live holds together depends on the database: only the tournament's line is asserted.
    const ok = await cli(['check-config', file('ok.json', { torneo: record({ slug: 'tc-check' }) })]);
    expect(ok.out).toContain('Torneo tc-check: se puede guardar y programar');
    expect((await cli(['tournament-show', 'tc-check'])).code).toBe(1);
    const bad = await cli(['check-config', file('bad.json', { torneo: record({ slug: 'tc-check', seasonId: 'no-existe' }) })]);
    expect(bad.code).toBe(1);
    expect(bad.out).toContain('tournament_season_unknown');
  });

  test('sin datos, cada comando enseña su uso', async () => {
    expect((await cli(['tournament-draft'])).out).toContain('Uso: tournament-draft');
    expect((await cli(['tournament-show'])).out).toContain('Uso: tournament-show');
  });
});
