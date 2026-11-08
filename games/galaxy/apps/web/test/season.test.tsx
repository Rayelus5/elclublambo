import type { SeasonView } from '@galaxy/shared';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { copy } from '../src/copy/es';
import { SeasonScreen } from '../src/season/SeasonScreen';
import { jsonResponse, mockApi, renderAt } from './render';

// The season route and shop (GDD §13.1; M7d-1).
afterEach(() => vi.unstubAllGlobals());

const r = (x: object) => ({ coins: 0, dust: 0, signal: 0, shards: 0, title: null, frame: null, ...x });
const view: SeasonView = {
  season: { id: 'season-1', name: 'Temporada 1', endsAt: new Date(Date.now() + 10 * 86_400_000).toISOString(), tiers: [500, 2000, 6000, 15000, 30000] },
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
  expect(screen.getByRole('button', { name: copy.season.claimOf(800) })).toBeDisabled();
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
