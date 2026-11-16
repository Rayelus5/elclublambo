import { DEFAULT_SHOP_PRODUCTS, parseConfig, productTab, purchaseGrants, type ShopProductView, type ShopPurchaseView, type ShopView } from '@galaxy/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { copy } from '../src/copy/es';
import { eur } from '../src/shop/art-hooks';
import { ShopScreen } from '../src/shop/ShopScreen';
import { jsonResponse, LocationProbe, mockApi, renderAt } from './render';

// The resource shop on the web (shop and lab plan, F5): closed or open, the products of each tab with what they give
// and their price (from the server), the featured offer, the welcome pack and the first purchase's extra, a blocked
// product saying why, and buying: the consent box first, then Stripe's form (faked here), then waiting for the server
// to see it paid, and the celebration. Coming back from Stripe's redirect waits for that purchase.

const confirm = vi.hoisted(() => vi.fn(async () => ({ type: 'success' as const, session: {} })));
vi.mock('../src/shop/stripe', () => ({ loadShopStripe: vi.fn(() => Promise.resolve({})), STRIPE_APPEARANCE: {} }));
vi.mock('@stripe/react-stripe-js/checkout', () => ({
  CheckoutElementsProvider: ({ children }: { children: unknown }) => children,
  useCheckoutElements: () => ({ type: 'success', checkout: { confirm } }),
  PaymentElement: () => <div data-testid="payment-element" />,
  ContactDetailsElement: () => <div data-testid="contact-element" />,
  ExpressCheckoutElement: () => <div data-testid="express-element" />,
}));
afterEach(() => {
  confirm.mockClear();
  vi.unstubAllGlobals();
});

const t = copy.shop;
const cfg = parseConfig('shop', {});
const now = new Date();
const wallet = { coins: 100, dust: 50, signal: 2, components: 10 };

function productView(id: string, over: Partial<ShopProductView> = {}): ShopProductView {
  const p = cfg.products.find((x) => x.id === id)!;
  const { base, extra, total } = purchaseGrants(p, now, p.firstBonus, cfg);
  return {
    id: p.id,
    kind: p.kind,
    tab: productTab(p),
    name: p.name,
    art: p.art,
    base,
    bonus: { ...p.bonus },
    extra,
    total,
    priceCents: p.priceCents,
    beforeCents: null,
    offer: null,
    badge: p.badge,
    featured: p.featured,
    first: p.firstBonus,
    maxPerAccount: p.kind === 'welcome' ? 1 : p.maxPerAccount,
    bought: 0,
    block: null,
    ...over,
  };
}

function view(over: Partial<ShopView> = {}, products = DEFAULT_SHOP_PRODUCTS.map((p) => productView(p.id))): ShopView {
  return {
    open: true,
    closed: null,
    publishableKey: 'pk_live_test',
    products,
    limits: { dailyCents: 10_000, spentTodayCents: 0, pendingMax: 3 },
    firstPurchase: { enabled: true, percent: 100 },
    legal: { seller: 'Vendedor de prueba', contact: 'contacto@ejemplo.es', termsVersion: 'v1' },
    wallet,
    ...over,
  };
}

function open(v: ShopView, routes: Record<string, (b: unknown) => Response> = {}, path = '/tienda') {
  const fetch = mockApi({
    'GET /galaxy/api/shop': () => jsonResponse(200, v),
    'GET /galaxy/api/gacha': () => jsonResponse(200, { banners: [], wallet }),
    ...routes,
  });
  renderAt(path, { '/tienda': <><ShopScreen /><LocationProbe /></> });
  return fetch;
}
/** Text as getByText compares it (the DOM's no-break spaces become plain ones). */
const plain = (text: string) => text.replace(/\s/g, ' ');
const card = (name: string) => screen.getByRole('heading', { name, level: 3 }).closest('article')!;

test('cerrada, lo dice y no enseña productos; bloqueada, dice por qué', async () => {
  open(view({ open: false, closed: 'closed', publishableKey: null, products: [] }));
  expect(await screen.findByText(t.closed)).toBeInTheDocument();
  expect(screen.queryByRole('tablist')).toBeNull();
});

