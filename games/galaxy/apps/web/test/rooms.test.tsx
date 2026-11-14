import type { FriendsView, LiveEvent, MeResponse, RoomsView, RoomView } from '@galaxy/shared';
import { DEFAULT_CONTENT } from '@galaxy/sim';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { copy } from '../src/copy/es';
import { HangarScreen } from '../src/hangar/HangarScreen';
import { LiveConnection, useLive } from '../src/live/LiveConnection';
import { LiveToasts } from '../src/live/Toasts';
import { view } from './hangar-fixtures';
import { jsonResponse, mockApi, renderAt } from './render';

// Playing in a group (multiplayer plan, phase 5), inside the lobby: «En grupo» over the stage, the group side
// (Entrar rápido, create, join by code or from the list, friends' rooms, locked before the tutorial), my room (my
// teammates on their pads, the leader's controls, ready, launching into the run) and the live socket's room events
// (an invite to join, being kicked).
const t = copy.coop;
const me: MeResponse = { id: 'a1', username: 'sonda_rayo', roles: [], mfa: false, level: 3 };
const nebula = DEFAULT_CONTENT.sectors.find((s) => s.id === 'outer-nebula')!;
const friends: FriendsView = {
  friends: [
    { username: 'lyra', level: 4, clan: null, presence: { status: 'online', activity: 'room', room: { size: 2, max: 4, code: 'QWERTY' } }, since: '2026-11-02T00:00:00Z' },
    { username: 'vega', level: 7, clan: null, presence: { status: 'offline' }, since: '2026-11-01T00:00:00Z' },
  ],
  incoming: [],
  outgoing: [],
  blocked: [],
  prefs: { invites: 'friends', showStatus: true, notices: 'sound' },
  max: 200,
};
const room = (over: Partial<RoomView> = {}): RoomView => ({
  id: 'r1',
  code: 'ABC234',
  kind: 'public',
  leader: 'sonda_rayo',
  sector: nebula.id,
  state: 'lobby',
  members: [
    { username: 'sonda_rayo', level: 3, probe: 'lumen', skin: null, ready: false, connected: true, leader: true },
    { username: 'deneb', level: 5, probe: 'lumen', skin: null, ready: false, connected: false, leader: false },
  ],
  max: 4,
  createdAt: '2026-11-09T10:00:00Z',
  canStart: false,
  run: null,
  ...over,
});
const rooms = (over: Partial<RoomsView> = {}): RoomsView => ({
  mine: null,
  open: [{ code: 'ZXCVBN', sector: nebula.id, leader: 'orion', size: 3, max: 4, levels: [2, 9], createdAt: '2026-11-09T10:00:00Z' }],
  allowed: true,
  reason: null,
  minLevel: 1,
  waitUntil: null,
  ...over,
});
const base = (v: RoomsView) => ({
  'GET /galaxy/api/auth/me': () => jsonResponse(200, me),
  'GET /galaxy/api/hangar': () => jsonResponse(200, view()),
  'GET /galaxy/api/friends': () => jsonResponse(200, friends),
  'GET /galaxy/api/rooms': () => jsonResponse(200, v),
});
const bodyOf = (fetch: ReturnType<typeof mockApi>, url: string) => {
  const call = fetch.mock.calls.find(([u, init]) => u === url && init?.method === 'POST');
  return call ? JSON.parse(String(call[1]!.body ?? 'null')) : undefined;
};
const lobby = (path = '/incursion') => renderAt(path, { '/incursion': <HangarScreen /> });

test('En grupo se elige sobre el escenario, queda en la dirección, y Entrar rápido mete en una sala', async () => {
  const fetch = mockApi({ ...base(rooms()), 'POST /galaxy/api/rooms/quick': () => jsonResponse(200, room()) });
  const user = userEvent.setup();
  lobby();
  const who = await screen.findByRole('radiogroup', { name: copy.lobby.who });
  await user.click(within(who).getByRole('radio', { name: new RegExp(copy.lobby.group) }));
  expect(await screen.findByRole('complementary', { name: t.title })).toBeInTheDocument();
  await user.click(await screen.findByRole('button', { name: t.quick }));
  await waitFor(() => expect(fetch.mock.calls.some(([u]) => u === '/galaxy/api/rooms/quick')).toBe(true));
  // In a room the lobby is the room: its code, and alone is closed until leaving it.
  expect(await screen.findByRole('button', { name: t.copyCode('ABC234') })).toBeInTheDocument();
  expect(within(who).getByRole('radio', { name: new RegExp(copy.lobby.solo) })).toBeDisabled();
});

