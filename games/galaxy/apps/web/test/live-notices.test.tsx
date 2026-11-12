import type { FriendsView, LiveNotice, MeResponse, NoticeMode } from '@galaxy/shared';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { api } from '../src/api/client';
import { COLLECTION_KEY, GACHA_KEY } from '../src/api/economy';
import { MAILBOX_KEY } from '../src/api/mail';
import { MARKET_KEY } from '../src/api/market';
import { MISSIONS_KEY } from '../src/api/missions';
import { TRADES_KEY } from '../src/api/trades';
import { copy } from '../src/copy/es';
import { LiveConnection, useLive } from '../src/live/LiveConnection';
import { refreshFor } from '../src/live/notices';
import { playNotice } from '../src/live/sfx';
import { LiveToasts } from '../src/live/Toasts';
import { FakeSocket } from './fake-socket';
import { jsonResponse, LocationProbe, locationOf, mockApi, renderAt } from './render';

// Real-time notices (plan of 2026-11-12): what the live socket says happened elsewhere shows as a toast at the top
// (with its sound when the player wants it), and what it touches is read again even when no screen shows it. In
// «Silencio» nothing pops up but the lists still follow; during a run the toasts wait for it to end.

vi.mock('../src/live/sfx', () => ({ playNotice: vi.fn() }));

const t = copy.notices;
const me: MeResponse = { id: 'a1', username: 'sonda_rayo', roles: [], mfa: false, level: 12 };
const friends = (notices: NoticeMode): FriendsView => ({ friends: [], incoming: [], outgoing: [], blocked: [], prefs: { invites: 'friends', showStatus: true, notices }, max: 200 });
const vega = { username: 'vega', avatar: 'crew-cat', frame: 'prism' };
const trade: LiveNotice = { kind: 'trade', event: 'proposed', trade: 't1', from: vega };
const sale: LiveNotice = { kind: 'sale', listing: 'l1', galaxy: { id: 'g1', name: 'Kathra', tier: 'rare' }, price: 600, net: 558, buyer: vega, wallet: { coins: 1558, dust: 40, signal: 2 } };

beforeEach(() => {
  FakeSocket.last = null;
  vi.stubGlobal('WebSocket', FakeSocket);
  useLive.setState({ toasts: [], run: null, connected: false, shownResult: null });
  vi.mocked(playNotice).mockClear();
});
afterEach(() => vi.unstubAllGlobals());

const shell = {
  '/': (
    <>
      <LiveToasts />
      <LiveConnection />
    </>
  ),
  '*': <LocationProbe />,
};

async function connect(mode: NoticeMode = 'sound', routes: Record<string, (b: unknown) => Response> = {}) {
  const fetch = mockApi({ 'GET /galaxy/api/auth/me': () => jsonResponse(200, me), 'GET /galaxy/api/friends': () => jsonResponse(200, friends(mode)), ...routes });
  const view = renderAt('/', shell);
  await waitFor(() => expect(FakeSocket.last).not.toBeNull());
  const ws = FakeSocket.last!;
  act(() => ws.open());
  act(() => ws.push({ type: 'hello', friends: friends(mode) }));
  return { ws, fetch, client: view.client };
}

test('qué refresca cada aviso', () => {
  const keys = (n: LiveNotice) => refreshFor(n).map((r) => [JSON.stringify(r.key), r.hidden ?? false]);
  expect(keys(trade)).toEqual([[JSON.stringify(TRADES_KEY), true], [JSON.stringify(COLLECTION_KEY), false]]);
  expect(keys(sale)).toEqual([[JSON.stringify([...MARKET_KEY, 'mine']), true], [JSON.stringify(COLLECTION_KEY), false]]);
  expect(keys({ kind: 'mail', id: 'm1', title: 'Hola' })).toEqual([[JSON.stringify(MAILBOX_KEY), true]]);
  expect(keys({ kind: 'achievement', id: 'a1', name: 'Primeros pasos', tier: 'bronze' })).toEqual([[JSON.stringify(MISSIONS_KEY), true]]);
  expect(refreshFor({ kind: 'clan', event: 'request', clan: { tag: 'NEB', name: 'Nebulosa' }, who: vega }).map((r) => r.key)).toEqual([
    ['clans', 'mine'],
    ['clans', 'view', 'NEB'],
  ]);
});

