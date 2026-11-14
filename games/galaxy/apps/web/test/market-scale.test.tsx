import type { GachaView, GalaxySummary, MarketListing, MarketPage, MarketRules, MarketStats, MeResponse, MyMarket } from '@galaxy/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { copy, fmt } from '../src/copy/es';
import { MarketScreen } from '../src/market/MarketScreen';
import { pickOption } from './pick';
import { jsonResponse, mockApi, renderAt } from './render';

// The market at scale on the web (the owner, 2026-11-14: «profesional para 100.000 anuncios … mostrar los recursos del
// usuario en lugar de "El mercado se queda el 7 %" … previsualizar las galaxias con su carta 3D y sus poderes …
// estadísticas públicas»): «Cargar más» from the cursor, the filters, the preview with «Comprar», the wallet in the
// header, and the numbers.
afterEach(() => vi.unstubAllGlobals());

const t = copy.market;
const me: MeResponse = { id: 'a1', username: 'sonda_rayo', roles: [], mfa: false, level: 12 };
const gacha: GachaView = { banners: [], costs: { coins: 100, coinsTen: 900, signals: 1 }, freePullAvailable: false, wallet: { coins: 4321, dust: 87, signal: 2 } };
const galaxy = (id: string, over: Partial<GalaxySummary> = {}): GalaxySummary => ({ id, seed: '12345', tier: 'rare', finish: 'normal', traits: {}, name: `Vega ${id}`, designation: `GX-${id.toUpperCase()}`, featured: false, level: 1, createdAt: '2026-11-01T10:00:00.000Z', ...over });
const rules: MarketRules = { commission: 0.07, minPrice: { common: 50, uncommon: 120, rare: 400, epic: 1500, legendary: 6000, mythic: 15000 }, mythicListing: false, maxPrice: 10_000_000, canTrade: true, reason: null, minLevel: 10, minAccountDays: 3, listingsLeft: 10, purchasesLeft: 10, days: 7, offers: { enabled: true, hours: 48, openLeft: 10, todayLeft: 30 } };
const listing = (id: string, price: number, seller = 'lyra'): MarketListing => ({ id, galaxy: galaxy(`g${id}`), seller, price, listedAt: '2026-11-14T10:00:00.000Z', expiresAt: '2026-11-21T10:00:00.000Z' });
const page = (listings: MarketListing[], next: string | null = null): MarketPage => ({ listings, next, rules });
const mine: MyMarket = { active: [], sold: [], rules };

function mount(routes: Record<string, (b: unknown) => Response> = {}) {
  return mockApi({
    'GET /galaxy/api/auth/me': () => jsonResponse(200, me),
    'GET /galaxy/api/gacha': () => jsonResponse(200, gacha),
    'GET /galaxy/api/market/mine': () => jsonResponse(200, mine),
    'GET /galaxy/api/trades': () => jsonResponse(200, { trades: [], rules }),
    'GET /galaxy/api/market?sort=new': () => jsonResponse(200, page([listing('1', 600), listing('2', 900)], 'c1')),
    'GET /galaxy/api/market?sort=new&cursor=c1': () => jsonResponse(200, page([listing('3', 1200)])),
    ...routes,
  });
}
const screenAt = (path = '/mercado') => renderAt(path, { '/mercado': <MarketScreen /> });
const gets = (fetch: ReturnType<typeof mockApi>) => fetch.mock.calls.filter(([, init]) => (init?.method ?? 'GET') === 'GET').map(([u]) => String(u));

test('«Cargar más» sigue desde el cursor y añade sin mover lo que había', async () => {
  mount();
  screenAt();
  expect(await screen.findByText(t.shown(2, true))).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: t.more }));
  expect((await screen.findAllByText('Vega g3'))[0]).toBeInTheDocument();
  expect(screen.getByText(t.shown(3, false))).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: t.more })).toBeNull();
});

