import { type LiveEvent, type RoomsView, type RoomView } from '@galaxy/shared';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type WebSocket from 'ws';
import { createAdminViaCli, get, ORIGIN, post, put, sessionCookie, testApp, totpNow, uniqueName } from '../helpers';

// Rooms (multiplayer plan, phase 5): who may play in a group, public/private/friends rooms, Entrar rápido, the leader's
// powers, blocks, invites with privacy, launching (not yet: co-op runs come in phase 6) and the admin's live rooms.
let ctx: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  ctx = await testApp();
});
afterAll(() => ctx.close());

async function player(tutorial = true) {
  const username = uniqueName('rom');
  const res = await post(ctx.app, '/galaxy/api/auth/register', { username, password: 'una-clave-larga' });
  const cookie = sessionCookie(res);
  if (tutorial) await put(ctx.app, '/galaxy/api/tutorial', { action: 'skip' }, { cookie });
  return { cookie, id: (res.json() as { id: string }).id, username };
}
type P = Awaited<ReturnType<typeof player>>;

const rooms = async (p: P) => (await get(ctx.app, '/galaxy/api/rooms', { cookie: p.cookie })).json() as RoomsView;
const act = (p: P, path: string, body?: unknown) => post(ctx.app, `/galaxy/api/rooms${path}`, body, { cookie: p.cookie });
const create = async (p: P, kind = 'public', sector = 'outer-nebula') => {
  const res = await act(p, '', { kind, sector });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as RoomView;
};
const friends = async (x: P, y: P) => {
  await post(ctx.app, '/galaxy/api/friends/requests', { username: y.username }, { cookie: x.cookie });
  await post(ctx.app, `/galaxy/api/friends/${x.username}/accept`, undefined, { cookie: y.cookie });
};

async function live(p: P) {
  const events: LiveEvent[] = [];
  const ws: WebSocket = await ctx.app.injectWS('/galaxy/api/live/ws', { headers: { origin: ORIGIN, cookie: `gs_sid=${p.cookie}` } });
  ws.on('message', (data) => events.push(JSON.parse(String(data)) as LiveEvent));
  return { ws, events };
}
const settle = (ms = 150) => new Promise((r) => setTimeout(r, ms));

describe('quién puede', () => {
  test('sin acabar o saltar el tutorial no se juega en grupo', async () => {
    const p = await player(false);
    expect((await rooms(p)).reason).toBe('tutorial');
    expect((await act(p, '', { kind: 'public', sector: 'outer-nebula' })).json()).toMatchObject({ error: 'coop_tutorial' });
  });

  test('un sector que el líder no tiene → sector_locked', async () => {
    const p = await player();
    expect((await act(p, '', { kind: 'public', sector: 'broken-forge' })).json()).toMatchObject({ error: 'sector_locked' });
  });
});

