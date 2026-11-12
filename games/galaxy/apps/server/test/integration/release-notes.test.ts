import { randomInt, randomUUID } from 'node:crypto';
import { type AdminReleaseNotesView, compareVersions, RELEASE_NOTES, type ReleaseNotesView } from '@galaxy/shared';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { createAdminViaCli, get, post, put, sessionCookie, testApp, totpNow, uniqueName } from '../helpers';

// «Notas de versión» (plan «notas de versión»): the players read the notes of the code merged with the panel's; the
// admin creates new ones (never over an existing one), corrects those of the code, hides and shows them again (a
// correction survives), takes a code note back to the game's text, and deletes only the panel's own; two visible notes
// never share a version through the panel; every change is audited. Moderators and players do not edit.
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
const freeVersion = () => `${randomInt(100, 999)}.${randomInt(0, 999)}`;
const freeId = () => `prueba-${randomUUID().slice(0, 8)}`;

test('los jugadores ven las notas del juego, de la más nueva a la más antigua, y una copia que no ha cambiado no se vuelve a mandar', async () => {
  const cookie = await player();
  const res = await get(ctx.app, '/galaxy/api/notes', { cookie });
  expect(res.statusCode).toBe(200);
  const list = (res.json() as ReleaseNotesView).notes;
  for (const n of RELEASE_NOTES) expect(list.map((x) => x.id)).toContain(n.id);
  for (let i = 1; i < list.length; i++) expect(compareVersions(list[i - 1]!.version, list[i]!.version)).toBeGreaterThanOrEqual(0);
  const etag = res.headers['etag'] as string;
  expect(etag).toMatch(/^"notes-/);
  expect((await get(ctx.app, '/galaxy/api/notes', { cookie, headers: { 'if-none-match': etag } })).statusCode).toBe(304);
  expect((await get(ctx.app, '/galaxy/api/notes')).statusCode).toBe(401);
});

test('crear una nota la publica con su fecha tal cual, y nunca pisa otra que ya existe', async () => {
  const admin = await staff('admin');
  const cookie = await player();
  const id = freeId();
  const version = freeVersion();
  expect((await post(ctx.app, '/galaxy/api/admin/notes', { id, ...body(version) }, { cookie: admin })).statusCode).toBe(200);
  expect((await notes(cookie)).find((n) => n.id === id)).toMatchObject({ version, date: '2026-12-01', title: 'Una prueba del panel' });
  expect((await panel(admin)).find((n) => n.id === id)).toMatchObject({ source: 'panel', hidden: false, date: '2026-12-01' });
  // The same id again, or a code note's id: refused, nothing changes.
  const again = await post(ctx.app, '/galaxy/api/admin/notes', { id, ...body(freeVersion(), 'Otra') }, { cookie: admin });
  expect(again.statusCode).toBe(409);
  expect(again.json()).toEqual({ error: 'note_exists' });
  expect((await post(ctx.app, '/galaxy/api/admin/notes', { id: RELEASE_NOTES[0]!.id, ...body(freeVersion()) }, { cookie: admin })).json()).toEqual({ error: 'note_exists' });
  expect((await notes(cookie)).find((n) => n.id === id)!.title).toBe('Una prueba del panel');
  // A date that does not exist is refused before it reaches the database.
  expect((await post(ctx.app, '/galaxy/api/admin/notes', { id: freeId(), ...body(freeVersion()), date: '2026-02-31' }, { cookie: admin })).statusCode).toBe(400);
});

test('corregir una nota del juego, ocultarla y mostrarla otra vez conserva la corrección; volver al texto del juego la deshace', async () => {
  const admin = await staff('admin');
  const cookie = await player();
  const code = RELEASE_NOTES.at(-1)!;
  expect((await put(ctx.app, `/galaxy/api/admin/notes/${code.id}`, { ...body(code.version, 'Beta abierta corregida'), date: code.date }, { cookie: admin })).statusCode).toBe(200);
  expect((await notes(cookie)).find((n) => n.id === code.id)!.title).toBe('Beta abierta corregida');
  expect((await panel(admin)).find((n) => n.id === code.id)).toMatchObject({ source: 'edited', date: code.date });
  expect((await post(ctx.app, `/galaxy/api/admin/notes/${code.id}/hide`, {}, { cookie: admin })).statusCode).toBe(200);
  expect((await notes(cookie)).map((n) => n.id)).not.toContain(code.id);
  // Editing it while hidden keeps it hidden.
  expect((await put(ctx.app, `/galaxy/api/admin/notes/${code.id}`, { ...body(code.version, 'Beta abierta, otra vez'), date: code.date }, { cookie: admin })).statusCode).toBe(200);
  expect((await panel(admin)).find((n) => n.id === code.id)).toMatchObject({ hidden: true, title: 'Beta abierta, otra vez' });
  expect((await post(ctx.app, `/galaxy/api/admin/notes/${code.id}/restore`, {}, { cookie: admin })).statusCode).toBe(200);
  expect((await notes(cookie)).find((n) => n.id === code.id)!.title).toBe('Beta abierta, otra vez');
  expect((await post(ctx.app, `/galaxy/api/admin/notes/${code.id}/revert`, {}, { cookie: admin })).statusCode).toBe(200);
  expect((await notes(cookie)).find((n) => n.id === code.id)).toEqual(code);
  expect((await panel(admin)).find((n) => n.id === code.id)).toMatchObject({ source: 'code', hidden: false });
  expect(await audits(code.id)).toEqual(['notes.save', 'notes.hide', 'notes.save', 'notes.restore', 'notes.revert']);
});

test('las notas del juego se ocultan pero no se eliminan; las del panel sí', async () => {
  const admin = await staff('admin');
  const cookie = await player();
  const code = RELEASE_NOTES.at(-2)!;
  expect((await post(ctx.app, `/galaxy/api/admin/notes/${code.id}/delete`, {}, { cookie: admin })).json()).toEqual({ error: 'note_from_code' });
  expect((await post(ctx.app, `/galaxy/api/admin/notes/${code.id}/revert`, {}, { cookie: admin })).statusCode).toBe(200);
  const id = freeId();
  await post(ctx.app, '/galaxy/api/admin/notes', { id, ...body(freeVersion()) }, { cookie: admin });
  expect((await post(ctx.app, `/galaxy/api/admin/notes/${id}/revert`, {}, { cookie: admin })).json()).toEqual({ error: 'note_not_from_code' });
  expect((await post(ctx.app, `/galaxy/api/admin/notes/${id}/delete`, {}, { cookie: admin })).statusCode).toBe(200);
  expect((await notes(cookie)).map((n) => n.id)).not.toContain(id);
  expect((await post(ctx.app, `/galaxy/api/admin/notes/${id}/hide`, {}, { cookie: admin })).json()).toEqual({ error: 'note_not_found' });
  expect(await audits(id)).toEqual(['notes.save', 'notes.delete']);
});

test('dos notas visibles no comparten versión por el panel, tampoco al mostrar una oculta; si llegan así, el panel lo marca', async () => {
  const admin = await staff('admin');
  const taken = await post(ctx.app, '/galaxy/api/admin/notes', { id: freeId(), ...body(RELEASE_NOTES[0]!.version) }, { cookie: admin });
  expect(taken.statusCode).toBe(409);
  expect(taken.json()).toEqual({ error: 'note_version_taken' });
  // Hide one, give its version to another, then try to show the first again.
  const version = freeVersion();
  const [first, second] = [freeId(), freeId()];
  await post(ctx.app, '/galaxy/api/admin/notes', { id: first, ...body(version) }, { cookie: admin });
  await post(ctx.app, `/galaxy/api/admin/notes/${first}/hide`, {}, { cookie: admin });
  expect((await post(ctx.app, '/galaxy/api/admin/notes', { id: second, ...body(version) }, { cookie: admin })).statusCode).toBe(200);
  expect((await post(ctx.app, `/galaxy/api/admin/notes/${first}/restore`, {}, { cookie: admin })).json()).toEqual({ error: 'note_version_taken' });
  // A note of the code arriving with a version the panel already used (a deploy): both stay, the panel flags them.
  const code = RELEASE_NOTES[0]!;
  await ctx.db.insertInto('galaxy.release_notes').values({ id: `${first}-dup`, version: code.version, date: code.date, title: 'Del panel', items: JSON.stringify(code.items) }).execute();
  try {
    const flagged = (await panel(admin)).filter((n) => n.version === code.version);
    expect(flagged.length).toBe(2);
    expect(flagged.every((n) => n.clash)).toBe(true);
  } finally {
    await ctx.db.deleteFrom('galaxy.release_notes').where('id', '=', `${first}-dup`).execute();
  }
});

test('lo que no vale no se guarda, y solo un admin edita', async () => {
  const admin = await staff('admin');
  const moderator = await staff('moderator');
  const cookie = await player();
  expect((await put(ctx.app, '/galaxy/api/admin/notes/prueba-mala', { ...body('9.9'), items: [] }, { cookie: admin })).statusCode).toBe(400);
  expect((await put(ctx.app, '/galaxy/api/admin/notes/CON-MAYUS', body('9.8'), { cookie: admin })).statusCode).toBe(400);
  expect((await put(ctx.app, `/galaxy/api/admin/notes/${freeId()}`, body(freeVersion()), { cookie: admin })).json()).toEqual({ error: 'note_not_found' });
  expect((await post(ctx.app, '/galaxy/api/admin/notes', { id: 'prueba-mod', ...body('9.7') }, { cookie: moderator })).statusCode).toBe(403);
  expect((await get(ctx.app, '/galaxy/api/admin/notes', { cookie: moderator })).statusCode).toBe(403);
  expect((await post(ctx.app, '/galaxy/api/admin/notes', { id: 'prueba-jug', ...body('9.6') }, { cookie })).statusCode).toBe(403);
});
