import { randomInt, randomUUID } from 'node:crypto';
import { type ChatEvent, type ChatHistory, type ChatMessage, PROBE_TEST, type RoomView } from '@galaxy/shared';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type WebSocket from 'ws';
import { credit } from '../../src/economy/wallet';
import { createAdminViaCli, fixedConfig, get, ORIGIN, post, put, sessionCookie, testApp, totpNow, uniqueName } from '../helpers';

// The chats on the server (GDD §14.4; M5b-2): reading a channel and whether one can write; writing needs the level,
// no mute and the per-minute limit, and the filter covers its words; the socket pushes each message only to who can
// read it, and a message taken down as `deleted`; reports hide a message at three; moderators hide and mute.

type Ctx = Awaited<ReturnType<typeof testApp>>;
let clock = new Date();
let ctx: Ctx;
beforeAll(async () => {
  ctx = await testApp({ now: () => clock, config: fixedConfig({ chat: { words: ['tonto'] } }) });
});
afterAll(() => ctx.close());

async function player(level = 5) {
  const username = uniqueName('cht');
  const res = await post(ctx.app, '/galaxy/api/auth/register', { username, password: 'una-clave-larga' });
  const cookie = sessionCookie(res);
  const id = (res.json() as { id: string }).id;
  await post(ctx.app, '/galaxy/api/probe-test', { answers: PROBE_TEST.questions.map((q) => q.answers.indexOf('lumen' as never)) }, { cookie });
  const xp = [0, 0, 100, 300, 600, 1000][level] ?? 1000;
  if (xp > 0) await ctx.db.insertInto('galaxy.account_xp').values({ account_id: id, xp }).execute();
  return { cookie, id, username };
}
type P = Awaited<ReturnType<typeof player>>;

async function moderator(): Promise<P> {
  const { username, password, totpSecret } = await createAdminViaCli(ctx.db, 'moderator');
  const login = await post(ctx.app, '/galaxy/api/auth/login', { username, password });
  const res = await post(ctx.app, '/galaxy/api/auth/totp', { challenge: login.json().challenge, code: totpNow(totpSecret) });
  expect(res.statusCode).toBe(200);
  const row = await ctx.db.selectFrom('galaxy.accounts').select('id').where('username', '=', username).executeTakeFirstOrThrow();
  return { cookie: sessionCookie(res), id: row.id, username };
}

const send = (p: P, body: string, channel = 'global') => post(ctx.app, `/galaxy/api/chat/${channel}/messages`, { body }, { cookie: p.cookie });
const history = async (p: P, channel = 'global') => (await get(ctx.app, `/galaxy/api/chat/${channel}`, { cookie: p.cookie })).json() as ChatHistory;

/** A socket as the browser opens it, with every event it receives. */
async function socket(p: P | null, origin = ORIGIN) {
  const events: ChatEvent[] = [];
  let closed: number | null = null;
  const ws: WebSocket = await ctx.app.injectWS('/galaxy/api/chat/ws', { headers: { origin, ...(p ? { cookie: `gs_sid=${p.cookie}` } : {}) } });
  ws.on('message', (data) => events.push(JSON.parse(String(data)) as ChatEvent));
  ws.on('close', (code) => {
    closed = code;
  });
  return { ws, events, closed: () => closed };
}
const settle = () => new Promise((r) => setTimeout(r, 150));

async function clanWith(leader: P, ...members: P[]): Promise<string> {
  await credit(ctx.db, leader.id, 'coins', 2000, 'test');
  const tag = randomInt(36 ** 3, 36 ** 4).toString(36).toUpperCase();
  const res = await post(ctx.app, '/galaxy/api/clans', { name: `Charla ${randomUUID().slice(0, 8).replace(/[^a-z]/g, 'x')}`, tag, emblem: 'eye', color: 'ice' }, { cookie: leader.cookie, headers: { 'idempotency-key': randomUUID() } });
  expect(res.statusCode).toBe(200);
  for (const m of members) await post(ctx.app, `/galaxy/api/clans/${tag}/join`, undefined, { cookie: m.cookie });
  return tag;
}