test('las salas públicas salen con su sector y huecos, y Unirse entra', async () => {
  const fetch = mockApi({ ...base(rooms()), 'POST /galaxy/api/rooms/join': () => jsonResponse(200, room({ code: 'ZXCVBN' })) });
  const user = userEvent.setup();
  lobby('/incursion?modo=grupo');
  const list = await screen.findByRole('region', { name: t.publicTitle });
  const row = (await within(list).findByText(nebula.name)).closest('li')!;
  expect(row).toHaveTextContent(t.ledBy('orion'));
  expect(within(row).getByLabelText(t.size(3, 4))).toBeInTheDocument();
  await user.click(within(row).getByRole('button', { name: t.join }));
  await waitFor(() => expect(bodyOf(fetch, '/galaxy/api/rooms/join')).toEqual({ code: 'ZXCVBN' }));
  expect(await screen.findByRole('button', { name: t.copyCode('ZXCVBN') })).toBeInTheDocument();
});

test('crear una sala privada en un sector abierto, y unirse por código o a la sala de un amigo', async () => {
  const fetch = mockApi({ ...base(rooms({ open: [] })), 'POST /galaxy/api/rooms': () => jsonResponse(200, room({ kind: 'private' })) });
  const user = userEvent.setup();
  lobby('/incursion?modo=grupo');
  expect(await screen.findByText(t.noRooms)).toBeInTheDocument();
  // Only the sectors I have open can be chosen.
  const sector = await screen.findByRole('combobox', { name: t.sector });
  const open = view()
    .sectors.filter((s) => s.unlocked)
    .map((s) => s.name);
  await user.click(sector);
  await waitFor(() => expect(within(screen.getByRole('listbox', { name: t.sector })).getAllByRole('option').map((o) => o.textContent)).toEqual(open));
  await user.keyboard('{Escape}');
  // A friend in a room can be joined from the side.
  const side = screen.getByRole('region', { name: t.friendsTitle });
  expect(within(side).getByText('lyra').closest('li')).toContainElement(within(side).getByRole('button', { name: t.joinFriend }));
  expect(within(side).queryByText('vega')).not.toBeInTheDocument();
  // The code waits for six characters.
  const code = screen.getByLabelText(t.codeLabel);
  const join = within(code.closest('form')!).getByRole('button', { name: t.join });
  await user.type(code, 'abc23');
  expect(join).toBeDisabled();
  await user.click(screen.getByRole('radio', { name: t.kinds.private }));
  expect(screen.getByText(t.kindHint.private)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: t.create }));
  await waitFor(() => expect(bodyOf(fetch, '/galaxy/api/rooms')).toEqual({ kind: 'private', sector: nebula.id }));
});

test('sin acabar el tutorial se explica por qué y no se puede entrar ni crear', async () => {
  mockApi(base(rooms({ allowed: false, reason: 'tutorial' })));
  lobby('/incursion?modo=grupo');
  expect(await screen.findByText(t.lockedTutorial)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: t.quick })).toBeDisabled();
  expect(screen.getByRole('button', { name: t.create })).toBeDisabled();
});

