import type { AdminPlayer, AdminPlayerList, AdminPlayerRow, AdminSection, AuditPage, MeResponse } from '@galaxy/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import { AdminLayout } from '../src/admin/AdminLayout';
import { AuditScreen } from '../src/admin/AuditScreen';
import { PlayerScreen } from '../src/admin/PlayerScreen';
import { PlayersScreen } from '../src/admin/PlayersScreen';
import { copy } from '../src/copy/es';
import { jsonResponse, locationOf, mockApi, renderAt } from './render';
import { pickOption } from './pick';

// The admin panel on the web (GDD §16.1, §16.2; M6a): only for admins signed in with TOTP; finding a player, their
// page with state and tabs, the change dialogs (reason always, the admin's password for destructive ones), the reset
// code shown once, and the audit log with its filters and CSV export.
afterEach(() => vi.unstubAllGlobals());

const t = copy.admin;
const admin: MeResponse = { id: 'ad1', username: 'rayelus', roles: ['superadmin'], mfa: true, level: 30 };
const player: AdminPlayer = {
  id: 'p1',
  username: 'vega',
  createdAt: '2026-11-01T10:00:00.000Z',
  roles: [],
  level: 12,
  xp: 15000,
  banned: { until: '9999-12-31T00:00:00.000Z', permanent: true },
  muted: null,
  leaderboardExcluded: false,
  clan: { tag: 'GX', name: 'Galácticos', role: 'leader' },
  wallet: { coins: 1200, dust: 30, signal: 2, material: 5, components: 1 },
  counts: { galaxies: 14, runs: 40, pulls: 30, listings: 2, trades: 1, messages: 9 },
  sessions: [{ createdAt: '2026-11-08T10:00:00.000Z', expiresAt: '2026-11-09T10:00:00.000Z', ip: '10.0.0.7', userAgent: 'Firefox', mfa: false }],
  ips: [{ ip: '10.0.0.7', firstSeen: '2026-11-01T10:00:00.000Z', lastSeen: '2026-11-08T10:00:00.000Z' }],
  station: [{ room: 'refinery', level: 2 }],
  lab: ['probe-hull:1'],
  probes: [{ probe: 'lumen', level: 3 }],
  deletedAt: null,
};
const P = '/galaxy/api/admin/players';
const posted = (fetch: ReturnType<typeof mockApi>, path: string) =>
  fetch.mock.calls.filter(([url, init]) => url === `${P}${path}` && init?.method === 'POST').map(([, init]) => JSON.parse(String(init?.body ?? '{}')));

function api(routes: Record<string, (b: unknown) => Response> = {}, me: MeResponse = admin) {
  return mockApi({ 'GET /galaxy/api/auth/me': () => jsonResponse(200, me), [`GET ${P}/vega`]: () => jsonResponse(200, player), ...routes });
}
const playerPage = () =>
  renderAt('/admin/jugadores/vega', { '/admin/jugadores/:username': <PlayerScreen /> });

test('quien no es admin con TOTP vuelve al inicio', async () => {
  api({}, { id: 'x', username: 'normal', roles: [], mfa: false, level: 3 });
  renderAt('/admin', { '/admin': <AdminLayout /> });
  await waitFor(() => expect(locationOf(screen.getByTestId('location')).pathname).toBe('/'));
});

test('la barra lateral lleva a todas las secciones del panel, ya sin nada en «Próximamente»', async () => {
  api();
  renderAt('/admin', { '/admin': <AdminLayout /> });
  const nav = await screen.findByRole('navigation', { name: t.nav });
  expect(within(nav).getByRole('link', { name: t.sections.players })).toHaveAttribute('href', '/admin/jugadores');
  expect(within(nav).getByRole('link', { name: t.sections.audit })).toHaveAttribute('href', '/admin/auditoria');
  expect(within(nav).getByRole('link', { name: t.sections.config })).toHaveAttribute('href', '/admin/configuracion');
  expect(within(nav).getByRole('link', { name: t.sections.moderation })).toHaveAttribute('href', '/admin/moderacion');
  expect(within(nav).getByRole('link', { name: t.sections.stats })).toHaveAttribute('href', '/admin/estadisticas');
  // Every section of the panel works now: nothing is left «Próximamente».
  expect(within(nav).queryByText(t.soon)).toBeNull();
});

