import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ControlledTransaction, Kysely } from 'kysely';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { runCli } from '../../src/cli';
import { createDb } from '../../src/db';
import type { DB } from '../../src/db/schema';
import { liveNotices } from '../../src/mail/service';
import { testEnv } from '../helpers';

// Publishing live config and title notices from the container CLI (open beta launch): with no admin account left
// after the wipe, the launch config goes live from files, validated like the panel's and audited as «cli».
// The local DB is the user's: everything here runs on one transaction that is rolled back when the file ends.

let db: Kysely<DB>;
let trx: ControlledTransaction<DB>;
const dir = mkdtempSync(join(tmpdir(), 'galaxy-cli-'));
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
const live = async (key: string) => trx.selectFrom('galaxy.game_config_active').select(['version', 'data']).where('key', '=', key).executeTakeFirst();

beforeAll(async () => {
  db = createDb(testEnv().DATABASE_URL, { max: 1 });
  trx = await db.startTransaction().execute();
});
afterAll(async () => {
  await trx.rollback().execute();
  await db.destroy();
});

test('publish-config publica una clave validada, con su versión siguiente, y lo audita como cli', async () => {
  const before = (await live('boosts'))?.version ?? 0;
  const boost = { id: 'lanzamiento', name: 'Lanzamiento', currency: 'coins', factor: 1.5, startsAt: '2026-11-09T23:00:00.000Z', endsAt: '2026-11-16T23:00:00.000Z' };
  const r = await cli(['publish-config', 'boosts', file('boosts.json', { list: [boost] }), '--reason', 'Lanzamiento de la beta abierta']);
  expect(r.code, r.out).toBe(0);
  expect(r.out).toContain(`boosts v${before + 1}`);
  const now = await live('boosts');
  expect(now?.version).toBe(before + 1);
  expect((now?.data as { list: unknown[] }).list).toEqual([boost]);
  const audit = await trx.selectFrom('galaxy.admin_audit_log').select(['actor_label', 'action', 'reason']).where('target_id', '=', 'boosts').orderBy('id', 'desc').executeTakeFirstOrThrow();
  expect(audit).toEqual({ actor_label: 'cli', action: 'config.published', reason: 'Lanzamiento de la beta abierta' });
});

test('un JSON que no valida no publica nada y dice dónde falla', async () => {
  const before = (await live('boosts'))?.version ?? 0;
  const r = await cli(['publish-config', 'boosts', file('bad.json', { list: [{ id: 'x', name: 'X', currency: 'coins', factor: 99, startsAt: '2026-11-09T23:00:00.000Z', endsAt: '2026-11-10T23:00:00.000Z' }] }), '--reason', 'prueba']);
  expect(r.code).toBe(1);
  expect(r.out).toMatch(/factor/);
  expect((await live('boosts'))?.version ?? 0).toBe(before);
  expect((await cli(['publish-config', 'nada', file('x.json', {}), '--reason', 'prueba'])).code).toBe(1);
  expect((await cli(['publish-config', 'boosts', file('y.json', { list: [] })])).code).toBe(1);
});

test('la ruta de temporada (seasonRoute, con mayúscula) también se publica', async () => {
  const r = await cli(['publish-config', 'seasonRoute', file('route.json', { currency: { name: 'Esquirlas', perPoint: 0.5, dustRate: 2 } }), '--reason', 'Ruta de 4 semanas']);
  expect(r.code, r.out).toBe(0);
  expect((await live('seasonRoute'))?.version).toBeGreaterThan(0);
});

test('notice crea un aviso de la pantalla de título, vivo desde ahora los días pedidos, y lo audita', async () => {
  const r = await cli(['notice', 'Arranca la Beta Abierta', '--tone', 'info', '--days', '14', '--reason', 'Lanzamiento']);
  expect(r.code, r.out).toBe(0);
  const notices = await liveNotices(trx, new Date());
  expect(notices.find((n) => n.text === 'Arranca la Beta Abierta')).toMatchObject({ tone: 'info' });
  const row = await trx.selectFrom('galaxy.title_notices').select(['ends_at']).where('text', '=', 'Arranca la Beta Abierta').executeTakeFirstOrThrow();
  expect(Math.abs(new Date(row.ends_at).getTime() - (Date.now() + 14 * 86_400_000))).toBeLessThan(60_000);
  expect((await cli(['notice', '', '--reason', 'x'])).code).toBe(1);
});
