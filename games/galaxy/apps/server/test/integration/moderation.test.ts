import { randomInt, randomUUID } from 'node:crypto';
import { type ChatHistory, type LiveEvent, type ModChannel, type ModMessage, type ModMute, type ModReportPage, PROBE_TEST, type Role } from '@galaxy/shared';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { credit } from '../../src/economy/wallet';
import type WebSocket from 'ws';
import { createAdminViaCli, fixedConfig, get, ORIGIN, post, sessionCookie, testApp, totpNow, uniqueName } from '../helpers';

// Chat moderation on the server (GDD §16.1, §16.4; M6c-1): staff with TOTP (moderators too) watch every chat, hide and
// restore messages, work the report queue and mute accounts; each change is audited. A message kept visible is not
// hidden again by old reports; two staff resolving the same report get one review. The in-game hide and mute are
// audited too, and nobody mutes staff they may not act on.

type Ctx = Awaited<ReturnType<typeof testApp>>;
let ctx: Ctx;
beforeAll(async () => {
  ctx = await testApp({ config: fixedConfig({}) });
});
afterAll(() => ctx.close());

async function player() {
  const username = uniqueName('mdp');
  const res = await post(ctx.app, '/galaxy/api/auth/register', { username, password: 'una-clave-larga' });
  const cookie = sessionCookie(res);
  const id = (res.json() as { id: string }).id;
  await post(ctx.app, '/galaxy/api/probe-test', { answers: PROBE_TEST.questions.map((q) => q.answers.indexOf('lumen' as never)) }, { cookie });
  await ctx.db.insertInto('galaxy.account_xp').values({ account_id: id, xp: 1000 }).execute();
  return { cookie, id, username };
}
type P = Awaited<ReturnType<typeof player>>;

async function staff(role: Role): Promise<P> {
  const { username, password, totpSecret } = await createAdminViaCli(ctx.db, role);
  const login = await post(ctx.app, '/galaxy/api/auth/login', { username, password });
  const res = await post(ctx.app, '/galaxy/api/auth/totp', { challenge: login.json().challenge, code: totpNow(totpSecret) });
  expect(res.statusCode).toBe(200);
  const row = await ctx.db.selectFrom('galaxy.accounts').select('id').where('username', '=', username).executeTakeFirstOrThrow();
  return { cookie: sessionCookie(res), id: row.id, username };
}
let mod: P;
beforeAll(async () => {
  mod = await staff('moderator');
});

const M = (path: string) => `/galaxy/api/admin/moderation${path}`;
const act = (path: string, body: object, p: P = mod) => post(ctx.app, M(path), body, { cookie: p.cookie });
const read = async <T>(path: string, p: P = mod) => (await get(ctx.app, M(path), { cookie: p.cookie })).json() as T;
const write = async (p: P, body: string, channel = 'global') => {
  const res = await post(ctx.app, `/galaxy/api/chat/${channel}/messages`, { body }, { cookie: p.cookie });
  expect(res.statusCode).toBe(200);
  return (res.json() as { id: string }).id;
};
const report = (p: P, id: string, reason?: string) => post(ctx.app, `/galaxy/api/chat/messages/${id}/report`, reason ? { reason } : {}, { cookie: p.cookie });
const seen = async (p: P, id: string) => ((await get(ctx.app, '/galaxy/api/chat/global', { cookie: p.cookie })).json() as ChatHistory).messages.some((m) => m.id === id);
const audits = (target: string) =>
  ctx.db.selectFrom('galaxy.admin_audit_log').select(['action', 'actor_label', 'before', 'after', 'reason']).where('target_id', '=', target).orderBy('id').execute();
const inQueue = async (id: string) => (await read<ModReportPage>('/reports')).reports.find((r) => r.message.id === id);

describe('quién entra', () => {
  test('sin sesión 401, un jugador 403, un moderador con TOTP lee los cuatro apartados', async () => {
    const p = await player();
    expect((await get(ctx.app, M('/reports'))).statusCode).toBe(401);
    for (const path of ['/channels', '/messages?channel=global', '/reports', '/mutes']) {
      expect((await get(ctx.app, M(path), { cookie: p.cookie })).statusCode).toBe(403);
      expect((await get(ctx.app, M(path), { cookie: mod.cookie })).statusCode).toBe(200);
    }
    expect((await act('/mutes', { username: p.username, minutes: 10, reason: 'Insultos' }, p)).statusCode).toBe(403);
  });
});

