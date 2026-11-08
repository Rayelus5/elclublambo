import type { CollectionPage, GachaView, Leaderboard, MeResponse } from '@galaxy/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { copy } from '../src/copy/es';
import { TitleScreen } from '../src/hub/TitleScreen';
import { jsonResponse, locationOf, mockApi, renderAt } from './render';

// The title screen (GDD §4): resources, the deep scan with its free-pull notice, the collection, and every section
// that does not exist yet visible but locked («En desarrollo»).
afterEach(() => vi.unstubAllGlobals());

const me: MeResponse = { id: 'a1', username: 'sonda_rayo', roles: [], mfa: false, level: 3 };
const view = (free: boolean): GachaView => ({
  banners: [
    {
      id: 'deep-scan',
      kind: 'standard',
      name: 'Escáner profundo',
      currency: 'signal',
      nextRates: [0.5, 0.28, 0.13, 0.06, 0.03],
      sinceLegendary: 0,
      untilGuarantee: 10,
      welcome: true,
    },
  ],
  costs: { coins: 100, coinsTen: 900, signals: 1 },
  freePullAvailable: free,
  wallet: { coins: 1250, dust: 40, signal: 10 },
});
const galaxy = (id: string, tier: 'legendary' | 'rare') => ({
  id,
  seed: '12345',
  tier,
  finish: 'normal' as const,
  traits: { galaxy_type: 'spiral', palette: 'andromeda_blue', phenomenon: 'pulsar' },
  name: 'Kathra',
  designation: 'GX-ABCDEF',
  featured: false,
  level: 1,
  createdAt: '2026-11-06T20:00:00Z',
});
const page: CollectionPage = {
  items: [galaxy('g1', 'legendary'), galaxy('g2', 'rare')],
  counts: { common: 3, uncommon: 1, rare: 1, epic: 0, legendary: 1 },
  fusion: { count: 5, dust: [20, 50, 120, 300] },
};

const board: Leaderboard = {
  season: { id: 'season-1', name: 'Temporada 1', startsAt: '2026-11-01T00:00:00.000Z', endsAt: new Date(Date.now() + 5 * 86_400_000 + 3_600_000).toISOString(), tiers: [500, 2000, 6000, 15000, 30000] },
  tab: 'general',
  rows: [
    { rank: 1, username: 'vega', level: 12, value: 9000 },
    { rank: 2, username: 'lyra', level: 8, value: 4100 },
    { rank: 3, username: 'deneb', level: 6, value: 2400 },
    { rank: 4, username: 'rigel', level: 4, value: 900 },
  ],
  me: { rank: 9, username: 'sonda_rayo', level: 3, value: 640 },
  total: 40,
};

function api(free = true, season: Leaderboard = board) {
  return mockApi({
    'GET /galaxy/api/gacha': () => jsonResponse(200, view(free)),
    'GET /galaxy/api/galaxies?sort=rarity&limit=6': () => jsonResponse(200, page),
    'GET /galaxy/api/leaderboard?tab=general': () => jsonResponse(200, season),
    'POST /galaxy/api/auth/logout': () => jsonResponse(204),
  });
}

test('la barra superior muestra polvo, monedas y señales con su número accesible', async () => {
  api();
  renderAt('/', { '/': <TitleScreen me={me} /> });
  expect(await screen.findByLabelText(copy.hub.resource.coins(1250))).toBeInTheDocument();
  expect(screen.getByLabelText(copy.hub.resource.dust(40))).toBeInTheDocument();
  expect(screen.getByLabelText(copy.hub.resource.signal(10))).toBeInTheDocument();
  expect(screen.getByText('sonda_rayo')).toBeInTheDocument();
});

test('el escáner avisa de la tirada gratis solo cuando toca', async () => {
  api(true);
  const { unmount } = renderAt('/', { '/': <TitleScreen me={me} /> });
  const scanner = await screen.findByRole('link', { name: new RegExp(copy.hub.scanner) });
  expect(await within(scanner).findByText(copy.hub.freePull)).toBeInTheDocument();
  unmount();
  vi.unstubAllGlobals();
  api(false);
  renderAt('/', { '/': <TitleScreen me={me} /> });
  await screen.findByLabelText(copy.hub.resource.coins(1250));
  expect(screen.queryByText(copy.hub.freePull)).not.toBeInTheDocument();
});

test('lo que aún no existe se ve bloqueado con «En desarrollo»', async () => {
  api();
  renderAt('/', { '/': <TitleScreen me={me} /> });
  await screen.findByLabelText(copy.hub.resource.coins(1250));
  for (const name of [copy.hub.market, copy.hub.probes, copy.hub.codex]) {
    const button = screen.getByRole('button', { name: new RegExp(name) });
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent(copy.hub.soon);
  }
});

test('la colección muestra cuántas galaxias tienes y lleva a /coleccion', async () => {
  api();
  renderAt('/', { '/': <TitleScreen me={me} /> });
  const tile = await screen.findByRole('link', { name: new RegExp(copy.hub.collection) });
  expect(await within(tile).findByText(copy.hub.galaxies(6))).toBeInTheDocument();
  await userEvent.setup().click(tile);
  expect(locationOf(await screen.findByTestId('location')).pathname).toBe('/coleccion');
});

