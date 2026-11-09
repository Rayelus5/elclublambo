import type { FriendsView, LiveEvent, MeResponse } from '@galaxy/shared';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { copy } from '../src/copy/es';
import { LiveConnection, useLive } from '../src/live/LiveConnection';
import { FriendsHost } from '../src/social/FriendsPanel';
import { FriendToasts } from '../src/social/FriendToasts';
import { useUi } from '../src/state/ui';
import { jsonResponse, mockApi, renderAt } from './render';

// Friends (multiplayer plan, phase 3): the sheet (online first with what they do, requests, add, remove and block
// asked first, privacy) and the live socket (hello, presence, a request as a toast that can be accepted).
const t = copy.friends;
const me: MeResponse = { id: 'a1', username: 'sonda_rayo', roles: [], mfa: false, level: 3 };
const view = (over: Partial<FriendsView> = {}): FriendsView => ({
  friends: [
    { username: 'vega', level: 7, clan: 'ECN', presence: { status: 'offline' }, since: '2026-11-01T00:00:00Z' },
    { username: 'lyra', level: 4, clan: null, presence: { status: 'online', activity: 'run', layer: 3 }, since: '2026-11-02T00:00:00Z' },
  ],
  incoming: [{ username: 'deneb', level: 2, at: '2026-11-09T10:00:00Z' }],
  outgoing: [],
  blocked: [],
  prefs: { invites: 'friends', showStatus: true },
  max: 200,
  ...over,
});

class FakeSocket {
  static last: FakeSocket | null = null;
  static OPEN = 1;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.last = this;
  }
  send(data: string) {
    this.sent.push(data);
  }
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
  vi.stubGlobal('WebSocket', FakeSocket);
  useLive.setState({ toasts: [], run: null, connected: false });
});
afterEach(() => {
  vi.unstubAllGlobals();
  act(() => useUi.getState().closeFriends());
});

const shell = { '/': (
  <>
    <FriendsHost />
    <FriendToasts />
    <LiveConnection />
  </>
) };

test('la hoja enseña primero a los conectados con lo que hacen, y las solicitudes con su número', async () => {
  mockApi({ 'GET /galaxy/api/auth/me': () => jsonResponse(200, me), 'GET /galaxy/api/friends': () => jsonResponse(200, view({ incoming: [] })) });
  renderAt('/', shell);
  await waitFor(() => expect(FakeSocket.last).not.toBeNull());
  act(() => useUi.getState().openFriends());
  const sheet = await screen.findByRole('dialog', { name: t.title });
  await within(sheet).findByText('lyra');
  const rows = within(within(sheet).getByRole('tabpanel')).getAllByRole('listitem');
  expect(rows[0]).toHaveTextContent('lyra');
  expect(rows[0]).toHaveTextContent(t.presence.run(3));
  expect(rows[1]).toHaveTextContent(t.presence.offline);
  expect(sheet).toHaveTextContent(t.online(1));
});

test('aceptar una solicitud desde la pestaña Solicitudes', async () => {
  const fetch = mockApi({
    'GET /galaxy/api/auth/me': () => jsonResponse(200, me),
    'GET /galaxy/api/friends': () => jsonResponse(200, view()),
    'POST /galaxy/api/friends/deneb/accept': () => jsonResponse(200, view({ incoming: [] })),
  });
  const user = userEvent.setup();
  renderAt('/', shell);
  await waitFor(() => expect(FakeSocket.last).not.toBeNull());
  act(() => useUi.getState().openFriends());
  const sheet = await screen.findByRole('dialog', { name: t.title });
  await user.click(within(sheet).getByRole('tab', { name: new RegExp(t.tabs.requests) }));
  await user.click(await within(sheet).findByRole('button', { name: t.accept }));
  await waitFor(() => expect(fetch.mock.calls.some(([url]) => url === '/galaxy/api/friends/deneb/accept')).toBe(true));
  expect(await within(sheet).findByText(t.noRequests)).toBeInTheDocument();
});

