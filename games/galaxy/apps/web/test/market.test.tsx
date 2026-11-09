import type { GachaView, GalaxyDetail, GalaxySummary, MarketListing, MarketPage, MarketRules, MeResponse, MyMarket } from '@galaxy/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { copy } from '../src/copy/es';
import { GalaxyDetailDialog } from '../src/collection/GalaxyDetailDialog';
import { MarketScreen } from '../src/market/MarketScreen';
import { jsonResponse, locationOf, mockApi, renderAt } from './render';

// The market on the web (GDD §14.6, §14.7; M5c-1): Comprar, Vender and Mis anuncios; who may trade and why not;
// buying after a confirmation that shows the price and the balance; selling at least at the rarity's floor, with what
// the commission leaves; withdrawing a listing; someone buying first.
afterEach(() => vi.unstubAllGlobals());

const t = copy.market;
const me: MeResponse = { id: 'a1', username: 'sonda_rayo', roles: [], mfa: false, level: 12 };
const gacha = (coins: number): GachaView => ({ banners: [], costs: { coins: 100, coinsTen: 900, signals: 1 }, freePullAvailable: false, wallet: { coins, dust: 0, signal: 0 } });
const galaxy = (id: string, over: Partial<GalaxySummary> = {}): GalaxySummary => ({
  id,
  seed: '12345',
  tier: 'rare',
  finish: 'normal',
  traits: {},
  name: `Vega ${id}`,
  designation: `GX-${id.toUpperCase()}`,
  featured: false,
  level: 1,
  createdAt: '2026-11-01T10:00:00.000Z',
  ...over,
});
const rules = (over: Partial<MarketRules> = {}): MarketRules => ({
  commission: 0.07,
  minPrice: { common: 50, uncommon: 120, rare: 400, epic: 1500, legendary: 6000 },
  maxPrice: 10_000_000,
  canTrade: true,
  reason: null,
  minLevel: 10,
  minAccountDays: 3,
  listingsLeft: 10,
  purchasesLeft: 10,
  days: 7,
  ...over,
});
const listing = (id: string, price: number, seller = 'lyra', over: Partial<MarketListing> = {}): MarketListing => ({
  id,
  galaxy: galaxy(`g${id}`),
  seller,
  price,
  listedAt: '2026-11-08T10:00:00.000Z',
  expiresAt: '2026-11-15T10:00:00.000Z',
  ...over,
});
const page = (listings: MarketListing[], r: Partial<MarketRules> = {}): MarketPage => ({ listings, page: 1, pages: 1, rules: rules(r) });
const mine = (over: Partial<MyMarket> = {}): MyMarket => ({ active: [], sold: [], rules: rules(), ...over });

function mount(routes: Record<string, (b: unknown) => Response> = {}, coins = 1000) {
  return mockApi({
    'GET /galaxy/api/auth/me': () => jsonResponse(200, me),
    'GET /galaxy/api/gacha': () => jsonResponse(200, gacha(coins)),
    'GET /galaxy/api/market?sort=new&page=1': () => jsonResponse(200, page([listing('1', 600), listing('2', 2000), listing('3', 500, 'sonda_rayo')])),
    'GET /galaxy/api/market/mine': () => jsonResponse(200, mine()),
    ...routes,
  });
}
const screenAt = () => renderAt('/mercado', { '/mercado': <MarketScreen />, '/coleccion/:id': <p>colección</p> });
/** The row or card of a galaxy (its name shows on the card too). */
const itemOf = async (name: string) => (await screen.findAllByText(name))[0]!.closest('li')!;
const posted = (fetch: ReturnType<typeof mockApi>, path: string) =>
  fetch.mock.calls.filter(([url, init]) => url === `/galaxy/api/market${path}` && init?.method === 'POST').map(([, init]) => JSON.parse(String(init?.body ?? '{}')));

test('tres pestañas, y las cartas dicen precio y vendedor', async () => {
  mount();
  screenAt();
  expect(await screen.findByRole('heading', { level: 1, name: t.title })).toBeInTheDocument();
  expect(screen.getAllByRole('link', { name: /^(Comprar|Vender|Mis anuncios)$/ }).map((a) => a.textContent)).toEqual([t.tabs.buy, t.tabs.sell, t.tabs.mine]);
  const card = await itemOf('Vega g1');
  expect(within(card).getByText(t.price(600))).toBeInTheDocument();
  expect(within(card).getByRole('link', { name: 'lyra' })).toHaveAttribute('href', '/perfil/lyra');
  // One's own listing: no «Comprar».
  const own = await itemOf('Vega g3');
  expect(within(own).queryByRole('button', { name: /Comprar/ })).not.toBeInTheDocument();
  expect(within(own).getByText(t.yours)).toBeInTheDocument();
});

