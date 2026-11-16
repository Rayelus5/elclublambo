import { type MyMailbox, PROBE_TEST, type Role } from '@galaxy/shared';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { getWallet } from '../../src/economy/wallet';
import { createAdminViaCli, del, fixedConfig, get, patch, post, sessionCookie, testApp, totpNow, uniqueName } from '../helpers';

// Mail v2 on the server (2026-11-16): messages have a type, give gifts of every kind and packs of the library (copied
// into the message when it is sent), big gifts are a superadmin's, and the mailbox claims everything at once, archives,
// deletes and pages. A message from before keeps paying with its old keys.

type Ctx = Awaited<ReturnType<typeof testApp>>;
let ctx: Ctx;
const live: Record<string, unknown> = {
  mail: { packs: [{ id: 'bienvenida', name: 'Bienvenida', art: 'chest', items: [{ kind: 'currency', currency: 'coins', amount: 30 }, { kind: 'cosmetic', piece: 'frame', id: 'bronze' }] }] },
};
beforeAll(async () => {
  ctx = await testApp({ config: fixedConfig(live) });
});
afterAll(() => ctx.close());

async function player() {
  const username = uniqueName('mv2');
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
  return { cookie: sessionCookie(res), password };
}
let admin: Awaited<ReturnType<typeof staff>>;
let superadmin: Awaited<ReturnType<typeof staff>>;
beforeAll(async () => {
  [admin, superadmin] = await Promise.all([staff('admin'), staff('superadmin')]);
});

const send = (to: string[], extra: object = {}, who = admin) =>
  post(ctx.app, '/galaxy/api/admin/mail', { title: 'Un regalo', body: 'Para ti', audience: { kind: 'segment', usernames: to }, reason: 'Prueba del buzón v2', password: who.password, ...extra }, { cookie: who.cookie });
const box = async (p: P, query = '') => (await get(ctx.app, `/galaxy/api/mailbox${query}`, { cookie: p.cookie })).json() as MyMailbox;
const claim = (p: P, id: string) => post(ctx.app, `/galaxy/api/mailbox/${id}/claim`, undefined, { cookie: p.cookie });

describe('enviar', () => {
  test('un mensaje lleva su tipo, sus regalos sueltos y la copia de sus packs', async () => {
    const a = await player();
    const res = await send([a.username], { type: 'gift', gifts: { items: [{ kind: 'currency', currency: 'components', amount: 9 }], packs: ['bienvenida'] } });
    expect(res.statusCode).toBe(200);
    const { id } = res.json() as { id: string };
    const m = (await box(a)).messages.find((x) => x.id === id)!;
    expect(m.type).toBe('gift');
    expect(m.contents.items).toEqual([{ kind: 'currency', currency: 'components', amount: 9 }]);
    expect(m.contents.packs).toMatchObject([{ id: 'bienvenida', name: 'Bienvenida', art: 'chest' }]);
    // The library changes later; what was sent does not.
    live.mail = { packs: [{ id: 'bienvenida', name: 'Otra cosa', art: 'star', items: [{ kind: 'xp', amount: 1 }] }] };
    expect((await box(a)).messages.find((x) => x.id === id)!.contents.packs[0]!.name).toBe('Bienvenida');
    live.mail = { packs: [{ id: 'bienvenida', name: 'Bienvenida', art: 'chest', items: [{ kind: 'currency', currency: 'coins', amount: 30 }, { kind: 'cosmetic', piece: 'frame', id: 'bronze' }] }] };
  });

  test('un pack que no está en la biblioteca o un regalo imposible no se envían', async () => {
    const a = await player();
    expect((await send([a.username], { gifts: { items: [], packs: ['no-existe'] } })).json()).toEqual({ error: 'pack_unknown' });
    const bad = await send([a.username], { gifts: { items: [{ kind: 'cosmetic', piece: 'frame', id: 'no-existe' }], packs: [] } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ error: 'gift_invalid', issues: [{ index: 0, code: 'cosmetic_unknown' }] });
  });

  test('un regalo grande solo lo envía un superadmin, y queda marcado', async () => {
    const a = await player();
    const big = { items: [{ kind: 'galaxy', tier: 'legendary', finish: 'normal', trait: null, count: 1 }], packs: [] };
    const res = await send([a.username], { gifts: big });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'gift_needs_superadmin', reasons: ['galaxy_tier'] });
    const ok = await send([a.username], { gifts: big }, superadmin);
    expect(ok.statusCode).toBe(200);
    const rows = (await get(ctx.app, '/galaxy/api/admin/mail', { cookie: superadmin.cookie })).json() as { id: string; big: boolean; type: string }[];
    expect(rows.find((r) => r.id === (ok.json() as { id: string }).id)).toMatchObject({ big: true, type: 'announcement' });
  });

  test('los límites del buzón solo los publica un superadmin', async () => {
    const body = { data: {}, reason: 'Ajustar los límites', password: admin.password };
    expect((await post(ctx.app, '/galaxy/api/admin/config/mailLimits', body, { cookie: admin.cookie })).json()).toEqual({ error: 'superadmin_only' });
    expect((await post(ctx.app, '/galaxy/api/admin/config/mailLimits', { ...body, password: superadmin.password }, { cookie: superadmin.cookie })).statusCode).toBe(201);
  });
});