test('un trueque propuesto sale arriba con quién y su botón, suena, y la lista de trueques se vuelve a pedir aunque no se vea', async () => {
  const { ws, fetch, client } = await connect('sound', { 'GET /galaxy/api/trades': () => jsonResponse(200, { open: [], closed: [], rules: {} }) });
  // The trades were read once (a screen showed them) and nothing shows them now.
  await client.prefetchQuery({ queryKey: TRADES_KEY, queryFn: () => api('/trades') });
  const before = fetch.mock.calls.filter(([u]) => u === '/galaxy/api/trades').length;
  act(() => ws.push({ type: 'notice', notice: trade }));
  const toast = (await screen.findByText(t.trade.proposed('vega'))).closest('li')!;
  await waitFor(() => expect(fetch.mock.calls.filter(([u]) => u === '/galaxy/api/trades').length).toBe(before + 1));
  expect(vi.mocked(playNotice)).toHaveBeenCalledTimes(1);
  await userEvent.click(within(toast).getByRole('button', { name: t.see }));
  expect(locationOf(screen.getByTestId('location'))).toMatchObject({ pathname: '/mercado', search: '?pestana=trueques' });
});

test('una venta pone la cartera nueva en todas partes y lleva a mis anuncios', async () => {
  const { ws, client } = await connect();
  client.setQueryData(GACHA_KEY, { banners: [], wallet: { coins: 1000, dust: 40, signal: 2 } });
  act(() => ws.push({ type: 'notice', notice: sale }));
  expect(await screen.findByText(t.sale('Kathra'))).toBeInTheDocument();
  expect(screen.getByText(t.saleDetail('vega', 558))).toBeInTheDocument();
  expect((client.getQueryData(GACHA_KEY) as { wallet: { coins: number } }).wallet.coins).toBe(1558);
});

test('con «Sin sonido» sale pero no suena; con «Silencio» no sale nada y la lista se refresca igual', async () => {
  const quiet = await connect('silent');
  act(() => quiet.ws.push({ type: 'notice', notice: trade }));
  expect(await screen.findByText(t.trade.proposed('vega'))).toBeInTheDocument();
  expect(vi.mocked(playNotice)).not.toHaveBeenCalled();
});

test('con «Silencio» no sale ningún aviso, ni de amistad, pero lo que toca se vuelve a pedir', async () => {
  const { ws, fetch, client } = await connect('off', { 'GET /galaxy/api/mailbox': () => jsonResponse(200, { items: [], unread: 0 }) });
  await client.prefetchQuery({ queryKey: MAILBOX_KEY, queryFn: () => api('/mailbox') });
  const before = fetch.mock.calls.filter(([u]) => u === '/galaxy/api/mailbox').length;
  act(() => ws.push({ type: 'notice', notice: { kind: 'mail', id: 'm1', title: 'Bienvenida' } }));
  act(() => ws.push({ type: 'friends', reason: 'request', username: 'orion' }));
  await waitFor(() => expect(fetch.mock.calls.filter(([u]) => u === '/galaxy/api/mailbox').length).toBe(before + 1));
  expect(screen.queryByText(t.mail)).not.toBeInTheDocument();
  expect(screen.queryByText(copy.friends.toastRequest('orion'))).not.toBeInTheDocument();
  expect(useLive.getState().toasts).toEqual([]);
});

test('durante una incursión los avisos esperan y salen al acabar; una invitación a grupo se descarta', async () => {
  const { ws } = await connect();
  act(() => useLive.getState().setRun({ layer: 2 }));
  act(() => ws.push({ type: 'notice', notice: { kind: 'achievement', id: 'a1', name: 'Primeros pasos', tier: 'bronze' } }));
  act(() => ws.push({ type: 'invite', invite: { from: 'vega', code: 'ABCD', sector: 'outer-nebula', kind: 'private', size: 1 } }));
  expect(screen.queryByText('Primeros pasos')).not.toBeInTheDocument();
  expect(vi.mocked(playNotice)).not.toHaveBeenCalled();
  act(() => useLive.getState().setRun(null));
  expect(await screen.findByText('Primeros pasos')).toBeInTheDocument();
  expect(useLive.getState().toasts.map((x) => x.kind)).toEqual(['notice']);
  expect(vi.mocked(playNotice)).toHaveBeenCalledTimes(1);
});

test('se ven tres a la vez, el más nuevo arriba, y el resto espera su turno', async () => {
  const { ws } = await connect();
  for (const name of ['uno', 'dos', 'tres', 'cuatro']) act(() => ws.push({ type: 'notice', notice: { kind: 'mail', id: name, title: name } }));
  const items = await screen.findAllByRole('listitem');
  expect(items.map((li) => within(li).queryByText(/uno|dos|tres|cuatro/)?.textContent)).toEqual(['tres', 'dos', 'uno']);
  await userEvent.click(within(items[2]!).getByRole('button', { name: copy.friends.dismiss }));
  expect(await screen.findByText('cuatro')).toBeInTheDocument();
});