describe('escribir y leer', () => {
  test('un mensaje limpio llega al historial con su autor, y la vista dice que se puede escribir', async () => {
    const a = await player();
    const res = await send(a, '  hola   mundo  ');
    expect(res.statusCode).toBe(200);
    const m = res.json() as ChatMessage;
    expect(m).toMatchObject({ channel: 'global', body: 'hola mundo', author: { username: a.username, level: 5, clan: null } });
    const h = await history(a);
    expect(h.messages.at(-1)).toEqual(m);
    expect(h).toMatchObject({ channel: 'global', canWrite: true, reason: null, minLevel: 5, maxLength: 280, moderator: false });
  });

  test('el filtro tapa sus palabras, y vacío o demasiado largo no se envía', async () => {
    const a = await player();
    expect(((await send(a, 'eres TONTO')).json() as ChatMessage).body).toBe('eres *****');
    expect((await send(a, '   ')).json()).toEqual({ error: 'chat_empty' });
    expect((await send(a, 'x'.repeat(281))).json()).toEqual({ error: 'chat_empty' });
  });

  test('sin nivel no se escribe y la vista lo dice', async () => {
    const low = await player(1);
    const h = await history(low);
    expect(h).toMatchObject({ canWrite: false, reason: 'level' });
    const res = await send(low, 'hola');
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'chat_level' });
  });

  test('pasado el límite por minuto, espera', async () => {
    const a = await player();
    for (let i = 0; i < 6; i++) expect((await send(a, `mensaje ${i}`)).statusCode).toBe(200);
    const seventh = await send(a, 'uno más');
    expect(seventh.statusCode).toBe(429);
    expect(seventh.json()).toEqual({ error: 'rate_limited' });
  });

  test('el canal del clan es solo de sus miembros', async () => {
    const [lead, outsider] = [await player(), await player()];
    const tag = await clanWith(lead);
    expect((await send(lead, 'reunión a las nueve', 'clan')).statusCode).toBe(200);
    expect((await history(lead, 'clan')).messages.at(-1)).toMatchObject({ channel: 'clan', body: 'reunión a las nueve', author: { clan: tag } });
    expect((await get(ctx.app, '/galaxy/api/chat/clan', { cookie: outsider.cookie })).json()).toEqual({ error: 'clan_forbidden' });
    expect((await send(outsider, 'hola', 'clan')).json()).toEqual({ error: 'clan_forbidden' });
    expect((await get(ctx.app, '/galaxy/api/chat/global')).statusCode).toBe(401);
  });
});

describe('el canal de la sala (fase 6c)', () => {
  /** A private room of `ps` (the first makes it, the rest join with its code). */
  async function roomOf(...ps: P[]): Promise<RoomView> {
    for (const p of ps) await put(ctx.app, '/galaxy/api/tutorial', { action: 'skip' }, { cookie: p.cookie });
    const res = await post(ctx.app, '/galaxy/api/rooms', { kind: 'private', sector: 'outer-nebula' }, { cookie: ps[0]!.cookie });
    expect(res.statusCode, res.body).toBe(200);
    const room = res.json() as RoomView;
    for (const p of ps.slice(1)) expect((await post(ctx.app, '/galaxy/api/rooms/join', { code: room.code }, { cookie: p.cookie })).statusCode).toBe(200);
    return room;
  }

  test('solo lo leen y escriben quienes están en la sala, les llega en vivo, y al salir deja de llegar', async () => {
    const [a, b, out] = [await player(), await player(), await player()];
    await roomOf(a, b);
    const [sB, sOut] = [await socket(b), await socket(out)];
    expect((await send(a, 'voy por la izquierda', 'room')).statusCode).toBe(200);
    expect((await history(b, 'room')).messages.at(-1)).toMatchObject({ channel: 'room', body: 'voy por la izquierda' });
    expect((await get(ctx.app, '/galaxy/api/chat/room', { cookie: out.cookie })).json()).toEqual({ error: 'room_not_found' });
    expect((await send(out, 'hola', 'room')).json()).toEqual({ error: 'room_not_found' });
    await settle();
    const bodies = (x: typeof sB) => x.events.flatMap((e) => (e.type === 'message' ? [e.message.body] : []));
    expect(bodies(sB)).toContain('voy por la izquierda');
    expect(bodies(sOut)).not.toContain('voy por la izquierda');

    expect((await post(ctx.app, '/galaxy/api/rooms/leave', undefined, { cookie: b.cookie })).statusCode).toBe(200);
    await send(a, 'te has ido', 'room');
    await settle();
    expect(bodies(sB)).not.toContain('te has ido');
    expect((await get(ctx.app, '/galaxy/api/chat/room', { cookie: b.cookie })).statusCode).toBe(404);
    for (const x of [sB, sOut]) x.ws.terminate();
  });
});