describe('recoger', () => {
  test('da cada regalo, guarda lo que dio y lo enseña en la carta', async () => {
    const a = await player();
    const { id } = (await send([a.username], { type: 'reward', gifts: { items: [{ kind: 'galaxy', tier: 'rare', finish: 'normal', trait: null, count: 1 }], packs: ['bienvenida'] } })).json() as { id: string };
    const before = await getWallet(ctx.db, a.id);
    const res = await claim(a, id);
    expect(res.statusCode).toBe(200);
    const { granted } = res.json() as { granted: { outcome: string }[] };
    expect(granted.map((g) => g.outcome)).toEqual(['granted', 'granted', 'granted']);
    expect((await getWallet(ctx.db, a.id)).coins - before.coins).toBe(30);
    expect(await ctx.db.selectFrom('galaxy.galaxies').select('id').where('owner_id', '=', a.id).where('origin', '=', 'grant').execute()).toHaveLength(1);
    expect((await box(a)).messages.find((m) => m.id === id)).toMatchObject({ claimed: true, granted: [{ outcome: 'granted' }, { outcome: 'granted' }, { outcome: 'granted' }] });
  });

  test('un mensaje de antes paga con sus claves de siempre', async () => {
    const a = await player();
    const old = await ctx.db
      .insertInto('galaxy.mailbox_messages')
      .values({ title: 'Antiguo', body: 'De antes', gifts: JSON.stringify({ coins: 10, signal: 1 }), audience: JSON.stringify({ kind: 'segment', usernames: [a.username] }), created_at: new Date(), expires_at: new Date(Date.now() + 86_400_000) })
      .returning('id')
      .executeTakeFirstOrThrow();
    await ctx.db.insertInto('galaxy.mailbox_receipts').values({ message_id: old.id, account_id: a.id }).execute();
    expect((await box(a)).messages.find((m) => m.id === old.id)).toMatchObject({ type: 'announcement', gifts: { coins: 10, signal: 1 } });
    expect((await claim(a, old.id)).statusCode).toBe(200);
    const keys = await ctx.db.selectFrom('galaxy.ledger').select('operation_key').where('account_id', '=', a.id).where('reason', '=', 'mail_gift').execute();
    expect(keys.map((k) => k.operation_key).sort()).toEqual([`mail:${old.id}:coins`, `mail:${old.id}:signal`]);
  });

  test('«Recoger todo» recoge los regalos vivos de una vez', async () => {
    const a = await player();
    await send([a.username], { gifts: { items: [{ kind: 'currency', currency: 'coins', amount: 5 }], packs: [] } });
    await send([a.username], { gifts: { items: [{ kind: 'currency', currency: 'dust', amount: 5 }], packs: [] } });
    await send([a.username]);
    const res = await post(ctx.app, '/galaxy/api/mailbox/claim-all', undefined, { cookie: a.cookie });
    expect(res.json()).toMatchObject({ claimed: 2 });
    expect((await box(a)).unclaimed).toBe(0);
  });
});