test('una cuenta bloqueada ve el motivo', async () => {
  open(view({ open: false, closed: 'blocked', publishableKey: null, products: [] }));
  expect(await screen.findByText(t.blocked)).toBeInTheDocument();
});

test('seis packs por pestaña con lo que dan, su regalo, su extra de primera compra y su precio; la pestaña va en la dirección', async () => {
  open(view());
  await screen.findByRole('tablist', { name: t.tabsLabel });
  const grid = screen.getByRole('tabpanel');
  expect(within(grid).getAllByRole('article')).toHaveLength(6);
  const saco = card('Saco de monedas');
  expect(within(saco).getByText(t.amounts.coins(5000))).toBeInTheDocument();
  expect(within(saco).getByText(t.gift(2000, 500))).toBeInTheDocument();
  expect(within(saco).getByText(t.extra(2500))).toBeInTheDocument();
  expect(within(saco).getByText(t.badges.popular)).toBeInTheDocument();
  expect(within(saco).getByText(t.first.tag(100))).toBeInTheDocument();
  expect(within(saco).getByRole('button', { name: t.buyOf('Saco de monedas', eur(1299)) })).toBeEnabled();
  fireEvent.click(screen.getByRole('tab', { name: t.tabs.dust }));
  expect(screen.getByRole('tab', { name: t.tabs.dust })).toHaveAttribute('aria-selected', 'true');
  expect(within(screen.getByRole('tabpanel')).getAllByRole('article')).toHaveLength(6);
  expect(screen.getByTestId('location').textContent).toContain('pestana=polvo');
});

test('lo destacado con su cuenta atrás, el pack de bienvenida y la primera compra; nada de precio de antes sin el servidor', async () => {
  const endsAt = new Date(Date.now() + 2 * 86_400_000 + 3 * 3_600_000).toISOString();
  const products = DEFAULT_SHOP_PRODUCTS.map((p) => productView(p.id, p.id === 'kit-explorador' ? { offer: { kind: 'bonus', percent: 50, endsAt } } : {}));
  open(view({}, products));
  expect(await screen.findByRole('heading', { name: 'Kit del explorador', level: 2 })).toBeInTheDocument();
  expect(screen.getByText(t.offerBonus(50))).toBeInTheDocument();
  expect(screen.getByText(/^Acaba en 2 d 2 h|^Acaba en 2 d 3 h/)).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: t.welcome.title })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: t.first.title(100) })).toBeInTheDocument();
  expect(screen.queryByText(/^Antes /)).toBeNull();
});

test('un precio rebajado tacha el de antes que manda el servidor', async () => {
  const endsAt = new Date(Date.now() + 86_400_000).toISOString();
  open(view({}, [productView('coins-4', { priceCents: 1999, beforeCents: 2499, offer: { kind: 'price', endsAt } })]));
  expect(await screen.findByText(plain(t.before(eur(2499))))).toBeInTheDocument();
  expect(screen.getByText(t.offerPrice)).toBeInTheDocument();
});

test('lo que no se puede comprar dice por qué y su botón no se pulsa', async () => {
  open(view({}, [productView('coins-6', { block: 'daily_limit' }), productView('welcome', { block: 'once_used' })]));
  const b = await screen.findByRole('button', { name: t.overLimit });
  expect(b).toBeDisabled();
  // A welcome pack already bought is not offered again.
  expect(screen.queryByRole('heading', { name: t.welcome.title })).toBeNull();
});

