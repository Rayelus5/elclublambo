import type { AdminClan, MeResponse, ModChannel, ModMessage, ModMute, ModReport, ModReportPage } from '@galaxy/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { AdminHome, AdminLayout, AdminOnly } from '../src/admin/AdminLayout';
import { ClanPage } from '../src/admin/ModClans';
import { LiveChat, Mutes, Reports } from '../src/admin/ModerationScreen';
import { copy } from '../src/copy/es';
import { TopBar } from '../src/hub/TopBar';
import { jsonResponse, locationOf, mockApi, renderAt } from './render';

// Moderation on the web (GDD §16.1, §16.4; M6c-1): a moderator (TOTP) reaches the panel but only its Moderación; the
// report queue resolves with a reason; the live chat lists hidden messages and restores them; a mute takes a
// duration; dissolving a clan asks for the admin's password.
afterEach(() => vi.unstubAllGlobals());

const t = copy.admin.moderation;
const mod: MeResponse = { id: 'm1', username: 'vigia', roles: ['moderator'], mfa: true, level: 1 };
const admin: MeResponse = { id: 'ad1', username: 'rayelus', roles: ['superadmin'], mfa: true, level: 30 };
const M = '/galaxy/api/admin/moderation';
const channels: ModChannel[] = [
  { key: 'global', label: 'Comunidad', lastAt: '2026-11-08T09:00:00.000Z' },
  { key: 'clan:0f8f0d0e-6c1b-4c39-9a37-1f7b0c4c2a11', label: '[GX] Galácticos', lastAt: '2026-11-08T08:00:00.000Z' },
];
const message = (over: Partial<ModMessage> = {}): ModMessage => ({ id: '41', channel: 'global', author: 'vega', body: 'esto molesta', at: '2026-11-08T09:00:00.000Z', hidden: null, reports: 0, ...over });
const posted = (fetch: ReturnType<typeof mockApi>, url: string) =>
  fetch.mock.calls.filter(([u, init]) => u === url && init?.method === 'POST').map(([, init]) => JSON.parse(String(init?.body ?? '{}')));

test('un moderador entra al panel pero solo ve Moderación, y lo demás le lleva a ella', async () => {
  mockApi({ 'GET /galaxy/api/auth/me': () => jsonResponse(200, mod) });
  renderAt('/admin', { '/admin': <AdminLayout /> });
  const nav = await screen.findByRole('navigation', { name: copy.admin.nav });
  expect(within(nav).getByRole('link', { name: copy.admin.sections.moderation })).toHaveAttribute('href', '/admin/moderacion');
  expect(within(nav).queryByRole('link', { name: copy.admin.sections.players })).toBeNull();
  expect(within(nav).queryByText(copy.admin.sections.config)).toBeNull();
});

test('el inicio del panel y las páginas de admin mandan al moderador a Moderación', async () => {
  mockApi({ 'GET /galaxy/api/auth/me': () => jsonResponse(200, mod) });
  renderAt('/admin', { '/admin': <AdminHome /> });
  await waitFor(() => expect(locationOf(screen.getByTestId('location')).pathname).toBe('/admin/moderacion'));
});

test('un moderador que abre jugadores acaba en Moderación', async () => {
  mockApi({ 'GET /galaxy/api/auth/me': () => jsonResponse(200, mod) });
  renderAt('/admin/jugadores', { '/admin/jugadores': <AdminOnly /> });
  await waitFor(() => expect(locationOf(screen.getByTestId('location')).pathname).toBe('/admin/moderacion'));
});

