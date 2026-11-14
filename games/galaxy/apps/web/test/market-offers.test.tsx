import type { GachaView, GalaxySummary, MarketListing, MarketOffer, MarketOffersView, MarketPage, MarketRules, MeResponse, MyMarket } from '@galaxy/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { copy } from '../src/copy/es';
import { MarketScreen } from '../src/market/MarketScreen';
import { jsonResponse, mockApi, renderAt } from './render';

// Offers on market listings (the owner, 2026-11-14: «ofertas en los anuncios … se reserva» the gold): made from a
// listing's preview between its floor and its price, its coins held; the tab with the ones on my listings (accept after
// a confirmation, or reject) and mine (withdraw); the coins held beside the wallet; one's own offer on its card.
afterEach(() => vi.unstubAllGlobals());

const t = copy.market;
const o = t.offers;
const me: MeResponse = { id: 'a1', username: 'sonda_rayo', roles: [], mfa: false, level: 12 };
const gacha: GachaView = { banners: [], costs: { coins: 100, coinsTen: 900, signals: 1 }, freePullAvailable: false, wallet: { coins: 5000, dust: 0, signal: 0 } };
const galaxy = (id: string): GalaxySummary => ({ id, seed: '12345', tier: 'rare', finish: 'normal', traits: {}, name: `Vega ${id}`, designation: `GX-${id.toUpperCase()}`, featured: false, level: 1, createdAt: '2026-11-01T10:00:00.000Z' });
const rules: MarketRules = {
  commission: 0.07,
  minPrice: { common: 50, uncommon: 120, rare: 400, epic: 1500, legendary: 6000, mythic: 15000 },
  mythicListing: false,
  maxPrice: 10_000_000,
  canTrade: true,
  reason: null,
  minLevel: 10,
  minAccountDays: 3,
  listingsLeft: 10,
  purchasesLeft: 10,
  days: 7,
  offers: { enabled: true, hours: 48, openLeft: 9, todayLeft: 29 },
};
const listing = (id: string, price: number, over: Partial<MarketListing> = {}): MarketListing => ({ id, galaxy: galaxy(`g${id}`), seller: 'lyra', price, listedAt: '2026-11-14T10:00:00.000Z', expiresAt: '2026-11-21T10:00:00.000Z', offers: 2, myOffer: null, ...over });
const offer = (id: string, over: Partial<MarketOffer> = {}): MarketOffer => ({
  id,
  listing: { id: `l${id}`, galaxy: galaxy(`o${id}`), price: 2000, seller: 'sonda_rayo', active: true },
  buyer: 'deneb',
  amount: 1600,
  status: 'open',
  createdAt: '2026-11-14T10:00:00.000Z',
  expiresAt: '2026-11-16T10:00:00.000Z',
  closedAt: null,
  ...over,
});
const offers: MarketOffersView = {
  received: [offer('1')],
  sent: [offer('2', { buyer: 'sonda_rayo', amount: 700, listing: { id: 'l2', galaxy: galaxy('o2'), price: 900, seller: 'orion_7', active: true } })],
  held: 700,
};
const mine: MyMarket = { active: [], sold: [], rules };
const posts = (fetch: ReturnType<typeof mockApi>, path: string) =>
  fetch.mock.calls.filter(([url, init]) => url === `/galaxy/api${path}` && init?.method === 'POST').map(([, init]) => ({ body: JSON.parse(String(init?.body ?? '{}')), key: (init?.headers as Record<string, string> | undefined)?.['idempotency-key'] }));

function mount(routes: Record<string, (b: unknown) => Response> = {}) {
  return mockApi({
    'GET /galaxy/api/auth/me': () => jsonResponse(200, me),
    'GET /galaxy/api/gacha': () => jsonResponse(200, gacha),
    'GET /galaxy/api/market/mine': () => jsonResponse(200, mine),
    'GET /galaxy/api/market/offers': () => jsonResponse(200, offers),
    'GET /galaxy/api/content': () => jsonResponse(404, { error: 'not_found' }),
    'GET /galaxy/api/market?sort=new': () => jsonResponse(200, { listings: [listing('1', 1000), listing('2', 900, { myOffer: 700 })], next: null, rules } satisfies MarketPage),
    ...routes,
  });
}
const screenAt = (path = '/mercado') => renderAt(path, { '/mercado': <MarketScreen />, '/coleccion/:id': <p>colección</p> });

