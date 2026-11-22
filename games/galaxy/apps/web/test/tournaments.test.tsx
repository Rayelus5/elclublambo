import type { TournamentDetail, TournamentList } from '@galaxy/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { copy, fmt } from '../src/copy/es';
import { playClaim } from '../src/missions/sfx';
import { TournamentScreen } from '../src/tournaments/TournamentScreen';
import { TournamentsScreen } from '../src/tournaments/TournamentsScreen';
import { jsonResponse, mockApi, renderAt } from './render';
import { at, card, DAY, list, me, page, row } from './tournament-fixtures';

// The tournaments for players (plan «temporadas como fichas», part 5; GDD §13.3): the list in three tabs with each
// card's state, time, measure, prizes, entrants, my place and its action; signing up and leaving, each explained
// before and sent once with its idempotency key; and a tournament's page in each of its states, where the prizes are
// collected with their flight and their sound (stand-ins here, so the test sees what they are asked to do).
const fx = vi.hoisted(() => ({ burst: vi.fn() }));
vi.mock('../src/missions/ClaimFx', async (importOriginal) => ({ ...(await importOriginal<object>()), useClaimFx: () => ({ burst: fx.burst, view: null }) }));
vi.mock('../src/missions/sfx', () => ({ playClaim: vi.fn() }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const t = copy.tournaments;
const ID = '11111111-1111-4111-8111-111111111111';
const gacha = { banners: [], costs: { coins: 100, coinsFive: 475, coinsTen: 900, signals: 1 }, freePullAvailable: false, wallet: { coins: 1200, dust: 80, signal: 2 } };
const keyOf = (init: RequestInit | undefined) => (init?.headers as Record<string, string> | undefined)?.['idempotency-key'];
const posts = (fetch: ReturnType<typeof mockApi>, url: string) => fetch.mock.calls.filter(([u, init]) => u === url && init?.method === 'POST');

const upcoming = card({ id: '22222222-2222-4222-8222-222222222222', slug: 'copa-de-fuego', title: 'Copa de fuego', state: 'scheduled', startsAt: at(2 * DAY), endsAt: at(6 * DAY), entrants: 12, maxEntrants: 50, entry: { currency: 'coins', amount: 500 } });
const done = card({ id: '33333333-3333-4333-8333-333333333333', slug: 'copa-vieja', title: 'Copa vieja', state: 'finished', startsAt: at(-9 * DAY), endsAt: at(-3 * DAY), resultsAt: at(-2 * DAY), join: { open: false, block: 'closed' } });
const lists = (over: Partial<TournamentList> = {}) => list({ running: [card()], upcoming: [upcoming], finished: [done], ...over });

test('las pestañas En curso, Próximos y Terminados reparten los torneos y viven en la dirección', async () => {
  mockApi({ 'GET /galaxy/api/tournaments': () => jsonResponse(200, lists()), 'GET /galaxy/api/gacha': () => jsonResponse(200, gacha) });
  renderAt('/torneos', { '/torneos': <TournamentsScreen /> });
  expect(await screen.findByRole('heading', { level: 1, name: t.title })).toBeInTheDocument();
  const tabs = screen.getByRole('navigation', { name: t.tabsLabel });
  expect(within(tabs).getByRole('link', { name: t.tabs.running })).toHaveAttribute('aria-current', 'page');
  expect(within(tabs).getByRole('link', { name: t.tabs.upcoming })).toHaveAttribute('href', '/torneos?pestana=proximos');
  expect(within(tabs).getByRole('link', { name: t.tabs.finished })).toHaveAttribute('href', '/torneos?pestana=terminados');
  expect(await screen.findByRole('heading', { name: 'Copa de hielo' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Copa de fuego' })).toBeNull();
  await userEvent.click(within(tabs).getByRole('link', { name: t.tabs.upcoming }));
  expect(await screen.findByRole('heading', { name: 'Copa de fuego' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Copa de hielo' })).toBeNull();
});

test('sin torneos en curso abre la pestaña que tiene alguno', async () => {
  mockApi({ 'GET /galaxy/api/tournaments': () => jsonResponse(200, lists({ running: [] })), 'GET /galaxy/api/gacha': () => jsonResponse(200, gacha) });
  renderAt('/torneos', { '/torneos': <TournamentsScreen /> });
  expect(await screen.findByRole('heading', { name: 'Copa de fuego' })).toBeInTheDocument();
});

test('cada tarjeta dice su estado, cuánto queda, cómo se gana, sus premios, los inscritos y tu puesto', async () => {
  mockApi({ 'GET /galaxy/api/tournaments': () => jsonResponse(200, lists({ running: [card({ me: me({ rank: 5, score: 1240 }), join: { open: false, block: 'joined' } })] })), 'GET /galaxy/api/gacha': () => jsonResponse(200, gacha) });
  renderAt('/torneos', { '/torneos': <TournamentsScreen /> });
  const item = (await screen.findByRole('heading', { name: 'Copa de hielo' })).closest('article')!;
  const c = within(item);
  expect(c.getByText(t.state.running)).toBeInTheDocument();
  expect(c.getByText(/^Termina en 3 d 5 h/)).toBeInTheDocument();
  expect(c.getByText(t.metric.points)).toBeInTheDocument();
  expect(c.getByText(t.entrants(42, null))).toBeInTheDocument();
  expect(c.getByText(t.exclusive)).toBeInTheDocument();
  const prizes = c.getByRole('list', { name: t.prizesTitle });
  expect(within(prizes).getByText(t.places(1, 1))).toBeInTheDocument();
  expect(within(prizes).getByText(t.places(2, 3))).toBeInTheDocument();
  expect(c.getByText(t.status.joined)).toBeInTheDocument();
  expect(c.getByText(t.rankNow(5))).toBeInTheDocument();
  expect(c.getByText(t.value.points(1240))).toBeInTheDocument();
  expect(c.getByRole('link', { name: t.seeOf('Copa de hielo') })).toHaveAttribute('href', '/torneos/copa-de-hielo');
  expect(c.getByRole('button', { name: t.leaveOf('Copa de hielo') })).toBeEnabled();
  expect(c.queryByRole('button', { name: /Inscribirme/ })).toBeNull();
});

test('un premio en dinero se ve en la tarjeta con su €', async () => {
  const cash = card({ prizes: [{ from: 1, to: 1, gifts: [], cash: { amountEur: 50, note: '' } }] });
  mockApi({ 'GET /galaxy/api/tournaments': () => jsonResponse(200, lists({ running: [cash] })), 'GET /galaxy/api/gacha': () => jsonResponse(200, gacha) });
  renderAt('/torneos', { '/torneos': <TournamentsScreen /> });
  const item = (await screen.findByRole('heading', { name: 'Copa de hielo' })).closest('article')!;
  expect(within(item).getByText(t.cash(50))).toBeInTheDocument();
});

test('cuando no puedes inscribirte la tarjeta dice por qué', async () => {
  const blocked = [
    card({ id: 'a1', slug: 'a1', title: 'Saliste', join: { open: false, block: 'left' }, me: me({ status: 'left', rank: null }) }),
    card({ id: 'a2', slug: 'a2', title: 'Llena', join: { open: false, block: 'full' }, maxEntrants: 42 }),
    card({ id: 'a3', slug: 'a3', title: 'Con nivel', join: { open: false, block: 'level' }, filters: { sector: null, probe: null, mode: 'any', minLevel: 15 } }),
    card({ id: 'a4', slug: 'a4', title: 'Exclusiva', join: { open: false, block: 'exclusive' }, exclusiveWith: { slug: 'copa-de-fuego', title: 'Copa de fuego' } }),
  ];
  mockApi({ 'GET /galaxy/api/tournaments': () => jsonResponse(200, lists({ running: blocked })), 'GET /galaxy/api/gacha': () => jsonResponse(200, gacha) });
  renderAt('/torneos', { '/torneos': <TournamentsScreen /> });
  expect(await screen.findByText(t.block.left)).toBeInTheDocument();
  expect(screen.getByText(t.block.full)).toBeInTheDocument();
  expect(screen.getByText(t.block.level(15))).toBeInTheDocument();
  expect(screen.getByText(t.block.exclusive('Copa de fuego'))).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Inscribirme/ })).toBeNull();
});

test('inscribirte explica antes la entrada, la exclusividad, desde cuándo cuenta y que salir borra tu puntuación; se envía una vez con su clave', async () => {
  let now = lists({ running: [card()], upcoming: [{ ...upcoming, exclusive: true, startsAt: at(DAY), endsAt: at(5 * DAY) }] });
  const fetch = mockApi({
    'GET /galaxy/api/tournaments': () => jsonResponse(200, now),
    'GET /galaxy/api/gacha': () => jsonResponse(200, gacha),
    [`POST /galaxy/api/tournaments/${ID}/join`]: () => {
      now = { ...now, running: [card({ me: me({ rank: null, score: 0 }), join: { open: false, block: 'joined' }, entrants: 43 })] };
      return jsonResponse(200, { me: me({ rank: null, score: 0 }), wallet: { coins: 1200, dust: 80, signal: 2 } });
    },
  });
  renderAt('/torneos', { '/torneos': <TournamentsScreen /> });
  await userEvent.click(await screen.findByRole('button', { name: t.joinOf('Copa de hielo', null) }));
  const dialog = screen.getByRole('dialog', { name: t.joinDialog.title('Copa de hielo') });
  const d = within(dialog);
  expect(d.getByText(t.joinDialog.free)).toBeInTheDocument();
  expect(d.getByText(t.joinDialog.exclusive(['Copa de fuego']))).toBeInTheDocument();
  expect(d.getByText(t.joinDialog.fromNow)).toBeInTheDocument();
  expect(d.getByText(t.joinDialog.leaveWarning)).toBeInTheDocument();
  // The focus starts on Cancelar: nothing is spent by a stray Enter.
  expect(d.getByRole('button', { name: t.joinDialog.cancel })).toHaveFocus();
  expect(posts(fetch, `/galaxy/api/tournaments/${ID}/join`)).toHaveLength(0);
  await userEvent.click(d.getByRole('button', { name: t.joinDialog.confirm }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  const sent = posts(fetch, `/galaxy/api/tournaments/${ID}/join`);
  expect(sent).toHaveLength(1);
  expect(keyOf(sent[0]![1])).toMatch(/^[0-9a-f-]{36}$/);
  expect(await screen.findByText(t.joined('Copa de hielo'))).toBeInTheDocument();
  expect(await screen.findByRole('button', { name: t.leaveOf('Copa de hielo') })).toBeInTheDocument();
});

test('con entrada, el diálogo dice cuánto cuesta y que no se devuelve; si no te llega, no deja pagar', async () => {
  const fetch = mockApi({ 'GET /galaxy/api/tournaments': () => jsonResponse(200, lists()), 'GET /galaxy/api/gacha': () => jsonResponse(200, { ...gacha, wallet: { coins: 300, dust: 80, signal: 2 } }) });
  renderAt('/torneos?pestana=proximos', { '/torneos': <TournamentsScreen /> });
  // The wallet is read first: the dialog weighs the fee against it.
  expect(await screen.findByRole('img', { name: copy.hub.resource.coins(300) })).toBeInTheDocument();
  await userEvent.click(await screen.findByRole('button', { name: t.joinOf('Copa de fuego', '500 monedas') }));
  const d = within(screen.getByRole('dialog', { name: t.joinDialog.title('Copa de fuego') }));
  expect(d.getByText(t.joinDialog.fee('500 monedas'))).toBeInTheDocument();
  expect(d.getByText(t.joinDialog.fromStart)).toBeInTheDocument();
  expect(d.getByText(t.joinDialog.short('200 monedas'))).toBeInTheDocument();
  expect(d.getByRole('button', { name: t.joinDialog.confirmFee('500 monedas') })).toBeDisabled();
  expect(posts(fetch, `/galaxy/api/tournaments/${upcoming.id}/join`)).toHaveLength(0);
});

test('salir pide confirmación, avisa de que no se vuelve y de que la entrada no se devuelve, y se envía con su clave', async () => {
  let now = lists({ upcoming: [{ ...upcoming, me: me({ rank: null, score: 0 }), join: { open: false, block: 'joined' } }] });
  const fetch = mockApi({
    'GET /galaxy/api/tournaments': () => jsonResponse(200, now),
    'GET /galaxy/api/gacha': () => jsonResponse(200, gacha),
    [`POST /galaxy/api/tournaments/${upcoming.id}/leave`]: () => {
      now = { ...now, upcoming: [{ ...upcoming, me: me({ status: 'left', rank: null, score: 0 }), join: { open: false, block: 'left' } }] };
      return jsonResponse(200, { me: me({ status: 'left' }), wallet: gacha.wallet });
    },
  });
  renderAt('/torneos?pestana=proximos', { '/torneos': <TournamentsScreen /> });
  await userEvent.click(await screen.findByRole('button', { name: t.leaveOf('Copa de fuego') }));
  const dialog = screen.getByRole('alertdialog', { name: t.leaveDialog.title('Copa de fuego') });
  expect(within(dialog).getByText(t.leaveDialog.body)).toBeInTheDocument();
  expect(within(dialog).getByText(t.leaveDialog.fee)).toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: t.leaveDialog.stay })).toHaveFocus();
  await userEvent.click(within(dialog).getByRole('button', { name: t.leaveDialog.confirm }));
  await waitFor(() => expect(posts(fetch, `/galaxy/api/tournaments/${upcoming.id}/leave`)).toHaveLength(1));
  expect(keyOf(posts(fetch, `/galaxy/api/tournaments/${upcoming.id}/leave`)[0]![1])).toMatch(/^[0-9a-f-]{36}$/);
  expect(await screen.findByText(t.block.left)).toBeInTheDocument();
});

// A tournament's page.
const routes = (detail: TournamentDetail, extra = {}) => ({
  'GET /galaxy/api/tournaments/copa-de-hielo': () => jsonResponse(200, detail),
  'GET /galaxy/api/tournaments': () => jsonResponse(200, lists()),
  'GET /galaxy/api/gacha': () => jsonResponse(200, gacha),
  ...extra,
});
const open = () => renderAt('/torneos/copa-de-hielo', { '/torneos/:slug': <TournamentScreen /> });

test('un torneo próximo cuenta atrás hasta que empiece, explica cómo se gana y enseña sus premios', async () => {
  const soon = page({ state: 'scheduled', startsAt: at(2 * DAY + 3_600_000 + 30_000), endsAt: at(9 * DAY), ranking: [], total: 0, filters: { sector: null, probe: null, mode: 'solo', minLevel: 8 }, maxEntrants: 100 });
  mockApi(routes(soon));
  open();
  expect(await screen.findByRole('heading', { level: 1, name: 'Copa de hielo' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: copy.backTo.screens['/torneos'] })).toHaveAttribute('href', '/torneos');
  expect(screen.getAllByText(/^Empieza en 2 d 1 h/).length).toBeGreaterThan(0);
  const rules = within(screen.getByRole('region', { name: t.rulesTitle }));
  expect(rules.getByText(t.metricHow.points)).toBeInTheDocument();
  expect(rules.getByText(t.onlySolo)).toBeInTheDocument();
  expect(rules.getByText(t.minLevel(8))).toBeInTheDocument();
  expect(rules.getByText(t.cap(100))).toBeInTheDocument();
  expect(rules.getByText(t.tie)).toBeInTheDocument();
  expect(rules.getByText(t.reviewRule(24))).toBeInTheDocument();
  expect(rules.getByText(/Vale cualquier sonda/)).toBeInTheDocument();
  const prizes = within(screen.getByRole('region', { name: t.prizesTitle }));
  expect(prizes.getByText(t.places(1, 1))).toBeInTheDocument();
  expect(prizes.getByText(t.places(4, 10))).toBeInTheDocument();
  expect(prizes.getByText(`${fmt(5000)} monedas`)).toBeInTheDocument();
  expect(screen.getByText(t.rankingSoon)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: t.joinOf('Copa de hielo', null) })).toBeEnabled();
});

test('en curso, el podio, la tabla y tu fila fija; las cuentas sin premio llevan su marca; y tus partidas que cuentan', async () => {
  const live = page({
    me: me({ rank: 7, score: 1240 }),
    join: { open: false, block: 'joined' },
    ranking: [row(1, 'vega', 4200), row(2, 'deneb', 3100, { eligible: false, place: null }), row(3, 'altair', 2800, { place: 2 }), row(4, 'rigel', 1900, { place: 3 })],
    total: 30,
    mine: row(7, 'piloto', 1240, { me: true, place: 6 }),
    myRuns: [
      { id: 'r1', finishedAt: at(-3_600_000), sector: 'nebula', probe: 'lumen', coop: false, outcome: 'extracted', depth: 6, kills: 900, cores: 1, points: 640, value: 640 },
      { id: 'r2', finishedAt: at(-7_200_000), sector: 'nebula', probe: 'lumen', coop: true, outcome: 'died', depth: 4, kills: 500, cores: 0, points: 600, value: 600 },
    ],
  });
  mockApi(routes(live));
  open();
  expect(await screen.findByRole('list', { name: copy.social.podium })).toBeInTheDocument();
  expect(screen.getAllByText(/^Termina en 3 d 5 h/).length).toBeGreaterThan(0);
  const podium = within(screen.getByRole('list', { name: copy.social.podium }));
  expect(podium.getByRole('link', { name: 'vega' })).toHaveAttribute('href', '/perfil/vega');
  expect(podium.getByText(t.noPrizeMark)).toBeInTheDocument();
  const table = within(screen.getByRole('table', { name: t.rankingTitle }));
  expect(table.getByRole('link', { name: 'rigel' })).toBeInTheDocument();
  const pinned = within(screen.getByRole('region', { name: t.yourRow }));
  expect(pinned.getByText(fmt(7))).toBeInTheDocument();
  expect(pinned.getByText(t.value.points(1240))).toBeInTheDocument();
  expect(screen.getByText(t.players(30))).toBeInTheDocument();
  const runs = within(screen.getByRole('table', { name: t.runsTitle }));
  expect(runs.getAllByRole('row')).toHaveLength(3);
  expect(runs.getByText(t.group)).toBeInTheDocument();
  expect(runs.getByText(`+${fmt(640)}`)).toBeInTheDocument();
});

test('en revisión dice hasta cuándo y qué falta por comprobar, en sencillo', async () => {
  const resultsAt = at(20 * 3_600_000);
  mockApi(routes(page({ state: 'review', endsAt: at(-4 * 3_600_000), resultsAt, review: { checks: 6, pending: 2 }, me: me(), join: { open: false, block: 'joined' } })));
  open();
  expect(await screen.findByText(t.reviewChecking(6, 2))).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: new RegExp(`^${t.reviewTitle('').trim()}`) })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Inscribirme|Salir/ })).toBeNull();
});