test('la cola de denuncias enseña el mensaje y sus motivos, y se resuelve con un motivo', async () => {
  const queue: ModReport[] = [{ message: message({ hidden: { reason: 'reports', by: null, at: '2026-11-08T09:05:00.000Z' }, reports: 3 }), reasons: ['Spam', 'Me ofende'], pending: 3, firstAt: '2026-11-08T09:01:00.000Z', lastAt: '2026-11-08T09:05:00.000Z' }];
  const fetch = mockApi({
    'GET /galaxy/api/auth/me': () => jsonResponse(200, mod),
    [`GET ${M}/reports?page=1`]: () => jsonResponse(200, { reports: queue, total: 51, page: 1, pages: 2 } satisfies ModReportPage),
    [`GET ${M}/reports?page=2`]: () => jsonResponse(200, { reports: [], total: 51, page: 2, pages: 2 } satisfies ModReportPage),
    [`GET ${M}/channels`]: () => jsonResponse(200, channels),
    [`POST ${M}/reports/41`]: () => jsonResponse(200, { outcome: 'kept' }),
  });
  renderAt('/admin/moderacion', { '/admin/moderacion': <Reports /> });
  const card = await screen.findByRole('article', { name: t.messageOf('vega') });
  expect(screen.getByText(t.waiting(51))).toBeInTheDocument();
  expect(within(card).getByText('esto molesta')).toBeInTheDocument();
  expect(within(card).getByText(t.pending(3))).toBeInTheDocument();
  // The total says nothing more while every report is still pending.
  expect(within(card).queryByText(t.reports(3))).toBeNull();
  expect(within(card).getByText(t.hiddenByReports)).toBeInTheDocument();
  expect(within(card).getByText('Spam')).toBeInTheDocument();
  expect(within(card).getByText('Comunidad')).toBeInTheDocument();
  await userEvent.click(within(card).getByRole('button', { name: t.restore }));
  const dialog = await screen.findByRole('dialog', { name: t.restore });
  await userEvent.type(within(dialog).getByLabelText(copy.admin.fields.reason), 'No incumple las normas');
  await userEvent.click(within(dialog).getByRole('button', { name: t.restore }));
  await waitFor(() => expect(posted(fetch, `${M}/reports/41`)).toEqual([{ outcome: 'kept', reason: 'No incumple las normas' }]));
  expect(await screen.findByRole('status')).toHaveTextContent(copy.admin.done);
  await userEvent.click(screen.getByRole('button', { name: copy.admin.next }));
  await waitFor(() => expect(fetch.mock.calls.some(([u]) => u === `${M}/reports?page=2`)).toBe(true));
});

test('sin denuncias pendientes lo dice', async () => {
  mockApi({ 'GET /galaxy/api/auth/me': () => jsonResponse(200, mod), [`GET ${M}/reports?page=1`]: () => jsonResponse(200, { reports: [], total: 0, page: 1, pages: 1 }), [`GET ${M}/channels`]: () => jsonResponse(200, channels) });
  renderAt('/admin/moderacion', { '/admin/moderacion': <Reports /> });
  expect(await screen.findByText(t.noReports)).toBeInTheDocument();
});

test('el chat en vivo lista los ocultos con quién los ocultó, se puede pausar y restaura uno con motivo', async () => {
  const fetch = mockApi({
    'GET /galaxy/api/auth/me': () => jsonResponse(200, admin),
    [`GET ${M}/channels`]: () => jsonResponse(200, channels),
    [`GET ${M}/messages?channel=global`]: () =>
      jsonResponse(200, [message({ id: '42', body: 'hola a todos', author: 'nova' }), message({ hidden: { reason: 'moderator', by: 'vigia', at: '2026-11-08T09:02:00.000Z' } })]),
    [`POST ${M}/messages/41/restore`]: () => jsonResponse(200, { hidden: false }),
  });
  renderAt('/admin/moderacion/chat', { '/admin/moderacion/chat': <LiveChat /> });
  const hidden = await screen.findByRole('article', { name: t.messageOf('vega') });
  expect(within(hidden).getByText(t.hiddenBy('vigia'))).toBeInTheDocument();
  expect(screen.getByText(t.live)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: t.pause }));
  expect(screen.getByText(t.paused)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: t.words })).toHaveAttribute('href', '/admin/configuracion/chat');
  await userEvent.click(within(hidden).getByRole('button', { name: t.restore }));
  const dialog = await screen.findByRole('dialog', { name: t.restore });
  await userEvent.type(within(dialog).getByLabelText(copy.admin.fields.reason), 'Era una broma');
  await userEvent.click(within(dialog).getByRole('button', { name: t.restore }));
  await waitFor(() => expect(posted(fetch, `${M}/messages/41/restore`)).toEqual([{ reason: 'Era una broma' }]));
});

test('el filtro de palabras no se ofrece a un moderador', async () => {
  mockApi({
    'GET /galaxy/api/auth/me': () => jsonResponse(200, mod),
    [`GET ${M}/channels`]: () => jsonResponse(200, channels),
    [`GET ${M}/messages?channel=global`]: () => jsonResponse(200, [message()]),
  });
  renderAt('/admin/moderacion/chat', { '/admin/moderacion/chat': <LiveChat /> });
  await screen.findByRole('article', { name: t.messageOf('vega') });
  expect(screen.queryByRole('link', { name: t.words })).toBeNull();
});