test('quien ha dejado varias partidas en grupo hace poco ve hasta cuándo espera y no puede entrar ni crear', async () => {
  const until = '2026-11-09T21:45:00.000Z';
  mockApi(base(rooms({ allowed: false, reason: 'abandons', waitUntil: until })));
  lobby('/incursion?modo=grupo');
  expect(await screen.findByText(t.lockedAbandons(until))).toBeInTheDocument();
  expect(t.lockedAbandons(until)).toContain(new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' }).format(new Date(until)));
  expect(screen.getByRole('button', { name: t.quick })).toBeDisabled();
  expect(screen.getByRole('button', { name: t.create })).toBeDisabled();
});

test('el líder ve a su equipo en sus plataformas, expulsa, y no despega hasta que todos están listos', async () => {
  const fetch = mockApi({ ...base(rooms({ mine: room() })), 'POST /galaxy/api/rooms/kick': () => jsonResponse(200, room({ members: [room().members[0]!] })) });
  const user = userEvent.setup();
  lobby();
  // The leader's own view (who I am arrives with the session).
  expect(await screen.findByRole('button', { name: t.start })).toBeDisabled();
  const team = await screen.findByRole('list', { name: t.playersTitle });
  const items = within(team).getAllByRole('listitem');
  expect(items).toHaveLength(3);
  expect(items[0]).toHaveTextContent('deneb');
  expect(items[0]).toHaveTextContent(t.disconnected);
  expect(items[1]).toHaveTextContent(t.waiting);
  expect(screen.getByText(t.waitReady)).toBeInTheDocument();
  await user.click(within(items[0]!).getByRole('button', { name: t.kick }));
  await waitFor(() => expect(bodyOf(fetch, '/galaxy/api/rooms/kick')).toEqual({ username: 'deneb' }));
  await waitFor(() => expect(within(team).queryByText('deneb')).not.toBeInTheDocument());
});

test('desde la sala se puede añadir como amigo a quien no lo es, y no a uno mismo (plan de noviembre A3)', async () => {
  const withMates = room({
    members: [
      room().members[0]!,
      { username: 'deneb', level: 5, probe: 'lumen', skin: null, ready: false, connected: true, leader: false },
      { username: 'vega', level: 7, probe: 'lumen', skin: null, ready: true, connected: true, leader: false },
    ],
  });
  const after: FriendsView = { ...friends, outgoing: [{ username: 'deneb', level: 5, at: '2026-11-12T00:00:00Z' }] };
  const fetch = mockApi({ ...base(rooms({ mine: withMates })), 'POST /galaxy/api/friends/requests': () => jsonResponse(200, after) });
  const user = userEvent.setup();
  lobby();
  // The leader's own view (who I am arrives with the session): there the button is round, beside theirs.
  expect(await screen.findByRole('button', { name: t.start })).toBeInTheDocument();
  const team = await screen.findByRole('list', { name: t.playersTitle });
  const deneb = within(team).getAllByRole('listitem').find((li) => li.textContent?.includes('deneb'))!;
  const vega = within(team).getAllByRole('listitem').find((li) => li.textContent?.includes('vega'))!;
  const add = await within(deneb).findByRole('button', { name: copy.friends.profile.add });
  // Already a friend (once my friends list is in): no button.
  await waitFor(() => expect(within(vega).queryByRole('button', { name: copy.friends.profile.add })).not.toBeInTheDocument());
  await user.click(add);
  await waitFor(() => expect(bodyOf(fetch, '/galaxy/api/friends/requests')).toEqual({ username: 'deneb' }));
  expect(await within(deneb).findByRole('button', { name: copy.friends.profile.sent })).toBeDisabled();
  // My own pad (the hero) never offers it.
  expect(screen.queryAllByRole('button', { name: copy.friends.profile.add })).toHaveLength(0);
});

test('quien no lidera marca que está listo, y no ve los mandos del líder', async () => {
  const guest = room({ leader: 'deneb', members: [{ ...room().members[1]!, leader: true, connected: true }, { ...room().members[0]!, leader: false }] });
  const fetch = mockApi({
    ...base(rooms({ mine: guest })),
    'POST /galaxy/api/rooms/ready': () => jsonResponse(200, { ...guest, canStart: true, members: guest.members.map((m) => ({ ...m, ready: true })) }),
  });
  const user = userEvent.setup();
  lobby();
  await user.click(await screen.findByRole('button', { name: t.markReady }));
  await waitFor(() => expect(bodyOf(fetch, '/galaxy/api/rooms/ready')).toEqual({ ready: true }));
  expect(await screen.findByRole('button', { name: t.unready })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.queryByRole('button', { name: t.start })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: t.kick })).not.toBeInTheDocument();
  // Ready, the probe is the one said: the arrows wait.
  expect(screen.getByRole('button', { name: copy.lobby.nextProbe })).toBeDisabled();
});

test('el líder con todos listos pulsa Despegar y el lobby pasa a ser la partida', async () => {
  vi.stubGlobal('WebSocket', FakeSocket);
  const ready = room({ canStart: true, members: room().members.map((m) => ({ ...m, ready: true, connected: true })) });
  const fetch = mockApi({ ...base(rooms({ mine: ready })), 'POST /galaxy/api/rooms/start': () => jsonResponse(200, { ...ready, state: 'running', canStart: false, run: { id: 'run-1' } }) });
  const user = userEvent.setup();
  lobby();
  await user.click(await screen.findByRole('button', { name: t.start }));
  await waitFor(() => expect(fetch.mock.calls.some(([u]) => u === '/galaxy/api/rooms/start')).toBe(true));
  // The loading screen (the owner, 2026-11-14) says it is connecting.
  expect(await screen.findByRole('status', { name: t.loading.label })).toHaveTextContent(t.loading.steps.connect);
  expect(FakeSocket.last?.url).toContain('/galaxy/api/coop/play/ws?run=run-1');
});

