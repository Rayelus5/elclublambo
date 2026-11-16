import type { DraftCheck, DraftSummary, DraftView } from '@galaxy/shared';
import { DEFAULT_CONTENT } from '@galaxy/sim';
import type { ControlledTransaction, Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createConfigService } from '../../src/config/service';
import { createDb } from '../../src/db';
import type { DB } from '../../src/db/schema';
import { createAdminViaCli, del, get, patch, post, put, sessionCookie, testApp, testEnv, totpNow } from '../helpers';

// Config drafts on the server (the content editor, 2026-11-16, P2): a draft keeps the top-level fields it changes, made
// on the live version of each key; saves name their revision; a later publish is merged entity by entity (rebase); the
// draft is checked, published with a reason and the password (all its keys or none) or discarded.
// The live config runs on one transaction rolled back when the file ends (like config-admin.test.ts): nothing here is
// ever published for real.

let configDb: Kysely<DB>;
let trx: ControlledTransaction<DB>;
type Ctx = Awaited<ReturnType<typeof testApp>>;
let ctx: Ctx;
let admin: { cookie: string; password: string };

beforeAll(async () => {
  configDb = createDb(testEnv().DATABASE_URL, { max: 1 });
  trx = await configDb.startTransaction().execute();
  ctx = await testApp({ config: createConfigService(trx) });
  const { username, password, totpSecret } = await createAdminViaCli(ctx.db, 'admin');
  const login = await post(ctx.app, '/galaxy/api/auth/login', { username, password });
  const res = await post(ctx.app, '/galaxy/api/auth/totp', { challenge: login.json().challenge, code: totpNow(totpSecret) });
  admin = { cookie: sessionCookie(res), password };
});
afterAll(async () => {
  await ctx.close();
  await trx.rollback().execute();
  await configDb.destroy();
});

const D = '/galaxy/api/admin/config-drafts';
const as = { get cookie() { return admin.cookie; } };
const create = async (title: string) => (await post(ctx.app, D, { title }, { cookie: as.cookie })).json() as DraftView;
const save = (id: string, body: object) => put(ctx.app, `${D}/${id}/field`, body, { cookie: as.cookie });
const lastVersion = async (key: string) =>
  (await trx.selectFrom('galaxy.game_config_versions').select('version').where('key', '=', key).orderBy('version', 'desc').executeTakeFirst())?.version ?? 0;
const liveEnemies = async () => {
  const row = (await get(ctx.app, '/galaxy/api/admin/config/content', { cookie: as.cookie })).json() as { data: typeof DEFAULT_CONTENT };
  return row.data.enemies;
};
const withHp = (enemies: typeof DEFAULT_CONTENT.enemies, id: string, hp: number) => enemies.map((e) => (e.id === id ? { ...e, hp } : e));

