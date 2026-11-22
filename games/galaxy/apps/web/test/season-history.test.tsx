import { DEFAULT_CLOSING_TIERS, DEFAULT_PODIUM, type Leaderboard, type LeaderRow, type MeResponse, type PastRow, type SeasonResults, type SeasonsHistory, type SeasonView } from '@galaxy/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { copy, fmt } from '../src/copy/es';
import { SeasonScreen } from '../src/season/SeasonScreen';
import { TrophiesScreen } from '../src/season/TrophiesScreen';
import { boardMode, LeaderboardScreen } from '../src/social/LeaderboardScreen';
import { pickOption } from './pick';
import { jsonResponse, locationOf, mockApi, renderAt } from './render';

// The past seasons for players (plan «temporadas como fichas», histórico, 2026-11-22): the leaderboard chooses between
// the current season and the closed ones (in the address, ?temporada=), a closed one shows its podium, its final
// ranking with your row, its numbers and what its close paid; the hall of fame leads to each. An admin previews a
// season still to come in the leaderboard and in the shop, with nothing to press and a way back to the panel.
const fx = vi.hoisted(() => ({ burst: vi.fn() }));
vi.mock('../src/missions/ClaimFx', async (importOriginal) => ({ ...(await importOriginal<object>()), useClaimFx: () => ({ burst: fx.burst, view: null }) }));
vi.mock('../src/missions/sfx', () => ({ playClaim: vi.fn() }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const t = copy.social;
const p = copy.season.preview;
const DAY = 86_400_000;
const admin: MeResponse = { id: 'ad1', username: 'rayelus', roles: ['superadmin'], mfa: true, level: 30 };
const player: MeResponse = { id: 'p1', username: 'deneb', roles: [], mfa: false, level: 9 };
const closing = { tiers: [...DEFAULT_CLOSING_TIERS], podium: DEFAULT_PODIUM, podiumSize: 3 };
const tiers = [500, 2000, 6000, 15000, 30000];

const live: Leaderboard = {
  season: { id: 'season-2', name: 'Temporada 2', startsAt: '2026-11-22T23:00:00.000Z', endsAt: new Date(Date.now() + 20 * DAY).toISOString(), tiers, closing },
  tab: 'general',
  rows: [{ rank: 1, username: 'orion', level: 4, value: 900, runs: 3, bestDepth: 2 } as LeaderRow],
  me: null,
  total: 1,
};
const stats = { players: 412, runs: 5320, kills: 1_204_000, cores: 388, extractions: 1900, maxDepth: 17, topSector: 'outer-nebula', topProbe: 'lumen', tiers: { bronze: 200, silver: 120, gold: 60, platinum: 25, stellar: 7 } };
const T1 = { id: 'season-1', name: 'Temporada 1', startsAt: '2026-11-12T23:00:00.000Z', endsAt: '2026-11-22T23:00:00.000Z', players: 412, podium: [], stats };
const T0 = { id: 'season-0', name: 'Temporada cero', startsAt: '2026-10-01T22:00:00.000Z', endsAt: '2026-10-31T23:00:00.000Z', players: 20, podium: [], stats: null };
const history: SeasonsHistory = { seasons: [T1, T0] };
const row = (rank: number, username: string, value: number, tier: PastRow['tier'], podium = false): PastRow => ({ rank, username, level: 10, value, tier, podium, avatar: null, frame: null });
const ROWS = [row(1, 'vega', 31000, 'stellar', true), row(2, 'lyra', 16000, 'platinum', true), row(3, 'altair', 9000, 'gold', true), row(4, 'rigel', 2400, 'silver'), row(5, 'sirius', 600, 'bronze')];
const results = (over: Partial<SeasonResults> = {}): SeasonResults => ({ season: { ...T1, tiers, closing }, rows: ROWS, me: row(140, 'deneb', 120, null), total: 412, next: null, ...over });
const screens = { '/clasificacion': <LeaderboardScreen /> };

function api(me: MeResponse, extra: Record<string, () => Response> = {}) {
  return mockApi({
    'GET /galaxy/api/auth/me': () => jsonResponse(200, me),
    'GET /galaxy/api/seasons/history': () => jsonResponse(200, history),
    'GET /galaxy/api/leaderboard?tab=general': () => jsonResponse(200, live),
    'GET /galaxy/api/seasons/season-1/results': () => jsonResponse(200, results()),
    ...extra,
  });
}

describe('qué temporada enseña la clasificación', () => {
  const base = { past: ['season-1'], liveId: 'season-2', admin: false };
  test('sin temporada en la dirección, la actual; una pasada, su resultado', () => {
    expect(boardMode({ ...base, wanted: null })).toBe('live');
    expect(boardMode({ ...base, wanted: 'season-1' })).toBe('past');
    expect(boardMode({ ...base, wanted: 'season-2' })).toBe('live');
  });
  test('otra temporada es la vista previa de un admin; un jugador ve la actual', () => {
    expect(boardMode({ ...base, wanted: 'season-3', admin: true })).toBe('preview');
    expect(boardMode({ ...base, wanted: 'season-3' })).toBe('live');
  });
  test('mientras falta saber algo, espera', () => {
    expect(boardMode({ ...base, wanted: 'season-3', past: undefined })).toBe('loading');
    expect(boardMode({ ...base, wanted: 'season-3', liveId: undefined })).toBe('loading');
    expect(boardMode({ ...base, wanted: 'season-3', admin: undefined })).toBe('loading');
  });
});

test('el selector elige entre la temporada actual y las pasadas, y lo elegido queda en la dirección', async () => {
  const user = userEvent.setup();
  const fetch = api(player);
  renderAt('/clasificacion', screens);
  const select = await screen.findByRole('combobox', { name: t.seasonPick });
  expect(select).toHaveTextContent(t.currentSeason);
  await user.click(select);
  const list = document.getElementById(select.getAttribute('aria-controls')!)!;
  expect(within(list).getAllByRole('option').map((o) => o.textContent)).toEqual([t.currentSeason, expect.stringContaining('Temporada 1'), expect.stringContaining('Temporada cero')]);
  // Each past season says its days of play.
  expect(within(list).getByRole('option', { name: 'Temporada 1' })).toHaveAccessibleDescription(t.span('13 nov', '22 nov 2026'));
  await pickOption(user, select, 'Temporada 1');
  expect(await screen.findByRole('heading', { level: 2, name: 'Temporada 1' })).toBeInTheDocument();
  expect(fetch.mock.calls.map(([url]) => url)).toContain('/galaxy/api/seasons/season-1/results');
  expect(screen.getByRole('combobox', { name: t.seasonPick })).toHaveTextContent('Temporada 1');
  // And back to the current one.
  await pickOption(user, screen.getByRole('combobox', { name: t.seasonPick }), t.currentSeason);
  expect(await screen.findByRole('heading', { level: 2, name: 'Temporada 2' })).toBeInTheDocument();
});

test('sin temporadas pasadas no hay selector', async () => {
  api(player, { 'GET /galaxy/api/seasons/history': () => jsonResponse(200, { seasons: [] }) });
  renderAt('/clasificacion', screens);
  expect(await screen.findByRole('heading', { level: 2, name: 'Temporada 2' })).toBeInTheDocument();
  expect(screen.queryByRole('combobox', { name: t.seasonPick })).toBeNull();
});

test('una temporada pasada enseña su podio, su clasificación final con tu fila, sus números y sus premios de cierre', async () => {
  api(player);
  renderAt('/clasificacion?temporada=season-1', screens);
  const podium = await screen.findByRole('list', { name: t.podium });
  expect(within(podium).getAllByRole('listitem')).toHaveLength(3);
  expect(podium).toHaveTextContent('vega');
  expect(podium).toHaveTextContent(t.value.general(31000));
  const table = screen.getByRole('table', { name: t.leaderboard });
  expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual([t.columns.rank, t.columns.player, t.columns.level, t.past.tierColumn, t.columns.value.general]);
  const lines = within(table).getAllByRole('row').slice(1);
  expect(lines).toHaveLength(2);
  expect(lines[0]).toHaveTextContent('rigel');
  expect(lines[0]).toHaveTextContent(t.tier.silver);
  expect(within(lines[0]!).getByRole('link', { name: 'rigel' })).toHaveAttribute('href', '/perfil/rigel');
  // Your row, pinned below: you finished 140th with no tier.
  const pinned = screen.getByRole('region', { name: t.yourRow });
  expect(pinned).toHaveTextContent('140');
  expect(pinned).toHaveTextContent(t.past.noTier);

  const card = screen.getByRole('region', { name: 'Temporada 1' });
  expect(card).toHaveTextContent(t.past.ended);
  expect(card).toHaveTextContent(t.span('13 nov', '22 nov 2026'));
  expect(card).toHaveTextContent(t.rankOf(140, 412));
  expect(card).toHaveTextContent(t.past.prizesTitle);
  const prizes = within(card).getByRole('list', { name: t.tiersTitle });
  expect(within(prizes).getByText(t.tier.stellar).closest('li')).toHaveTextContent(t.prize(closing.tiers[4]!));
  expect(within(card).getByRole('group', { name: t.podiumPrize })).toHaveTextContent(t.podiumWho(3));
  // A past season leads nowhere else: no countdown, no route.
  expect(within(card).queryByRole('link')).toBeNull();
  expect(card.querySelector('time')).toBeNull();

  const numbers = screen.getByRole('region', { name: t.past.statsTitle });
  for (const [label, value] of [
    [t.past.stats.players, fmt(412)],
    [t.past.stats.runs, fmt(5320)],
    [t.past.stats.kills, fmt(1_204_000)],
    [t.past.stats.cores, fmt(388)],
    [t.past.stats.extractions, fmt(1900)],
    [t.past.stats.maxDepth, fmt(17)],
  ] as const) {
    expect(within(numbers).getByText(label).closest('div')).toHaveTextContent(value);
  }
  // By their names in the content, not their ids.
  expect(within(numbers).getByText(t.past.stats.topSector).closest('div')).toHaveTextContent('Nebulosa Exterior');
  expect(within(numbers).getByText(t.past.stats.topProbe).closest('div')).toHaveTextContent('Lumen');
  const reached = within(numbers).getByRole('list', { name: t.past.tiersReached });
  expect(within(reached).getByText(t.tier.stellar).closest('li')).toHaveTextContent(t.players(7));
});

test('de una temporada pasada solo queda la General: las demás pestañas no se pueden abrir y se dice por qué', async () => {
  api(player);
  renderAt('/clasificacion?temporada=season-1', screens);
  const tabs = await screen.findByRole('navigation', { name: t.tabsLabel });
  expect(within(tabs).getByRole('link', { name: t.tabs.general })).toHaveAttribute('aria-current', 'page');
  expect(within(tabs).getByRole('link', { name: t.tabs.general })).toHaveAttribute('href', '/clasificacion?temporada=season-1');
  for (const k of ['depth', 'purges', 'clans', 'groups'] as const) expect(within(tabs).getByRole('button', { name: t.tabs[k] })).toBeDisabled();
  expect(tabs).toHaveAccessibleDescription(t.past.onlyGeneral);
  // A tab in the address for a past season shows General anyway, and never asks for the tab.
  const view = renderAt('/clasificacion?temporada=season-1&pestana=clanes', screens);
  expect(await within(view.container).findByRole('table', { name: t.leaderboard })).toBeInTheDocument();
});

test('la clasificación final se carga por páginas con «Ver más»', async () => {
  const user = userEvent.setup();
  const fetch = api(player, {
    'GET /galaxy/api/seasons/season-1/results': () => jsonResponse(200, results({ next: 5 })),
    'GET /galaxy/api/seasons/season-1/results?offset=5': () => jsonResponse(200, results({ rows: [row(6, 'mimosa', 400, 'bronze'), row(140, 'deneb', 120, null)], next: null })),
  });
  renderAt('/clasificacion?temporada=season-1', screens);
  await user.click(await screen.findByRole('button', { name: t.past.more }));
  const table = screen.getByRole('table', { name: t.leaderboard });
  await waitFor(() => expect(within(table).getAllByRole('row').slice(1)).toHaveLength(4));
  expect(fetch.mock.calls.map(([url]) => url)).toContain('/galaxy/api/seasons/season-1/results?offset=5');
  expect(screen.queryByRole('button', { name: t.past.more })).toBeNull();
  // Now in the table, your row is marked there and no longer pinned.
  expect(table.querySelector('tr[aria-current="true"]')).toHaveTextContent('deneb');
  expect(screen.queryByRole('region', { name: t.yourRow })).toBeNull();
});

test('una temporada en la que no puntuaste lo dice, y una sin números guardados también', async () => {
  api(player, { 'GET /galaxy/api/seasons/season-0/results': () => jsonResponse(200, results({ season: { ...T0, tiers: [], closing: null }, rows: ROWS.slice(0, 2), me: null, total: 2 })) });
  renderAt('/clasificacion?temporada=season-0', screens);
  const card = await screen.findByRole('region', { name: 'Temporada cero' });
  expect(card).toHaveTextContent(t.past.notPlayed);
  expect(card).not.toHaveTextContent(t.past.prizesTitle);
  expect(screen.getByRole('region', { name: t.past.statsTitle })).toHaveTextContent(t.past.noStats);
});

test('un admin ve de antemano la clasificación de una temporada que viene, sin nadie, y vuelve al panel', async () => {
  const T3 = { id: 'season-3', name: 'Temporada 3', startsAt: '2026-12-20T23:00:00.000Z', endsAt: '2027-01-17T23:00:00.000Z', tiers, closing };
  const fetch = api(admin, { 'GET /galaxy/api/leaderboard?tab=general&season=season-3': () => jsonResponse(200, { season: T3, tab: 'general', rows: [], me: null, total: 0 }) });
  renderAt('/clasificacion?temporada=season-3', screens);
  expect(await screen.findByText(p.starts('Temporada 3', '21 dic 2026'))).toBeInTheDocument();
  expect(screen.getByText(p.boardHint)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: p.back })).toHaveAttribute('href', '/admin/temporadas');
  expect(screen.queryByRole('table')).toBeNull();
  const card = screen.getByRole('region', { name: 'Temporada 3' });
  // As it will open: its days instead of a countdown, and its route and shop seen as a player.
  expect(card).toHaveTextContent(t.span('21 dic', '17 ene 2027'));
  expect(within(card).getByRole('link', { name: t.seeRoute })).toHaveAttribute('href', '/temporada?vista=season-3');
  expect(screen.getByRole('combobox', { name: t.seasonPick })).toHaveTextContent('Temporada 3');
  expect(fetch.mock.calls.map(([url]) => url)).toContain('/galaxy/api/leaderboard?tab=general&season=season-3');
});