test('terminado, tu resultado y tu premio: «Recoger» suena, vuela a la barra y se celebra, una vez y con su clave', async () => {
  const rewards = { place: 2, gifts: [{ kind: 'currency' as const, currency: 'coins' as const, amount: 3000 }, { kind: 'cosmetic' as const, piece: 'title' as const, id: 'Campeón de hielo' }], cash: null, participation: false };
  const finished = page({ state: 'finished', endsAt: at(-3 * DAY), resultsAt: at(-2 * DAY), join: { open: false, block: 'closed' }, me: me({ rank: 2, score: 3100, rewards }), total: 30 });
  let current = finished;
  const fetch = mockApi(
    routes(finished, {
      'GET /galaxy/api/tournaments/copa-de-hielo': () => jsonResponse(200, current),
      [`POST /galaxy/api/tournaments/${ID}/claim`]: () => {
        current = { ...finished, me: me({ rank: 2, score: 3100, rewards, claimed: true }) };
        return jsonResponse(200, { items: rewards.gifts.map((gift) => ({ gift, outcome: 'granted' })), wallet: { coins: 4200, dust: 80, signal: 2 } });
      },
    }),
  );
  open();
  expect(await screen.findByText(t.yourResult(2, 30))).toBeInTheDocument();
  const claim = await screen.findByRole('button', { name: t.claimOf('Copa de hielo') });
  await userEvent.click(claim);
  await waitFor(() => expect(playClaim).toHaveBeenCalledWith(expect.objectContaining({ coins: 3000, title: 'Campeón de hielo' }), true));
  expect(fx.burst).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ coins: 3000 }));
  expect(await screen.findByText(t.bigClaim)).toBeInTheDocument();
  expect(await screen.findByText(t.claimed)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: t.claimOf('Copa de hielo') })).toBeNull();
  const sent = posts(fetch, `/galaxy/api/tournaments/${ID}/claim`);
  expect(sent).toHaveLength(1);
  expect(keyOf(sent[0]![1])).toMatch(/^[0-9a-f-]{36}$/);
  // The page wears the wallet the prize flies to.
  expect(document.querySelector('[data-wallet]')).not.toBeNull();
});