test('Salir cierra la sesión y vuelve a Entrar', async () => {
  const fetch = api();
  renderAt('/', { '/': <TitleScreen me={me} /> });
  await userEvent.setup().click(await screen.findByRole('button', { name: copy.hub.logout }));
  expect(locationOf(await screen.findByTestId('location')).pathname).toBe('/entrar');
  expect(fetch.mock.calls.some(([url, init]) => url === '/galaxy/api/auth/logout' && init?.method === 'POST')).toBe(true);
});

test('el Hogar lleva a la estación (M4a)', async () => {
  api();
  renderAt('/', { '/': <TitleScreen me={me} /> });
  await screen.findByLabelText(copy.hub.resource.coins(1250));
  const link = screen.getByRole('link', { name: new RegExp(copy.hub.home) });
  expect(link).toHaveAttribute('href', '/estacion');
  expect(link).not.toHaveTextContent(copy.hub.soon);
});

test('Jugar y Supervivencia llevan al hangar de las incursiones', async () => {
  api();
  renderAt('/', { '/': <TitleScreen me={me} /> });
  await screen.findByLabelText(copy.hub.resource.coins(1250));
  for (const name of [copy.hub.play, copy.hub.survival]) {
    const link = screen.getByRole('link', { name: new RegExp(name) });
    expect(link).toHaveAttribute('href', '/incursion');
    expect(link).not.toHaveTextContent(copy.hub.soon);
  }
});

test('la columna derecha es la temporada: los tres primeros, tu puesto, tu tramo y la clasificación completa (M5a)', async () => {
  api();
  renderAt('/', { '/': <TitleScreen me={me} /> });
  const season = await screen.findByRole('complementary', { name: 'Temporada 1' });
  const top = await within(season).findByRole('list', { name: copy.social.podium });
  expect(within(top).getAllByRole('listitem')).toHaveLength(3);
  expect(within(top).getByRole('link', { name: /vega/ })).toHaveAttribute('href', '/perfil/vega');
  expect(season).toHaveTextContent(copy.social.endsIn(5));
  const mine = within(season).getByRole('region', { name: copy.social.yourRow });
  expect(mine).toHaveTextContent('9');
  expect(mine).toHaveTextContent(copy.social.value.general(640));
  expect(mine).toHaveTextContent(copy.social.tier.bronze);
  expect(mine).toHaveTextContent(copy.social.toNext(1360, copy.social.tier.silver));
  expect(within(season).getByRole('link', { name: copy.social.seeAll })).toHaveAttribute('href', '/clasificacion');
});

test('sin temporada abierta la columna lo dice', async () => {
  api(true, { season: null, tab: 'general', rows: [], me: null, total: 0 });
  renderAt('/', { '/': <TitleScreen me={me} /> });
  expect(await screen.findByText(copy.errors.season_closed)).toBeInTheDocument();
});

test('el mosaico Ranking lleva a la clasificación y tu avatar a tu perfil con tu nivel (M5a)', async () => {
  api();
  renderAt('/', { '/': <TitleScreen me={me} /> });
  await screen.findByLabelText(copy.hub.resource.coins(1250));
  const ranking = screen.getByRole('link', { name: new RegExp(copy.hub.ranking) });
  expect(ranking).toHaveAttribute('href', '/clasificacion');
  expect(ranking).not.toHaveTextContent(copy.hub.soon);
  // Its name keeps what it shows, the username and the level (M5a review: label in name).
  const profile = screen.getByRole('link', { name: /sonda_rayo.*Nivel 3.*tu perfil/ });
  expect(profile).toHaveAttribute('href', '/perfil/sonda_rayo');
  expect(profile).toHaveTextContent(copy.social.level(3));
});

test('si la temporada no llega, la columna lo dice en vez de quedarse cargando (revisión M5a)', async () => {
  mockApi({
    'GET /galaxy/api/gacha': () => jsonResponse(200, view(true)),
    'GET /galaxy/api/galaxies?sort=rarity&limit=6': () => jsonResponse(200, page),
    'GET /galaxy/api/leaderboard?tab=general': () => jsonResponse(500, { error: 'internal' }),
  });
  renderAt('/', { '/': <TitleScreen me={me} /> });
  expect(await screen.findByText(copy.errors.internal, {}, { timeout: 4000 })).toBeInTheDocument();
});

test('el mosaico Clan lleva a los clanes (M5b-1)', async () => {
  api();
  renderAt('/', { '/': <TitleScreen me={me} /> });
  await screen.findByLabelText(copy.hub.resource.coins(1250));
  const clan = screen.getByRole('link', { name: new RegExp(copy.hub.clan) });
  expect(clan).toHaveAttribute('href', '/clanes');
  expect(clan).not.toHaveTextContent(copy.hub.soon);
});
