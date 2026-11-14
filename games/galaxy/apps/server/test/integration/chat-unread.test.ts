import { randomInt, randomUUID } from 'node:crypto';
import { type ChatHistory, type ChatUnread, type LiveEvent, PROBE_TEST } from '@galaxy/shared';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type WebSocket from 'ws';
import { credit } from '../../src/economy/wallet';
import { get, ORIGIN, post, sessionCookie, testApp, uniqueName } from '../helpers';

// The chats' unread counts, mentions and live delivery (the owner's chat asks, 2026-11-14): a channel never read
// starts at its head; what others write after what I read counts (not mine, not who I blocked), 99 at most; what I
// read only moves forward; a mention is kept for who can read the channel and counted apart; the live socket brings a
// clan's messages in full, Comunidad's in full only to who has it open (the rest, a head every few seconds); a
// mention arrives marked. Clan channels keep the counts exact (Comunidad is shared by every test).

type Ctx = Awaited<ReturnType<typeof testApp>>;
let ctx: Ctx;
beforeAll(async () => {
  ctx = await testApp();
});
afterAll(() => ctx.close());

async function player() {
  const username = uniqueName('unr');
  const res = await post(ctx.app, '/galaxy/api/auth/register', { username, password: 'una-clave-larga' });
  const cookie = sessionCookie(res);
  const id = (res.json() as { id: string }).id;
  await post(ctx.app, '/galaxy/api/probe-test', { answers: PROBE_TEST.questions.map((q) => q.answers.indexOf('lumen' as never)) }, { cookie });
  await ctx.db.insertInto('galaxy.account_xp').values({ account_id: id, xp: 1000 }).execute();
  return { cookie, id, username };
}
type P = Awaited<ReturnType<typeof player>>;

async function clanWith(leader: P, ...members: P[]): Promise<string> {
  await credit(ctx.db, leader.id, 'coins', 2000, 'test');
  const tag = randomInt(36 ** 3, 36 ** 4).toString(36).toUpperCase();
  const res = await post(ctx.app, '/galaxy/api/clans', { name: `Leidos ${randomUUID().slice(0, 8).replace(/[^a-z]/g, 'x')}`, tag, emblem: 'eye', color: 'ice' }, { cookie: leader.cookie, headers: { 'idempotency-key': randomUUID() } });
  expect(res.statusCode).toBe(200);
  for (const m of members) await post(ctx.app, `/galaxy/api/clans/${tag}/join`, undefined, { cookie: m.cookie });
  return tag;
}
const clanKey = async (p: P) => `clan:${(await ctx.db.selectFrom('galaxy.clan_members').select('clan_id').where('account_id', '=', p.id).executeTakeFirstOrThrow()).clan_id}`;

const send = async (p: P, body: string, channel = 'clan') => {
  const res = await post(ctx.app, `/galaxy/api/chat/${channel}/messages`, { body }, { cookie: p.cookie });
  expect(res.statusCode).toBe(200);
  return res.json() as { id: string };
};
const unread = async (p: P) => (await get(ctx.app, '/galaxy/api/chat/unread', { cookie: p.cookie })).json() as ChatUnread;
const read = (p: P, channel: string, id: string) => post(ctx.app, '/galaxy/api/chat/read', { channel, id }, { cookie: p.cookie });
const block = (who: P, whom: P) => ctx.db.insertInto('galaxy.blocks').values({ blocker: who.id, blocked: whom.id }).execute();

/** The live socket as the browser opens it, with every event it receives. */
async function live(p: P) {
  const events: LiveEvent[] = [];
  const ws: WebSocket = await ctx.app.injectWS('/galaxy/api/live/ws', { headers: { origin: ORIGIN, cookie: `gs_sid=${p.cookie}` } });
  ws.on('message', (data) => events.push(JSON.parse(String(data)) as LiveEvent));
  return { ws, events, chat: () => events.filter((e) => e.type === 'chat' || e.type === 'chatHead' || e.type === 'chatRead') };
}
const settle = (ms = 150) => new Promise((r) => setTimeout(r, ms));

describe('sin leer', () => {
  test('un canal que nunca leí empieza en su cabeza; luego cuenta lo de otros, no lo mío ni lo de quien bloqueé', async () => {
    const [a, b, c] = [await player(), await player(), await player()];
    await clanWith(a, b, c);
    await send(b, 'antes de mirar');
    expect((await unread(a)).clan).toBe(0);
    await send(b, 'uno');
    await send(b, 'dos');
    await send(a, 'el mío');
    await block(a, c);
    await send(c, 'de alguien bloqueado');
    const u = await unread(a);
    expect(u.clan).toBe(2);
    expect(u.room).toBeNull();
  });

  test('lo leído solo avanza y nunca pasa del último mensaje del canal', async () => {
    const [a, b] = [await player(), await player()];
    await clanWith(a, b);
    await unread(a);
    const first = await send(b, 'uno');
    const second = await send(b, 'dos');
    const res = await read(a, 'clan', '999999999999');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: second.id });
    expect((await read(a, 'clan', first.id)).json()).toEqual({ id: second.id });
    expect((await unread(a)).clan).toBe(0);
    await send(b, 'tres');
    expect((await unread(a)).clan).toBe(1);
  });

  test('cuenta 99 como mucho', async () => {
    const [a, b] = [await player(), await player()];
    await clanWith(a, b);
    await unread(a);
    const key = await clanKey(b);
    await ctx.db
      .insertInto('galaxy.chat_messages')
      .values(Array.from({ length: 120 }, (_, i) => ({ channel: key, author_id: b.id, body: `mensaje ${i}` })))
      .execute();
    expect((await unread(a)).clan).toBe(99);
  });

  test('sin clan no hay contador de clan, y leer un clan ajeno no se puede', async () => {
    const a = await player();
    expect((await unread(a)).clan).toBeNull();
    expect((await read(a, 'clan', '1')).statusCode).toBe(403);
  });
});

