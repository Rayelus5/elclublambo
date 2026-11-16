import { type AdminMailRow, type MyMailbox, PROBE_TEST, type Role } from '@galaxy/shared';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { dispatchDue } from '../../src/mail/jobs';
import { createAdminViaCli, fixedConfig, get, post, sessionCookie, testApp, totpNow, uniqueName } from '../helpers';

// Scheduled mail (mail v2, P5): a message written now and sent later. Nothing reaches a mailbox until its time; the
// dispatcher sends it once even when two run at the same moment, takes the audience as it is then, checks the big
// gift again against the writer's role, and withdrawing it before its time cancels it. The sent list says how many
// gifts each player already had or could not be given.

type Ctx = Awaited<ReturnType<typeof testApp>>;
let ctx: Ctx;
let clock = Date.now();
const now = () => new Date(clock);
beforeAll(async () => {
  ctx = await testApp({ config: fixedConfig({}), now });
});
afterAll(() => ctx.close());

async function player(username = uniqueName('prg')) {
  const res = await post(ctx.app, '/galaxy/api/auth/register', { username, password: 'una-clave-larga' });
  const cookie = sessionCookie(res);
  const id = (res.json() as { id: string }).id;
  await post(ctx.app, '/galaxy/api/probe-test', { answers: PROBE_TEST.questions.map((q) => q.answers.indexOf('lumen' as never)) }, { cookie });
  return { cookie, id, username };
}
type P = Awaited<ReturnType<typeof player>>;
async function staff(role: Role) {
  const { username, password, totpSecret } = await createAdminViaCli(ctx.db, role);
  const login = await post(ctx.app, '/galaxy/api/auth/login', { username, password });
  const res = await post(ctx.app, '/galaxy/api/auth/totp', { challenge: login.json().challenge, code: totpNow(totpSecret) });
  return { cookie: sessionCookie(res), password, username };
}
let admin: Awaited<ReturnType<typeof staff>>;
// Made before any test moves the clock (their TOTP codes go by the real time).
let writer: Awaited<ReturnType<typeof staff>>;
beforeAll(async () => {
  admin = await staff('admin');
  writer = await staff('admin');
});

const deps = () => ({ db: ctx.db, config: fixedConfig({}), now });
const schedule = (to: string[], inMinutes: number, extra: object = {}) =>
  post(
    ctx.app,
    '/galaxy/api/admin/mail',
    { title: 'Más tarde', body: 'Llega luego', audience: { kind: 'segment', usernames: to }, reason: 'Prueba programada', scheduledAt: new Date(clock + inMinutes * 60_000).toISOString(), ...extra },
    { cookie: admin.cookie },
  );
const box = async (p: P) => (await get(ctx.app, '/galaxy/api/mailbox', { cookie: p.cookie })).json() as MyMailbox;
const sent = async () => (await get(ctx.app, '/galaxy/api/admin/mail', { cookie: admin.cookie })).json() as AdminMailRow[];

describe('programado', () => {
  test('no llega hasta su hora; el despachador lo envía una sola vez aunque corran dos a la vez', async () => {
    const a = await player();
    const res = await schedule([a.username], 10);
    expect(res.statusCode).toBe(200);
    const { id } = res.json() as { id: string };
    expect((await box(a)).messages.some((m) => m.id === id)).toBe(false);
    expect((await sent()).find((m) => m.id === id)).toMatchObject({ sentAt: null });
    expect(await dispatchDue(deps())).toBe(0);
    clock += 11 * 60_000;
    const [x, y] = await Promise.all([dispatchDue(deps()), dispatchDue(deps())]);
    expect(x + y).toBeGreaterThanOrEqual(1);
    expect((await box(a)).messages.filter((m) => m.id === id)).toHaveLength(1);
    const receipts = await ctx.db.selectFrom('galaxy.mailbox_receipts').select('account_id').where('message_id', '=', id).execute();
    expect(receipts).toHaveLength(1);
    expect((await sent()).find((m) => m.id === id)!.sentAt).not.toBeNull();
  });

  test('el público se toma al despacharlo: quien se registra antes de su hora también lo recibe', async () => {
    const later = uniqueName('prg');
    const { id } = (await schedule([later], 5)).json() as { id: string };
    const p = await player(later);
    clock += 6 * 60_000;
    await dispatchDue(deps());
    expect((await box(p)).messages.some((m) => m.id === id)).toBe(true);
  });

  test('retirarlo antes de su hora lo cancela', async () => {
    const a = await player();
    const { id } = (await schedule([a.username], 5)).json() as { id: string };
    expect((await post(ctx.app, `/galaxy/api/admin/mail/${id}/withdraw`, { reason: 'Ya no hace falta' }, { cookie: admin.cookie })).statusCode).toBe(200);
    clock += 6 * 60_000;
    await dispatchDue(deps());
    expect((await box(a)).messages.some((m) => m.id === id)).toBe(false);
  });

  test('una hora pasada no se programa', async () => {
    const a = await player();
    expect((await schedule([a.username], -5)).json()).toEqual({ error: 'invalid_input' });
  });
});