describe('chat en vivo', () => {
  test('los canales son el global y los clanes con mensajes, y los mensajes de un clan se leen sin ser miembro', async () => {
    const leader = await player();
    await credit(ctx.db, leader.id, 'coins', 2000, 'test');
    const tag = randomInt(36 ** 3, 36 ** 4).toString(36).toUpperCase();
    const name = `Vigia ${randomUUID().slice(0, 6).replace(/[^a-z]/g, 'x')}`;
    expect((await post(ctx.app, '/galaxy/api/clans', { name, tag, emblem: 'eye', color: 'ice' }, { cookie: leader.cookie, headers: { 'idempotency-key': randomUUID() } })).statusCode).toBe(200);
    const id = await write(leader, 'hola clan', 'clan');
    const channels = await read<ModChannel[]>('/channels');
    expect(channels[0]).toMatchObject({ key: 'global' });
    const mine = channels.find((c) => c.label === `[${tag}] ${name}`)!;
    expect(mine.key).toMatch(/^clan:[0-9a-f-]{36}$/);
    const messages = await read<ModMessage[]>(`/messages?channel=${mine.key}`);
    expect(messages[0]).toMatchObject({ id, author: leader.username, body: 'hola clan', hidden: null, reports: 0 });
  });

  test('los más nuevos primero, ocultos incluidos, y anteriores con el cursor', async () => {
    const a = await player();
    const first = await write(a, 'uno');
    const second = await write(a, 'dos');
    await act(`/messages/${first}/hide`, { reason: 'Prueba de cursor' });
    const page = await read<ModMessage[]>('/messages?channel=global');
    expect(page.findIndex((m) => m.id === second)).toBeLessThan(page.findIndex((m) => m.id === first));
    const older = await read<ModMessage[]>(`/messages?channel=global&before=${second}`);
    expect(older.every((m) => BigInt(m.id) < BigInt(second))).toBe(true);
    expect(older.find((m) => m.id === first)).toMatchObject({ body: 'uno', hidden: { reason: 'moderator', by: mod.username } });
  });

  test('ocultar y restaurar cambian lo que ven los jugadores, una sola vez cada uno, y quedan en la auditoría', async () => {
    const a = await player();
    const id = await write(a, 'esto sobra');
    expect((await act(`/messages/${id}/hide`, { reason: 'Insulto' })).json()).toEqual({ hidden: true });
    expect(await seen(a, id)).toBe(false);
    expect((await act(`/messages/${id}/hide`, { reason: 'Insulto' })).json()).toEqual({ error: 'message_hidden' });
    expect((await act(`/messages/${id}/restore`, { reason: 'Era una broma entre amigos' })).json()).toEqual({ hidden: false });
    expect(await seen(a, id)).toBe(true);
    expect((await act(`/messages/${id}/restore`, { reason: 'Otra vez' })).json()).toEqual({ error: 'message_visible' });
    expect((await act('/messages/999999999999/hide', { reason: 'No existe' })).json()).toEqual({ error: 'message_not_found' });
    expect(await audits(id)).toEqual([
      { action: 'chat.hide', actor_label: mod.username, before: { body: 'esto sobra' }, after: null, reason: 'Insulto' },
      { action: 'chat.restore', actor_label: mod.username, before: { reason: 'moderator', by: mod.username }, after: null, reason: 'Era una broma entre amigos' },
    ]);
  });
});

