import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ControlledTransaction, Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { runCli } from '../../src/cli';
import { createDb } from '../../src/db';
import type { DB } from '../../src/db/schema';
import { testEnv } from '../helpers';

// The «Encuestas y avisos» commands of the container CLI (plan 2026-11-22, part A): a campaign of an ops folder goes to
// PRE as a draft (new, or replacing a draft by its id), with its image uploaded first, and never further. The local DB
// is the user's: everything here runs on one transaction that is rolled back when the file ends.

let db: Kysely<DB>;
let trx: ControlledTransaction<DB>;
const dir = mkdtempSync(join(tmpdir(), 'galaxy-popup-cli-'));
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
// A real 1×1 PNG (the server sniffs the bytes, not the name), made unique per run so it is a new asset.
const png = (): string => {
  const base = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  return Buffer.concat([base, Buffer.from(String(Math.random()))]).toString('base64');
};
// Far in the future, so nothing else in the database meets these dates.
const promotion = (over: Record<string, unknown> = {}) => ({
  kind: 'promotion',
  title: 'Prueba de la consola',
  body: 'Una promoción para probar la consola',
  questions: [],
  link: { kind: 'route', to: '/temporada', label: 'Ver la temporada' },
  audience: { kind: 'segment', minLevel: 3 },
  startsAt: '2089-03-01T10:00:00.000Z',
  endsAt: '2089-03-08T10:00:00.000Z',
  priority: 2,
  reward: [],
  ...over,
});

beforeAll(async () => {
  db = createDb(testEnv().DATABASE_URL, { max: 1 });
  trx = await db.startTransaction().execute();
});
afterAll(async () => {
  await trx.rollback().execute();
  await db.destroy();
});

describe('la CLI de encuestas y avisos', () => {
  test('popup-draft sube la imagen, guarda el borrador, lo cambia por su id y popup-list lo enseña', async () => {
    const first = await cli(['popup-draft', file('a.json', { record: promotion(), image: { name: 'prueba.png', data: png() } }), '--reason', 'Desde la carpeta']);
    expect(first.code, first.out).toBe(0);
    expect(first.out).toContain('Guardado como borrador');
    expect(first.out).toContain('Administración › Encuestas y avisos');
    // With its image it has everything it needs to be published.
    expect(first.out).not.toContain('Para publicarla falta');
    const id = /([0-9a-f-]{36})/.exec(first.out)![1]!;
    const row = await trx.selectFrom('galaxy.popup_campaigns').select(['state', 'image_media', 'audience', 'created_by']).where('id', '=', id).executeTakeFirstOrThrow();
    expect(row).toMatchObject({ state: 'draft', audience: { kind: 'segment', minLevel: 3 }, created_by: null });
    expect(row.image_media).not.toBeNull();
    const audit = await trx.selectFrom('galaxy.admin_audit_log').select(['action', 'actor_label']).where('target_id', '=', id).execute();
    expect(audit).toContainEqual({ action: 'popup.saved', actor_label: 'cli' });

    const again = await cli(['popup-draft', file('b.json', { id, record: { ...promotion({ title: 'Prueba cambiada' }), imageMedia: row.image_media } }), '--reason', 'Otro título']);
    expect(again.code, again.out).toBe(0);
    expect(again.out).toContain('Borrador cambiado');
    expect(again.out).toContain('v2');

    const list = await cli(['popup-list']);
    expect(list.code).toBe(0);
    expect(list.out).toContain(`${id}  Promoción  borrador`);
    expect(list.out).toContain('Prueba cambiada');
  });

  test('sin imagen, la promoción se guarda pero avisa de lo que le falta para publicarla', async () => {
    const res = await cli(['popup-draft', file('c.json', { record: promotion({ title: 'Sin imagen' }) }), '--reason', 'Sin imagen']);
    expect(res.code, res.out).toBe(0);
    expect(res.out).toContain('Para publicarla falta');
    expect(res.out).toContain('popup_image_missing');
  });

  test('una ficha que no vale, un JSON mal hecho o sin motivo se rechazan sin guardar nada', async () => {
    const bad = await cli(['popup-draft', file('d.json', { record: promotion({ questions: [{ type: 'stars', id: 'nota', prompt: 'Nota' }] }) }), '--reason', 'Mal']);
    expect(bad.code).toBe(1);
    expect(bad.out).toContain('La campaña no vale');
    const shape = await cli(['popup-draft', file('e.json', { kind: 'promotion' }), '--reason', 'Sin record']);
    expect(shape.code).toBe(1);
    expect(shape.out).toContain('{ record, id?, image?: { name, data } }');
    const noReason = await cli(['popup-draft', file('f.json', { record: promotion() })]);
    expect(noReason.code).toBe(1);
    expect(noReason.out).toContain('Uso: popup-draft');
  });
});
