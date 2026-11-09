import { type FriendsView, type LiveEvent } from '@galaxy/shared';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type WebSocket from 'ws';
import { createAdminViaCli, fixedConfig, get, ORIGIN, post, put, sessionCookie, testApp, totpNow, uniqueName } from '../helpers';

// Multiplayer plan, phase 3: friends (request, accept, decline, cancel, remove), blocks both ways, the privacy
// preferences, and the live socket (hello, presence of friends, pushes on every change).
let ctx: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  ctx = await testApp({ config: fixedConfig({ social: { maxFriends: 10, requestsPerHour: 50 } }) });
});
afterAll(() => ctx.close());

async function player() {
  const username = uniqueName('frd');
  const res = await post(ctx.app, '/galaxy/api/auth/register', { username, password: 'una-clave-larga' });
  return { cookie: sessionCookie(res), id: (res.json() as { id: string }).id, username };
}
type P = Awaited<ReturnType<typeof player>>;

const view = async (p: P) => (await get(ctx.app, '/galaxy/api/friends', { cookie: p.cookie })).json() as FriendsView;
const ask = (p: P, username: string) => post(ctx.app, '/galaxy/api/friends/requests', { username }, { cookie: p.cookie });
const act = (p: P, username: string, what: 'accept' | 'remove' | 'block' | 'unblock') => post(ctx.app, `/galaxy/api/friends/${username}/${what}`, undefined, { cookie: p.cookie });
const relation = async (p: P, username: string) => ((await get(ctx.app, `/galaxy/api/friends/relation/${username}`, { cookie: p.cookie })).json() as { relation: string }).relation;

async function friends(x: P, y: P) {
  expect((await ask(x, y.username)).statusCode).toBe(200);
  expect((await act(y, x.username, 'accept')).statusCode).toBe(200);
}

/** A live socket as the browser opens it, with every event it receives. */
async function live(p: P | null, origin = ORIGIN) {
  const events: LiveEvent[] = [];
  let closed: number | null = null;
  const ws: WebSocket = await ctx.app.injectWS('/galaxy/api/live/ws', { headers: { origin, ...(p ? { cookie: `gs_sid=${p.cookie}` } : {}) } });
  ws.on('message', (data) => events.push(JSON.parse(String(data)) as LiveEvent));
  ws.on('close', (code) => {
    closed = code;
  });
  return { ws, events, closed: () => closed };
}
const settle = (ms = 150) => new Promise((r) => setTimeout(r, ms));

describe('amistad', () => {
  test('pedir, ver la solicitud en las dos listas y aceptar', async () => {
    const [a, b] = [await player(), await player()];
    const res = await ask(a, b.username);
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as FriendsView).outgoing.map((r) => r.username)).toEqual([b.username]);
    expect((await view(b)).incoming.map((r) => r.username)).toEqual([a.username]);
    expect(await relation(a, b.username)).toBe('outgoing');
    expect(await relation(b, a.username)).toBe('incoming');
    const done = (await act(b, a.username, 'accept')).json() as FriendsView;
    expect(done.friends.map((f) => f.username)).toEqual([a.username]);
    expect(done.incoming).toEqual([]);
    expect((await view(a)).friends.map((f) => f.username)).toEqual([b.username]);
    expect(await relation(a, b.username)).toBe('friends');
  });

  test('si los dos se piden a la vez, quedan amigos', async () => {
    const [a, b] = [await player(), await player()];
    await ask(a, b.username);
    const res = await ask(b, a.username);
    expect(res.statusCode).toBe(200);
    expect((res.json() as FriendsView).friends.map((f) => f.username)).toEqual([a.username]);
  });

  test('pedir dos veces, a uno mismo o a quien no existe falla con su código', async () => {
    const [a, b] = [await player(), await player()];
    await ask(a, b.username);
    expect((await ask(a, b.username)).json()).toMatchObject({ error: 'friend_exists' });
    expect((await ask(a, a.username)).json()).toMatchObject({ error: 'friend_self' });
    expect((await ask(a, 'nadie_existe_9')).statusCode).toBe(404);
  });

  test('rechazar, cancelar y quitar borran la relación', async () => {
    const [a, b, c] = [await player(), await player(), await player()];
    await ask(a, b.username);
    await act(b, a.username, 'remove');
    expect((await view(a)).outgoing).toEqual([]);
    await ask(a, c.username);
    await act(a, c.username, 'remove');
    expect((await view(c)).incoming).toEqual([]);
    await friends(a, b);
    await act(b, a.username, 'remove');
    expect((await view(a)).friends).toEqual([]);
    expect((await act(b, a.username, 'remove')).statusCode).toBe(404);
  });

  test('el tope de amigos se cumple a los dos lados', async () => {
    const a = await player();
    for (let k = 0; k < 10; k++) await friends(a, await player());
    const late = await player();
    expect((await ask(a, late.username)).json()).toMatchObject({ error: 'friend_limit' });
    await ask(late, a.username);
    expect((await act(a, late.username, 'accept')).json()).toMatchObject({ error: 'friend_limit' });
  });
});