test('los filtros van al servidor: acabado, nivel y precio, y se quitan de una vez', async () => {
  const fetch = mount({
    'GET /galaxy/api/market?finish=holo&sort=new': () => jsonResponse(200, page([])),
    'GET /galaxy/api/market?finish=holo&minLevel=2&sort=new': () => jsonResponse(200, page([])),
    'GET /galaxy/api/market?finish=holo&minLevel=2&maxPrice=5000&sort=new': () => jsonResponse(200, page([listing('7', 4000)])),
  });
  screenAt();
  const user = userEvent.setup();
  await screen.findByText(t.shown(2, true));
  await user.click(screen.getByRole('button', { name: t.filtersCount(0) }));
  await pickOption(user, screen.getByRole('combobox', { name: copy.finishLabel }), copy.finishes.holo);
  await user.type(screen.getByRole('spinbutton', { name: t.rangeLabel(t.level, t.from) }), '2');
  await user.type(screen.getByRole('spinbutton', { name: t.rangeLabel(t.priceRange, t.to) }), '5000');
  await waitFor(() => expect(gets(fetch)).toContain('/galaxy/api/market?finish=holo&minLevel=2&maxPrice=5000&sort=new'));
  expect((await screen.findAllByText('Vega g7'))[0]).toBeInTheDocument();
  expect(screen.getByRole('button', { name: t.filtersCount(3) })).toHaveAttribute('aria-expanded', 'true');
  await user.click(screen.getByRole('button', { name: t.clearFilters }));
  expect(await screen.findByRole('button', { name: t.filtersCount(0) })).toBeInTheDocument();
});

test('ver un anuncio de cerca: su carta, sus poderes, precio, vendedor y «Comprar», que lleva a confirmar', async () => {
  mount({ 'GET /galaxy/api/content': () => jsonResponse(404, { error: 'not_found' }) });
  screenAt();
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: t.seeOf('Vega g1') }));
  const sheet = await screen.findByRole('dialog', { name: 'Vega g1' });
  expect(sheet).toHaveTextContent(t.price(600));
  expect(within(sheet).getByRole('link', { name: 'lyra' })).toHaveAttribute('href', '/perfil/lyra');
  expect(within(sheet).getByRole('heading', { name: copy.hangar.sheet.powers })).toBeInTheDocument();
  await user.click(within(sheet).getByRole('button', { name: t.buy }));
  expect(await screen.findByRole('alertdialog', { name: t.buyTitle('Vega g1') })).toBeInTheDocument();
});

test('arriba, lo que tienes en vez de la comisión; la comisión se dice al vender', async () => {
  mount();
  screenAt();
  const wallet = await screen.findByRole('group', { name: t.wallet });
  expect(await within(wallet).findByRole('img', { name: copy.hub.resource.coins(4321) })).toBeInTheDocument();
  expect(within(wallet).getByRole('img', { name: copy.hub.resource.dust(87) })).toBeInTheDocument();
  expect(screen.queryByText(t.commission(7))).toBeNull();
});

test('las estadísticas públicas: 24 horas, 7 días, por rareza y la venta más cara', async () => {
  const stats: MarketStats = {
    updatedAt: '2026-11-14T10:05:00.000Z',
    day: { sales: 12, gold: 34_000, commission: 2380 },
    week: { sales: 80, gold: 250_000, commission: 17_500, trades: 9 },
    active: 1534,
    byTier: { epic: { sales: 20, avg: 2100 } },
    top: { name: 'Kathra', tier: 'legendary', price: 48_000, at: '2026-11-13T18:00:00.000Z' },
  };
  mount({ 'GET /galaxy/api/market/stats': () => jsonResponse(200, stats) });
  screenAt('/mercado?pestana=estadisticas');
  const section = await screen.findByRole('region', { name: t.stats.title });
  expect(within(section).getAllByRole('group', { name: t.stats.sales })[0]).toHaveTextContent('12');
  expect(within(section).getByRole('group', { name: t.stats.active })).toHaveTextContent(fmt(1534));
  expect(within(section).getByRole('group', { name: t.stats.trades })).toHaveTextContent('9');
  const epic = within(section).getByRole('row', { name: new RegExp(copy.tiers.epic) });
  expect(epic).toHaveTextContent(t.price(2100));
  expect(section).toHaveTextContent(`${t.stats.topLine('Kathra')} ${t.price(48_000)}`);
});
