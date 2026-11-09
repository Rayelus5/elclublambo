import type { AdminAlertsPage, AdminDealsPage, DealLineage, MeResponse } from '@galaxy/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { Alerts, Commerce } from '../src/admin/ModMarket';
import { ModerationLayout } from '../src/admin/ModerationScreen';
import { copy } from '../src/copy/es';
import { jsonResponse, mockApi, renderAt } from './render';

// Trade moderation on the web (GDD §16.4; M6c-2), for admins: the history of listings and trades with its filters in
// the address, cancelling, reverting after seeing each galaxy's lineage (with the password; not possible when a galaxy
// moved on, and the dialog says why), and the alerts reviewed with a reason. Moderators do not see these tabs.
afterEach(() => vi.unstubAllGlobals());

const t = copy.admin.market;
const admin: MeResponse = { id: 'ad1', username: 'rayelus', roles: ['superadmin'], mfa: true, level: 30 };
const mod: MeResponse = { id: 'm1', username: 'vigia', roles: ['moderator'], mfa: true, level: 1 };
const A = '/galaxy/api/admin/market';
const galaxy = { id: 'g1', name: 'Nebulosa Vega', tier: 2 };
const listings: AdminDealsPage = {
  kind: 'listings',
  rows: [
    { id: 'l1', galaxy, seller: 'vega', buyer: 'nova', price: 600, commission: 42, status: 'sold', listedAt: '2026-11-08T09:00:00.000Z', soldAt: '2026-11-08T09:05:00.000Z', reversal: null },
    { id: 'l2', galaxy: { ...galaxy, id: 'g2', name: 'Cúmulo Orión' }, seller: 'vega', buyer: null, price: 900, commission: null, status: 'active', listedAt: '2026-11-08T08:00:00.000Z', soldAt: null, reversal: null },
  ],
  page: 1,
  pages: 1,
};
const lineage = (returnable: boolean): DealLineage => ({
  returnable,
  reversal: null,
  galaxies: [
    {
      galaxy,
      from: 'vega',
      to: 'nova',
      owner: returnable ? 'nova' : 'orion',
      gone: false,
      fusedInto: null,
      laterMoves: returnable ? [] : [{ kind: 'sale', id: 'l9', at: '2026-11-08T10:00:00.000Z', from: 'nova', to: 'orion' }],
      leveledSince: 0,
      returnable,
    },
  ],
  money: { price: 600, owed: 558, recoverable: 100 },
});
const posted = (fetch: ReturnType<typeof mockApi>, url: string) =>
  fetch.mock.calls.filter(([u, init]) => u === url && init?.method === 'POST').map(([, init]) => JSON.parse(String(init?.body ?? '{}')));

test('el historial de anuncios se filtra por cuenta y estado desde la dirección, y pasa a trueques', async () => {
  const fetch = mockApi({
    'GET /galaxy/api/auth/me': () => jsonResponse(200, admin),
    [`GET ${A}/deals?kind=listings&page=1`]: () => jsonResponse(200, listings),
    [`GET ${A}/deals?kind=listings&user=vega&status=sold&page=1`]: () => jsonResponse(200, { ...listings, rows: [listings.rows[0]!] }),
    [`GET ${A}/deals?kind=trades&user=vega&page=1`]: () => jsonResponse(200, { kind: 'trades', rows: [], page: 1, pages: 1 } satisfies AdminDealsPage),
  });
  renderAt('/admin/moderacion/comercio', { '/admin/moderacion/comercio': <Commerce /> });
  const table = await screen.findByRole('table', { name: t.listingsTitle });
  expect(within(table).getByRole('cell', { name: 'Nebulosa Vega' })).toBeInTheDocument();
  expect(within(table).getByText(t.statuses['sold']!)).toBeInTheDocument();
  expect(within(table).getByRole('button', { name: t.withdrawOf('Cúmulo Orión') })).toBeInTheDocument();
  expect(within(table).getByRole('button', { name: t.revertOf('Nebulosa Vega') })).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText(t.account), 'vega');
  await userEvent.selectOptions(screen.getByLabelText(t.status), 'sold');
  await waitFor(() => expect(fetch.mock.calls.some(([u]) => u === `${A}/deals?kind=listings&user=vega&status=sold&page=1`)).toBe(true));
  await userEvent.click(screen.getByRole('button', { name: t.kinds.trades }));
  expect(await screen.findByText(t.noTrades)).toBeInTheDocument();
});