describe('salas', () => {
  test('crear una pública: sale en la lista, otro entra por código y los dos la ven', async () => {
    const [a, b] = [await player(), await player()];
    const room = await create(a);
    expect(room).toMatchObject({ kind: 'public', leader: a.username, state: 'lobby', max: 4 });
    expect((await rooms(b)).open.map((r) => r.code)).toContain(room.code);
    const sa = await live(a);
    await settle();
    const joined = (await act(b, '/join', { code: room.code.toLowerCase() })).json() as RoomView;
    expect(joined.members.map((m) => m.username)).toEqual([a.username, b.username]);
    await settle();
    expect(sa.events.some((e) => e.type === 'room' && e.room?.members.length === 2)).toBe(true);
    expect((await rooms(a)).mine?.code).toBe(room.code);
    expect((await act(b, '/join', { code: room.code })).json()).toMatchObject({ error: 'room_already' });
    sa.ws.terminate();
  });

  test('Entrar rápido entra en una pública abierta, o crea una', async () => {
    const [a, b, c] = [await player(), await player(), await player()];
    const room = await create(a);
    const quick = (await act(b, '/quick')).json() as RoomView;
    // Other tests' public rooms may exist: the fullest open one is taken, never a new one while one is open.
    expect(quick.members.length).toBeGreaterThanOrEqual(2);
    void room;
    await act(c, '/leave');
    expect(((await act(c, '/quick')).json() as RoomView).state).toBe('lobby');
  });

  test('solo amigos: entra el amigo del líder y nadie más', async () => {
    const [a, b, c] = [await player(), await player(), await player()];
    await friends(a, b);
    const room = await create(a, 'friends');
    expect((await act(c, '/join', { code: room.code })).json()).toMatchObject({ error: 'room_forbidden' });
    expect((await act(b, '/join', { code: room.code })).statusCode).toBe(200);
    expect((await rooms(c)).open.map((r) => r.code)).not.toContain(room.code);
  });

  test('quien tiene bloqueado a alguien de la sala no entra ni la ve', async () => {
    const [a, b] = [await player(), await player()];
    const room = await create(a);
    await post(ctx.app, `/galaxy/api/friends/${b.username}/block`, undefined, { cookie: a.cookie });
    expect((await act(b, '/join', { code: room.code })).json()).toMatchObject({ error: 'room_forbidden' });
    expect((await rooms(b)).open.map((r) => r.code)).not.toContain(room.code);
  });

  test('el líder cambia el sector (y nadie queda listo), expulsa y cede; solo él', async () => {
    const [a, b, c] = [await player(), await player(), await player()];
    const room = await create(a, 'private');
    await act(b, '/join', { code: room.code });
    await act(c, '/join', { code: room.code });
    await act(b, '/ready', { ready: true });
    expect((await act(b, '/sector', { sector: 'outer-nebula' })).json()).toMatchObject({ error: 'room_not_leader' });
    const changed = (await act(a, '/sector', { sector: 'outer-nebula' })).json() as RoomView;
    expect(changed.members.every((m) => !m.ready)).toBe(true);
    const sc = await live(c);
    await settle();
    const kicked = (await act(a, '/kick', { username: c.username })).json() as RoomView;
    expect(kicked.members.map((m) => m.username)).toEqual([a.username, b.username]);
    await settle();
    expect(sc.events).toContainEqual({ type: 'room', room: null, why: 'kicked' });
    const led = (await act(a, '/lead', { username: b.username })).json() as RoomView;
    expect(led.leader).toBe(b.username);
    sc.ws.terminate();
  });

  test('si el líder se va, lidera el siguiente; si se van todos, la sala se cierra', async () => {
    const [a, b] = [await player(), await player()];
    const room = await create(a, 'private');
    await act(b, '/join', { code: room.code });
    await act(a, '/leave');
    expect((await rooms(b)).mine?.leader).toBe(b.username);
    await act(b, '/leave');
    expect((await act(a, '/join', { code: room.code })).json()).toMatchObject({ error: 'room_not_found' });
  });

  test('despegar pide que todos estén listos; con todos listos, aún no hay partidas en grupo', async () => {
    const [a, b] = [await player(), await player()];
    const room = await create(a, 'private');
    await act(b, '/join', { code: room.code });
    expect((await act(a, '/start')).json()).toMatchObject({ error: 'room_not_ready' });
    await act(b, '/ready', { ready: true });
    expect((await act(a, '/start')).json()).toMatchObject({ error: 'coop_soon' });
    expect((await act(b, '/start')).json()).toMatchObject({ error: 'room_not_leader' });
  });
});

describe('invitaciones', () => {
  test('a un amigo conectado le llega; a quien no acepta invitaciones o no está, no', async () => {
    const [a, b, c] = [await player(), await player(), await player()];
    await friends(a, b);
    await create(a, 'private');
    const sb = await live(b);
    await settle();
    expect((await act(a, '/invite', { username: b.username })).statusCode).toBe(200);
    await settle();
    expect(sb.events.some((e) => e.type === 'invite' && e.invite.from === a.username)).toBe(true);
    // C is not a friend and keeps the default (friends and clan only).
    expect((await act(a, '/invite', { username: c.username })).json()).toMatchObject({ error: 'invite_refused' });
    sb.ws.terminate();
    await settle(50);
    await put(ctx.app, '/galaxy/api/friends/prefs', { invites: 'everyone', showStatus: true }, { cookie: c.cookie });
    expect((await act(a, '/invite', { username: c.username })).json()).toMatchObject({ error: 'invite_offline' });
  });
});

describe('panel de admin', () => {
  test('un moderador ve las salas en vivo y cierra una, y a sus miembros se les dice', async () => {
    const a = await player();
    const room = await create(a, 'private');
    const sa = await live(a);
    await settle();
    const { username, password, totpSecret } = await createAdminViaCli(ctx.db, 'moderator');
    const login = await post(ctx.app, '/galaxy/api/auth/login', { username, password });
    const staff = sessionCookie(await post(ctx.app, '/galaxy/api/auth/totp', { challenge: login.json().challenge, code: totpNow(totpSecret) }));
    const list = (await get(ctx.app, '/galaxy/api/admin/rooms', { cookie: staff })).json() as { rooms: RoomView[] };
    expect(list.rooms.map((r) => r.code)).toContain(room.code);
    expect((await get(ctx.app, '/galaxy/api/admin/rooms', { cookie: a.cookie })).statusCode).toBe(403);
    const closed = await post(ctx.app, `/galaxy/api/admin/rooms/${room.code}/close`, { reason: 'Prueba de cierre' }, { cookie: staff });
    expect(closed.statusCode).toBe(200);
    await settle();
    expect(sa.events).toContainEqual({ type: 'room', room: null, why: 'closed' });
    expect((await rooms(a)).mine).toBeNull();
    sa.ws.terminate();
  });
});
