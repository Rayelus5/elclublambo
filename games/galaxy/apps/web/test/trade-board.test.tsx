import type { GachaView, GalaxySummary, MarketRules, MeResponse, MyTradePosts, MyTrades, PublicGalaxy, TradeBoardPage, TradeBoardRules, TradePostView } from '@galaxy/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { copy } from '../src/copy/es';
import { MarketScreen } from '../src/market/MarketScreen';
import { jsonResponse, mockApi, renderAt } from './render';

// The public trade board on the web (the owner, 2026-11-14: «un tablón público» of trades): the Trueques tab's two
// views, the posts with what they give and are after, the rarity filter, posting (what I give, what I am after, a
// note), answering one (what it gives fixed) and withdrawing mine after a confirmation.
afterEach(() => vi.unstubAllGlobals());

const t = copy.trades;
const b = t.board;
const me: MeResponse = { id: 'a1', username: 'sonda_rayo', roles: [], mfa: false, level: 12 };
const gacha: GachaView = { banners: [], costs: { coins: 100, coinsTen: 900, signals: 1 }, freePullAvailable: false, wallet: { coins: 5000, dust: 0, signal: 0 } };
const pub = (id: string, name: string, tier: PublicGalaxy['tier'] = 'rare'): PublicGalaxy => ({ id, seed: '9', tier, finish: 'normal', traits: {}, name, designation: `GX-${id.toUpperCase()}`, featured: false, level: 1 });
const mineG = (id: string, name: string): GalaxySummary => ({ ...pub(id, name), createdAt: '2026-11-01T10:00:00.000Z' });
const rules = {
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
  tradeGalaxies: 3,
} as MarketRules & MyTrades['rules'];
const boardRules: TradeBoardRules = { canPost: true, openLeft: 2, todayLeft: 4, days: 7, answers: 20 };
const PID = '00000000-0000-4000-8000-0000000000b1';
const MID = '00000000-0000-4000-8000-0000000000b2';
const post = (over: Partial<TradePostView> = {}): TradePostView => ({
  id: PID,
  author: 'lyra',
  mine: false,
  galaxies: [pub('l1', 'Kathra', 'epic')],
  coins: 0,
  wants: { tiers: ['legendary'], palette: 'ember', coins: true },
  note: 'Busco algo rojo',
  status: 'open',
  createdAt: '2026-11-14T10:00:00.000Z',
  expiresAt: '2026-11-21T10:00:00.000Z',
  answers: 2,
  myAnswer: null,
  ...over,
});
const page = (posts: TradePostView[], next: string | null = null): TradeBoardPage => ({ posts, next, rules: boardRules });
const posted = (fetch: ReturnType<typeof mockApi>, path: string) =>
  fetch.mock.calls.filter(([url, init]) => url === `/galaxy/api${path}` && init?.method === 'POST').map(([, init]) => ({ body: JSON.parse(String(init?.body ?? '{}')), key: (init?.headers as Record<string, string> | undefined)?.['idempotency-key'] }));

function mount(routes: Record<string, (body: unknown) => Response> = {}, mine: TradePostView[] = []) {
  return mockApi({
    'GET /galaxy/api/auth/me': () => jsonResponse(200, me),
    'GET /galaxy/api/gacha': () => jsonResponse(200, gacha),
    'GET /galaxy/api/market/mine': () => jsonResponse(200, { active: [], sold: [], rules }),
    'GET /galaxy/api/market/offers': () => jsonResponse(200, { received: [], sent: [], held: 0 }),
    'GET /galaxy/api/trades': () => jsonResponse(200, { open: [], closed: [], rules } satisfies MyTrades),
    'GET /galaxy/api/trades/board': () => jsonResponse(200, page([post()], 'c1')),
    'GET /galaxy/api/trades/board?cursor=c1': () => jsonResponse(200, page([post({ id: '00000000-0000-4000-8000-0000000000b3', author: 'orion_7', galaxies: [pub('o1', 'Selem')], wants: { tiers: [], coins: false }, note: '' })])),
    'GET /galaxy/api/trades/board?tier=epic': () => jsonResponse(200, page([post()])),
    'GET /galaxy/api/trades/posts/mine': () => jsonResponse(200, { posts: mine, rules: boardRules } satisfies MyTradePosts),
    'GET /galaxy/api/galaxies?sort=rarity&limit=30': () => jsonResponse(200, { items: [mineG('m1', 'Libre'), mineG('m2', 'Otra libre')], counts: {}, fusion: { count: 5, dust: [] } }),
    ...routes,
  });
}
const board = () => renderAt('/mercado?pestana=trueques&vista=tablon', { '/mercado': <MarketScreen /> });

test('el tablón: lo que da cada publicación, lo que busca, su nota, el filtro por rareza y cargar más', async () => {
  const fetch = mount();
  board();
  const user = userEvent.setup();
  expect(await screen.findByRole('link', { name: b.views.board })).toHaveAttribute('aria-current', 'page');
  const card = (await screen.findAllByRole('article'))[0]!;
  expect(within(card).getByRole('link', { name: 'lyra' })).toHaveAttribute('href', '/perfil/lyra');
  expect(within(card).getByRole('region', { name: b.gives })).toHaveTextContent('Kathra');
  const seeks = within(card).getByRole('region', { name: b.seeks });
  expect(seeks).toHaveTextContent(copy.tiers.legendary);
  expect(seeks).toHaveTextContent(b.acceptsCoins);
  expect(seeks).toHaveTextContent('Busco algo rojo');
  expect(card).toHaveTextContent(b.answers(2));
  await user.click(screen.getByRole('button', { name: copy.collection.loadMore }));
  expect(await screen.findByRole('link', { name: 'orion_7' })).toBeInTheDocument();
  expect(screen.getByText(b.anything)).toBeInTheDocument();
  await user.click(within(screen.getByRole('group', { name: b.filter })).getByRole('button', { name: copy.tiers.epic }));
  await waitFor(() => expect(fetch.mock.calls.some(([url]) => url === '/galaxy/api/trades/board?tier=epic')).toBe(true));
});