test('revertir una venta enseña a dónde vuelve la galaxia y pide la contraseña', async () => {
  const fetch = mockApi({
    'GET /galaxy/api/auth/me': () => jsonResponse(200, admin),
    [`GET ${A}/deals?kind=listings&page=1`]: () => jsonResponse(200, listings),
    [`GET ${A}/lineage?kind=listing&id=l1`]: () => jsonResponse(200, lineage(true)),
    [`POST ${A}/listings/l1/revert`]: () => jsonResponse(200, { reverted: true, shortfall: 458 }),
  });
  renderAt('/admin/moderacion/comercio', { '/admin/moderacion/comercio': <Commerce /> });
  await userEvent.click(await screen.findByRole('button', { name: t.revertOf('Nebulosa Vega') }));
  const dialog = await screen.findByRole('dialog', { name: t.revertOf('Nebulosa Vega') });
  expect(await within(dialog).findByText(t.goesBack('Nebulosa Vega', 'nova', 'vega'))).toBeInTheDocument();
  expect(within(dialog).getByText(t.money(600, 100, 558))).toBeInTheDocument();
  expect(within(dialog).getByText(t.shortfallAhead(458))).toBeInTheDocument();
  await userEvent.type(within(dialog).getByLabelText(copy.admin.fields.reason), 'Fraude entre cuentas');
  expect(within(dialog).getByRole('button', { name: t.revert })).toBeDisabled();
  await userEvent.type(within(dialog).getByLabelText(copy.admin.fields.password), 'mi-clave');
  await userEvent.click(within(dialog).getByRole('button', { name: t.revert }));
  await waitFor(() => expect(posted(fetch, `${A}/listings/l1/revert`)).toEqual([{ reason: 'Fraude entre cuentas', password: 'mi-clave' }]));
  expect(await within(dialog).findByText(t.revertedShort(458))).toBeInTheDocument();
});

test('si la galaxia ya pasó a otra cuenta, el diálogo dice por qué y no deja revertir', async () => {
  mockApi({
    'GET /galaxy/api/auth/me': () => jsonResponse(200, admin),
    [`GET ${A}/deals?kind=listings&page=1`]: () => jsonResponse(200, listings),
    [`GET ${A}/lineage?kind=listing&id=l1`]: () => jsonResponse(200, lineage(false)),
  });
  renderAt('/admin/moderacion/comercio', { '/admin/moderacion/comercio': <Commerce /> });
  await userEvent.click(await screen.findByRole('button', { name: t.revertOf('Nebulosa Vega') }));
  const dialog = await screen.findByRole('dialog', { name: t.revertOf('Nebulosa Vega') });
  expect(await within(dialog).findByText(t.moved('nova', 'orion', '8 nov'), { exact: false })).toBeInTheDocument();
  expect(within(dialog).getByText(t.blocked)).toBeInTheDocument();
  await userEvent.type(within(dialog).getByLabelText(copy.admin.fields.reason), 'Fraude entre cuentas');
  await userEvent.type(within(dialog).getByLabelText(copy.admin.fields.password), 'mi-clave');
  expect(within(dialog).getByRole('button', { name: t.revert })).toBeDisabled();
});