describe('un borrador', () => {
  test('se crea, sale en la lista y guarda cada campo con su revisión', async () => {
    const d = await create('Más vida al ácaro');
    expect(d).toMatchObject({ title: 'Más vida al ácaro', status: 'open', revision: 0, fields: [] });
    expect(((await get(ctx.app, D, { cookie: as.cookie })).json() as DraftSummary[]).some((x) => x.id === d.id)).toBe(true);
    const saved = (await save(d.id, { key: 'content', field: 'hitCap', value: 0.35, revision: 0 })).json() as DraftView;
    expect(saved).toMatchObject({ revision: 1, fields: [{ key: 'content', field: 'hitCap' }], data: { content: { hitCap: 0.35 } }, baseVersions: { content: await lastVersion('content') } });
    // Another tab still on revision 0: refused, nothing overwritten.
    const stale = await save(d.id, { key: 'content', field: 'hitCap', value: 0.2, revision: 0 });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toEqual({ error: 'draft_conflict' });
    // `null` drops the field: back to what is live.
    expect(((await save(d.id, { key: 'content', field: 'hitCap', value: null, revision: 1 })).json() as DraftView).fields).toEqual([]);
  });

  test('solo campos que existen, y solo contenido, sectores y sondas', async () => {
    const d = await create('Campos');
    expect((await save(d.id, { key: 'content', field: 'nope', value: 1, revision: 0 })).json()).toEqual({ error: 'unknown_field' });
    expect((await save(d.id, { key: 'chat', field: 'maxLength', value: 1, revision: 0 })).statusCode).toBe(400);
  });

  test('se comprueba sobre lo publicado, cada problema con su clave y su ruta', async () => {
    const d = await create('Tope roto');
    await save(d.id, { key: 'content', field: 'hitCap', value: 5, revision: 0 });
    const check = (await get(ctx.app, `${D}/${d.id}/check`, { cookie: as.cookie })).json() as DraftCheck;
    expect(check.issues).toEqual([expect.objectContaining({ key: 'content', path: 'hitCap' })]);
    expect(check.stale).toBe(false);
  });

  test('se publica con motivo y contraseña: una versión nueva, y el borrador queda cerrado', async () => {
    const d = await create('Tope por golpe');
    await save(d.id, { key: 'content', field: 'hitCap', value: 0.36, revision: 0 });
    const before = await lastVersion('content');
    expect((await post(ctx.app, `${D}/${d.id}/publish`, { reason: 'Tope', password: 'mala-clave' }, { cookie: as.cookie })).statusCode).toBe(401);
    const res = await post(ctx.app, `${D}/${d.id}/publish`, { reason: 'Tope por golpe', password: admin.password }, { cookie: as.cookie });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ versions: { content: before + 1 } });
    const after = (await get(ctx.app, `${D}/${d.id}`, { cookie: as.cookie })).json() as DraftView;
    expect(after).toMatchObject({ status: 'published', publishedVersions: { content: before + 1 } });
    expect(((await get(ctx.app, D, { cookie: as.cookie })).json() as DraftSummary[]).some((x) => x.id === d.id)).toBe(false);
    expect((await post(ctx.app, `${D}/${d.id}/publish`, { reason: 'Otra vez', password: admin.password }, { cookie: as.cookie })).json()).toEqual({ error: 'draft_closed' });
  });

  test('si se publicó otra cosa mientras tanto, se junta por entidad antes de publicar', async () => {
    const enemies = await liveEnemies();
    const d = await create('Ácaro');
    await save(d.id, { key: 'content', field: 'enemies', value: withHp(enemies, 'mite', 77), revision: 0 });
    // Someone publishes another enemy's life meanwhile.
    const direct = await post(
      ctx.app,
      '/galaxy/api/admin/config/content',
      { data: { enemies: withHp(enemies, 'cell', 88) }, reason: 'Célula', password: admin.password, baseVersion: await lastVersion('content') },
      { cookie: as.cookie },
    );
    expect(direct.statusCode).toBe(201);
    expect(((await get(ctx.app, `${D}/${d.id}`, { cookie: as.cookie })).json() as DraftView).stale).toBe(true);
    expect((await post(ctx.app, `${D}/${d.id}/publish`, { reason: 'Ácaro', password: admin.password }, { cookie: as.cookie })).json()).toMatchObject({ error: 'config_conflict' });
    const rebased = (await post(ctx.app, `${D}/${d.id}/rebase`, {}, { cookie: as.cookie })).json() as { draft: DraftView; conflicts: unknown[] };
    expect(rebased.conflicts).toEqual([]);
    expect(rebased.draft.stale).toBe(false);
    expect((await post(ctx.app, `${D}/${d.id}/publish`, { reason: 'Ácaro', password: admin.password }, { cookie: as.cookie })).statusCode).toBe(201);
    const live = await liveEnemies();
    expect(live.find((e) => e.id === 'mite')!.hp).toBe(77);
    expect(live.find((e) => e.id === 'cell')!.hp).toBe(88);
  });

  test('si los dos cambiaron lo mismo, el rebase lo dice y se elige qué lado gana', async () => {
    const enemies = await liveEnemies();
    const d = await create('Ácaro otra vez');
    await save(d.id, { key: 'content', field: 'enemies', value: withHp(enemies, 'mite', 55), revision: 0 });
    await post(
      ctx.app,
      '/galaxy/api/admin/config/content',
      { data: { enemies: withHp(enemies, 'mite', 66) }, reason: 'Ácaro directo', password: admin.password, baseVersion: await lastVersion('content') },
      { cookie: as.cookie },
    );
    const first = (await post(ctx.app, `${D}/${d.id}/rebase`, {}, { cookie: as.cookie })).json() as { conflicts: unknown[] };
    expect(first.conflicts).toEqual([{ key: 'content', field: 'enemies', id: 'mite' }]);
    const chosen = (await post(ctx.app, `${D}/${d.id}/rebase`, { resolutions: { content: { enemies: { mite: 'mine' } } } }, { cookie: as.cookie })).json() as {
      draft: DraftView;
      conflicts: unknown[];
    };
    expect(chosen.conflicts).toEqual([]);
    expect((chosen.draft.data.content!.enemies as { id: string; hp: number }[]).find((e) => e.id === 'mite')!.hp).toBe(55);
  });

  test('se renombra y se descarta', async () => {
    const d = await create('Viejo');
    expect(((await patch(ctx.app, `${D}/${d.id}`, { title: 'Nuevo', revision: 0 }, { cookie: as.cookie })).json() as DraftView).title).toBe('Nuevo');
    expect((await del(ctx.app, `${D}/${d.id}`, { cookie: as.cookie })).statusCode).toBe(204);
    expect(((await get(ctx.app, `${D}/${d.id}`, { cookie: as.cookie })).json() as DraftView).status).toBe('discarded');
  });
});