test('añadir por nombre envía la solicitud y lo dice', async () => {
  const fetch = mockApi({
    'GET /galaxy/api/auth/me': () => jsonResponse(200, me),
    'GET /galaxy/api/friends': () => jsonResponse(200, view({ incoming: [] })),
    'POST /galaxy/api/friends/requests': () => jsonResponse(200, view({ incoming: [], outgoing: [{ username: 'orion', level: 1, at: '2026-11-09T11:00:00Z' }] })),
  });
  const user = userEvent.setup();
  renderAt('/', shell);
  await waitFor(() => expect(FakeSocket.last).not.toBeNull());
  act(() => useUi.getState().openFriends());
  const sheet = await screen.findByRole('dialog', { name: t.title });
  await user.type(await within(sheet).findByLabelText(t.addLabel), 'orion');
  await user.click(within(sheet).getByRole('button', { name: t.send }));
  expect(await within(sheet).findByText(t.sent('orion'))).toBeInTheDocument();
  const call = fetch.mock.calls.find(([url]) => url === '/galaxy/api/friends/requests');
  expect(JSON.parse(String(call![1]!.body))).toEqual({ username: 'orion' });
});

test('quitar y bloquear piden confirmación antes de hacer nada', async () => {
  const fetch = mockApi({
    'GET /galaxy/api/auth/me': () => jsonResponse(200, me),
    'GET /galaxy/api/friends': () => jsonResponse(200, view({ incoming: [] })),
    'POST /galaxy/api/friends/vega/block': () => jsonResponse(200, view({ incoming: [], friends: [view().friends[1]!], blocked: [{ username: 'vega', at: '2026-11-09T12:00:00Z' }] })),
  });
  const user = userEvent.setup();
  renderAt('/', shell);
  await waitFor(() => expect(FakeSocket.last).not.toBeNull());
  act(() => useUi.getState().openFriends());
  const sheet = await screen.findByRole('dialog', { name: t.title });
  await user.click(await within(sheet).findByRole('button', { name: `${t.block} vega` }));
  const confirm = await screen.findByRole('alertdialog', { name: t.blockTitle('vega') });
  expect(fetch.mock.calls.some(([url]) => String(url).includes('/block'))).toBe(false);
  await user.click(within(confirm).getByRole('button', { name: t.block }));
  await waitFor(() => expect(fetch.mock.calls.some(([url]) => url === '/galaxy/api/friends/vega/block')).toBe(true));
});

test('el socket vivo saluda con la lista, cambia la presencia y avisa de una solicitud que se puede aceptar', async () => {
  const fetch = mockApi({
    'GET /galaxy/api/auth/me': () => jsonResponse(200, me),
    'GET /galaxy/api/friends': () => jsonResponse(200, view({ incoming: [] })),
    'POST /galaxy/api/friends/orion/accept': () => jsonResponse(200, view({ incoming: [] })),
  });
  const user = userEvent.setup();
  renderAt('/', shell);
  await waitFor(() => expect(FakeSocket.last).not.toBeNull());
  const ws = FakeSocket.last!;
  act(() => ws.open());
  // It says what I am doing as soon as it opens.
  expect(JSON.parse(ws.sent[0]!)).toEqual({ type: 'activity', activity: 'hub' });
  act(() => ws.push({ type: 'hello', friends: view({ incoming: [] }) }));
  act(() => ws.push({ type: 'presence', username: 'vega', presence: { status: 'online', activity: 'hangar' } }));
  act(() => useUi.getState().openFriends());
  const sheet = await screen.findByRole('dialog', { name: t.title });
  await waitFor(() => expect(sheet.textContent).toContain(t.presence.hangar));
  act(() => ws.push({ type: 'friends', reason: 'request', username: 'orion' }));
  const toast = await screen.findByText(t.toastRequest('orion'));
  await user.click(within(toast.closest('li')!).getByRole('button', { name: t.accept }));
  await waitFor(() => expect(fetch.mock.calls.some(([url]) => url === '/galaxy/api/friends/orion/accept')).toBe(true));
});