describe('cola de denuncias', () => {
  test('lo denunciado más recientemente va primero, con cuántos mensajes esperan y sus páginas de 50', async () => {
    const [a, b] = await Promise.all([player(), player()]);
    const first = await write(a, 'primero en llegar');
    const second = await write(a, 'segundo en llegar');
    await report(b, first);
    await report(b, second);
    const queue = await read<ModReportPage>('/reports');
    expect(queue.reports.slice(0, 2).map((r) => r.message.id)).toEqual([second, first]);
    expect(queue.reports.length).toBeLessThanOrEqual(50);
    expect(queue.total).toBeGreaterThanOrEqual(2);
    expect(queue).toMatchObject({ page: 1, pages: Math.max(1, Math.ceil(queue.total / 50)) });
    const last = await read<ModReportPage>(`/reports?page=${queue.pages}`);
    expect(last.page).toBe(queue.pages);
    expect((await get(ctx.app, M('/reports?page=0'), { cookie: mod.cookie })).statusCode).toBe(400);
  });

  test('dejar visible un mensaje ocultado por denuncias lo devuelve, y una denuncia más no lo vuelve a ocultar', async () => {
    const [a, b, c, d, e] = await Promise.all([player(), player(), player(), player(), player()]);
    const id = await write(a, 'opinión polémica');
    await report(b, id, 'Me ofende');
    await report(c, id);
    expect((await report(d, id, 'Spam')).json()).toEqual({ hidden: true });
    expect(await inQueue(id)).toMatchObject({ pending: 3, reasons: ['Spam', 'Me ofende'], message: { hidden: { reason: 'reports', by: null }, reports: 3 } });

    expect((await act(`/reports/${id}`, { outcome: 'kept', reason: 'No incumple las normas' })).json()).toEqual({ outcome: 'kept' });
    expect(await seen(a, id)).toBe(true);
    expect(await inQueue(id)).toBeUndefined();

    expect((await report(e, id, 'Sigue sin gustarme')).json()).toEqual({ hidden: false });
    expect(await seen(a, id)).toBe(true);
    expect(await inQueue(id)).toMatchObject({ pending: 1, reasons: ['Sigue sin gustarme'] });
  });

  test('dos moderadores a la vez: uno resuelve, el otro recibe 409, y queda una sola revisión', async () => {
    const other = await staff('moderator');
    const [a, b] = await Promise.all([player(), player()]);
    const id = await write(a, 'esto se denuncia');
    await report(b, id, 'Insulto');
    const [x, y] = await Promise.all([act(`/reports/${id}`, { outcome: 'hidden', reason: 'Insulto claro' }), act(`/reports/${id}`, { outcome: 'kept', reason: 'Se queda' }, other)]);
    expect([x.statusCode, y.statusCode].sort()).toEqual([200, 409]);
    expect([x, y].find((r) => r.statusCode === 409)!.json()).toEqual({ error: 'report_reviewed' });
    const reviews = await ctx.db.selectFrom('galaxy.chat_report_reviews').selectAll().where('message_id', '=', id).execute();
    expect(reviews).toHaveLength(1);
    expect((await audits(id)).filter((r) => r.action === 'chat.review')).toHaveLength(1);
  });

  test('ocultar desde la cola lo quita a los jugadores y lo audita con lo que se decidió', async () => {
    const [a, b] = await Promise.all([player(), player()]);
    const id = await write(a, 'otro insulto');
    await report(b, id);
    expect((await act(`/reports/${id}`, { outcome: 'hidden', reason: 'Insulto' })).statusCode).toBe(200);
    expect(await seen(a, id)).toBe(false);
    expect(await audits(id)).toEqual([{ action: 'chat.review', actor_label: mod.username, before: { hidden: null, pending: 1 }, after: { outcome: 'hidden' }, reason: 'Insulto' }]);
    expect((await act(`/reports/${id}`, { outcome: 'hidden', reason: 'Otra vez' })).json()).toEqual({ error: 'report_reviewed' });
  });

  test('restaurar desde el chat en vivo también resuelve sus denuncias', async () => {
    const [a, b, c, d, e] = await Promise.all([player(), player(), player(), player(), player()]);
    const id = await write(a, 'otra opinión');
    for (const p of [b, c, d]) await report(p, id);
    await act(`/messages/${id}/restore`, { reason: 'No incumple las normas' });
    expect(await inQueue(id)).toBeUndefined();
    expect((await report(e, id)).json()).toEqual({ hidden: false });
  });
});

describe('silencios', () => {
  test('silenciar y levantar desde el panel, con su lista y su auditoría', async () => {
    const a = await player();
    const res = await act('/mutes', { username: a.username, minutes: 60, reason: 'Insultos' });
    expect(res.statusCode).toBe(200);
    expect((await read<ModMute[]>('/mutes')).find((m) => m.username === a.username)).toMatchObject({ reason: 'Insultos', by: mod.username });
    expect((await post(ctx.app, '/galaxy/api/chat/global/messages', { body: 'hola' }, { cookie: a.cookie })).json()).toEqual({ error: 'chat_muted' });
    expect((await act(`/mutes/${a.username}/lift`, { reason: 'Se disculpó' })).json()).toEqual({ lifted: true });
    expect((await read<ModMute[]>('/mutes')).some((m) => m.username === a.username)).toBe(false);
    await write(a, 'perdón');
    expect((await act(`/mutes/${a.username}/lift`, { reason: 'Otra vez' })).json()).toEqual({ error: 'mute_not_found' });
    expect((await audits(a.id)).map((r) => [r.action, r.reason])).toEqual([
      ['chat.mute', 'Insultos'],
      ['chat.unmute', 'Se disculpó'],
    ]);
  });

  test('un moderador no silencia a un admin ni a sí mismo', async () => {
    const admin = await staff('admin');
    expect((await act('/mutes', { username: admin.username, minutes: 10, reason: 'Prueba' })).json()).toEqual({ error: 'staff_target' });
    expect((await act('/mutes', { username: mod.username, minutes: 10, reason: 'Prueba' })).json()).toEqual({ error: 'self_target' });
  });
});

