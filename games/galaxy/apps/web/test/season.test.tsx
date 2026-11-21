import type { SeasonView } from '@galaxy/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { copy, fmt } from '../src/copy/es';
import { playClaim } from '../src/missions/sfx';
import { SeasonScreen } from '../src/season/SeasonScreen';
import { TrophiesScreen } from '../src/season/TrophiesScreen';
import { jsonResponse, mockApi, renderAt } from './render';

// The season route and shop (GDD §13.1; M7d-1). What is collected or bought is heard and flies to the wallet (season
// shop plan, PR 4): the flight and the sound are stand-ins here, so the test sees what they are asked to do.
const fx = vi.hoisted(() => ({ burst: vi.fn() }));
vi.mock('../src/missions/ClaimFx', async (importOriginal) => ({ ...(await importOriginal<object>()), useClaimFx: () => ({ burst: fx.burst, view: null }) }));
vi.mock('../src/missions/sfx', () => ({ playClaim: vi.fn() }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const r = (x: object) => ({ coins: 0, dust: 0, signal: 0, shards: 0, title: null, frame: null, avatar: null, skin: null, ...x });
const view: SeasonView = {
  season: { id: 'season-1', name: 'Temporada 1', startsAt: '2026-11-12T23:00:00.000Z', endsAt: new Date(Date.now() + 10 * 86_400_000).toISOString(), tiers: [500, 2000, 6000, 15000, 30000] },
  score: 600,
  tier: 'bronze',
  currency: { name: 'Esquirlas', balance: 45 },
  steps: [
    { at: 100, reward: r({ coins: 300 }), reached: true, claimed: true },
    { at: 500, reward: r({ shards: 30, title: 'Pionero' }), reached: true, claimed: false },
    { at: 800, reward: r({ dust: 400 }), reached: false, claimed: false },
  ],
  shop: [
    { id: 'dust-bag', name: 'Saco de polvo estelar', price: 40, limit: 10, bought: 0, reward: r({ dust: 500 }) },
    { id: 'frame-abyss', name: 'Marco Abismo', price: 900, limit: 1, bought: 0, reward: r({ frame: 'abyss' }) },
  ],
  closing: null,
};

test('la ruta deja recoger lo alcanzado, la tienda compra lo que da la moneda y avisa de la conversión', async () => {
  const fetch = mockApi({
    'GET /galaxy/api/season': () => jsonResponse(200, view),
    'POST /galaxy/api/season/route/500/claim': () => jsonResponse(200, { ...view, steps: view.steps.map((s) => (s.at === 500 ? { ...s, claimed: true } : s)) }),
  });
  renderAt('/temporada', { '/temporada': <SeasonScreen /> });
  expect(await screen.findByRole('heading', { level: 1, name: 'Temporada 1' })).toBeInTheDocument();
  expect(screen.getByText(copy.season.toNext(200))).toBeInTheDocument();
  expect(screen.getByText('30 Esquirlas, el título Pionero')).toBeInTheDocument();
  // A step not reached yet says what it lacks instead of offering a dead button.
  expect(screen.queryByRole('button', { name: copy.season.claimOf(800) })).toBeNull();
  expect(screen.getByText(copy.season.left(200))).toBeInTheDocument();
  expect(screen.getByRole('button', { name: copy.season.buyOf('Saco de polvo estelar', 40, 'Esquirlas') })).toBeEnabled();
  expect(screen.getByRole('button', { name: copy.season.buyOf('Marco Abismo', 900, 'Esquirlas') })).toBeDisabled();
  expect(screen.getByText(copy.season.convertNote('Esquirlas'))).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: copy.season.claimOf(500) }));
  await vi.waitFor(() => expect(screen.queryByRole('button', { name: copy.season.claimOf(500) })).toBeNull());
  expect(fetch.mock.calls.some(([url, init]) => url === '/galaxy/api/season/route/500/claim' && init?.method === 'POST')).toBe(true);
});

test('fuera de temporada lo dice', async () => {
  mockApi({ 'GET /galaxy/api/season': () => jsonResponse(200, { ...view, season: null, steps: [], shop: [] }) });
  renderAt('/temporada', { '/temporada': <SeasonScreen /> });
  expect(await screen.findByText(copy.errors.season_closed)).toBeInTheDocument();
});