// Plan «escáner pro», part F: the whole list with nothing typed, its filters in the URL, sortable headers, 50 a page and
// «Eliminar» from each row.
const row = (over: Partial<AdminPlayerRow> = {}): AdminPlayerRow => ({ username: 'vega', level: 12, createdAt: '2026-11-01T10:00:00.000Z', lastSeen: null, banned: false, roles: [], clan: 'GX', online: false, muted: false, deletedAt: null, ...over });
const listOf = (players: AdminPlayerRow[], total = players.length, page = 1) => jsonResponse(200, { players, total, page, pages: Math.max(1, Math.ceil(total / 50)) } satisfies AdminPlayerList);
const L = (q: string) => `GET ${P}?${q}`;
const playersPage = (path = '/admin/jugadores') => renderAt(path, { '/admin/jugadores': <PlayersScreen />, '/admin/jugadores/:username': <PlayerScreen /> });
/** The list with its address beside it, to read the filters it keeps in the URL. */
function Where() {
  return <output data-testid="where">{useLocation().search}</output>;
}
const where = () => screen.getByTestId('where').textContent;

test('sin escribir nada sale la lista entera, con su total, y cada nombre lleva a su ficha', async () => {
  api({ [L('q=&state=all&sort=created&dir=desc&page=1')]: () => listOf([row({ banned: true }), row({ username: 'orion', online: true, roles: ['moderator'] }), row({ username: 'lyra', muted: true })], 120) });
  playersPage();
  const table = await screen.findByRole('table');
  expect(within(table).getByRole('link', { name: 'vega' })).toHaveAttribute('href', '/admin/jugadores/vega');
  expect(within(table).getByText(t.states.banned)).toBeInTheDocument();
  expect(within(table).getByText(t.list.online)).toBeInTheDocument();
  expect(within(table).getByText(t.list.muted)).toBeInTheDocument();
  expect(screen.getByText(t.list.total(120))).toBeInTheDocument();
  expect(screen.getByRole('navigation', { name: t.pageOf(1, 3) })).toBeInTheDocument();
});

test('el texto, el estado, el orden y la página van en la URL y en la petición', async () => {
  const fetch = api({
    [L('q=&state=all&sort=created&dir=desc&page=1')]: () => listOf([row()], 120),
    [L('q=veg&state=all&sort=created&dir=desc&page=1')]: () => listOf([row()], 120),
    [L('q=veg&state=banned&sort=created&dir=desc&page=1')]: () => listOf([row({ banned: true })], 120),
    [L('q=veg&state=banned&sort=name&dir=asc&page=1')]: () => listOf([row({ banned: true })], 120),
    [L('q=veg&state=banned&sort=name&dir=desc&page=1')]: () => listOf([row({ banned: true })], 120),
    [L('q=veg&state=banned&sort=name&dir=desc&page=2')]: () => listOf([row({ banned: true })], 120, 2),
  });
  renderAt('/admin/jugadores', { '/admin/jugadores': (
    <>
      <PlayersScreen />
      <Where />
    </>
  ) });
  const user = userEvent.setup();
  await user.type(await screen.findByRole('searchbox', { name: t.search }), 'veg');
  await waitFor(() => expect(where()).toBe('?q=veg'));
  // The text settles before it is asked for.
  await waitFor(() => expect(fetch.mock.calls.some(([url]) => String(url).includes('?q=veg&state=all'))).toBe(true));
  await pickOption(user, screen.getByLabelText(t.list.state), 'banned');
  await waitFor(() => expect(where()).toBe('?q=veg&estado=baneados'));
  await waitFor(() => expect(fetch.mock.calls.some(([url]) => String(url).includes('state=banned'))).toBe(true));
  const header = () => screen.getByRole('columnheader', { name: t.columns.username });
  expect(header()).not.toHaveAttribute('aria-sort');
  await user.click(within(header()).getByRole('button'));
  await waitFor(() => expect(header()).toHaveAttribute('aria-sort', 'ascending'));
  await user.click(within(header()).getByRole('button'));
  await waitFor(() => expect(header()).toHaveAttribute('aria-sort', 'descending'));
  expect(screen.getByRole('columnheader', { name: t.columns.createdAt })).not.toHaveAttribute('aria-sort');
  await user.click(screen.getByRole('button', { name: t.next }));
  await waitFor(() => expect(where()).toBe('?q=veg&estado=baneados&orden=nombre&dir=desc&pagina=2'));
  await waitFor(() => expect(fetch.mock.calls.some(([url]) => String(url).endsWith('page=2'))).toBe(true));
});