describe('menciones', () => {
  test('se guarda solo para quien puede leer el canal, cuenta aparte y llega por el socket vivo marcada', async () => {
    const [a, b, outsider] = [await player(), await player(), await player()];
    await clanWith(a, b);
    await unread(b);
    const sock = await live(b);
    await settle();
    const m = await send(a, `@${b.username.toUpperCase()} y @${outsider.username}, mirad esto`);
    await settle();
    const rows = await ctx.db.selectFrom('galaxy.chat_mentions').select('account_id').where('message_id', '=', m.id).execute();
    expect(rows.map((r) => r.account_id)).toEqual([b.id]);
    const u = await unread(b);
    expect(u.clan).toBe(1);
    expect(u.mentions.clan).toBe(1);
    expect(sock.chat()).toContainEqual(expect.objectContaining({ type: 'chat', mention: true, message: expect.objectContaining({ id: m.id }) }));
    sock.ws.terminate();
  });

  test('quien bloqueó al autor no queda mencionado ni recibe el mensaje', async () => {
    const [a, b] = [await player(), await player()];
    await clanWith(a, b);
    await block(b, a);
    const sock = await live(b);
    await settle();
    const m = await send(a, `hola @${b.username}`);
    await settle();
    expect(await ctx.db.selectFrom('galaxy.chat_mentions').select('account_id').where('message_id', '=', m.id).execute()).toEqual([]);
    expect(sock.chat()).toEqual([]);
    sock.ws.terminate();
  });

  test('buscar nombres por cómo empiezan, sin los bloqueados en ningún sentido', async () => {
    const [a, b, c] = [await player(), await player(), await player()];
    await block(c, a);
    const prefix = b.username.slice(0, 6);
    const res = await get(ctx.app, `/galaxy/api/chat/mentions?q=${prefix}`, { cookie: a.cookie });
    expect(res.statusCode).toBe(200);
    const names = (res.json() as { players: { username: string }[] }).players.map((p) => p.username);
    expect(names).toContain(b.username);
    expect(names).not.toContain(c.username);
    expect((await get(ctx.app, '/galaxy/api/chat/mentions?q=a', { cookie: a.cookie })).statusCode).toBe(400);
  });
});

describe('en directo', () => {
  test('el clan: el mensaje entero a sus miembros; lo leído en un dispositivo llega a los demás', async () => {
    const [a, b] = [await player(), await player()];
    await clanWith(a, b);
    const sock = await live(b);
    await settle();
    const m = await send(a, 'hola clan');
    await settle();
    expect(sock.chat()).toContainEqual({ type: 'chat', message: expect.objectContaining({ id: m.id, channel: 'clan', body: 'hola clan' }) });
    await read(b, 'clan', m.id);
    await settle();
    expect(sock.chat()).toContainEqual({ type: 'chatRead', channel: 'clan', id: m.id });
    sock.ws.terminate();
  });

  test('Comunidad: entera a quien la tiene abierta; a quien no, un aviso con la cuenta unos segundos después', async () => {
    const [a, watching, away] = [await player(), await player(), await player()];
    const w = await live(watching);
    const z = await live(away);
    await settle();
    w.ws.send(JSON.stringify({ type: 'chat', open: 'global' }));
    await settle();
    const m = await send(a, 'hola a todos', 'global');
    await settle();
    expect(w.chat()).toContainEqual({ type: 'chat', message: expect.objectContaining({ id: m.id }) });
    expect(z.chat().some((e) => e.type === 'chat')).toBe(false);
    await settle(3300);
    const head = z.chat().find((e) => e.type === 'chatHead');
    expect(head).toMatchObject({ type: 'chatHead', channel: 'global' });
    expect(Number((head as { n: number }).n)).toBeGreaterThanOrEqual(1);
    w.ws.terminate();
    z.ws.terminate();
  }, 10_000);

  test('el historial no enseña lo que escribió alguien a quien bloqueé', async () => {
    const [a, b] = [await player(), await player()];
    await clanWith(a, b);
    await send(b, 'no deberías verme');
    await send(a, 'mi mensaje');
    await block(a, b);
    const h = (await get(ctx.app, '/galaxy/api/chat/clan', { cookie: a.cookie })).json() as ChatHistory;
    expect(h.messages.map((m) => m.body)).toEqual(['mi mensaje']);
  });
});