test('al cerrar una temporada enseña el puesto y sus premios para recogerlos una vez (M7d-2)', async () => {
  const closing = { season: 'season-0', name: 'Temporada 0', endsAt: '2026-10-31T00:00:00.000Z', rank: 2, score: 7000, tier: 'gold' as const, podium: true, rewards: [r({ coins: 3000 }), r({ title: 'Podio de temporada', frame: 'crown', avatar: null, skin: null })], claimed: false };
  const fetch = mockApi({
    'GET /galaxy/api/season': () => jsonResponse(200, { ...view, season: null, steps: [], shop: [], closing }),
    'POST /galaxy/api/season/results/season-0/claim': () => jsonResponse(200, { ...view, season: null, steps: [], shop: [], closing: null }),
  });
  renderAt('/temporada', { '/temporada': <SeasonScreen /> });
  expect(await screen.findByRole('heading', { name: copy.season.closingTitle('Temporada 0') })).toBeInTheDocument();
  expect(screen.getByText(copy.season.closingPlace(2, 7000))).toBeInTheDocument();
  expect(screen.getByText(`${fmt(3000)} monedas; el título Podio de temporada, el marco Corona`)).toBeInTheDocument();
  expect(screen.getByText(copy.season.closingTrophy)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: copy.season.closingClaim }));
  await vi.waitFor(() => expect(screen.queryByRole('button', { name: copy.season.closingClaim })).toBeNull());
  expect(fetch.mock.calls.some(([url]) => url === '/galaxy/api/season/results/season-0/claim')).toBe(true);
});

test('los trofeos enseñan tus temporadas y el salón de la fama con su podio (M7d-2)', async () => {
  mockApi({
    'GET /galaxy/api/auth/me': () => jsonResponse(200, { id: 'u1', username: 'piloto', roles: [], mfa: false }),
    'GET /galaxy/api/profiles/piloto/seasons': () => jsonResponse(200, { seasons: [{ season: 'season-0', name: 'Temporada 0', endsAt: '2026-10-31T00:00:00.000Z', rank: 1, score: 9000, tier: 'gold', podium: true }] }),
    'GET /galaxy/api/hall-of-fame': () =>
      jsonResponse(200, { seasons: [{ season: 'season-0', name: 'Temporada 0', endsAt: '2026-10-31T00:00:00.000Z', players: 40, podium: [{ username: 'piloto', rank: 1, score: 9000 }, { username: 'otra', rank: 2, score: 8000 }] }] }),
  });
  renderAt('/trofeos', { '/trofeos': <TrophiesScreen /> });
  expect(await screen.findByText(copy.trophies.podiumPlace(1))).toBeInTheDocument();
  expect(await screen.findByText(copy.trophies.players(40))).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'otra' })).toHaveAttribute('href', '/perfil/otra');
});

// The season shop with the wallet of Missions (season shop plan, PR 4): your resources and the season currency up top,
// what you collect or buy heard and flying up to them, «Recoger todo» on the route, a confirmation before an expensive
// purchase, what you can pay marked, and the time left ticking.
const t = copy.season;
const R = copy.hub.resource;
const gachaView = { banners: [], costs: { coins: 100, coinsFive: 475, coinsTen: 900, signals: 1 }, freePullAvailable: false, wallet: { coins: 1200, dust: 80, signal: 2 } };
const pouch = { id: 'coin-pouch', name: 'Bolsa de monedas', price: 10, limit: 5, bought: 0, reward: r({ coins: 200 }) };
const gone = { id: 'old-title', name: 'Título Veterano', price: 5, limit: 1, bought: 1, reward: r({ title: 'Veterano' }) };
const shopView: SeasonView = { ...view, shop: [...view.shop, pouch, gone] };
const withRoute = (v: SeasonView, at: number) => ({ ...v, steps: v.steps.map((s) => (s.at === at ? { ...s, claimed: true } : s)) });
/** Gives a control a box of its own, so the flight can be seen to start from it (read before the answer replaces it). */
const boxed = (el: HTMLElement, left: number) => {
  el.getBoundingClientRect = () => ({ left, top: 300, width: 40, height: 30, right: left + 40, bottom: 330, x: left, y: 300, toJSON: () => ({}) }) as DOMRect;
  return expect.objectContaining({ left, top: 300 });
};

