import type { GachaView, MeResponse } from '@galaxy/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { copy } from '../src/copy/es';
import { TopBar } from '../src/hub/TopBar';
import { jsonResponse, mockApi, renderAt } from './render';

// Event signals left over when their scanner closes become star dust on the server; the next time the player is on
// the home screen (or the lobby) a window tells them so, once: which event, how many signals, how much dust.
afterEach(() => vi.unstubAllGlobals());

const t = copy.leftovers;
const me: MeResponse = { id: 'p1', username: 'vega', roles: [], mfa: false, level: 6 };
const view = (over: Partial<GachaView> = {}): GachaView => ({
  banners: [{ id: 'deep-scan', kind: 'standard', name: 'Escáner profundo', currency: 'signal', nextRates: [0.5, 0.28, 0.13, 0.06, 0.03], sinceLegendary: 0, untilGuarantee: 10, welcome: false }],
  costs: { coins: 100, coinsTen: 900, signals: 1 },
  freePullAvailable: false,
  wallet: { coins: 10, dust: 200, signal: 1 },
  leftovers: [],
  ...over,
});
const bar = (wallet: GachaView['wallet']) => <TopBar me={me} wallet={wallet} freePull={false} onLogout={() => {}} leaving={false} />;

test('cuando las señales de un evento cerrado se han convertido, una ventana lo cuenta una vez y al cerrarla queda vista', async () => {
  const leftovers = [{ id: '7', label: 'Primer contacto', signals: 4, dust: 200 }];
  const fetch = mockApi({
    'GET /galaxy/api/gacha': () => jsonResponse(200, view({ leftovers })),
    'POST /galaxy/api/gacha/leftovers/seen': () => jsonResponse(204),
  });
  renderAt('/', { '/': bar(view().wallet) });
  const dialog = await screen.findByRole('dialog', { name: t.title });
  const item = within(dialog).getByText('Primer contacto').closest('li')!;
  expect(item).toHaveTextContent(copy.hub.resource.eventSignal(4));
  expect(item).toHaveTextContent(copy.hub.resource.dust(200));
  await userEvent.click(within(dialog).getByRole('button', { name: t.ok }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: t.title })).toBeNull());
  const sent = fetch.mock.calls.find(([url, init]) => url === '/galaxy/api/gacha/leftovers/seen' && init?.method === 'POST');
  expect(JSON.parse(String(sent![1]!.body))).toEqual({ ids: ['7'] });
});

test('sin conversiones no sale ninguna ventana', async () => {
  const fetch = mockApi({ 'GET /galaxy/api/gacha': () => jsonResponse(200, view()) });
  renderAt('/', { '/': bar(view().wallet) });
  await vi.waitFor(() => expect(fetch.mock.calls.some(([url]) => url === '/galaxy/api/gacha')).toBe(true));
  expect(screen.queryByRole('dialog', { name: t.title })).toBeNull();
});

test('sin escáner de evento abierto el ticket morado no sale, aunque queden señales de un evento viejo', async () => {
  const wallet = { coins: 10, dust: 200, signal: 1, 'signal:viejo': 3 };
  mockApi({ 'GET /galaxy/api/gacha': () => jsonResponse(200, view({ wallet })) });
  renderAt('/', { '/': bar(wallet) });
  await screen.findByRole('link', { name: new RegExp(copy.hub.resource.signal(1)) });
  await waitFor(() => expect(screen.queryByRole('link', { name: new RegExp(copy.hub.resource.eventSignal(3)) })).toBeNull());
  expect(document.querySelector('.res.event-signal')).toBeNull();
});
