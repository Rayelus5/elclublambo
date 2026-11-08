import type { GachaView, GalaxySummary, MarketRules, MeResponse, MyTrades, Profile, PublicGalaxy, TradeView } from '@galaxy/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { copy } from '../src/copy/es';
import { MarketScreen } from '../src/market/MarketScreen';
import { ProfileScreen } from '../src/social/ProfileScreen';
import { jsonResponse, locationOf, mockApi, renderAt } from './render';

// Swaps on the web (GDD §14.5; M5c-2): proposing one from another player's profile (what I give, what I want of
// theirs), the Trueques tab of the market with each trade's two sides and whose turn it is, confirming the version
// seen, a change by the other side, and cancelling.
afterEach(() => vi.unstubAllGlobals());

const t = copy.trades;
const me: MeResponse = { id: 'a1', username: 'sonda_rayo', roles: [], mfa: false, level: 12 };
const gacha: GachaView = { banners: [], costs: { coins: 100, coinsTen: 900, signals: 1 }, freePullAvailable: false, wallet: { coins: 500, dust: 0, signal: 0 } };
const pub = (id: string, name: string): PublicGalaxy => ({ id, seed: '9', tier: 'rare', finish: 'normal', traits: {}, name, designation: `GX-${id.toUpperCase()}`, featured: false, level: 1 });
const mineG = (id: string, name: string, over: Partial<GalaxySummary> = {}): GalaxySummary => ({ ...pub(id, name), createdAt: '2026-11-01T10:00:00.000Z', ...over });
const rules: MyTrades['rules'] = {
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
  openTrades: 4,
  tradesLeft: 9,
  tradeDays: 3,
} as MarketRules & MyTrades['rules'];
const trade = (over: Partial<TradeView> = {}): TradeView => ({
  id: '00000000-0000-4000-8000-0000000000t1'.replace('t1', 'a1'),
  version: 1,
  status: 'open',
  createdAt: '2026-11-08T10:00:00.000Z',
  expiresAt: '2026-11-11T10:00:00.000Z',
  proposedByMe: false,
  me: { galaxy: pub('m1', 'Mía'), confirmed: false },
  them: { username: 'vega', galaxy: pub('v1', 'Suya'), confirmed: true },
  ...over,
});
const TID = '00000000-0000-4000-8000-0000000000a1';

function marketApi(routes: Record<string, (b: unknown) => Response> = {}, trades: TradeView[] = [trade()], r = rules) {
  return mockApi({
    'GET /galaxy/api/auth/me': () => jsonResponse(200, me),
    'GET /galaxy/api/gacha': () => jsonResponse(200, gacha),
    'GET /galaxy/api/market/mine': () => jsonResponse(200, { active: [], sold: [], rules: r }),
    'GET /galaxy/api/trades': () => jsonResponse(200, { open: trades.filter((x) => x.status === 'open'), closed: trades.filter((x) => x.status !== 'open'), rules: r } satisfies MyTrades),
    ...routes,
  });
}
const openTab = async () => {
  renderAt('/mercado', { '/mercado': <MarketScreen /> });
  const user = userEvent.setup();
  await user.click(await screen.findByRole('link', { name: t.tab }));
  return user;
};
const posted = (fetch: ReturnType<typeof mockApi>, path: string) =>
  fetch.mock.calls.filter(([url, init]) => url === `/galaxy/api/trades${path}` && init?.method === 'POST').map(([, init]) => JSON.parse(String(init?.body ?? '{}')));
const cardOf = async () => (await screen.findByRole('article', { name: t.with('vega') }));

test('la pestaña Trueques enseña lo que das y lo que recibes, y que te toca', async () => {
  marketApi();
  await openTab();
  const card = await cardOf();
  expect(within(card).getByRole('region', { name: t.youGive })).toHaveTextContent('Mía');
  expect(within(card).getByRole('region', { name: t.youGet })).toHaveTextContent('Suya');
  expect(within(card).getByText(t.theyConfirmed('vega'))).toBeInTheDocument();
  expect(within(card).getByRole('link', { name: 'vega' })).toHaveAttribute('href', '/perfil/vega');
});

test('confirmar nombra la versión vista; si el trato cambió, lo dice y vuelve a leer', async () => {
  const fetch = marketApi({ [`POST /galaxy/api/trades/${TID}/confirm`]: () => jsonResponse(409, { error: 'trade_changed' }) }, [trade({ id: TID, version: 3 })]);
  const user = await openTab();
  const card = await cardOf();
  await user.click(within(card).getByRole('button', { name: t.confirm }));
  await waitFor(() => expect(posted(fetch, `/${TID}/confirm`)).toEqual([{ version: 3 }]));
  expect(await within(card).findByRole('alert')).toHaveTextContent(copy.errors.trade_changed);
  await waitFor(() => expect(fetch.mock.calls.filter(([url]) => url === '/galaxy/api/trades').length).toBeGreaterThan(1));
});

test('confirmado por mí espera al otro; incompleto no se confirma', async () => {
  marketApi({}, [trade({ id: TID, me: { galaxy: pub('m1', 'Mía'), confirmed: true }, them: { username: 'vega', galaxy: pub('v1', 'Suya'), confirmed: false } })]);
  await openTab();
  const card = await cardOf();
  expect(within(card).getByText(t.waiting('vega'))).toBeInTheDocument();
  expect(within(card).getByRole('button', { name: t.confirm })).toBeDisabled();
});