test('arriba enseña tus recursos como en Misiones, con las Esquirlas, y cuánto queda en vivo', async () => {
  mockApi({ 'GET /galaxy/api/season': () => jsonResponse(200, view), 'GET /galaxy/api/gacha': () => jsonResponse(200, gachaView) });
  renderAt('/temporada', { '/temporada': <SeasonScreen /> });
  const bar = (await screen.findByRole('img', { name: R.coins(1200) })).closest<HTMLElement>('[data-wallet]')!;
  expect(bar).toHaveClass('missions-wallet');
  expect(within(bar).getByRole('img', { name: R.dust(80) })).toBeInTheDocument();
  expect(within(bar).getByRole('link', { name: new RegExp(R.signal(2)) })).toBeInTheDocument();
  expect(within(bar).getByRole('img', { name: R.season(45, 'Esquirlas') })).toHaveClass('shards');
  expect(document.querySelector('.season-wallet')).toBeNull();
  expect(screen.getByText(/^Acaba en 9 d 23 h/)).toBeInTheDocument();
  expect(screen.queryByText(copy.social.endsIn(10))).toBeNull();
});

test('la tienda marca lo que puedes pagar, lo que te falta y lo agotado', async () => {
  mockApi({ 'GET /galaxy/api/season': () => jsonResponse(200, shopView), 'GET /galaxy/api/gacha': () => jsonResponse(200, gachaView) });
  renderAt('/temporada', { '/temporada': <SeasonScreen /> });
  const card = async (name: string) => (await screen.findByText(name, { selector: 'b' })).closest('li')!;
  expect(await card('Bolsa de monedas')).toHaveClass('affordable');
  expect(await card('Saco de polvo estelar')).toHaveClass('affordable');
  const frame = await card('Marco Abismo');
  expect(frame).toHaveClass('short');
  expect(within(frame).getByText(t.short(855, 'Esquirlas'))).toBeInTheDocument();
  const sold = await card('Título Veterano');
  expect(sold).toHaveClass('sold');
  expect(within(sold).getByRole('button', { name: t.buyOf('Título Veterano', 5, 'Esquirlas') })).toBeDisabled();
  expect(within(sold).getByText(t.soldOut)).toBeInTheDocument();
});

test('comprar algo barato suena y lo comprado vuela desde su botón a la barra', async () => {
  const fetch = mockApi({
    'GET /galaxy/api/season': () => jsonResponse(200, shopView),
    'GET /galaxy/api/gacha': () => jsonResponse(200, gachaView),
    'POST /galaxy/api/season/shop/coin-pouch/buy': () => jsonResponse(200, { ...shopView, currency: { name: 'Esquirlas', balance: 35 }, shop: shopView.shop.map((i) => (i.id === 'coin-pouch' ? { ...i, bought: 1 } : i)) }),
  });
  renderAt('/temporada', { '/temporada': <SeasonScreen /> });
  const buy = await screen.findByRole('button', { name: t.buyOf('Bolsa de monedas', 10, 'Esquirlas') });
  const from = boxed(buy, 111);
  await userEvent.click(buy);
  await vi.waitFor(() => expect(playClaim).toHaveBeenCalledWith(expect.objectContaining({ coins: 200 }), false));
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(fx.burst).toHaveBeenCalledWith(from, expect.objectContaining({ coins: 200 }));
  expect(fetch.mock.calls.filter(([, init]) => init?.method === 'POST').map(([u]) => u)).toEqual(['/galaxy/api/season/shop/coin-pouch/buy']);
  expect(await screen.findByText(t.bought('Bolsa de monedas'))).toBeInTheDocument();
});

test('una compra que se lleva más de la mitad de tus Esquirlas pide confirmación', async () => {
  const fetch = mockApi({
    'GET /galaxy/api/season': () => jsonResponse(200, shopView),
    'GET /galaxy/api/gacha': () => jsonResponse(200, gachaView),
    'POST /galaxy/api/season/shop/dust-bag/buy': () => jsonResponse(200, { ...shopView, currency: { name: 'Esquirlas', balance: 5 } }),
  });
  renderAt('/temporada', { '/temporada': <SeasonScreen /> });
  const posts = () => fetch.mock.calls.filter(([, init]) => init?.method === 'POST');
  await userEvent.click(await screen.findByRole('button', { name: t.buyOf('Saco de polvo estelar', 40, 'Esquirlas') }));
  let ask = screen.getByRole('alertdialog', { name: t.confirmTitle('Saco de polvo estelar') });
  expect(within(ask).getByText(t.confirmBody(40, 5, 'Esquirlas'))).toBeInTheDocument();
  await userEvent.click(within(ask).getByRole('button', { name: t.confirmNo }));
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(posts()).toHaveLength(0);
  const item = screen.getByRole('button', { name: t.buyOf('Saco de polvo estelar', 40, 'Esquirlas') });
  const from = boxed(item, 222);
  await userEvent.click(item);
  ask = screen.getByRole('alertdialog', { name: t.confirmTitle('Saco de polvo estelar') });
  await userEvent.click(within(ask).getByRole('button', { name: t.confirmYes(40, 'Esquirlas') }));
  await vi.waitFor(() => expect(posts().map(([u]) => u)).toEqual(['/galaxy/api/season/shop/dust-bag/buy']));
  expect(screen.queryByRole('alertdialog')).toBeNull();
  // The flight starts from the item's own button, not from the dialog's.
  await vi.waitFor(() => expect(fx.burst).toHaveBeenCalledWith(from, expect.objectContaining({ dust: 500 })));
});