class FakeSocket {
  static last: FakeSocket | null = null;
  static OPEN = 1;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.last = this;
  }
  send() {}
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  push(event: LiveEvent) {
    this.onmessage?.({ data: JSON.stringify(event) });
  }
}

beforeEach(() => {
  FakeSocket.last = null;
  useLive.setState({ toasts: [], run: null, connected: false });
});
afterEach(() => vi.unstubAllGlobals());

const live = { '/': (
  <>
    <LiveToasts />
    <LiveConnection />
  </>
) };

test('una invitación llega como aviso con Unirse, que entra en la sala; y si te expulsan, se dice', async () => {
  vi.stubGlobal('WebSocket', FakeSocket);
  const fetch = mockApi({ ...base(rooms()), 'POST /galaxy/api/rooms/join': () => jsonResponse(200, room({ code: 'QWERTY' })) });
  const user = userEvent.setup();
  renderAt('/', live);
  await waitFor(() => expect(FakeSocket.last).not.toBeNull());
  const ws = FakeSocket.last!;
  act(() => ws.open());
  act(() => ws.push({ type: 'room', room: null, why: 'kicked' }));
  expect(await screen.findByText(t.kicked)).toBeInTheDocument();
  act(() => ws.push({ type: 'invite', invite: { from: 'lyra', code: 'QWERTY', sector: nebula.id, kind: 'friends', size: 2 } }));
  const toast = (await screen.findByText(t.toastInvite('lyra', nebula.name))).closest('li')!;
  await user.click(within(toast).getByRole('button', { name: t.accept }));
  await waitFor(() => expect(bodyOf(fetch, '/galaxy/api/rooms/join')).toEqual({ code: 'QWERTY' }));
});

test('durante una incursión no salen avisos, y una invitación que llega entonces se descarta', async () => {
  vi.stubGlobal('WebSocket', FakeSocket);
  mockApi(base(rooms()));
  useLive.setState({ run: { layer: 2 } });
  renderAt('/', live);
  await waitFor(() => expect(FakeSocket.last).not.toBeNull());
  act(() => FakeSocket.last!.open());
  act(() => FakeSocket.last!.push({ type: 'invite', invite: { from: 'lyra', code: 'QWERTY', sector: nebula.id, kind: 'friends', size: 2 } }));
  expect(useLive.getState().toasts).toHaveLength(0);
});

test('quien abandonó una partida en grupo recibe su resultado al acabar: un aviso que abre los resultados', async () => {
  vi.stubGlobal('WebSocket', FakeSocket);
  mockApi(base(rooms()));
  const user = userEvent.setup();
  renderAt('/', live);
  await waitFor(() => expect(FakeSocket.last).not.toBeNull());
  act(() => FakeSocket.last!.open());
  const result = {
    id: 'r9',
    outcome: 'abandoned',
    ticks: 3600,
    depth: 1,
    kills: 80,
    level: 6,
    payout: { coins: 20, dust: 6, signals: 0, material: 4 },
    breakdown: { layers: [{ layer: 1, coins: 20, dust: 6, multiplier: 1 }], share: 0.5, daily: [{ seconds: 60, multiplier: 1 }] },
    wallet: { coins: 120, dust: 6, signal: 10 },
    progress: { xp: 0, level: 1, levelUp: false, points: 0 },
  };
  act(() => FakeSocket.last!.push({ type: 'coopResult', outcome: 'died', result } as LiveEvent));
  const toast = (await screen.findByText(t.resultToast)).closest('li')!;
  await user.click(within(toast).getByRole('button', { name: t.resultSee }));
  const dialog = await screen.findByRole('dialog', { name: t.resultTitle });
  expect(within(dialog).getByRole('heading', { name: copy.results.abandoned })).toBeInTheDocument();
});

// The owner, 2026-11-14: the room's chat button lit in red with what is unread in it, and «Salir de la sala» red and
// plain to see.
test('en la sala, el chat se enciende en rojo con lo que hay sin leer y Salir de la sala es rojo', async () => {
  mockApi({
    ...base(rooms({ mine: room() })),
    'GET /galaxy/api/chat/unread': () => jsonResponse(200, { global: 0, clan: null, room: 4, mentions: { global: 0, clan: 0, room: 0 } }),
  });
  lobby();
  const chat = await screen.findByRole('button', { name: copy.chat.roomChatLabel(4) });
  expect(chat).toHaveClass('has-unread');
  expect(chat).toHaveTextContent('4');
  expect(screen.getByRole('button', { name: t.leave })).toHaveClass('danger');
});