test('sin el nivel o los días, todo se ve pero no se compra, y se dice por qué', async () => {
  mount({ 'GET /galaxy/api/market?sort=new&page=1': () => jsonResponse(200, page([listing('1', 600)], { canTrade: false, reason: 'level' })) });
  screenAt();
  expect(await screen.findByText(t.gate(10, 3))).toBeInTheDocument();
  expect(screen.getByText(t.gateLevel)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: t.buyOf('Vega g1') })).toBeDisabled();
});

test('sin monedas dice cuántas faltan', async () => {
  mount({}, 100);
  screenAt();
  const card = await itemOf('Vega g1');
  expect(within(card).getByRole('button', { name: t.buyOf('Vega g1') })).toBeDisabled();
  expect(within(card).getByText(t.missing(500))).toBeInTheDocument();
});

test('comprar pide confirmación con el precio y el saldo, y después lleva a la colección', async () => {
  const fetch = mount({ 'POST /galaxy/api/market/listings/1/buy': () => jsonResponse(200, { galaxy: galaxy('g1'), wallet: { coins: 400, dust: 0, signal: 0 } }) });
  screenAt();
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: t.buyOf('Vega g1') }));
  const dialog = await screen.findByRole('alertdialog', { name: t.buyTitle('Vega g1') });
  expect(within(dialog).getByText(t.balanceAfter(1000, 400))).toBeInTheDocument();
  await user.click(within(dialog).getByRole('button', { name: t.confirmBuy(600) }));
  await waitFor(() => expect(posted(fetch, '/listings/1/buy')).toHaveLength(1));
  expect(fetch.mock.calls.find(([url]) => url === '/galaxy/api/market/listings/1/buy')![1]!.headers).toHaveProperty('idempotency-key');
  expect(await within(dialog).findByText(t.bought)).toBeInTheDocument();
  // What it cost: from the balance it had when the dialog opened to what is left.
  expect(within(dialog).getByText(t.balanceAfter(1000, 400))).toBeInTheDocument();
  await user.click(within(dialog).getByRole('link', { name: t.seeIt }));
  expect(await screen.findByText('colección')).toBeInTheDocument();
});

test('si alguien se adelanta lo dice y relee el escaparate', async () => {
  const fetch = mount({ 'POST /galaxy/api/market/listings/1/buy': () => jsonResponse(409, { error: 'listing_gone' }) });
  screenAt();
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: t.buyOf('Vega g1') }));
  const dialog = await screen.findByRole('alertdialog');
  await user.click(within(dialog).getByRole('button', { name: t.confirmBuy(600) }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(copy.errors.listing_gone);
  await waitFor(() => expect(fetch.mock.calls.filter(([url]) => url === '/galaxy/api/market?sort=new&page=1').length).toBeGreaterThan(1));
});

test('el escaparate se filtra por rareza y se ordena', async () => {
  const fetch = mount({
    'GET /galaxy/api/market?tier=epic&sort=new&page=1': () => jsonResponse(200, page([listing('9', 1500)])),
    'GET /galaxy/api/market?tier=epic&sort=cheap&page=1': () => jsonResponse(200, page([listing('9', 1500)])),
  });
  screenAt();
  const user = userEvent.setup();
  await itemOf('Vega g1');
  await user.selectOptions(screen.getByLabelText(t.filterTier), 'epic');
  await user.selectOptions(screen.getByLabelText(t.sortLabel), 'cheap');
  await waitFor(() => expect(fetch.mock.calls.some(([url]) => url === '/galaxy/api/market?tier=epic&sort=cheap&page=1')).toBe(true));
  expect(await itemOf('Vega g9')).toBeInTheDocument();
});

