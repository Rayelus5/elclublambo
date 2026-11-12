import { randomInt, randomUUID } from 'node:crypto';
import { type AdminReleaseNotesView, compareVersions, RELEASE_NOTES, type ReleaseNotesView } from '@galaxy/shared';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { createAdminViaCli, get, post, put, sessionCookie, testApp, totpNow, uniqueName } from '../helpers';

// «Notas de versión» (plan «notas de versión»): the players read the notes of the code merged with the panel's; the
// admin adds new ones, corrects or hides those of the code (and brings them back), and deletes only the panel's own;
// every change is audited. Moderators and players do not edit.
let ctx: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  ctx = await testApp();
});
afterAll(() => ctx.close());

async function staff(role: 'admin' | 'moderator') {
  const { username, password, totpSecret } = await createAdminViaCli(ctx.db, role);
  const login = await post(ctx.app, '/galaxy/api/auth/login', { username, password });
  const res = await post(ctx.app, '/galaxy/api/auth/totp', { challenge: login.json().challenge, code: totpNow(totpSecret) });
  return sessionCookie(res);
}
async function player() {
  const res = await post(ctx.app, '/galaxy/api/auth/register', { username: uniqueName('nts'), password: 'una-clave-larga' });
  return sessionCookie(res);
}
const notes = async (cookie: string) => ((await get(ctx.app, '/galaxy/api/notes', { cookie })).json() as ReleaseNotesView).notes;
const panel = async (cookie: string) => ((await get(ctx.app, '/galaxy/api/admin/notes', { cookie })).json() as AdminReleaseNotesView).notes;
const audits = async (id: string) => (await ctx.db.selectFrom('galaxy.admin_audit_log').select(['action']).where('target_type', '=', 'release_note').where('target_id', '=', id).orderBy('id').execute()).map((r) => r.action);
const body = (version: string, title = 'Una prueba del panel') => ({ version, date: '2026-12-01', title, summary: 'Lo que cambia', items: [{ kind: 'nuevo', text: 'Algo nuevo' }] });

test('los jugadores ven las notas del juego, de la más nueva a la más antigua, y una copia que no ha cambiado no se vuelve a mandar', async () => {
  const cookie = await player();
  const res = await get(ctx.app, '/galaxy/api/notes', { cookie });
  expect(res.statusCode).toBe(200);
  const list = (res.json() as ReleaseNotesView).notes;
  for (const n of RELEASE_NOTES) expect(list.map((x) => x.id)).toContain(n.id);
  for (let i = 1; i < list.length; i++) expect(compareVersions(list[i - 1]!.version, list[i]!.version)).toBeGreaterThan(0);
  const etag = res.headers['etag'] as string;
  expect(etag).toMatch(/^"notes-/);
  expect((await get(ctx.app, '/galaxy/api/notes', { cookie, headers: { 'if-none-match': etag } })).statusCode).toBe(304);
  expect((await get(ctx.app, '/galaxy/api/notes')).statusCode).toBe(401);
});

test('el panel añade una nota, corrige una del juego, la oculta y la restaura, y solo elimina las suyas', async () => {
  const admin = await staff('admin');
  const cookie = await player();
  const id = `prueba-${randomUUID().slice(0, 8)}`;
  const version = `${randomInt(100, 999)}.${randomInt(0, 999)}`;
  expect((await put(ctx.app, `/galaxy/api/admin/notes/${id}`, body(version), { cookie: admin })).statusCode).toBe(200);
  expect((await notes(cookie)).find((n) => n.id === id)).toMatchObject({ version, title: 'Una prueba del panel' });
  expect((await panel(admin)).find((n) => n.id === id)).toMatchObject({ source: 'panel', hidden: false });

  // A note of the code, corrected: the players read the correction.
  const code = RELEASE_NOTES.at(-1)!;
  expect((await put(ctx.app, `/galaxy/api/admin/notes/${code.id}`, { ...body(code.version, 'Beta abierta corregida'), date: code.date }, { cookie: admin })).statusCode).toBe(200);
  expect((await notes(cookie)).find((n) => n.id === code.id)!.title).toBe('Beta abierta corregida');
  expect((await panel(admin)).find((n) => n.id === code.id)).toMatchObject({ source: 'edited' });
  // Hidden, the players stop seeing it; restored, it is the code's again.
  expect((await post(ctx.app, `/galaxy/api/admin/notes/${code.id}/hide`, {}, { cookie: admin })).statusCode).toBe(200);
  expect((await notes(cookie)).map((n) => n.id)).not.toContain(code.id);
  expect((await panel(admin)).find((n) => n.id === code.id)).toMatchObject({ hidden: true });
  expect((await post(ctx.app, `/galaxy/api/admin/notes/${code.id}/restore`, {}, { cookie: admin })).statusCode).toBe(200);
  expect((await notes(cookie)).find((n) => n.id === code.id)).toEqual(code);
  expect((await panel(admin)).find((n) => n.id === code.id)).toMatchObject({ source: 'code', hidden: false });

  // The code's notes are hidden, never deleted; the panel's own go.
  expect((await post(ctx.app, `/galaxy/api/admin/notes/${code.id}/delete`, {}, { cookie: admin })).json()).toEqual({ error: 'note_from_code' });
  expect((await post(ctx.app, `/galaxy/api/admin/notes/${id}/delete`, {}, { cookie: admin })).statusCode).toBe(200);
  expect((await notes(cookie)).map((n) => n.id)).not.toContain(id);
  expect((await post(ctx.app, `/galaxy/api/admin/notes/${id}/hide`, {}, { cookie: admin })).json()).toEqual({ error: 'note_not_found' });

  expect(await audits(id)).toEqual(['notes.save', 'notes.delete']);
  expect(await audits(code.id)).toEqual(['notes.save', 'notes.hide', 'notes.restore']);
});

test('dos notas no comparten versión, lo que no vale no se guarda, y solo un admin edita', async () => {
  const admin = await staff('admin');
  const moderator = await staff('moderator');
  const cookie = await player();
  const taken = await put(ctx.app, `/galaxy/api/admin/notes/prueba-${randomUUID().slice(0, 8)}`, body(RELEASE_NOTES[0]!.version), { cookie: admin });
  expect(taken.statusCode).toBe(409);
  expect(taken.json()).toEqual({ error: 'note_version_taken' });
  expect((await put(ctx.app, '/galaxy/api/admin/notes/prueba-mala', { ...body('9.9'), items: [] }, { cookie: admin })).statusCode).toBe(400);
  expect((await put(ctx.app, '/galaxy/api/admin/notes/CON-MAYUS', body('9.8'), { cookie: admin })).statusCode).toBe(400);
  expect((await put(ctx.app, '/galaxy/api/admin/notes/prueba-mod', body('9.7'), { cookie: moderator })).statusCode).toBe(403);
  expect((await get(ctx.app, '/galaxy/api/admin/notes', { cookie: moderator })).statusCode).toBe(403);
  expect((await put(ctx.app, '/galaxy/api/admin/notes/prueba-jug', body('9.6'), { cookie })).statusCode).toBe(403);
});
