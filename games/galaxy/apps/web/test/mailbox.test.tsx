import type { MeResponse, MyMailbox, TitleNotice } from '@galaxy/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { copy } from '../src/copy/es';
import { TitleNotices } from '../src/hub/TitleNotices';
import { TopBar } from '../src/hub/TopBar';
import { jsonResponse, mockApi, renderAt } from './render';

// The mailbox and the notices for players (GDD §4, §16.5; M6d-1): the top bar's mail button says how many are unread
// and opens the mailbox; opening a message marks it read; a gift is collected once and says what it gave; the title
// screen shows the running notices, each closed for good in this browser.
beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

const t = copy.mail;
const me: MeResponse = { id: 'p1', username: 'vega', roles: [], mfa: false, level: 6 };
const box: MyMailbox = {
  unread: 2,
  messages: [
    { id: 'm1', title: 'Regalo de bienvenida', body: 'Gracias por probar la beta.\nAquí tienes algo para empezar', gifts: { coins: 100, dust: 5 }, at: '2026-11-08T10:00:00.000Z', expiresAt: '2026-12-08T10:00:00.000Z', read: false, claimed: false },
    { id: 'm2', title: 'Mantenimiento el domingo', body: 'El juego parará una hora', gifts: {}, at: '2026-11-07T10:00:00.000Z', expiresAt: '2026-12-07T10:00:00.000Z', read: false, claimed: false },
  ],
};
const posted = (fetch: ReturnType<typeof mockApi>, url: string) => fetch.mock.calls.filter(([u, init]) => u === url && init?.method === 'POST').length;
const bar = () => <TopBar me={me} wallet={{ coins: 10, dust: 2, signal: 1 }} freePull={false} onLogout={() => {}} leaving={false} />;

test('el botón del buzón dice cuántos hay sin leer y abre el buzón con la lista', async () => {
  mockApi({ 'GET /galaxy/api/mailbox': () => jsonResponse(200, box) });
  renderAt('/', { '/': bar() });
  await userEvent.click(await screen.findByRole('button', { name: t.unread(2) }));
  const dialog = await screen.findByRole('dialog', { name: t.title });
  expect(within(dialog).getByRole('button', { name: /Regalo de bienvenida/ })).toBeInTheDocument();
  expect(within(dialog).getAllByText(t.new)).toHaveLength(2);
});

test('abrir un mensaje lo marca leído y enseña su texto con los saltos de línea', async () => {
  const fetch = mockApi({ 'GET /galaxy/api/mailbox': () => jsonResponse(200, box), 'POST /galaxy/api/mailbox/m2/read': () => jsonResponse(200, { read: true }) });
  renderAt('/', { '/': bar() });
  await userEvent.click(await screen.findByRole('button', { name: t.unread(2) }));
  const dialog = await screen.findByRole('dialog', { name: t.title });
  await userEvent.click(within(dialog).getByRole('button', { name: /Mantenimiento el domingo/ }));
  expect(await within(dialog).findByRole('heading', { name: 'Mantenimiento el domingo' })).toBeInTheDocument();
  expect(within(dialog).getByText('El juego parará una hora')).toBeInTheDocument();
  await waitFor(() => expect(posted(fetch, '/galaxy/api/mailbox/m2/read')).toBe(1));
  expect(within(dialog).queryByRole('button', { name: t.claim })).toBeNull();
});

test('un regalo dice lo que da, se recoge una vez y lo confirma', async () => {
  const fetch = mockApi({
    'GET /galaxy/api/mailbox': () => jsonResponse(200, box),
    'POST /galaxy/api/mailbox/m1/read': () => jsonResponse(200, { read: true }),
    'POST /galaxy/api/mailbox/m1/claim': () => jsonResponse(200, { wallet: { coins: 110, dust: 7, signal: 1 } }),
  });
  renderAt('/', { '/': bar() });
  await userEvent.click(await screen.findByRole('button', { name: t.unread(2) }));
  const dialog = await screen.findByRole('dialog', { name: t.title });
  await userEvent.click(within(dialog).getByRole('button', { name: /Regalo de bienvenida/ }));
  const gift = await within(dialog).findByRole('region', { name: t.giftTitle });
  expect(within(gift).getByText(copy.hub.resource.coins(100))).toBeInTheDocument();
  expect(within(gift).getByText(copy.hub.resource.dust(5))).toBeInTheDocument();
  await userEvent.click(within(gift).getByRole('button', { name: t.claim }));
  expect(await within(gift).findByRole('status')).toHaveTextContent(t.claimed);
  expect(within(gift).queryByRole('button', { name: t.claim })).toBeNull();
  expect(posted(fetch, '/galaxy/api/mailbox/m1/claim')).toBe(1);
});

test('un buzón vacío lo dice', async () => {
  mockApi({ 'GET /galaxy/api/mailbox': () => jsonResponse(200, { unread: 0, messages: [] }) });
  renderAt('/', { '/': bar() });
  await userEvent.click(await screen.findByRole('button', { name: t.button }));
  expect(await screen.findByText(t.empty)).toBeInTheDocument();
});

test('los avisos en curso salen en la pantalla de título y se cierran para siempre en este navegador', async () => {
  const notices: TitleNotice[] = [
    { id: 'n1', text: 'Mantenimiento el domingo a las 10', tone: 'warning' },
    { id: 'n2', text: 'Nueva temporada el lunes', tone: 'info' },
  ];
  mockApi({ 'GET /galaxy/api/notices': () => jsonResponse(200, notices) });
  const { unmount } = renderAt('/', { '/': <TitleNotices /> });
  expect(await screen.findByText('Mantenimiento el domingo a las 10')).toBeInTheDocument();
  expect(screen.getByText('Nueva temporada el lunes')).toBeInTheDocument();
  await userEvent.click(screen.getAllByRole('button', { name: t.closeNotice })[0]!);
  expect(screen.queryByText('Mantenimiento el domingo a las 10')).toBeNull();
  unmount();
  renderAt('/', { '/': <TitleNotices /> });
  expect(await screen.findByText('Nueva temporada el lunes')).toBeInTheDocument();
  expect(screen.queryByText('Mantenimiento el domingo a las 10')).toBeNull();
});

test('el buzón se cierra con su botón Cerrar', async () => {
  mockApi({ 'GET /galaxy/api/mailbox': () => jsonResponse(200, box) });
  renderAt('/', { '/': bar() });
  await userEvent.click(await screen.findByRole('button', { name: t.unread(2) }));
  const dialog = await screen.findByRole('dialog', { name: t.title });
  await userEvent.click(within(dialog).getByRole('button', { name: t.close }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: t.title })).toBeNull());
});