test('retirar un anuncio activo pide solo un motivo', async () => {
  const fetch = mockApi({
    'GET /galaxy/api/auth/me': () => jsonResponse(200, admin),
    [`GET ${A}/deals?kind=listings&page=1`]: () => jsonResponse(200, listings),
    [`POST ${A}/listings/l2/cancel`]: () => jsonResponse(200, { cancelled: true }),
  });
  renderAt('/admin/moderacion/comercio', { '/admin/moderacion/comercio': <Commerce /> });
  await userEvent.click(await screen.findByRole('button', { name: t.withdrawOf('Cúmulo Orión') }));
  const dialog = await screen.findByRole('dialog', { name: t.withdrawOf('Cúmulo Orión') });
  expect(within(dialog).queryByLabelText(copy.admin.fields.password)).toBeNull();
  await userEvent.type(within(dialog).getByLabelText(copy.admin.fields.reason), 'Precio abusivo');
  await userEvent.click(within(dialog).getByRole('button', { name: t.withdraw }));
  await waitFor(() => expect(posted(fetch, `${A}/listings/l2/cancel`)).toEqual([{ reason: 'Precio abusivo' }]));
});

test('las alertas pendientes se marcan revisadas con motivo, y las revisadas dicen quién', async () => {
  const pending: AdminAlertsPage = {
    rows: [{ id: '7', kind: 'shared_ip', deal: { kind: 'listing', id: 'l1' }, seller: 'vega', buyer: 'nova', details: { ip: '10.0.0.1' }, at: '2026-11-08T09:05:00.000Z', review: null }],
    page: 1,
    pages: 1,
  };
  const fetch = mockApi({
    'GET /galaxy/api/auth/me': () => jsonResponse(200, admin),
    [`GET ${A}/alerts?reviewed=false&page=1`]: () => jsonResponse(200, pending),
    [`GET ${A}/alerts?reviewed=true&page=1`]: () =>
      jsonResponse(200, { ...pending, rows: [{ ...pending.rows[0]!, review: { at: '2026-11-08T10:00:00.000Z', by: 'rayelus', reason: 'Hermanos' } }] } satisfies AdminAlertsPage),
    [`POST ${A}/alerts/7/review`]: () => jsonResponse(200, { reviewed: true }),
  });
  renderAt('/admin/moderacion/alertas', { '/admin/moderacion/alertas': <Alerts /> });
  const row = (await screen.findByRole('cell', { name: t.kindsAlert.shared_ip })).closest('tr')!;
  expect(within(row).getByText('10.0.0.1', { exact: false })).toBeInTheDocument();
  expect(within(row).getByRole('link', { name: t.seeDeal })).toHaveAttribute('href', '/admin/moderacion/comercio?tipo=anuncios&cuenta=vega');
  await userEvent.click(within(row).getByRole('button', { name: t.review }));
  const dialog = await screen.findByRole('dialog', { name: t.review });
  await userEvent.type(within(dialog).getByLabelText(copy.admin.fields.reason), 'Hermanos que juegan juntos');
  await userEvent.click(within(dialog).getByRole('button', { name: t.review }));
  await waitFor(() => expect(posted(fetch, `${A}/alerts/7/review`)).toEqual([{ reason: 'Hermanos que juegan juntos' }]));
  await userEvent.click(screen.getByRole('button', { name: t.reviewedTab }));
  expect(await screen.findByText(t.reviewedBy('rayelus', 'Hermanos'))).toBeInTheDocument();
});

test('un moderador no ve Comercio ni Alertas en los apartados (sí las salas en vivo)', async () => {
  mockApi({ 'GET /galaxy/api/auth/me': () => jsonResponse(200, mod) });
  renderAt('/admin/moderacion', { '/admin/moderacion': <ModerationLayout /> });
  const nav = await screen.findByRole('navigation', { name: copy.admin.moderation.nav });
  await waitFor(() => expect(within(nav).getAllByRole('link')).toHaveLength(4));
  expect(within(nav).getByRole('link', { name: copy.admin.moderation.tabs.rooms })).toBeInTheDocument();
  expect(within(nav).queryByRole('link', { name: copy.admin.moderation.tabs.commerce })).toBeNull();
});