test('un jugador con otra temporada en la dirección ve la actual, sin vista previa', async () => {
  const fetch = api(player);
  renderAt('/clasificacion?temporada=season-3', screens);
  expect(await screen.findByRole('heading', { level: 2, name: 'Temporada 2' })).toBeInTheDocument();
  expect(screen.queryByText(/Vista previa/)).toBeNull();
  expect(fetch.mock.calls.some(([url]) => String(url).includes('season=season-3'))).toBe(false);
});

describe('la tienda de temporada en vista previa', () => {
  const r = (x: object) => ({ coins: 0, dust: 0, signal: 0, shards: 0, title: null, frame: null, avatar: null, skin: null, ...x });
  // A step reached and an item paid for anyway: the preview must lock them on its own.
  const view: SeasonView = {
    season: { id: 'season-3', name: 'Temporada 3', startsAt: '2026-12-20T23:00:00.000Z', endsAt: '2027-01-17T23:00:00.000Z', tiers },
    score: 600,
    tier: 'bronze',
    currency: { name: 'Chispas', balance: 5000 },
    steps: [
      { at: 100, reward: r({ coins: 300 }), reached: true, claimed: false },
      { at: 500, reward: r({ dust: 400 }), reached: true, claimed: false },
    ],
    shop: [{ id: 'dust-bag', name: 'Saco de polvo estelar', price: 40, limit: 10, bought: 0, reward: r({ dust: 500 }) }],
    closing: { season: 'season-1', name: 'Temporada 1', endsAt: '2026-11-22T23:00:00.000Z', rank: 3, score: 9000, tier: 'gold', podium: true, rewards: [r({ coins: 3000 })], claimed: false },
  };

  test('un admin la ve como la verá un jugador, con su franja, sin nada que pulsar y con la vuelta al panel', async () => {
    const user = userEvent.setup();
    const fetch = mockApi({
      'GET /galaxy/api/auth/me': () => jsonResponse(200, admin),
      'GET /galaxy/api/season?preview=season-3': () => jsonResponse(200, view),
      'GET /galaxy/api/gacha': () => jsonResponse(500, { error: 'internal' }),
    });
    renderAt('/temporada?vista=season-3', { '/temporada': <SeasonScreen /> });
    expect(await screen.findByText(p.starts('Temporada 3', '21 dic 2026'))).toBeInTheDocument();
    expect(screen.getByText(p.shopHint)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: p.back })).toHaveAttribute('href', '/admin/temporadas');
    for (const b of [copy.season.claimOf(100), copy.season.claimOf(500), copy.missions.claimAll(2), copy.season.buyOf('Saco de polvo estelar', 40, 'Chispas')]) {
      expect(screen.getByRole('button', { name: b })).toBeDisabled();
    }
    await user.click(screen.getByRole('button', { name: copy.season.buyOf('Saco de polvo estelar', 40, 'Chispas') }));
    // No closing prizes of the admin's own, no countdown, and nothing ever sent.
    expect(screen.queryByRole('button', { name: copy.season.closingClaim })).toBeNull();
    expect(document.querySelector('.season-left')).toBeNull();
    expect(fetch.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
    expect(fx.burst).not.toHaveBeenCalled();
  });

  test('una temporada ya acabada o abierta lo dice en su franja', async () => {
    mockApi({
      'GET /galaxy/api/auth/me': () => jsonResponse(200, admin),
      'GET /galaxy/api/season?preview=season-1': () => jsonResponse(200, { ...view, season: { ...view.season!, id: 'season-1', name: 'Temporada 1', startsAt: '2026-10-01T22:00:00.000Z', endsAt: '2026-10-31T23:00:00.000Z' } }),
      'GET /galaxy/api/gacha': () => jsonResponse(500, { error: 'internal' }),
    });
    const v = renderAt('/temporada?vista=season-1', { '/temporada': <SeasonScreen /> });
    expect(await screen.findByText(p.ended('Temporada 1', '31 oct 2026'))).toBeInTheDocument();
    v.unmount();
    mockApi({
      'GET /galaxy/api/auth/me': () => jsonResponse(200, admin),
      'GET /galaxy/api/season?preview=season-2': () => jsonResponse(200, { ...view, season: { ...view.season!, id: 'season-2', name: 'Temporada 2', startsAt: new Date(Date.now() - DAY).toISOString(), endsAt: new Date(Date.now() + DAY).toISOString() } }),
      'GET /galaxy/api/gacha': () => jsonResponse(500, { error: 'internal' }),
    });
    renderAt('/temporada?vista=season-2', { '/temporada': <SeasonScreen /> });
    expect(await screen.findByText(p.open('Temporada 2'))).toBeInTheDocument();
  });

  test('un jugador con la vista en la dirección ve su temporada de siempre', async () => {
    const fetch = mockApi({
      'GET /galaxy/api/auth/me': () => jsonResponse(200, player),
      'GET /galaxy/api/season': () => jsonResponse(200, { ...view, closing: null }),
      'GET /galaxy/api/gacha': () => jsonResponse(500, { error: 'internal' }),
    });
    renderAt('/temporada?vista=season-3', { '/temporada': <SeasonScreen /> });
    expect(await screen.findByRole('button', { name: copy.season.claimOf(100) })).toBeEnabled();
    expect(screen.queryByText(/Vista previa/)).toBeNull();
    expect(fetch.mock.calls.some(([url]) => String(url).includes('preview'))).toBe(false);
  });
});