test('un enlace con filtros los abre puestos', async () => {
  const fetch = api({ [L('q=lyr&state=staff&sort=seen&dir=asc&page=3')]: () => listOf([row({ username: 'lyra' })], 120, 3) });
  playersPage('/admin/jugadores?q=lyr&estado=equipo&orden=visto&dir=asc&pagina=3');
  expect(await screen.findByRole('link', { name: 'lyra' })).toBeInTheDocument();
  expect(screen.getByRole('searchbox', { name: t.search })).toHaveValue('lyr');
  expect(screen.getByRole('columnheader', { name: t.columns.lastSeen })).toHaveAttribute('aria-sort', 'ascending');
  expect(fetch).toHaveBeenCalled();
});

test('eliminar desde la lista pide motivo, tu contraseña y el nombre escrito; reservarlo es opcional', async () => {
  const fetch = api({
    [L('q=&state=all&sort=created&dir=desc&page=1')]: () => listOf([row(), row({ username: 'rayelus', roles: ['superadmin'] }), row({ username: 'borrado_0a1b2c3d', deletedAt: '2026-11-12T10:00:00.000Z', banned: true })]),
    [`POST ${P}/vega/delete`]: () => jsonResponse(200, { username: 'borrado_9f8e7d6c' }),
  });
  playersPage();
  const user = userEvent.setup();
  await screen.findByRole('table');
  // Not oneself, not a superadmin, not one already deleted.
  expect(screen.queryByRole('button', { name: t.actions.deleteOf('rayelus') })).toBeNull();
  expect(screen.queryByRole('button', { name: t.actions.deleteOf('borrado_0a1b2c3d') })).toBeNull();
  expect(screen.getByText(t.list.deleted)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: t.actions.deleteOf('vega') }));
  const dialog = await screen.findByRole('dialog', { name: t.actions.deleteOf('vega') });
  expect(within(dialog).getByText(t.deleteIntro)).toBeInTheDocument();
  const go = within(dialog).getByRole('button', { name: t.actions.delete });
  await user.type(within(dialog).getByLabelText(t.fields.reason), 'Lo pidió el jugador');
  await user.type(within(dialog).getByLabelText(t.fields.password), 'mi-clave');
  await user.type(within(dialog).getByLabelText(t.fields.confirm), 'veg');
  expect(go).toBeDisabled();
  await user.type(within(dialog).getByLabelText(t.fields.confirm), 'a');
  await user.click(within(dialog).getByRole('switch', { name: t.fields.reserveName }));
  expect(go).toBeEnabled();
  await user.click(go);
  await waitFor(() => expect(posted(fetch, '/vega/delete')).toEqual([{ confirm: 'vega', reserveName: true, reason: 'Lo pidió el jugador', password: 'mi-clave' }]));
  expect(await screen.findByRole('status')).toHaveTextContent(t.deletedAs('vega', 'borrado_9f8e7d6c'));
});