test('silenciar una cuenta pide nombre, duración y motivo; la lista se levanta con motivo', async () => {
  const mutes: ModMute[] = [{ username: 'nova', until: '2026-11-09T09:00:00.000Z', reason: 'Insultos', by: 'vigia' }];
  const fetch = mockApi({
    'GET /galaxy/api/auth/me': () => jsonResponse(200, mod),
    [`GET ${M}/mutes`]: () => jsonResponse(200, mutes),
    [`POST ${M}/mutes`]: () => jsonResponse(200, { until: '2026-11-09T10:00:00.000Z' }),
    [`POST ${M}/mutes/nova/lift`]: () => jsonResponse(200, { lifted: true }),
  });
  renderAt('/admin/moderacion/silencios', { '/admin/moderacion/silencios': <Mutes /> });
  expect(await screen.findByRole('cell', { name: 'Insultos' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: t.mute }));
  const dialog = await screen.findByRole('dialog', { name: t.mute });
  await userEvent.type(within(dialog).getByLabelText(t.username), 'vega');
  await userEvent.selectOptions(within(dialog).getByLabelText(copy.admin.fields.duration), '1440');
  await userEvent.type(within(dialog).getByLabelText(copy.admin.fields.reason), 'Spam');
  await userEvent.click(within(dialog).getByRole('button', { name: t.muteSubmit }));
  await waitFor(() => expect(posted(fetch, `${M}/mutes`)).toEqual([{ username: 'vega', minutes: 1440, reason: 'Spam' }]));

  await userEvent.click(screen.getByRole('button', { name: t.liftOf('nova') }));
  const lift = await screen.findByRole('dialog', { name: t.liftOf('nova') });
  await userEvent.type(within(lift).getByLabelText(copy.admin.fields.reason), 'Se disculpó');
  await userEvent.click(within(lift).getByRole('button', { name: t.lift }));
  await waitFor(() => expect(posted(fetch, `${M}/mutes/nova/lift`)).toEqual([{ reason: 'Se disculpó' }]));
});

test('disolver un clan pide la contraseña del admin', async () => {
  const clan: AdminClan = {
    tag: 'GX',
    name: 'Galácticos',
    members: 2,
    leader: 'vega',
    createdAt: '2026-11-01T10:00:00.000Z',
    description: 'Los mejores',
    emblem: 'eye',
    color: 'ice',
    open: true,
    roster: [
      { username: 'vega', role: 'leader', joinedAt: '2026-11-01T10:00:00.000Z' },
      { username: 'nova', role: 'member', joinedAt: '2026-11-02T10:00:00.000Z' },
    ],
  };
  const fetch = mockApi({
    'GET /galaxy/api/auth/me': () => jsonResponse(200, admin),
    'GET /galaxy/api/admin/clans/GX': () => jsonResponse(200, clan),
    'POST /galaxy/api/admin/clans/GX/dissolve': () => jsonResponse(200, { dissolved: true }),
  });
  renderAt('/admin/moderacion/clanes/GX', { '/admin/moderacion/clanes/:tag': <ClanPage /> });
  expect(await screen.findByRole('heading', { name: '[GX] Galácticos' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: t.clans.leaderOf('nova') })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: t.clans.leaderOf('vega') })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: t.clans.dissolve }));
  const dialog = await screen.findByRole('dialog', { name: t.clans.dissolve });
  await userEvent.type(within(dialog).getByLabelText(copy.admin.fields.reason), 'Clan de trampas');
  expect(within(dialog).getByRole('button', { name: t.clans.dissolve })).toBeDisabled();
  await userEvent.type(within(dialog).getByLabelText(copy.admin.fields.password), 'mi-clave');
  await userEvent.click(within(dialog).getByRole('button', { name: t.clans.dissolve }));
  await waitFor(() => expect(posted(fetch, '/galaxy/api/admin/clans/GX/dissolve')).toEqual([{ reason: 'Clan de trampas', password: 'mi-clave' }]));
  await waitFor(() => expect(locationOf(screen.getByTestId('location')).pathname).toBe('/admin/moderacion/clanes'));
});

test('un moderador con TOTP tiene el escudo del panel en la barra y su etiqueta dice Moderador', async () => {
  mockApi({});
  renderAt('/', { '/': <TopBar me={mod} wallet={undefined} freePull={false} onLogout={() => {}} leaving={false} /> });
  expect(await screen.findByRole('link', { name: copy.admin.title })).toHaveAttribute('href', '/admin');
  expect(screen.getByText(copy.hub.moderator)).toBeInTheDocument();
});