describe('el socket', () => {
  test('cada mensaje llega a quien puede leerlo, y al salir del clan deja de llegar el suyo', async () => {
    const [lead, member, outsider] = [await player(), await player(), await player()];
    const tag = await clanWith(lead, member);
    const [sLead, sMember, sOut] = [await socket(lead), await socket(member), await socket(outsider)];
    await send(lead, 'para todos');
    await send(lead, 'solo el clan', 'clan');
    await settle();
    const bodies = (s: typeof sLead) => s.events.flatMap((e) => (e.type === 'message' ? [e.message.body] : []));
    expect(bodies(sMember)).toEqual(expect.arrayContaining(['para todos', 'solo el clan']));
    expect(bodies(sOut)).toContain('para todos');
    expect(bodies(sOut)).not.toContain('solo el clan');

    await post(ctx.app, `/galaxy/api/clans/${tag}/leave`, undefined, { cookie: member.cookie });
    await send(lead, 'ya no estás', 'clan');
    await settle();
    expect(bodies(sMember)).not.toContain('ya no estás');
    expect(bodies(sLead)).toContain('ya no estás');
    for (const s of [sLead, sMember, sOut]) s.ws.terminate();
  });

  test('una cuenta tiene tres sockets como mucho: el cuarto cierra el más antiguo', async () => {
    const a = await player();
    const s = [await socket(a), await socket(a), await socket(a), await socket(a)];
    await settle();
    expect(s[0]!.closed()).toBe(4008);
    expect(s.slice(1).map((x) => x.closed())).toEqual([null, null, null]);
    const text = `cuatro pestañas ${randomUUID().slice(0, 6)}`;
    await send(a, text);
    await settle();
    for (const x of s.slice(1)) expect(x.events).toContainEqual(expect.objectContaining({ type: 'message', message: expect.objectContaining({ body: text }) }));
    for (const x of s) x.ws.terminate();
  });

  test('sin sesión o desde otro origen, se cierra', async () => {
    const anon = await socket(null);
    const a = await player();
    const foreign = await socket(a, 'https://evil.example');
    await settle();
    expect(anon.closed()).toBe(4401);
    expect(foreign.closed()).toBe(4403);
  });
});

describe('denuncias y moderación', () => {
  test('la denuncia propia y la repetida no cuentan; con tres se oculta y llega como deleted', async () => {
    const author = await player();
    const m = (await send(author, 'algo feo')).json() as ChatMessage;
    const watcher = await socket(await player());
    const report = (p: P) => post(ctx.app, `/galaxy/api/chat/messages/${m.id}/report`, {}, { cookie: p.cookie });
    expect((await report(author)).json()).toEqual({ hidden: false });
    const r1 = await player();
    expect((await report(r1)).json()).toEqual({ hidden: false });
    expect((await report(r1)).json()).toEqual({ hidden: false });
    expect((await report(await player())).json()).toEqual({ hidden: false });
    // Accounts below the level that writing needs do not count: throwaway accounts cannot take messages down.
    expect((await report(await player(1))).json()).toEqual({ hidden: false });
    expect((await history(author)).messages.map((x) => x.id)).toContain(m.id);
    expect((await report(await player())).json()).toEqual({ hidden: true });
    await settle();
    expect(watcher.events).toContainEqual({ type: 'deleted', channel: 'global', id: m.id });
    expect((await history(author)).messages.map((x) => x.id)).not.toContain(m.id);
    expect((await post(ctx.app, '/galaxy/api/chat/messages/999999999999/report', {}, { cookie: r1.cookie })).json()).toEqual({ error: 'message_not_found' });
    watcher.ws.terminate();
  });

  test('un jugador no modera; un moderador oculta y silencia, y el silencio caduca', async () => {
    const [a, b] = [await player(), await player()];
    const m = (await send(a, 'insulto')).json() as ChatMessage;
    expect((await post(ctx.app, `/galaxy/api/chat/messages/${m.id}/hide`, undefined, { cookie: b.cookie })).statusCode).toBe(403);
    expect((await post(ctx.app, '/galaxy/api/chat/mutes', { username: a.username, minutes: 60, reason: 'Insultos' }, { cookie: b.cookie })).json()).toEqual({ error: 'forbidden' });

    const mod = await moderator();
    // A moderator writes whatever its level (a new staff account is level 1).
    expect(await history(mod)).toMatchObject({ moderator: true, canWrite: true, reason: null });
    expect((await send(mod, 'Recordad las normas')).statusCode).toBe(200);
    expect((await post(ctx.app, `/galaxy/api/chat/messages/${m.id}/hide`, undefined, { cookie: mod.cookie })).statusCode).toBe(200);
    expect((await history(a)).messages.map((x) => x.id)).not.toContain(m.id);
    expect((await post(ctx.app, '/galaxy/api/chat/mutes', { username: a.username, minutes: 1, reason: 'Insultos' }, { cookie: mod.cookie })).statusCode).toBe(200);
    expect((await send(a, 'sigo aquí')).json()).toEqual({ error: 'chat_muted' });
    const muted = await history(a);
    expect(muted).toMatchObject({ canWrite: false, reason: 'muted' });
    expect(Date.parse(muted.mutedUntil!)).toBeGreaterThan(clock.getTime());
    clock = new Date(clock.getTime() + 2 * 60_000);
    expect((await send(a, 'ya puedo')).statusCode).toBe(200);
  });
});
