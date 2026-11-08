import { type AdminMailRow, type AdminNoticeRow, type MyMailbox, PROBE_TEST, type Role, type TitleNotice } from '@galaxy/shared';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { getWallet } from '../../src/economy/wallet';
import { createAdminViaCli, fixedConfig, get, post, sessionCookie, testApp, totpNow, uniqueName } from '../helpers';

// Communication on the server (GDD §16.5; M6d-1). Admins send news to a segment (here always a list of these tests'
// own accounts: the local database is the owner's, and a message for everyone would reach their accounts too), with
// gifts and the password; each receiver sees it while it is live, reads it and claims its gift once. Notices show on
// the title screen between their dates (every live one is ended in the same test). Everything is audited.

type Ctx = Awaited<ReturnType<typeof testApp>>;
let ctx: Ctx;
beforeAll(async () => {
  ctx = await testApp({ config: fixedConfig({}) });
});
afterAll(() => ctx.close());

async function player(opts: { xp?: number; username?: string } = {}) {
  const username = opts.username ?? uniqueName('mal');
  const res = await post(ctx.app, '/galaxy/api/auth/register', { username, password: 'una-clave-larga' });
  const cookie = sessionCookie(res);
  const id = (res.json() as { id: string }).id;
  await post(ctx.app, '/galaxy/api/probe-test', { answers: PROBE_TEST.questions.map((q) => q.answers.indexOf('lumen' as never)) }, { cookie });
  if (opts.xp) await ctx.db.insertInto('galaxy.account_xp').values({ account_id: id, xp: opts.xp }).execute();
  return { cookie, id, username };
}
type P = Awaited<ReturnType<typeof player>>;

async function staff(role: Role) {
  const { username, password, totpSecret } = await createAdminViaCli(ctx.db, role);
  const login = await post(ctx.app, '/galaxy/api/auth/login', { username, password });
  const res = await post(ctx.app, '/galaxy/api/auth/totp', { challenge: login.json().challenge, code: totpNow(totpSecret) });
  expect(res.statusCode).toBe(200);
  return { cookie: sessionCookie(res), username, password };
}
let admin: Awaited<ReturnType<typeof staff>>;
beforeAll(async () => {
  admin = await staff('admin');
});

const A = (path: string) => `/galaxy/api/admin${path}`;
const act = (path: string, body: object, cookie = admin.cookie) => post(ctx.app, A(path), body, { cookie });
const mailbox = async (p: P) => (await get(ctx.app, '/galaxy/api/mailbox', { cookie: p.cookie })).json() as MyMailbox;
const send = (to: string[], extra: object = {}) =>
  act('/mail', { title: 'Novedades de la beta', body: 'Gracias por jugar', audience: { kind: 'segment', usernames: to }, reason: 'Prueba del buzón', ...extra });
const claim = (p: P, id: string) => post(ctx.app, `/galaxy/api/mailbox/${id}/claim`, undefined, { cookie: p.cookie });
const audits = (id: string) => ctx.db.selectFrom('galaxy.admin_audit_log').select(['action', 'actor_label', 'after', 'reason']).where('target_id', '=', id).orderBy('id').execute();

describe('quién lo recibe', () => {
  test('una lista de nombres: lo ven ellos, no otros, y no quien se creó después de enviarse', async () => {
    const [a, b] = await Promise.all([player(), player()]);
    const later = uniqueName('mal');
    const res = await send([a.username, later]);
    expect(res.statusCode).toBe(200);
    const { id, recipients } = res.json() as { id: string; recipients: number };
    expect(recipients).toBe(1);
    const late = await player({ username: later });
    expect((await mailbox(a)).messages.map((m) => m.id)).toContain(id);
    expect((await mailbox(b)).messages.map((m) => m.id)).not.toContain(id);
    expect((await mailbox(late)).messages.map((m) => m.id)).not.toContain(id);
    expect((await claim(b, id)).json()).toEqual({ error: 'mail_gone' });
  });

  test('un segmento por nivel con nombres: solo quien cumple todo', async () => {
    const [low, high] = await Promise.all([player(), player({ xp: 1000 })]);
    const { id } = (await send([low.username, high.username], { audience: { kind: 'segment', usernames: [low.username, high.username], minLevel: 5 } })).json() as { id: string };
    expect((await mailbox(high)).messages.some((m) => m.id === id)).toBe(true);
    expect((await mailbox(low)).messages.some((m) => m.id === id)).toBe(false);
    expect((await act('/mail/preview', { audience: { kind: 'segment', usernames: [low.username, high.username], minLevel: 5 } })).json()).toEqual({ recipients: 1 });
  });
});