test('cancelar pide confirmación', async () => {
  const fetch = marketApi({ [`POST /galaxy/api/trades/${TID}/cancel`]: () => jsonResponse(200, trade({ id: TID, status: 'cancelled' })) }, [trade({ id: TID })]);
  const user = await openTab();
  await user.click(within(await cardOf()).getByRole('button', { name: t.withdrawOf('vega') }));
  const dialog = await screen.findByRole('alertdialog', { name: t.withdrawTitle('vega') });
  await user.click(within(dialog).getByRole('button', { name: t.withdraw }));
  await waitFor(() => expect(posted(fetch, `/${TID}/cancel`)).toHaveLength(1));
});

test('cambiar el trato: otra galaxia pedida, con la versión vista', async () => {
  const fetch = marketApi(
    {
      'GET /galaxy/api/profiles/vega/galaxies?sort=rarity&limit=30': () => jsonResponse(200, { items: [pub('v1', 'Suya'), pub('v2', 'Otra suya')], counts: {} }),
      [`POST /galaxy/api/trades/${TID}/offer`]: () => jsonResponse(200, trade({ id: TID, version: 2 })),
    },
    [trade({ id: TID, version: 2 })],
  );
  const user = await openTab();
  await user.click(within(await cardOf()).getByRole('button', { name: t.change }));
  const dialog = await screen.findByRole('dialog', { name: t.changeTitle('vega') });
  await user.click(within(dialog).getByRole('button', { name: t.chooseTheirs }));
  const picker = await screen.findByRole('dialog', { name: t.pickTheirs('vega') });
  await user.click(within(picker).getByRole('button', { name: t.askOne('Otra suya') }));
  await user.click(within(dialog).getByRole('button', { name: t.save }));
  await waitFor(() => expect(posted(fetch, `/${TID}/offer`)).toEqual([{ give: 'm1', want: 'v2', version: 2 }]));
});

test('un trueque cerrado dice qué diste y qué recibiste', async () => {
  marketApi({}, [trade({ id: TID, status: 'done' })]);
  await openTab();
  expect(await screen.findByText(t.gave('Mía'))).toBeInTheDocument();
  expect(screen.getByText(t.got('Suya'))).toBeInTheDocument();
  expect(screen.getByText(t.statuses.done)).toBeInTheDocument();
});

test('sin trueques, explica de dónde salen; sin los requisitos, no se confirma', async () => {
  marketApi({}, []);
  await openTab();
  expect(await screen.findByText(t.none)).toBeInTheDocument();
});

test('desde el perfil de otro: doy una mía libre, pido una suya y lleva a los trueques', async () => {
  const profile: Profile = {
    username: 'vega',
    since: '2026-10-01T00:00:00.000Z',
    level: 14,
    season: null,
    records: { maxDepth: 3, purges: 1, runs: 9 },
    collection: { total: 2, counts: { common: 0, uncommon: 0, rare: 2, epic: 0, legendary: 0 } },
    planetarium: { prestige: 0, exhibits: 0, cover: null },
    clan: null,
  };
  const fetch = mockApi({
    'GET /galaxy/api/auth/me': () => jsonResponse(200, me),
    'GET /galaxy/api/profiles/vega': () => jsonResponse(200, profile),
    'GET /galaxy/api/trades': () => jsonResponse(200, { open: [], closed: [], rules }),
    'GET /galaxy/api/galaxies?sort=rarity&limit=30': () => jsonResponse(200, { items: [mineG('m9', 'Equipada', { equipped: true }), mineG('m1', 'Libre')], counts: {}, fusion: { count: 5, dust: [] } }),
    'GET /galaxy/api/profiles/vega/galaxies?sort=rarity&limit=30': () => jsonResponse(200, { items: [pub('v1', 'Suya')], counts: {} }),
    'POST /galaxy/api/trades': () => jsonResponse(200, trade({ proposedByMe: true })),
  });
  renderAt('/perfil/vega', { '/perfil/:username': <ProfileScreen /> });
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: t.propose }));
  const dialog = await screen.findByRole('dialog', { name: t.proposeTitle('vega') });
  expect(within(dialog).getByText(t.held(3))).toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: t.send })).toBeDisabled();
  await user.click(within(dialog).getByRole('button', { name: t.chooseMine }));
  const mine = await screen.findByRole('dialog', { name: t.pickMine });
  expect(within(mine).getByRole('button', { name: t.giveOne('Equipada') })).toBeDisabled();
  await user.click(within(mine).getByRole('button', { name: t.giveOne('Libre') }));
  await user.click(within(dialog).getByRole('button', { name: t.chooseTheirs }));
  await user.click(within(await screen.findByRole('dialog', { name: t.pickTheirs('vega') })).getByRole('button', { name: t.askOne('Suya') }));
  await user.click(within(dialog).getByRole('button', { name: t.send }));
  await waitFor(() => expect(posted(fetch, '')).toEqual([{ username: 'vega', give: 'm1', want: 'v1' }]));
  await waitFor(() => expect(locationOf(screen.getByTestId('location'))).toMatchObject({ pathname: '/mercado', search: '?pestana=trueques' }));
});

test('en mi propio perfil no hay «Proponer trueque»', async () => {
  mockApi({
    'GET /galaxy/api/auth/me': () => jsonResponse(200, me),
    'GET /galaxy/api/profiles/sonda_rayo': () =>
      jsonResponse(200, { username: 'sonda_rayo', since: '2026-10-01T00:00:00.000Z', level: 12, season: null, records: { maxDepth: 0, purges: 0, runs: 0 }, collection: { total: 0, counts: { common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 0 } }, planetarium: { prestige: 0, exhibits: 0, cover: null }, clan: null }),
  });
  renderAt('/perfil/sonda_rayo', { '/perfil/:username': <ProfileScreen /> });
  expect(await screen.findByRole('heading', { level: 1, name: 'sonda_rayo' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: t.propose })).not.toBeInTheDocument();
});