test('comprar: la casilla primero, luego el pago de Stripe, y al confirmarse la celebración', async () => {
  const purchase = '00000000-0000-4000-8000-0000000000aa';
  let paid = false;
  const delivered: ShopPurchaseView = {
    id: purchase,
    product: 'dust-3',
    name: 'Tarro de polvo',
    status: 'paid',
    amountCents: 1299,
    grants: { coins: 0, dust: 2500, components: 0 },
    createdAt: now.toISOString(),
    paidAt: now.toISOString(),
    wallet: { ...wallet, dust: 2550 },
  };
  const fetch = open(view(), {
    'POST /galaxy/api/shop/checkout': () => jsonResponse(200, { purchase, clientSecret: 'cs_secret' }),
    [`GET /galaxy/api/shop/purchases/${purchase}`]: () => jsonResponse(200, paid ? delivered : { ...delivered, status: 'pending', paidAt: null }),
  });
  await screen.findByRole('tablist');
  fireEvent.click(screen.getByRole('tab', { name: t.tabs.dust }));
  fireEvent.click(within(card('Tarro de polvo')).getByRole('button', { name: t.buyOf('Tarro de polvo', eur(1299)) }));
  const dialog = await screen.findByRole('dialog', { name: 'Tarro de polvo' });
  const go = within(dialog).getByRole('button', { name: t.checkout.continue });
  expect(go).toBeDisabled();
  fireEvent.click(within(dialog).getByRole('checkbox', { name: t.checkout.consent }));
  fireEvent.click(go);
  await within(dialog).findByTestId('payment-element');
  const sent = fetch.mock.calls.find(([url]) => url === '/galaxy/api/shop/checkout')!;
  expect(JSON.parse(String(sent[1]?.body))).toEqual({ product: 'dust-3', consent: true, terms: 'v1' });
  expect((sent[1]?.headers as Record<string, string>)['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
  expect(within(dialog).getByTestId('express-element')).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole('button', { name: t.checkout.pay(eur(1299)) }));
  await waitFor(() => expect(confirm).toHaveBeenCalledWith({ redirect: 'if_required' }));
  expect(await screen.findByText(t.checkout.waiting)).toBeInTheDocument();
  paid = true;
  expect(await screen.findByText(t.celebrate.sub('Tarro de polvo'), {}, { timeout: 4000 })).toBeInTheDocument();
  expect(screen.queryByRole('dialog', { name: 'Tarro de polvo' })).toBeNull();
});

test('si Stripe rechaza el pago, lo dice y se puede volver a intentar', async () => {
  confirm.mockResolvedValueOnce({ type: 'error', error: { message: 'Tu tarjeta ha sido rechazada' } } as never);
  open(view(), { 'POST /galaxy/api/shop/checkout': () => jsonResponse(200, { purchase: '00000000-0000-4000-8000-0000000000ab', clientSecret: 'cs' }) });
  await screen.findByRole('tablist');
  fireEvent.click(within(card('Puñado de monedas')).getByRole('button', { name: t.buyOf('Puñado de monedas', eur(399)) }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('checkbox'));
  fireEvent.click(within(dialog).getByRole('button', { name: t.checkout.continue }));
  fireEvent.click(await within(dialog).findByRole('button', { name: t.checkout.pay(eur(399)) }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('Tu tarjeta ha sido rechazada');
  expect(within(dialog).getByRole('button', { name: t.checkout.pay(eur(399)) })).toBeEnabled();
});

test('un error al abrir el pago se dice junto al botón', async () => {
  open(view(), { 'POST /galaxy/api/shop/checkout': () => jsonResponse(409, { error: 'shop_daily_limit' }) });
  await screen.findByRole('tablist');
  fireEvent.click(within(card('Puñado de monedas')).getByRole('button', { name: t.buyOf('Puñado de monedas', eur(399)) }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('checkbox'));
  fireEvent.click(within(dialog).getByRole('button', { name: t.checkout.continue }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(copy.errors.shop_daily_limit);
});

test('de vuelta del banco, espera esa compra y la celebra', async () => {
  const purchase = '00000000-0000-4000-8000-0000000000ac';
  open(
    view(),
    {
      [`GET /galaxy/api/shop/purchases/${purchase}`]: () =>
        jsonResponse(200, { id: purchase, product: 'coins-1', name: 'Puñado de monedas', status: 'paid', amountCents: 399, grants: { coins: 1000, dust: 0, components: 0 }, createdAt: now.toISOString(), paidAt: now.toISOString(), wallet }),
    },
    `/tienda?compra=${purchase}`,
  );
  expect(await screen.findByText(t.celebrate.sub('Puñado de monedas'))).toBeInTheDocument();
  await waitFor(() => expect(screen.getByTestId('location').textContent).not.toContain('compra='));
});

test('las condiciones de compra con el vendedor y el límite del servidor', async () => {
  open(view());
  await screen.findByRole('tablist');
  fireEvent.click(screen.getByRole('button', { name: t.terms }));
  const d = await screen.findByRole('dialog', { name: t.legal.title });
  expect(within(d).getByText(t.legal.seller('Vendedor de prueba', 'contacto@ejemplo.es'))).toBeInTheDocument();
  expect(within(d).getByText(plain(t.limit(eur(10_000))))).toBeInTheDocument();
});

// Complete skin packs (2026-11-17): the card shows its eight probes, how many the player has, and until when it sells.
const LEYENDA = ['lumen', 'bastion', 'spark', 'sentinel', 'anchor', 'prism', 'comet', 'echo'];
function setView(owned: number, over: Partial<ShopProductView> = {}): ShopProductView {
  return productView('style-skin-lumen', {
    id: 'skins-leyenda',
    kind: 'set',
    tab: 'style',
    name: 'Pack Leyenda',
    cosmetic: null,
    pieces: LEYENDA.map((p, i) => ({ kind: 'skin' as const, id: `skin-${p}-leyenda`, owned: i < owned })),
    owned: owned === LEYENDA.length,
    priceCents: 1699,
    badge: 'limited',
    first: false,
    maxPerAccount: 1,
    availableUntil: '2027-01-06T23:00:00.000Z',
    ...over,
  });
}

test('un pack de skins enseña sus ocho sondas, cuántas tienes ya y hasta cuándo se vende', async () => {
  open(view({}, [setView(3)]), {}, '/tienda?pestana=estilo');
  const c = (await screen.findByRole('heading', { name: 'Pack Leyenda', level: 3 })).closest('article')!;
  expect(within(c).getAllByRole('img')).toHaveLength(8);
  expect(within(c).getAllByRole('img', { name: /ya la tienes/ })).toHaveLength(3);
  expect(within(c).getByText(t.set.amount(8, true))).toBeInTheDocument();
  expect(within(c).getByText(t.set.owned(3, 8))).toBeInTheDocument();
  expect(within(c).getByText(t.set.until('6 de enero'))).toBeInTheDocument();
  expect(within(c).getByText(t.badges.limited)).toBeInTheDocument();
  fireEvent.click(within(c).getByRole('button', { name: t.buyOf('Pack Leyenda', eur(1699)) }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getAllByRole('img')).toHaveLength(8);
  expect(within(dialog).getByText(t.set.amount(8, true))).toBeInTheDocument();
  expect(within(dialog).getByText(t.set.owned(3, 8))).toBeInTheDocument();
});

test('un pack que ya tienes entero no se compra', async () => {
  open(view({}, [setView(8, { block: 'once_used' })]), {}, '/tienda?pestana=estilo');
  const c = (await screen.findByRole('heading', { name: 'Pack Leyenda', level: 3 })).closest('article')!;
  expect(within(c).getByRole('button', { name: t.owned })).toBeDisabled();
  expect(within(c).queryByText(t.set.owned(8, 8))).toBeNull();
});

test('celebrar un pack dice cuántas skins nuevas llegaron al Taller', async () => {
  const purchase = '00000000-0000-4000-8000-0000000000ad';
  open(
    view({}, [setView(3)]),
    {
      [`GET /galaxy/api/shop/purchases/${purchase}`]: () =>
        jsonResponse(200, { id: purchase, product: 'skins-leyenda', name: 'Pack Leyenda', status: 'paid', amountCents: 1699, grants: { coins: 0, dust: 0, components: 0 }, pieces: [{ kind: 'skin', id: 'skin-comet-leyenda' }, { kind: 'skin', id: 'skin-echo-leyenda' }], createdAt: now.toISOString(), paidAt: now.toISOString(), wallet }),
    },
    `/tienda?compra=${purchase}`,
  );
  expect(await screen.findByText(t.celebrate.pieces(2))).toBeInTheDocument();
});