test('cada temporada del salón de la fama y de tu historial lleva a su clasificación final', async () => {
  const user = userEvent.setup();
  mockApi({
    'GET /galaxy/api/auth/me': () => jsonResponse(200, player),
    'GET /galaxy/api/hall-of-fame': () => jsonResponse(200, { seasons: [{ season: 'season-1', name: 'Temporada 1', endsAt: T1.endsAt, players: 412, podium: [{ username: 'vega', rank: 1, score: 31000 }] }] }),
    'GET /galaxy/api/profiles/deneb/seasons': () => jsonResponse(200, { seasons: [{ season: 'season-1', name: 'Temporada 1', endsAt: T1.endsAt, rank: 140, score: 120, tier: null, podium: false }] }),
  });
  renderAt('/trofeos', { '/trofeos': <TrophiesScreen /> });
  const link = await screen.findByRole('link', { name: copy.trophies.seeResultsOf('Temporada 1') });
  expect(link).toHaveAttribute('href', '/clasificacion?temporada=season-1');
  expect(await screen.findByRole('link', { name: 'Temporada 1' })).toHaveAttribute('href', '/clasificacion?temporada=season-1');
  await user.click(link);
  expect(locationOf(screen.getByTestId('location'))).toMatchObject({ pathname: '/clasificacion', search: '?temporada=season-1' });
});