test('recoger un escalón con una pieza suena, vuela y lo celebra', async () => {
  mockApi({
    'GET /galaxy/api/season': () => jsonResponse(200, view),
    'GET /galaxy/api/gacha': () => jsonResponse(200, gachaView),
    'POST /galaxy/api/season/route/500/claim': () => jsonResponse(200, withRoute(view, 500)),
  });
  renderAt('/temporada', { '/temporada': <SeasonScreen /> });
  const claim = await screen.findByRole('button', { name: t.claimOf(500) });
  const from = boxed(claim, 333);
  await userEvent.click(claim);
  await vi.waitFor(() => expect(playClaim).toHaveBeenCalledWith(expect.objectContaining({ shards: 30, title: 'Pionero' }), true));
  expect(fx.burst).toHaveBeenCalledWith(from, expect.objectContaining({ shards: 30, title: 'Pionero' }));
  const party = await screen.findByText(copy.missions.piece.title);
  expect(party.closest('.celebrate')).toHaveTextContent('Pionero');
  expect(await screen.findByText(copy.missions.gained('30 Esquirlas, el título Pionero'))).toBeInTheDocument();
});

test('Recoger todo recoge cada escalón listo de la ruta, en orden', async () => {
  const ready: SeasonView = { ...view, score: 700, steps: [...view.steps.slice(0, 2), { at: 650, reward: r({ coins: 500 }), reached: true, claimed: false }, view.steps[2]!] };
  const fetch = mockApi({
    'GET /galaxy/api/season': () => jsonResponse(200, ready),
    'GET /galaxy/api/gacha': () => jsonResponse(200, gachaView),
    'POST /galaxy/api/season/route/500/claim': () => jsonResponse(200, withRoute(ready, 500)),
    'POST /galaxy/api/season/route/650/claim': () => jsonResponse(200, withRoute(withRoute(ready, 500), 650)),
  });
  renderAt('/temporada', { '/temporada': <SeasonScreen /> });
  await userEvent.click(await screen.findByRole('button', { name: copy.missions.claimAll(2) }));
  const posts = () => fetch.mock.calls.filter(([, init]) => init?.method === 'POST').map(([u]) => u);
  await vi.waitFor(() => expect(posts()).toEqual(['/galaxy/api/season/route/500/claim', '/galaxy/api/season/route/650/claim']));
  await vi.waitFor(() => expect(fx.burst).toHaveBeenCalledTimes(2));
  expect(playClaim).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('button', { name: /Recoger todo/ })).toBeNull();
});

test('recoger los premios de cierre suena, vuela y lo celebra con el nombre de la temporada', async () => {
  const closing = { season: 'season-0', name: 'Temporada 0', endsAt: '2026-10-31T00:00:00.000Z', rank: 2, score: 7000, tier: 'gold' as const, podium: false, rewards: [r({ coins: 3000 }), r({ dust: 200, title: 'Oro de temporada' })], claimed: false };
  mockApi({
    'GET /galaxy/api/season': () => jsonResponse(200, { ...view, closing }),
    'GET /galaxy/api/gacha': () => jsonResponse(200, gachaView),
    'POST /galaxy/api/season/results/season-0/claim': () => jsonResponse(200, view),
  });
  renderAt('/temporada', { '/temporada': <SeasonScreen /> });
  const claim = await screen.findByRole('button', { name: t.closingClaim });
  const from = boxed(claim, 444);
  await userEvent.click(claim);
  await vi.waitFor(() => expect(playClaim).toHaveBeenCalledWith(expect.objectContaining({ coins: 3000, dust: 200, title: 'Oro de temporada' }), true));
  expect(fx.burst).toHaveBeenCalledWith(from, expect.objectContaining({ coins: 3000, dust: 200 }));
  expect((await screen.findByText(t.bigClosing)).closest('.celebrate')).toHaveTextContent('Temporada 0');
});
