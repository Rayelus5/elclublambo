import type { SeasonView } from '@galaxy/shared';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { copy, fmt } from '../src/copy/es';
import { SeasonScreen } from '../src/season/SeasonScreen';
import { TrophiesScreen } from '../src/season/TrophiesScreen';
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

test('al cerrar una temporada enseña el puesto y sus premios para recogerlos una vez (M7d-2)', async () => {
  const closing = { season: 'season-0', name: 'Temporada 0', endsAt: '2026-10-31T00:00:00.000Z', rank: 2, score: 7000, tier: 'gold' as const, podium: true, rewards: [r({ coins: 3000 }), r({ title: 'Podio de temporada', frame: 'crown' })], claimed: false };
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