test('publicar: doy una galaxia, busco rarezas y monedas, con nota; se envía una sola vez', async () => {
  const fetch = mount({ 'POST /galaxy/api/trades/posts': () => jsonResponse(200, post({ id: MID, mine: true, author: 'sonda_rayo' })) });
  board();
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: b.publish }));
  const dialog = await screen.findByRole('dialog', { name: b.publishTitle });
  expect(dialog).toHaveTextContent(b.lasts(7));
  expect(within(dialog).getByRole('button', { name: b.send })).toBeDisabled();
  await user.click(within(dialog).getByRole('button', { name: t.chooseMine }));
  await user.click(within(await screen.findByRole('dialog', { name: t.pickMine })).getByRole('button', { name: t.giveOne('Libre') }));
  const seek = within(dialog).getByRole('region', { name: b.seek });
  await user.click(within(seek).getByRole('button', { name: copy.tiers.epic }));
  await user.click(within(seek).getByRole('button', { name: copy.tiers.legendary }));
  await user.click(within(seek).getByRole('button', { name: b.coinsOk }));
  // Coins on one side: asking for coins switches off giving them.
  expect(within(dialog).getByLabelText(t.giveCoins)).toBeDisabled();
  await user.type(within(dialog).getByLabelText(b.note), 'Cambio rápido');
  await user.click(within(dialog).getByRole('button', { name: b.send }));
  expect(await within(dialog).findByText(b.sent)).toBeInTheDocument();
  const [sent] = posted(fetch, '/trades/posts');
  expect(sent?.body).toEqual({ give: { galaxies: ['m1'], coins: 0 }, wants: { tiers: ['epic', 'legendary'], coins: true }, note: 'Cambio rápido' });
  expect(sent?.key).toEqual(expect.any(String));
});

test('responder: lo que da la publicación va fijo, elijo lo que doy y lleva a mis trueques', async () => {
  const fetch = mount({ 'POST /galaxy/api/trades': () => jsonResponse(200, {}) });
  board();
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: b.answerOf('lyra') }));
  const dialog = await screen.findByRole('dialog', { name: b.answerTitle('lyra') });
  expect(dialog).toHaveTextContent('Busco algo rojo');
  const want = within(dialog).getByRole('region', { name: t.want });
  expect(want).toHaveTextContent('Kathra');
  expect(within(want).queryByRole('button', { name: t.remove('Kathra') })).toBeNull();
  expect(within(want).queryByRole('button', { name: t.chooseTheirs })).toBeNull();
  expect(within(want).getByLabelText(t.wantCoins)).toBeDisabled();
  expect(want).toHaveTextContent(b.fixed);
  await user.click(within(dialog).getByRole('button', { name: t.chooseMine }));
  await user.click(within(await screen.findByRole('dialog', { name: t.pickMine })).getByRole('button', { name: t.giveOne('Libre') }));
  await user.click(within(dialog).getByRole('button', { name: b.answerSend }));
  await waitFor(() =>
    expect(posted(fetch, '/trades')[0]?.body).toEqual({ username: 'lyra', give: { galaxies: ['m1'], coins: 0 }, want: { galaxies: ['l1'], coins: 0 }, post: PID }),
  );
  // Back to «Mis trueques», where the answer now is.
  await waitFor(() => expect(screen.getByRole('link', { name: b.views.mine })).toHaveAttribute('aria-current', 'page'));
});

test('mis publicaciones van arriba: retirar pide confirmación; la que ya respondí lleva a mi respuesta', async () => {
  const fetch = mount(
    {
      'GET /galaxy/api/trades/board': () => jsonResponse(200, page([post({ myAnswer: '00000000-0000-4000-8000-0000000000t9' })])),
      [`POST /galaxy/api/trades/posts/${MID}/cancel`]: () => jsonResponse(200, { cancelled: true }),
    },
    [post({ id: MID, mine: true, author: 'sonda_rayo', answers: 1 })],
  );
  board();
  const user = userEvent.setup();
  const mineSection = await screen.findByRole('region', { name: b.mine });
  expect(within(mineSection).getByText(b.yours)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: b.seeAnswer })).toHaveAttribute('href', '/mercado?pestana=trueques');
  await user.click(within(mineSection).getByRole('button', { name: b.withdrawOf('14 de noviembre') }));
  const confirm = await screen.findByRole('alertdialog', { name: b.withdrawTitle });
  expect(confirm).toHaveTextContent(b.withdrawBody);
  await user.click(within(confirm).getByRole('button', { name: b.withdraw }));
  await waitFor(() => expect(posted(fetch, `/trades/posts/${MID}/cancel`)).toHaveLength(1));
});

test('sin poder publicar más, el botón se apaga y dice por qué', async () => {
  mount({ 'GET /galaxy/api/trades/posts/mine': () => jsonResponse(200, { posts: [], rules: { ...boardRules, todayLeft: 0 } } satisfies MyTradePosts) });
  board();
  const button = await screen.findByRole('button', { name: b.publish });
  await waitFor(() => expect(button).toBeDisabled());
  expect(button).toHaveAccessibleDescription(b.none);
});