test('la ficha dice su estado y sus pestañas leen los historiales', async () => {
  api({ [`GET ${P}/vega/ledger?page=1`]: () => jsonResponse(200, { rows: [{ at: '2026-11-08T10:00:00.000Z', currency: 'coins', delta: -2000, balance: 0, reason: 'clan_create' }], page: 1, pages: 1 } satisfies AdminSection) });
  playerPage();
  expect(await screen.findByRole('heading', { level: 1, name: 'vega' })).toBeInTheDocument();
  expect(screen.getByText(t.states.bannedForever)).toBeInTheDocument();
  expect(screen.getByText(t.wallet.coins)).toBeInTheDocument();
  const user = userEvent.setup();
  await user.click(screen.getByRole('tab', { name: t.tabs.ledger }));
  expect(await screen.findByRole('cell', { name: 'clan_create' })).toBeInTheDocument();
});

test('dar moneda pide motivo; quitarla pide además tu contraseña, y se confirma', async () => {
  const fetch = api({ [`POST ${P}/vega/wallet`]: () => jsonResponse(200, { balance: 1100 }) });
  playerPage();
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: t.actions.wallet }));
  const dialog = await screen.findByRole('dialog', { name: t.actions.wallet });
  await pickOption(user, within(dialog).getByLabelText(t.fields.currency), 'coins');
  await user.type(within(dialog).getByLabelText(t.fields.amount), '-100');
  expect(within(dialog).getByLabelText(t.fields.password)).toBeInTheDocument();
  await user.type(within(dialog).getByLabelText(t.fields.reason), 'Corrección');
  await user.type(within(dialog).getByLabelText(t.fields.password), 'mi-clave');
  await user.click(within(dialog).getByRole('button', { name: t.apply }));
  await waitFor(() => expect(posted(fetch, '/vega/wallet')).toEqual([{ currency: 'coins', amount: -100, reason: 'Corrección', password: 'mi-clave' }]));
  expect(await screen.findByRole('status')).toHaveTextContent(t.done);
});

test('banear elige la duración y pide la contraseña', async () => {
  const fetch = api({ [`GET ${P}/vega`]: () => jsonResponse(200, { ...player, banned: null }), [`POST ${P}/vega/ban`]: () => jsonResponse(200, { until: '2026-11-15T10:00:00.000Z' }) });
  playerPage();
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: t.actions.ban }));
  const dialog = await screen.findByRole('dialog', { name: t.actions.ban });
  await pickOption(user, within(dialog).getByLabelText(t.fields.duration), '10080');
  await user.type(within(dialog).getByLabelText(t.fields.reason), 'Trampas');
  expect(within(dialog).getByRole('button', { name: t.apply })).toBeDisabled();
  await user.type(within(dialog).getByLabelText(t.fields.password), 'mi-clave');
  await user.click(within(dialog).getByRole('button', { name: t.apply }));
  await waitFor(() => expect(posted(fetch, '/vega/ban')).toEqual([{ minutes: 10080, reason: 'Trampas', password: 'mi-clave' }]));
});

test('cambiar el nombre lleva a la ficha con el nombre nuevo', async () => {
  api({ [`POST ${P}/vega/rename`]: () => jsonResponse(200, { username: 'vega_nueva' }), [`GET ${P}/vega_nueva`]: () => jsonResponse(200, { ...player, username: 'vega_nueva' }) });
  renderAt('/admin/jugadores/vega', { '/admin/jugadores/:username': <PlayerScreen /> });
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: t.actions.rename }));
  const dialog = await screen.findByRole('dialog', { name: t.actions.rename });
  await user.type(within(dialog).getByLabelText(t.fields.username), 'vega_nueva');
  await user.type(within(dialog).getByLabelText(t.fields.reason), 'Nombre ofensivo');
  await user.type(within(dialog).getByLabelText(t.fields.password), 'mi-clave');
  await user.click(within(dialog).getByRole('button', { name: t.apply }));
  expect(await screen.findByRole('heading', { level: 1, name: 'vega_nueva' })).toBeInTheDocument();
});