describe('leer y recoger', () => {
  test('sin leer cuenta como no leído; leerlo lo marca', async () => {
    const a = await player();
    const { id } = (await send([a.username])).json() as { id: string };
    const box = await mailbox(a);
    expect(box.messages.find((m) => m.id === id)).toMatchObject({ title: 'Novedades de la beta', read: false, claimed: false, gifts: {} });
    expect(box.unread).toBeGreaterThanOrEqual(1);
    expect((await post(ctx.app, `/galaxy/api/mailbox/${id}/read`, undefined, { cookie: a.cookie })).json()).toEqual({ read: true });
    expect((await mailbox(a)).messages.find((m) => m.id === id)!.read).toBe(true);
  });

  test('un regalo se recoge una vez, también desde dos pestañas a la vez, y queda en el libro de movimientos', async () => {
    const a = await player();
    const res = await send([a.username], { gifts: { coins: 100, dust: 5 }, password: admin.password });
    expect(res.statusCode).toBe(200);
    const { id } = res.json() as { id: string };
    const before = await getWallet(ctx.db, a.id);
    const [x, y] = await Promise.all([claim(a, id), claim(a, id)]);
    expect([x.statusCode, y.statusCode].sort()).toEqual([200, 409]);
    expect([x, y].find((r) => r.statusCode === 409)!.json()).toEqual({ error: 'mail_claimed' });
    const after = await getWallet(ctx.db, a.id);
    expect([after.coins - before.coins, after.dust - before.dust]).toEqual([100, 5]);
    const entries = await ctx.db.selectFrom('galaxy.ledger').select(['currency', 'delta']).where('account_id', '=', a.id).where('reason', '=', 'mail_gift').execute();
    expect(entries.map((e) => [e.currency, Number(e.delta)]).sort()).toEqual([
      ['coins', 100],
      ['dust', 5],
    ]);
    expect((await mailbox(a)).messages.find((m) => m.id === id)).toMatchObject({ read: true, claimed: true });
  });

  test('un mensaje retirado o caducado desaparece y su regalo ya no se recoge', async () => {
    const a = await player();
    const { id } = (await send([a.username], { gifts: { coins: 50 }, password: admin.password })).json() as { id: string };
    expect((await act(`/mail/${id}/withdraw`, { reason: 'Enviado por error' })).json()).toEqual({ withdrawn: true });
    expect((await mailbox(a)).messages.some((m) => m.id === id)).toBe(false);
    expect((await claim(a, id)).json()).toEqual({ error: 'mail_gone' });
    expect((await act(`/mail/${id}/withdraw`, { reason: 'Otra vez' })).json()).toEqual({ error: 'mail_gone' });
    const old = await ctx.db
      .insertInto('galaxy.mailbox_messages')
      .values({ title: 'Viejo', body: 'Ya pasó', gifts: JSON.stringify({ coins: 10 }), audience: JSON.stringify({ kind: 'segment', usernames: [a.username] }), created_at: new Date(Date.now() - 2 * 86_400_000), expires_at: new Date(Date.now() - 86_400_000) })
      .returning('id')
      .executeTakeFirstOrThrow();
    expect((await mailbox(a)).messages.some((m) => m.id === old.id)).toBe(false);
    expect((await claim(a, old.id)).json()).toEqual({ error: 'mail_gone' });
  });

  test('una cuenta baneada no recoge', async () => {
    const a = await player();
    const { id } = (await send([a.username], { gifts: { coins: 10 }, password: admin.password })).json() as { id: string };
    await ctx.db.updateTable('galaxy.accounts').set({ banned_until: new Date(Date.now() + 86_400_000) }).where('id', '=', a.id).execute();
    expect([401, 403]).toContain((await claim(a, id)).statusCode);
    expect(Number((await getWallet(ctx.db, a.id)).coins)).toBe(0);
  });
});

