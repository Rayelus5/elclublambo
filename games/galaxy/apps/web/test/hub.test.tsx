import type { CollectionPage, GachaView, MeResponse } from '@galaxy/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { copy } from '../src/copy/es';
import { TitleScreen } from '../src/hub/TitleScreen';
import { jsonResponse, locationOf, mockApi, renderAt } from './render';

// The title screen (GDD §4): resources, the deep scan with its free-pull notice, the collection, and every section
// that does not exist yet visible but locked («En desarrollo»).
afterEach(() => vi.unstubAllGlobals());

const me: MeResponse = { id: 'a1', username: 'sonda_rayo', roles: [], mfa: false };
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

function api(free = true) {
  return mockApi({
    'GET /galaxy/api/gacha': () => jsonResponse(200, view(free)),
    'GET /galaxy/api/galaxies?sort=rarity&limit=6': () => jsonResponse(200, page),
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
  for (const name of [copy.hub.home, copy.hub.market, copy.hub.probes, copy.hub.codex]) {
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
  expect(screen.getByRole('complementary', { name: copy.hub.summaryTitle })).toHaveTextContent('Kathra');
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