test('el código de recuperación se enseña una vez, para copiarlo', async () => {
  api({ [`POST ${P}/vega/reset-code`]: () => jsonResponse(200, { code: 'ABCD-EFGH-IJKL-MNOP' }) });
  playerPage();
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: t.actions.resetCode }));
  const dialog = await screen.findByRole('dialog', { name: t.actions.resetCode });
  await user.type(within(dialog).getByLabelText(t.fields.reason), 'Perdió la clave');
  await user.type(within(dialog).getByLabelText(t.fields.password), 'mi-clave');
  await user.click(within(dialog).getByRole('button', { name: t.apply }));
  expect(await within(dialog).findByText('ABCD-EFGH-IJKL-MNOP')).toBeInTheDocument();
  expect(within(dialog).getByText(t.codeOnce)).toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: t.copy })).toBeInTheDocument();
});

test('la auditoría se filtra y se exporta a CSV con los mismos filtros', async () => {
  const page: AuditPage = {
    rows: [{ id: '9', at: '2026-11-08T10:00:00.000Z', actor: 'rayelus', action: 'player.ban', targetType: 'account', targetId: 'p1', before: null, after: { until: 'x' }, reason: 'Trampas', ip: '10.0.0.1' }],
    page: 1,
    pages: 1,
  };
  api({
    'GET /galaxy/api/admin/audit?page=1': () => jsonResponse(200, page),
    'GET /galaxy/api/admin/audit?actor=rayelus&page=1': () => jsonResponse(200, page),
    'GET /galaxy/api/admin/audit?actor=rayelus&from=2026-11-01&page=1': () => jsonResponse(200, page),
  });
  renderAt('/admin/auditoria', { '/admin/auditoria': <AuditScreen /> });
  const user = userEvent.setup();
  expect(await screen.findByRole('cell', { name: 'player.ban' })).toBeInTheDocument();
  await user.type(screen.getByLabelText(t.audit.actor), 'rayelus');
  await waitFor(() => expect(screen.getByRole('link', { name: t.audit.export })).toHaveAttribute('href', '/galaxy/api/admin/audit?actor=rayelus&format=csv'));
  // The dates use the game's own calendar, and keep sending the day as the native field did.
  expect(screen.getAllByRole('button', { name: copy.picker.open })).toHaveLength(2);
  await user.type(screen.getByLabelText(t.audit.from), '01/11/2026');
  await waitFor(() => expect(screen.getByRole('link', { name: t.audit.export })).toHaveAttribute('href', '/galaxy/api/admin/audit?actor=rayelus&from=2026-11-01&format=csv'));
});

test('eliminar desde la ficha vuelve a la lista; una cuenta eliminada ya no ofrece cambios', async () => {
  const fetch = api({
    [`POST ${P}/vega/delete`]: () => jsonResponse(200, { username: 'borrado_9f8e7d6c' }),
    [L('q=&state=all&sort=created&dir=desc&page=1')]: () => listOf([]),
  });
  playerPage();
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: t.actions.delete }));
  const dialog = await screen.findByRole('dialog', { name: t.actions.deleteOf('vega') });
  await user.type(within(dialog).getByLabelText(t.fields.reason), 'Lo pidió el jugador');
  await user.type(within(dialog).getByLabelText(t.fields.password), 'mi-clave');
  await user.type(within(dialog).getByLabelText(t.fields.confirm), 'vega');
  await user.click(within(dialog).getByRole('button', { name: t.actions.delete }));
  await waitFor(() => expect(posted(fetch, '/vega/delete')).toHaveLength(1));
  await waitFor(() => expect(locationOf(screen.getByTestId('location')).pathname).toBe('/admin/jugadores'));
});

test('la ficha de una cuenta eliminada lo dice y no enseña acciones', async () => {
  api({ [`GET ${P}/borrado_0a1b2c3d`]: () => jsonResponse(200, { ...player, username: 'borrado_0a1b2c3d', deletedAt: '2026-11-12T10:00:00.000Z' }) });
  renderAt('/admin/jugadores/borrado_0a1b2c3d', { '/admin/jugadores/:username': <PlayerScreen /> });
  expect(await screen.findByText(t.deletedOn('12 de noviembre de 2026'))).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: t.actions.ban })).toBeNull();
  expect(screen.queryByRole('button', { name: t.actions.delete })).toBeNull();
});
