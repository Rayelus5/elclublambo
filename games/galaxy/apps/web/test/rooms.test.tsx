import type { FriendsView, HangarView, LiveEvent, MeResponse, RoomsView, RoomView } from '@galaxy/shared';
import { DEFAULT_CONTENT } from '@galaxy/sim';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { GroupScreen } from '../src/coop/GroupScreen';
import { RoomScreen } from '../src/coop/RoomScreen';
import { copy } from '../src/copy/es';
import { ModeBar } from '../src/hangar/ModeBar';
import { LiveConnection, useLive } from '../src/live/LiveConnection';
import { FriendToasts } from '../src/social/FriendToasts';
import { jsonResponse, locationOf, mockApi, renderAt } from './render';

// Playing in a group (multiplayer plan, phase 5): the mode bar over the hangar, the rooms page (Entrar rápido, create,
// join by code or from the list, friends' rooms, locked before the tutorial), my room (the leader's controls, ready,
// launching that still says «soon») and the live socket's room events (an invite to join, being kicked).
const t = copy.coop;
const me: MeResponse = { id: 'a1', username: 'sonda_rayo', roles: [], mfa: false, level: 3 };
const nebula = DEFAULT_CONTENT.sectors.find((s) => s.id === 'outer-nebula')!;
const frost = DEFAULT_CONTENT.sectors.find((s) => s.id === 'frost-rings')!;
const lumen = DEFAULT_CONTENT.probes.find((p) => p.id === 'lumen')!;
// Only what these screens read of the hangar: the sectors (names, which are open) and the probes (names, sprites).
const hangar = {
  sectors: [
    { id: nebula.id, name: nebula.name, unlocked: true },
    { id: frost.id, name: frost.name, unlocked: false },
  ],
  sector: nebula.id,
  probes: [{ id: lumen.id, name: lumen.name, sprite: lumen.sprite }],
  probe: lumen.id,
} as unknown as HangarView;
const friends: FriendsView = {
  friends: [
    { username: 'lyra', level: 4, clan: null, presence: { status: 'online', activity: 'room', room: { size: 2, max: 4, code: 'QWERTY' } }, since: '2026-11-02T00:00:00Z' },
    { username: 'vega', level: 7, clan: null, presence: { status: 'offline' }, since: '2026-11-01T00:00:00Z' },
  ],
  incoming: [],
  outgoing: [],
  blocked: [],
  prefs: { invites: 'friends', showStatus: true },
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
    { username: 'sonda_rayo', level: 3, probe: 'lumen', ready: false, connected: true, leader: true },
    { username: 'deneb', level: 5, probe: 'lumen', ready: false, connected: false, leader: false },
  ],
  max: 4,
  createdAt: '2026-11-09T10:00:00Z',
  canStart: false,
  ...over,
});
const rooms = (over: Partial<RoomsView> = {}): RoomsView => ({
  mine: null,
  open: [{ code: 'ZXCVBN', sector: nebula.id, leader: 'orion', size: 3, max: 4, levels: [2, 9], createdAt: '2026-11-09T10:00:00Z' }],
  allowed: true,
  reason: null,
  minLevel: 1,
  ...over,
});
const base = (view: RoomsView) => ({
  'GET /galaxy/api/auth/me': () => jsonResponse(200, me),
  'GET /galaxy/api/hangar': () => jsonResponse(200, hangar),
  'GET /galaxy/api/friends': () => jsonResponse(200, friends),
  'GET /galaxy/api/rooms': () => jsonResponse(200, view),
});
const bodyOf = (fetch: ReturnType<typeof mockApi>, url: string) => {
  const call = fetch.mock.calls.find(([u, init]) => u === url && init?.method === 'POST');
  return call ? JSON.parse(String(call[1]!.body ?? 'null')) : undefined;
};

test('la barra de modos: Partida rápida despega ya, y En grupo lleva a las salas o a la mía', async () => {
  mockApi(base(rooms()));
  const onQuick = vi.fn();
  const user = userEvent.setup();
  const { unmount } = renderAt('/incursion', { '/incursion': <ModeBar onQuick={onQuick} launching={false} disabled={false} /> });
  await user.click(screen.getByRole('button', { name: new RegExp(t.modes.quick) }));
  expect(onQuick).toHaveBeenCalledOnce();
  await waitFor(() => expect(screen.getByRole('link', { name: new RegExp(t.modes.group) })).toHaveAttribute('href', '/incursion/grupo'));
  unmount();
  mockApi(base(rooms({ mine: room() })));
  renderAt('/incursion', { '/incursion': <ModeBar onQuick={onQuick} launching={false} disabled={false} /> });
  const group = await screen.findByRole('link', { name: new RegExp(t.modes.inRoom(2, 4).replace(/[()]/g, '\\$&')) });
  expect(group).toHaveAttribute('href', '/incursion/sala');
});