test('una oferta desde la vista previa: entre el mínimo y el precio, y dice que se reservan las monedas', async () => {
  const fetch = mount({ 'POST /galaxy/api/market/listings/1/offers': () => jsonResponse(200, { id: 'n1', amount: 800, expiresAt: '2026-11-16T10:00:00.000Z' }) });
  screenAt();
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: t.seeOf('Vega g1') }));
  const sheet = await screen.findByRole('dialog', { name: 'Vega g1' });
  expect(sheet).toHaveTextContent(t.offerCount(2));
  await user.click(within(sheet).getByRole('button', { name: t.offer }));
  const dialog = await screen.findByRole('alertdialog', { name: t.offerTitle('Vega g1') });
  expect(dialog).toHaveTextContent(t.offerRange(400, 999));
  expect(dialog).toHaveTextContent(t.offerHold(48));
  const field = within(dialog).getByLabelText(t.offerAmount);
  await user.clear(field);
  await user.type(field, '1000');
  expect(within(dialog).getByRole('button', { name: t.offer })).toBeDisabled();
  await user.clear(field);
  await user.type(field, '800');
  await user.click(within(dialog).getByRole('button', { name: t.offerSend(800) }));
  expect(await within(dialog).findByText(t.offerSent)).toBeInTheDocument();
  const [sent] = posts(fetch, '/market/listings/1/offers');
  expect(sent?.body).toEqual({ amount: 800 });
  expect(sent?.key).toEqual(expect.any(String));
});

test('mi oferta sale en su carta, y en la vista previa se sube por encima de ella', async () => {
  mount();
  screenAt();
  const user = userEvent.setup();
  const card = (await screen.findAllByText('Vega g2'))[0]!.closest('li')!;
  expect(card).toHaveTextContent(t.offerMine(700));
  await user.click(within(card).getByRole('button', { name: t.seeOf('Vega g2') }));
  const sheet = await screen.findByRole('dialog', { name: 'Vega g2' });
  await user.click(within(sheet).getByRole('button', { name: t.raise }));
  expect(await screen.findByRole('alertdialog', { name: t.offerTitle('Vega g2') })).toHaveTextContent(t.offerRange(701, 899));
});

test('Ofertas: aceptar pide confirmación con lo que recibes; rechazar y retirar; arriba, lo reservado', async () => {
  const fetch = mount({
    'POST /galaxy/api/market/offers/1/accept': () => jsonResponse(200, { sold: true, net: 1488 }),
    'POST /galaxy/api/market/offers/1/reject': () => jsonResponse(200, { rejected: true }),
    'POST /galaxy/api/market/offers/2/withdraw': () => jsonResponse(200, { withdrawn: true }),
  });
  screenAt('/mercado?pestana=ofertas');
  const user = userEvent.setup();
  expect(await screen.findByRole('link', { name: t.heldLabel(700) })).toHaveAttribute('href', '/mercado?pestana=ofertas');
  const received = await screen.findByRole('region', { name: o.received });
  const row = within(received).getAllByText('Vega o1')[0]!.closest('li')!;
  expect(row).toHaveTextContent(o.by('deneb'));
  await user.click(within(row).getByRole('button', { name: o.accept }));
  const confirm = await screen.findByRole('alertdialog', { name: o.acceptOf('Vega o1', 1600) });
  expect(confirm).toHaveTextContent(o.acceptBody(1600 - 112));
  await user.click(within(confirm).getByRole('button', { name: o.accept }));
  await waitFor(() => expect(posts(fetch, '/market/offers/1/accept')).toHaveLength(1));
  expect(posts(fetch, '/market/offers/1/accept')[0]?.key).toEqual(expect.any(String));
  await user.click(within(row).getByRole('button', { name: o.rejectOf('deneb') }));
  await waitFor(() => expect(posts(fetch, '/market/offers/1/reject')).toHaveLength(1));
  const sent = screen.getByRole('region', { name: new RegExp(o.sent) });
  await user.click(within(sent).getByRole('button', { name: o.withdrawOf('Vega o2') }));
  await waitFor(() => expect(posts(fetch, '/market/offers/2/withdraw')).toHaveLength(1));
});