describe('ordenar el buzón', () => {
  test('archivar lo pasa al archivo; borrar con un regalo sin recoger no se puede', async () => {
    const a = await player();
    const { id } = (await send([a.username], { gifts: { items: [{ kind: 'currency', currency: 'coins', amount: 5 }], packs: [] } })).json() as { id: string };
    expect((await patch(ctx.app, `/galaxy/api/mailbox/${id}`, { archived: true }, { cookie: a.cookie })).statusCode).toBe(200);
    expect((await box(a)).messages.some((m) => m.id === id)).toBe(false);
    expect((await box(a, '?box=archive')).messages.find((m) => m.id === id)).toMatchObject({ archived: true });
    expect((await del(ctx.app, `/galaxy/api/mailbox/${id}`, { cookie: a.cookie })).json()).toEqual({ error: 'mail_has_gift' });
    await claim(a, id);
    expect((await del(ctx.app, `/galaxy/api/mailbox/${id}`, { cookie: a.cookie })).statusCode).toBe(200);
    expect((await box(a, '?box=archive')).messages.some((m) => m.id === id)).toBe(false);
    expect((await claim(a, id)).json()).toEqual({ error: 'mail_gone' });
  });

  test('se filtra por tipo y se pasa de página con el cursor', async () => {
    const a = await player();
    for (let i = 0; i < 3; i++) await send([a.username], { type: 'event' });
    await send([a.username], { type: 'personal' });
    const events = await box(a, '?type=event');
    expect(events.messages.map((m) => m.type)).toEqual(['event', 'event', 'event']);
    const first = await box(a, '?limit=2');
    expect(first.messages).toHaveLength(2);
    expect(first.next).not.toBeNull();
    const second = await box(a, `?limit=2&cursor=${encodeURIComponent(first.next!)}`);
    expect(second.messages.map((m) => m.id)).not.toContain(first.messages[0]!.id);
    expect(first.unread).toBe(4);
  });
});

describe('revisión de P3', () => {
  test('cada destinatario recibe sus propias galaxias, no las mismas', async () => {
    const [a, b] = await Promise.all([player(), player()]);
    const { id } = (await send([a.username, b.username], { gifts: { items: [{ kind: 'galaxy', tier: 'rare', finish: 'normal', trait: null, count: 2 }], packs: [] } })).json() as { id: string };
    await claim(a, id);
    await claim(b, id);
    const dna = async (p: P) => (await ctx.db.selectFrom('galaxy.galaxies').select('dna').where('owner_id', '=', p.id).where('origin', '=', 'grant').execute()).map((r) => r.dna);
    const [da, db] = await Promise.all([dna(a), dna(b)]);
    expect(da).toHaveLength(2);
    expect(db).toHaveLength(2);
    expect(da.filter((x) => db.includes(x))).toEqual([]);
  });

  test('un mensaje con más de diez galaxias no se envía', async () => {
    const a = await player();
    const res = await send([a.username], { gifts: { items: [3, 3, 3, 2].map((count) => ({ kind: 'galaxy', tier: 'rare', finish: 'normal', trait: null, count })), packs: [] } }, superadmin);
    expect(res.json()).toEqual({ error: 'galaxy_too_many' });
  });
});

describe('el buzón del jugador (P6)', () => {
  test('lo recogido dice de qué semilla sale cada galaxia, y el buzón trae los nombres que piden sus regalos', async () => {
    const a = await player();
    const { id } = (await send([a.username], { gifts: { items: [{ kind: 'galaxy', tier: 'rare', finish: 'normal', trait: null, count: 1 }], packs: [] } })).json() as { id: string };
    const res = await claim(a, id);
    const made = (res.json() as { granted: { galaxies?: { id: string; seed?: string; designation?: string }[] }[] }).granted[0]!.galaxies![0]!;
    expect(made.seed).toMatch(/^\d+$/);
    expect(made.designation).toMatch(/^GX-/);
    const row = await ctx.db.selectFrom('galaxy.galaxies').select('seed').where('id', '=', made.id).executeTakeFirstOrThrow();
    expect(String(row.seed)).toBe(made.seed);
    expect((await box(a)).names).toMatchObject({ seasonCurrency: expect.any(String) });
  });
});