test('las salas públicas salen con su sector y huecos, y Unirse entra y lleva a la sala', async () => {
  const fetch = mockApi({ ...base(rooms()), 'POST /galaxy/api/rooms/join': () => jsonResponse(200, room({ code: 'ZXCVBN' })) });
  const user = userEvent.setup();
  renderAt('/incursion/grupo', { '/incursion/grupo': <GroupScreen /> });
  const list = await screen.findByRole('region', { name: t.publicTitle });
  const row = (await within(list).findByText(nebula.name)).closest('li')!;
  expect(row).toHaveTextContent(t.ledBy('orion'));
  expect(within(row).getByLabelText(t.size(3, 4))).toBeInTheDocument();
  await user.click(within(row).getByRole('button', { name: t.join }));
  await waitFor(() => expect(bodyOf(fetch, '/galaxy/api/rooms/join')).toEqual({ code: 'ZXCVBN' }));
  expect(locationOf(await screen.findByTestId('location')).pathname).toBe('/incursion/sala');
});

test('crear una sala privada en un sector abierto, y unirse por código o a la sala de un amigo', async () => {
  const fetch = mockApi({ ...base(rooms({ open: [] })), 'POST /galaxy/api/rooms': () => jsonResponse(200, room({ kind: 'private' })) });
  const user = userEvent.setup();
  renderAt('/incursion/grupo', { '/incursion/grupo': <GroupScreen /> });
  expect(await screen.findByText(t.noRooms)).toBeInTheDocument();
  // Only the sectors I have open can be chosen.
  const sector = await screen.findByLabelText(t.sector);
  await waitFor(() => expect(within(sector).getAllByRole('option').map((o) => o.textContent)).toEqual([nebula.name]));
  // A friend in a room can be joined from the side.
  const side = screen.getByRole('complementary', { name: t.friendsTitle });
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
  renderAt('/incursion/grupo', { '/incursion/grupo': <GroupScreen /> });
  expect(await screen.findByText(t.lockedTutorial)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: t.quick })).toBeDisabled();
  expect(screen.getByRole('button', { name: t.create })).toBeDisabled();
});

test('el líder ve los cuatro huecos, expulsa, y no despega hasta que todos están listos', async () => {
  const fetch = mockApi({ ...base(rooms({ mine: room() })), 'POST /galaxy/api/rooms/kick': () => jsonResponse(200, room({ members: [room().members[0]!] })) });
  const user = userEvent.setup();
  renderAt('/incursion/sala', { '/incursion/sala': <RoomScreen /> });
  const slots = await screen.findByRole('region', { name: t.playersTitle });
  const items = within(slots).getAllByRole('listitem');
  expect(items).toHaveLength(4);
  expect(items[1]).toHaveTextContent('deneb');
  expect(items[1]).toHaveTextContent(t.disconnected);
  expect(items[2]).toHaveTextContent(t.waiting);
  expect(screen.getByRole('button', { name: t.start })).toBeDisabled();
  expect(screen.getByText(t.waitReady)).toBeInTheDocument();
  await user.click(within(items[1]!).getByRole('button', { name: t.kick }));
  await waitFor(() => expect(bodyOf(fetch, '/galaxy/api/rooms/kick')).toEqual({ username: 'deneb' }));
  await waitFor(() => expect(within(slots).queryByText('deneb')).not.toBeInTheDocument());
});

test('quien no lidera marca que está listo, y despegar con todos listos aún dice que llega pronto', async () => {
  const guest = room({ leader: 'deneb', members: [{ ...room().members[1]!, leader: true, connected: true }, { ...room().members[0]!, leader: false }] });
  const fetch = mockApi({
    ...base(rooms({ mine: guest })),
    'POST /galaxy/api/rooms/ready': () => jsonResponse(200, { ...guest, canStart: true, members: guest.members.map((m) => ({ ...m, ready: true })) }),
  });
  const user = userEvent.setup();
  renderAt('/incursion/sala', { '/incursion/sala': <RoomScreen /> });
  await user.click(await screen.findByRole('button', { name: t.markReady }));
  await waitFor(() => expect(bodyOf(fetch, '/galaxy/api/rooms/ready')).toEqual({ ready: true }));
  expect(await screen.findByRole('button', { name: t.unready })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.queryByRole('button', { name: t.start })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: t.kick })).not.toBeInTheDocument();
});

test('el líder con todos listos pulsa Despegar y se le dice que las partidas en grupo llegan pronto', async () => {
  const ready = room({ canStart: true, members: room().members.map((m) => ({ ...m, ready: true, connected: true })) });
  mockApi({ ...base(rooms({ mine: ready })), 'POST /galaxy/api/rooms/start': () => jsonResponse(409, { error: 'coop_soon' }) });
  const user = userEvent.setup();
  renderAt('/incursion/sala', { '/incursion/sala': <RoomScreen /> });
  await user.click(await screen.findByRole('button', { name: t.start }));
  expect(await screen.findByRole('alert')).toHaveTextContent(copy.errors.coop_soon);
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
    <FriendToasts />
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