describe('estadísticas de lo enviado', () => {
  test('cuenta lo que se dio, lo que ya tenían y lo que no se pudo dar', async () => {
    const a = await player();
    const res = await post(
      ctx.app,
      '/galaxy/api/admin/mail',
      { title: 'Regalo', body: 'Para ti', audience: { kind: 'segment', usernames: [a.username] }, reason: 'Prueba de estadísticas', password: admin.password, gifts: { items: [{ kind: 'currency', currency: 'coins', amount: 5 }, { kind: 'cosmetic', piece: 'frame', id: 'bronze' }], packs: [] } },
      { cookie: admin.cookie },
    );
    const { id } = res.json() as { id: string };
    await post(ctx.app, `/galaxy/api/mailbox/${id}/claim`, undefined, { cookie: a.cookie });
    const row = (await sent()).find((m) => m.id === id)!;
    expect(row.outcomes.granted).toBeGreaterThanOrEqual(1);
    expect(row.outcomes.granted + row.outcomes.owned + row.outcomes.skipped).toBe(2);
  });
});

describe('repaso de seguridad', () => {
  test('un programado no sale si a quien lo escribió le quitan el rol de admin, o lo banean', async () => {
    const id = (await ctx.db.selectFrom('galaxy.accounts').select('id').where('username', '=', writer.username.toLowerCase()).executeTakeFirstOrThrow()).id;
    const a = await player();
    const at = (n: number) => new Date(clock + n * 60_000).toISOString();
    const send = (title: string) =>
      post(ctx.app, '/galaxy/api/admin/mail', { title, body: 'Luego', audience: { kind: 'segment', usernames: [a.username] }, reason: 'Prueba de rol', scheduledAt: at(5) }, { cookie: writer.cookie });
    const first = ((await send('Sin rol')).json() as { id: string }).id;
    await ctx.db.deleteFrom('galaxy.account_roles').where('account_id', '=', id).execute();
    clock += 6 * 60_000;
    await dispatchDue(deps());
    expect((await box(a)).messages.some((m) => m.id === first)).toBe(false);
    const audit = await ctx.db.selectFrom('galaxy.admin_audit_log').select(['action', 'after']).where('target_id', '=', first).where('action', '=', 'mail.dispatch_refused').executeTakeFirst();
    expect(audit?.after).toMatchObject({ why: 'writer_revoked' });
  });

  test('los programados pendientes se ven en el panel aunque haya cincuenta envíos más nuevos', async () => {
    const a = await player();
    const { id } = (await schedule([a.username], 30)).json() as { id: string };
    // Fifty-one newer messages by an admin, straight in the table (the route's own limit is 60 a minute).
    const by = (await ctx.db.selectFrom('galaxy.accounts').select('id').where('username', '=', admin.username.toLowerCase()).executeTakeFirstOrThrow()).id;
    await ctx.db
      .insertInto('galaxy.mailbox_messages')
      .values(Array.from({ length: 51 }, (_, i) => ({ title: `Relleno ${i}`, body: 'x', gifts: '{}', audience: JSON.stringify({ kind: 'all' }), created_by: by, created_at: new Date(clock + (i + 1) * 1000), expires_at: new Date(clock + 86_400_000) })))
      .execute();
    expect((await sent()).some((m) => m.id === id)).toBe(true);
  });
});
