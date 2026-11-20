import type { AdminPriceCheck, AdminShopAlert, AdminShopSummary } from '@galaxy/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { ShopAdminScreen } from '../src/admin/shop/ShopAdminScreen';
import { copy } from '../src/copy/es';
import { eur } from '../src/shop/art-hooks';
import { jsonResponse, mockApi, renderAt } from './render';

// The resource shop in the panel (shop and lab plan, F5b): its state and earnings, the purchases (synced with Stripe
// when needed), the alerts reviewed with a reason, blocks lifted with the password, and the Stripe prices checked.

const t = copy.admin.shop;
afterEach(() => vi.unstubAllGlobals());
const plain = (text: string) => text.replace(/\s/g, ' ');

const summary: AdminShopSummary = {
  enabled: true,
  audience: 'staff',
  ready: true,
  mode: 'live',
  paid: { todayCents: 399, weekCents: 1698, monthCents: 1698, allCents: 1698, count: 2, buyers: 2 },
  refundedCents: 699,
  disputed: 0,
  openAlerts: 1,
  blocked: 1,
  products: [{ product: 'coins-1', name: 'Puñado de monedas', count: 2, cents: 798 }],
};
const alert: AdminShopAlert = {
  id: '7',
  kind: 'refund',
  username: 'pilota',
  purchase: '00000000-0000-4000-8000-000000000001',
  product: 'dust-2',
  details: { refundedCents: 699, taken: { coins: 0, dust: 200, components: 0 }, short: { coins: 0, dust: 400, components: 0 } },
  createdAt: '2026-11-11T10:00:00.000Z',
  reviewedAt: null,
  reviewer: null,
};
const checks: AdminPriceCheck[] = [
  { product: 'coins-1', name: 'Puñado de monedas', where: 'price', priceId: 'price_a', expectedCents: 399, stripeCents: 399, problem: null, beforeCents: null },
  { product: 'coins-2', name: 'Bolsa de monedas', where: 'price', priceId: 'price_b', expectedCents: 699, stripeCents: 799, problem: 'amount', beforeCents: null },
];

function open(routes: Record<string, (b: unknown) => Response> = {}, path = '/admin/tienda') {
  const fetch = mockApi({
    'GET /galaxy/api/admin/shop/summary': () => jsonResponse(200, summary),
    'GET /galaxy/api/admin/shop/alerts?open=true': () => jsonResponse(200, [alert]),
    'GET /galaxy/api/admin/shop/blocks': () => jsonResponse(200, [{ username: 'pilota', reason: 'Compra devuelta', purchase: null, createdAt: '2026-11-11T10:00:00.000Z', by: null }]),
    'GET /galaxy/api/admin/shop/purchases?page=1': () =>
      jsonResponse(200, {
        rows: [
          { id: '00000000-0000-4000-8000-000000000002', username: 'pilota', product: 'coins-1', name: 'Puñado de monedas', status: 'pending', amountCents: 399, refundedCents: 0, firstBonus: true, grants: { coins: 1000, dust: 0, components: 0 }, createdAt: '2026-11-11T10:00:00.000Z', paidAt: null },
        ],
        page: 1,
        pages: 1,
      }),
    ...routes,
  });
  renderAt(path, { '/admin/tienda': <ShopAdminScreen /> });
  return fetch;
}

test('el resumen dice su estado, lo ganado y las ventas por producto', async () => {
  open();
  expect(await screen.findByText(new RegExp(t.state(true, 'staff')))).toBeInTheDocument();
  expect(screen.getByRole('group', { name: t.tiles.all })).toHaveTextContent(plain(eur(1698)));
  expect(screen.getByRole('group', { name: t.tiles.refunded })).toHaveTextContent(plain(eur(699)));
  expect(screen.getByRole('link', { name: t.configure })).toHaveAttribute('href', '/admin/configuracion/shop');
  expect(screen.getByRole('cell', { name: 'Puñado de monedas' })).toBeInTheDocument();
});

test('una compra pendiente se sincroniza con Stripe', async () => {
  const fetch = open({ 'POST /galaxy/api/admin/shop/purchases/00000000-0000-4000-8000-000000000002/sync': () => jsonResponse(200, {}) }, '/admin/tienda?pestana=compras');
  fireEvent.click(await screen.findByRole('button', { name: t.syncOf('00000000-0000-4000-8000-000000000002') }));
  await waitFor(() => expect(fetch.mock.calls.some(([url, init]) => url === '/galaxy/api/admin/shop/purchases/00000000-0000-4000-8000-000000000002/sync' && init?.method === 'POST')).toBe(true));
  expect(screen.getByRole('cell', { name: t.statuses.pending })).toBeInTheDocument();
});

test('un aviso se revisa con un motivo, sin contraseña', async () => {
  const fetch = open({ 'POST /galaxy/api/admin/shop/alerts/7/review': () => jsonResponse(200, { reviewed: true }) }, '/admin/tienda?pestana=avisos');
  expect(await screen.findByRole('cell', { name: t.alertKinds.refund })).toBeInTheDocument();
  expect(screen.getByRole('cell', { name: `${eur(699)}, ${t.detail.taken('200 de polvo')}, ${t.detail.short('400 de polvo')}` })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: t.review }));
  const d = await screen.findByRole('dialog', { name: t.reviewTitle(t.alertKinds.refund!) });
  expect(within(d).queryByLabelText(copy.admin.fields.password)).toBeNull();
  fireEvent.change(within(d).getByLabelText(copy.admin.fields.reason), { target: { value: 'Hablado con el jugador' } });
  fireEvent.click(within(d).getByRole('button', { name: t.review }));
  await waitFor(() => {
    const call = fetch.mock.calls.find(([url]) => url === '/galaxy/api/admin/shop/alerts/7/review');
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ reason: 'Hablado con el jugador' });
  });
});

test('desbloquear pide la contraseña', async () => {
  const fetch = open({ 'POST /galaxy/api/admin/shop/blocks/pilota/unblock': () => jsonResponse(200, { blocked: false }) }, '/admin/tienda?pestana=bloqueos');
  fireEvent.click(await screen.findByRole('button', { name: t.unblock }));
  const d = await screen.findByRole('dialog', { name: t.unblockTitle('pilota') });
  fireEvent.change(within(d).getByLabelText(copy.admin.fields.reason), { target: { value: 'Revisado' } });
  const submit = within(d).getByRole('button', { name: t.unblock });
  expect(submit).toBeDisabled();
  fireEvent.change(within(d).getByLabelText(copy.admin.fields.password), { target: { value: 'secreto' } });
  fireEvent.click(submit);
  await waitFor(() => {
    const call = fetch.mock.calls.find(([url]) => url === '/galaxy/api/admin/shop/blocks/pilota/unblock');
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ reason: 'Revisado', password: 'secreto' });
  });
});

test('comprobar los precios enseña cuál no coincide con Stripe', async () => {
  open({ 'POST /galaxy/api/admin/shop/prices/verify': () => jsonResponse(200, checks) }, '/admin/tienda?pestana=precios');
  fireEvent.click(await screen.findByRole('button', { name: t.verify }));
  expect(await screen.findByRole('cell', { name: t.problems.amount })).toBeInTheDocument();
  expect(screen.getByRole('cell', { name: t.ok })).toBeInTheDocument();
  expect(screen.queryByText(t.allOk)).toBeNull();
});