test('una venta revertida dice en su fila quién, por qué y lo que faltó', async () => {
  const reverted: AdminDealsPage = { ...listings, rows: [{ ...listings.rows[0]!, reversal: { at: '2026-11-08T11:00:00.000Z', by: 'rayelus', reason: 'Fraude', shortfall: 458 } }] };
  mockApi({ 'GET /galaxy/api/auth/me': () => jsonResponse(200, admin), [`GET ${A}/deals?kind=listings&page=1`]: () => jsonResponse(200, reverted) });
  renderAt('/admin/moderacion/comercio', { '/admin/moderacion/comercio': <Commerce /> });
  const table = await screen.findByRole('table', { name: t.listingsTitle });
  expect(within(table).getByText(t.revertedBy('rayelus', 'Fraude'))).toBeInTheDocument();
  expect(within(table).getByText(t.shortfallWas(458))).toBeInTheDocument();
  expect(within(table).queryByRole('button', { name: t.revertOf('Nebulosa Vega') })).toBeNull();
});

test('si el comprador la subió de nivel o ya se revirtió, el diálogo lo dice', async () => {
  const leveled = lineage(true);
  leveled.returnable = false;
  leveled.galaxies[0] = { ...leveled.galaxies[0]!, leveledSince: 120, returnable: false };
  mockApi({
    'GET /galaxy/api/auth/me': () => jsonResponse(200, admin),
    [`GET ${A}/deals?kind=listings&page=1`]: () => jsonResponse(200, listings),
    [`GET ${A}/lineage?kind=listing&id=l1`]: () => jsonResponse(200, leveled),
  });
  renderAt('/admin/moderacion/comercio', { '/admin/moderacion/comercio': <Commerce /> });
  await userEvent.click(await screen.findByRole('button', { name: t.revertOf('Nebulosa Vega') }));
  const dialog = await screen.findByRole('dialog', { name: t.revertOf('Nebulosa Vega') });
  expect(await within(dialog).findByText(t.leveled(120), { exact: false })).toBeInTheDocument();
});

test('un trato que otro admin ya revirtió no invita a corregirlo a mano', async () => {
  const done = { ...lineage(false), reversal: { at: '2026-11-08T11:00:00.000Z', by: 'otro', reason: 'Fraude' } };
  mockApi({
    'GET /galaxy/api/auth/me': () => jsonResponse(200, admin),
    [`GET ${A}/deals?kind=listings&page=1`]: () => jsonResponse(200, listings),
    [`GET ${A}/lineage?kind=listing&id=l1`]: () => jsonResponse(200, done),
  });
  renderAt('/admin/moderacion/comercio', { '/admin/moderacion/comercio': <Commerce /> });
  await userEvent.click(await screen.findByRole('button', { name: t.revertOf('Nebulosa Vega') }));
  const dialog = await screen.findByRole('dialog', { name: t.revertOf('Nebulosa Vega') });
  expect(await within(dialog).findByText(t.alreadyReverted('otro', '8 nov'))).toBeInTheDocument();
  expect(within(dialog).queryByText(t.blocked)).toBeNull();
});

test('el filtro de cuenta espera a un nombre completo antes de buscar', async () => {
  const fetch = mockApi({
    'GET /galaxy/api/auth/me': () => jsonResponse(200, admin),
    [`GET ${A}/deals?kind=listings&page=1`]: () => jsonResponse(200, listings),
    [`GET ${A}/deals?kind=listings&user=veg&page=1`]: () => jsonResponse(200, listings),
  });
  renderAt('/admin/moderacion/comercio', { '/admin/moderacion/comercio': <Commerce /> });
  await screen.findByRole('table', { name: t.listingsTitle });
  await userEvent.type(screen.getByLabelText(t.account), 've');
  await new Promise((r) => setTimeout(r, 450));
  expect(fetch.mock.calls.some(([u]) => String(u).includes('user=ve&'))).toBe(false);
  expect(screen.queryByRole('alert')).toBeNull();
  await userEvent.type(screen.getByLabelText(t.account), 'g');
  await waitFor(() => expect(fetch.mock.calls.some(([u]) => u === `${A}/deals?kind=listings&user=veg&page=1`)).toBe(true));
});