describe('desde el chat del juego', () => {
  test('ocultar y silenciar desde el chat quedan en la auditoría, y respetan a quién se puede tocar', async () => {
    const a = await player();
    const id = await write(a, 'fuera de tono');
    expect((await post(ctx.app, `/galaxy/api/chat/messages/${id}/hide`, undefined, { cookie: mod.cookie })).statusCode).toBe(200);
    expect(await audits(id)).toMatchObject([{ action: 'chat.hide', actor_label: mod.username, reason: 'Ocultado desde el chat' }]);
    expect((await post(ctx.app, '/galaxy/api/chat/mutes', { username: a.username, minutes: 30, reason: 'Fuera de tono' }, { cookie: mod.cookie })).statusCode).toBe(200);
    expect((await audits(a.id)).map((r) => [r.action, r.reason])).toEqual([['chat.mute', 'Fuera de tono']]);
    const admin = await staff('admin');
    expect((await post(ctx.app, '/galaxy/api/chat/mutes', { username: admin.username, minutes: 30, reason: 'Prueba' }, { cookie: mod.cookie })).json()).toEqual({ error: 'staff_target' });
  });
});

// The owner's chat asks (2026-11-14): searching every chat at once, the reports counted on each message, many hidden at
// once, what an account wrote lately, hide and mute in one go, «Eliminar» (never undone), and the live socket telling
// moderation what is new.
describe('a escala', () => {
  test('buscar en todos los chats por texto, cuenta, estado y denuncias', async () => {
    const [a, b] = [await player(), await player()];
    const word = `zq${randomUUID().slice(0, 6).replace(/[^a-z0-9]/g, 'x')}`;
    const first = await write(a, `algo con ${word} dentro`);
    const second = await write(b, `otra vez ${word.toUpperCase()}`);
    await write(a, 'nada que ver');
    const byText = await read<ModMessage[]>(`/messages?q=${word}`);
    expect(byText.map((m) => m.id)).toEqual([second, first]);
    expect((await read<ModMessage[]>(`/messages?q=${word}&author=${a.username}`)).map((m) => m.id)).toEqual([first]);
    await act(`/messages/${first}/hide`, { reason: 'Prueba de estado' });
    expect((await read<ModMessage[]>(`/messages?q=${word}&state=hidden`)).map((m) => m.id)).toEqual([first]);
    expect((await read<ModMessage[]>(`/messages?q=${word}&state=visible`)).map((m) => m.id)).toEqual([second]);
    await report(a, second, 'spam');
    const reported = await read<ModMessage[]>(`/messages?q=${word}&reported=1`);
    expect(reported).toEqual([expect.objectContaining({ id: second, reports: 1, pending: 1 })]);
    // An account that does not exist finds nothing; two letters are not a search.
    expect(await read<ModMessage[]>('/messages?author=nadie_existe_aqui')).toEqual([]);
    expect((await get(ctx.app, M('/messages?q=ab'), { cookie: mod.cookie })).statusCode).toBe(400);
  });

  test('cada mensaje lleva sus denuncias: todas y las que esperan desde su última revisión', async () => {
    const [a, r1, r2, r3] = [await player(), await player(), await player(), await player()];
    const id = await write(a, `denunciable ${randomUUID().slice(0, 6)}`);
    await report(r1, id);
    await report(r2, id);
    let q = await inQueue(id);
    expect(q?.pending).toBe(2);
    expect(q?.message).toMatchObject({ reports: 2, pending: 2 });
    await act(`/reports/${id}`, { outcome: 'kept', reason: 'No incumple las normas' });
    expect(await inQueue(id)).toBeUndefined();
    await report(r3, id);
    q = await inQueue(id);
    expect(q?.message).toMatchObject({ reports: 3, pending: 1 });
  });

  test('ocultar varios a la vez, una sola entrada en la auditoría, y los ya ocultos se dejan como están', async () => {
    const a = await player();
    const ids = [await write(a, 'uno'), await write(a, 'dos'), await write(a, 'tres')];
    await act(`/messages/${ids[2]}/hide`, { reason: 'Ya estaba' });
    expect((await act('/messages/hide', { ids, reason: 'Inundación' })).json()).toEqual({ hidden: 2 });
    for (const id of ids) expect(await seen(a, id)).toBe(false);
    // One entry for the change, on one of the messages hidden.
    const entries = [...(await audits(ids[0]!)), ...(await audits(ids[1]!))].filter((r) => r.action === 'chat.hide_many');
    expect(entries).toHaveLength(1);
    expect(entries[0]!.after).toMatchObject({ ids: expect.arrayContaining([ids[0], ids[1]]) });
    expect((await act('/messages/hide', { ids: [], reason: 'Nada' })).statusCode).toBe(400);
  });

  test('ocultar lo último de una cuenta: solo lo de su ventana, y nunca a alguien del equipo', async () => {
    const a = await player();
    const old = await write(a, 'de hace tiempo');
    await ctx.db.updateTable('galaxy.chat_messages').set({ created_at: new Date(Date.now() - 3 * 3_600_000) }).where('id', '=', old).execute();
    const recent = [await write(a, 'spam 1'), await write(a, 'spam 2')];
    expect((await act(`/authors/${a.username}/hide`, { hours: 1, reason: 'Spam' })).json()).toEqual({ hidden: 2 });
    expect(await seen(a, old)).toBe(true);
    for (const id of recent) expect(await seen(a, id)).toBe(false);
    expect((await act(`/authors/${a.username}/hide`, { hours: 2, reason: 'Spam' })).statusCode).toBe(400);
    const admin = await staff('admin');
    expect((await act(`/authors/${admin.username}/hide`, { hours: 24, reason: 'No se puede' })).statusCode).toBe(403);
  });

  test('ocultar y silenciar de una vez', async () => {
    const a = await player();
    const id = await write(a, 'insulto');
    const res = await act(`/messages/${id}/hide-mute`, { minutes: 60, reason: 'Insultos' });
    expect(res.json()).toMatchObject({ hidden: true });
    expect(await seen(a, id)).toBe(false);
    expect((await post(ctx.app, '/galaxy/api/chat/global/messages', { body: 'otra vez' }, { cookie: a.cookie })).json()).toEqual({ error: 'chat_muted' });
  });

  test('«Eliminar» no se deshace: no se restaura ni se elimina dos veces, y queda su texto en la auditoría', async () => {
    const a = await player();
    const id = await write(a, 'mi teléfono es 600 000 000');
    expect((await act(`/messages/${id}/delete`, { reason: 'Datos personales' })).json()).toEqual({ deleted: true });
    expect(await seen(a, id)).toBe(false);
    expect((await act(`/messages/${id}/restore`, { reason: 'Error' })).json()).toEqual({ error: 'message_deleted' });
    expect((await act(`/messages/${id}/delete`, { reason: 'Otra vez' })).json()).toEqual({ error: 'message_deleted' });
    const [row] = await read<ModMessage[]>(`/messages?author=${a.username}`);
    expect(row?.hidden?.reason).toBe('deleted');
    expect((await audits(id)).find((r) => r.action === 'chat.delete')?.before).toMatchObject({ body: 'mi teléfono es 600 000 000' });
  });

  test('con la moderación abierta, el socket vivo avisa de cada mensaje nuevo y de cada denuncia; a un jugador, no', async () => {
    const [a, r, nosy] = [await player(), await player(), await player()];
    const listen = async (p: P) => {
      const events: LiveEvent[] = [];
      const ws: WebSocket = await ctx.app.injectWS('/galaxy/api/live/ws', { headers: { origin: ORIGIN, cookie: `gs_sid=${p.cookie}` } });
      ws.on('message', (data) => events.push(JSON.parse(String(data)) as LiveEvent));
      await new Promise((res) => setTimeout(res, 100));
      ws.send(JSON.stringify({ type: 'mod', open: true }));
      await new Promise((res) => setTimeout(res, 100));
      return { ws, mod: () => events.filter((e) => e.type === 'modChat' || e.type === 'modReport') };
    };
    const [staffSocket, playerSocket] = [await listen(mod), await listen(nosy)];
    const id = await write(a, 'algo nuevo');
    await report(r, id);
    await new Promise((res) => setTimeout(res, 150));
    expect(staffSocket.mod()).toEqual([{ type: 'modChat', channel: 'global' }, { type: 'modReport' }]);
    expect(playerSocket.mod()).toEqual([]);
    staffSocket.ws.terminate();
    playerSocket.ws.terminate();
  });
});