describe('bloqueos', () => {
  test('bloquear acaba la amistad, impide pedir en las dos direcciones y no se revela', async () => {
    const [a, b] = [await player(), await player()];
    await friends(a, b);
    const blocked = (await act(a, b.username, 'block')).json() as FriendsView;
    expect(blocked.friends).toEqual([]);
    expect(blocked.blocked.map((x) => x.username)).toEqual([b.username]);
    // The one blocked sees nothing special: the account looks missing.
    const asked = await ask(b, a.username);
    expect(asked.statusCode).toBe(404);
    expect(asked.json()).toMatchObject({ error: 'player_not_found' });
    expect(await relation(b, a.username)).toBe('none');
    // The one who blocks is told to unblock first.
    expect((await ask(a, b.username)).json()).toMatchObject({ error: 'friend_blocked' });
    expect(await relation(a, b.username)).toBe('blocked');
    await act(a, b.username, 'unblock');
    expect((await ask(a, b.username)).statusCode).toBe(200);
  });
});

describe('socket vivo y presencia', () => {
  test('saluda con la lista, cuenta la presencia a los amigos y avisa de cada cambio', async () => {
    const [a, b, c] = [await player(), await player(), await player()];
    await friends(a, b);
    const sa = await live(a);
    await settle();
    expect(sa.events[0]).toMatchObject({ type: 'hello', friends: { friends: [{ username: b.username, presence: { status: 'offline' } }] } });
    // B connects: A sees it online; B tells it is in the hangar.
    const sb = await live(b);
    await settle();
    expect(sa.events).toContainEqual({ type: 'presence', username: b.username, presence: { status: 'online', activity: 'hub' } });
    sb.ws.send(JSON.stringify({ type: 'activity', activity: 'hangar' }));
    await settle();
    expect(sa.events).toContainEqual({ type: 'presence', username: b.username, presence: { status: 'online', activity: 'hangar' } });
    const hello = sb.events.find((e) => e.type === 'hello');
    expect(hello).toMatchObject({ friends: { friends: [{ username: a.username, presence: { status: 'online' } }] } });
    // A request from C reaches A at once.
    await ask(c, a.username);
    await settle();
    expect(sa.events).toContainEqual({ type: 'friends', reason: 'request', username: c.username });
    sa.ws.terminate();
    sb.ws.terminate();
  });

  test('quien oculta su estado sale desconectado para sus amigos', async () => {
    const [a, b] = [await player(), await player()];
    await friends(a, b);
    expect((await put(ctx.app, '/galaxy/api/friends/prefs', { invites: 'nobody', showStatus: false }, { cookie: b.cookie })).statusCode).toBe(200);
    const sa = await live(a);
    const sb = await live(b);
    await settle();
    expect((await view(a)).friends[0]!.presence).toEqual({ status: 'offline' });
    expect(sa.events.filter((e) => e.type === 'presence' && e.username === b.username).every((e) => e.type === 'presence' && e.presence.status === 'offline')).toBe(true);
    expect((await view(b)).prefs).toEqual({ invites: 'nobody', showStatus: false });
    sa.ws.terminate();
    sb.ws.terminate();
  });

  test('sin sesión 4401, desde otro origen 4403, y cerrar sesión cierra sus sockets', async () => {
    const a = await player();
    const anon = await live(null);
    await settle();
    expect(anon.closed()).toBe(4401);
    const foreign = await live(a, 'https://evil.example');
    await settle();
    expect(foreign.closed()).toBe(4403);
    const s = await live(a);
    await settle();
    await post(ctx.app, '/galaxy/api/auth/logout', undefined, { cookie: a.cookie });
    await settle();
    expect(s.closed()).toBe(4401);
  });

  test('mensajes rotos se ignoran y una ráfaga cierra con 4429', async () => {
    const a = await player();
    const s = await live(a);
    await settle();
    s.ws.send('no es json');
    s.ws.send(JSON.stringify({ type: 'otra-cosa' }));
    await settle();
    expect(s.closed()).toBeNull();
    for (let k = 0; k < 40; k++) s.ws.send(JSON.stringify({ type: 'activity', activity: 'hub' }));
    await settle(300);
    expect(s.closed()).toBe(4429);
  });
});

describe('panel de admin', () => {
  test('la sección Social de un jugador enseña amigos, solicitudes y bloqueos en los dos sentidos', async () => {
    const [a, b, c, d] = [await player(), await player(), await player(), await player()];
    await friends(a, b);
    await ask(a, c.username);
    await act(d, a.username, 'block');
    const { username, password, totpSecret } = await createAdminViaCli(ctx.db, 'admin');
    const login = await post(ctx.app, '/galaxy/api/auth/login', { username, password });
    const admin = sessionCookie(await post(ctx.app, '/galaxy/api/auth/totp', { challenge: login.json().challenge, code: totpNow(totpSecret) }));
    const res = await get(ctx.app, `/galaxy/api/admin/players/${a.username}/social`, { cookie: admin });
    expect(res.statusCode).toBe(200);
    const rows = (res.json() as { rows: { kind: string; username: string }[] }).rows;
    expect(rows.map((r) => [r.kind, r.username]).sort()).toEqual(
      [
        ['blocked_by', d.username],
        ['friend', b.username],
        ['request_out', c.username],
      ].sort(),
    );
    // A player cannot read it.
    expect((await get(ctx.app, `/galaxy/api/admin/players/${a.username}/social`, { cookie: b.cookie })).statusCode).toBe(403);
  });
});