test('un premio solo en dinero no tiene nada que recoger: dice cómo se paga', async () => {
  const rewards = { place: 1, gifts: [], cash: { amountEur: 50, note: '' }, participation: false };
  mockApi(routes(page({ state: 'finished', endsAt: at(-3 * DAY), resultsAt: at(-2 * DAY), join: { open: false, block: 'closed' }, me: me({ rank: 1, score: 4200, rewards }), total: 30 })));
  open();
  expect(await screen.findByText(t.cashNote)).toBeInTheDocument();
  expect(screen.getAllByText(t.cash(50)).length).toBeGreaterThan(0);
  expect(screen.queryByRole('button', { name: t.claimOf('Copa de hielo') })).toBeNull();
});

test('una cuenta que no puede ganar premios lo sabe al ver su resultado', async () => {
  mockApi(routes(page({ state: 'finished', endsAt: at(-3 * DAY), resultsAt: at(-2 * DAY), join: { open: false, block: 'closed' }, me: me({ rank: 1, score: 4200, eligible: false }), total: 30 })));
  open();
  expect(await screen.findByText(t.ineligible)).toBeInTheDocument();
});

test('cancelado, lo dice y avisa de que la entrada se devolvió', async () => {
  mockApi(routes(page({ state: 'cancelled', entry: { currency: 'coins', amount: 500 }, join: { open: false, block: 'closed' }, me: me({ refunded: true, rank: null }), ranking: [], total: 0 })));
  open();
  expect(await screen.findByRole('heading', { name: t.cancelledTitle })).toBeInTheDocument();
  expect(screen.getByText(t.refunded)).toBeInTheDocument();
});

test('un torneo que no existe lo dice', async () => {
  mockApi({ 'GET /galaxy/api/tournaments/copa-de-hielo': () => jsonResponse(404, { error: 'tournament_not_found' }), 'GET /galaxy/api/gacha': () => jsonResponse(200, gacha), 'GET /galaxy/api/tournaments': () => jsonResponse(200, lists()) });
  open();
  expect(await screen.findByText(copy.errors.tournament_not_found)).toBeInTheDocument();
});