describe('el admin', () => {
  test('con regalos pide la contraseña: equivocada da 401 y no envía nada; sin regalos no la pide', async () => {
    const a = await player();
    expect((await send([a.username], { gifts: { coins: 100 } })).statusCode).toBe(400);
    expect((await send([a.username], { gifts: { coins: 100 }, password: 'no-es-esta' })).json()).toEqual({ error: 'password_wrong' });
    expect((await mailbox(a)).messages).toHaveLength(0);
    expect((await send([a.username])).statusCode).toBe(200);
  });

  test('la lista dice a cuántos llega, cuántos lo leyeron y cuántos recogieron, y queda en la auditoría', async () => {
    const [a, b] = await Promise.all([player(), player()]);
    const { id } = (await send([a.username, b.username], { gifts: { dust: 3 }, password: admin.password })).json() as { id: string };
    await claim(a, id);
    const row = ((await get(ctx.app, A('/mail'), { cookie: admin.cookie })).json() as AdminMailRow[]).find((m) => m.id === id)!;
    expect(row).toMatchObject({ recipients: 2, read: 1, claimed: 1, by: admin.username, withdrawnAt: null, gifts: { dust: 3 } });
    expect(await audits(id)).toMatchObject([{ action: 'mail.send', actor_label: admin.username, after: { title: 'Novedades de la beta', gifts: { dust: 3 }, recipients: 2 }, reason: 'Prueba del buzón' }]);
  });

  test('un moderador o un jugador no envían ni ven el buzón del panel', async () => {
    const p = await player();
    const mod = await staff('moderator');
    for (const cookie of [p.cookie, mod.cookie]) {
      expect((await get(ctx.app, A('/mail'), { cookie })).statusCode).toBe(403);
      expect((await act('/notices', { text: 'x', tone: 'info', startsAt: new Date().toISOString(), endsAt: new Date(Date.now() + 1000).toISOString(), reason: 'Prueba' }, cookie)).statusCode).toBe(403);
    }
    expect((await get(ctx.app, '/galaxy/api/mailbox')).statusCode).toBe(401);
  });
});

describe('avisos', () => {
  test('un aviso en curso sale en la pantalla de título hasta que se termina; uno futuro no sale', async () => {
    const p = await player();
    const now = Date.now();
    const live = (await act('/notices', { text: 'Aviso de prueba en curso', tone: 'warning', startsAt: new Date(now - 60_000).toISOString(), endsAt: new Date(now + 3_600_000).toISOString(), reason: 'Prueba' })).json() as { id: string };
    const future = (await act('/notices', { text: 'Aviso de prueba futuro', tone: 'info', startsAt: new Date(now + 86_400_000).toISOString(), endsAt: new Date(now + 2 * 86_400_000).toISOString(), reason: 'Prueba' })).json() as { id: string };
    try {
      const shown = (await get(ctx.app, '/galaxy/api/notices', { cookie: p.cookie })).json() as TitleNotice[];
      expect(shown.some((n) => n.id === live.id && n.tone === 'warning')).toBe(true);
      expect(shown.some((n) => n.id === future.id)).toBe(false);
      const list = (await get(ctx.app, A('/notices'), { cookie: admin.cookie })).json() as AdminNoticeRow[];
      expect(list.find((n) => n.id === live.id)).toMatchObject({ live: true, by: admin.username });
    } finally {
      expect((await act(`/notices/${live.id}/end`, { reason: 'Fin de la prueba' })).json()).toEqual({ ended: true });
      await act(`/notices/${future.id}/end`, { reason: 'Fin de la prueba' });
    }
    expect(((await get(ctx.app, '/galaxy/api/notices', { cookie: p.cookie })).json() as TitleNotice[]).some((n) => n.id === live.id)).toBe(false);
    expect((await act(`/notices/${live.id}/end`, { reason: 'Otra vez' })).json()).toEqual({ error: 'notice_gone' });
    expect((await audits(live.id)).map((r) => r.action)).toEqual(['notice.create', 'notice.end']);
  });
});