test('vender: se elige una galaxia libre, el precio parte del mínimo y dice lo que recibirás', async () => {
  const free = galaxy('f1', { tier: 'rare', name: 'Libre' });
  const busy = galaxy('b1', { tier: 'epic', name: 'Equipada', equipped: true });
  const fetch = mount({
    'GET /galaxy/api/galaxies?sort=rarity&limit=30': () => jsonResponse(200, { items: [busy, free], counts: {}, fusion: { count: 5, dust: [] } }),
    'POST /galaxy/api/market/listings': (b) => jsonResponse(200, listing('7', (b as { price: number }).price, 'sonda_rayo', { galaxy: free })),
  });
  screenAt();
  const user = userEvent.setup();
  await user.click(await screen.findByRole('link', { name: t.tabs.sell }));
  await user.click(await screen.findByRole('button', { name: t.choose }));
  const picker = await screen.findByRole('dialog', { name: t.pickTitle });
  expect(within(picker).getByRole('button', { name: t.pickOne('Equipada') })).toBeDisabled();
  await user.click(within(picker).getByRole('button', { name: t.pickOne('Libre') }));
  const price = screen.getByRole('textbox', { name: t.priceLabel });
  expect(price).toHaveValue('400');
  expect(screen.getByText(t.minHint(400))).toBeInTheDocument();
  expect(screen.getByText(t.net(372))).toBeInTheDocument();
  await user.clear(price);
  await user.type(price, '300');
  await user.tab();
  expect(screen.getByText(t.tooLow(400))).toBeInTheDocument();
  expect(screen.getByRole('button', { name: t.list })).toBeDisabled();
  await user.clear(price);
  await user.type(price, '1000');
  expect(screen.getByText(t.net(930))).toBeInTheDocument();
  expect(screen.getByText(t.listingsLeft(10))).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: t.list }));
  await waitFor(() => expect(posted(fetch, '/listings')).toEqual([{ galaxyId: 'f1', price: 1000 }]));
  expect(await screen.findByRole('status')).toHaveTextContent(t.listed('Libre', 7));
});

test('mis anuncios: retirar pide confirmación, y las ventas dicen comprador y lo cobrado', async () => {
  const fetch = mount({
    'GET /galaxy/api/market/mine': () =>
      jsonResponse(200, mine({ active: [listing('5', 800, 'sonda_rayo')], sold: [{ ...listing('6', 1000, 'sonda_rayo'), buyer: 'vega', net: 930, soldAt: '2026-11-08T12:00:00.000Z' }] })),
    'POST /galaxy/api/market/listings/5/cancel': () => jsonResponse(200, { cancelled: true }),
  });
  screenAt();
  const user = userEvent.setup();
  await user.click(await screen.findByRole('link', { name: t.tabs.mine }));
  const sale = await itemOf('Vega g6');
  expect(within(sale).getByRole('link', { name: 'vega' })).toHaveAttribute('href', '/perfil/vega');
  expect(within(sale).getByText(t.netGot(930))).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: t.withdrawOf('Vega g5') }));
  const confirm = await screen.findByRole('alertdialog', { name: t.withdrawTitle('Vega g5') });
  await user.click(within(confirm).getByRole('button', { name: t.withdraw }));
  await waitFor(() => expect(posted(fetch, '/listings/5/cancel')).toHaveLength(1));
});

test('volver lleva al inicio', async () => {
  mount();
  screenAt();
  const user = userEvent.setup();
  await user.click(await screen.findByRole('link', { name: t.back }));
  expect(locationOf(await screen.findByTestId('location')).pathname).toBe('/');
});

test('en la colección: «Vender» lleva al mercado con la galaxia, y una en venta no se desintegra ni se mejora', async () => {
  const detail = (over: Partial<GalaxyDetail>): GalaxyDetail => ({ ...galaxy('d1', { name: 'Detalle' }), origin: 'pull', lineage: [], dna: 'a'.repeat(64), dust: 10, levelUp: { dust: 5 }, refund: 0, ...over });
  mockApi({
    'GET /galaxy/api/gacha': () => jsonResponse(200, gacha(1000)),
    'GET /galaxy/api/galaxies/d1': () => jsonResponse(200, detail({})),
    'GET /galaxy/api/galaxies/d2': () => jsonResponse(200, detail({ id: 'd2', listed: true })),
  });
  const free = renderAt('/coleccion', { '/coleccion': <GalaxyDetailDialog id="d1" onClose={() => {}} onDisintegrated={() => {}} /> });
  expect(await screen.findByRole('link', { name: t.sellIt })).toHaveAttribute('href', '/mercado?pestana=vender&galaxia=d1');
  free.unmount();
  renderAt('/coleccion', { '/coleccion': <GalaxyDetailDialog id="d2" onClose={() => {}} onDisintegrated={() => {}} /> });
  expect(await screen.findByText(t.listedReason)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: copy.collection.disintegrate })).toBeDisabled();
  expect(screen.getByRole('button', { name: new RegExp(copy.hangar.levelUp(2)) })).toBeDisabled();
  expect(screen.queryByRole('link', { name: t.sellIt })).not.toBeInTheDocument();
});

test('el aviso de requisitos dice los días en singular o plural, y sin días no los menciona', () => {
  expect(t.gate(5, 1)).toBe('Necesitas nivel 5 y 1 día de cuenta para comerciar');
  expect(t.gate(10, 3)).toBe('Necesitas nivel 10 y 3 días de cuenta para comerciar');
  expect(t.gate(5, 0)).toBe('Necesitas nivel 5 para comerciar');
});
