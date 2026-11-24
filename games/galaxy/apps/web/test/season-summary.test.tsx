import { DEFAULT_CLOSING_TIERS, DEFAULT_PODIUM, type Leaderboard, type SeasonResult, type SeasonView } from '@galaxy/shared';
import { screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { seasonToCollect } from '../src/api/season';
import { copy } from '../src/copy/es';
import { SeasonSummary } from '../src/social/SeasonSummary';
import { jsonResponse, mockApi, renderAt } from './render';

// «Tienda de temporada» on the home (the owner, 2026-11-24): a red dot on its top-right corner while the season has
// rewards to collect (a step of the route reached and not collected, or the closing prizes of the last season), as the
// friends' and the free pull's; its name says so too.
afterEach(() => vi.unstubAllGlobals());

const t = copy.social;
const r = (x: object) => ({ coins: 0, dust: 0, signal: 0, shards: 0, title: null, frame: null, avatar: null, skin: null, ...x });
const season = {
  id: 'season-2',
  name: 'Temporada 2',
  startsAt: '2026-11-22T23:00:00.000Z',
  endsAt: new Date(Date.now() + 10 * 86_400_000).toISOString(),
  tiers: [500, 2000, 6000, 15000, 30000],
  closing: { tiers: [...DEFAULT_CLOSING_TIERS], podium: DEFAULT_PODIUM, podiumSize: 3 },
};
const board: Leaderboard = { season, tab: 'general', rows: [{ rank: 1, username: 'vega', level: 12, value: 900, runs: 9, bestDepth: 4 }], me: { rank: 1, username: 'vega', level: 12, value: 900, runs: 9, bestDepth: 4 }, total: 1 };
const view = (over: Partial<SeasonView> = {}): SeasonView => ({
  season: { id: season.id, name: season.name, startsAt: season.startsAt, endsAt: season.endsAt, tiers: season.tiers },
  score: 900,
  tier: 'bronze',
  currency: { name: 'Esquirlas', balance: 45 },
  steps: [
    { at: 100, reward: r({ coins: 300 }), reached: true, claimed: true },
    { at: 500, reward: r({ shards: 30 }), reached: true, claimed: true },
    { at: 1200, reward: r({ dust: 400 }), reached: false, claimed: false },
  ],
  shop: [],
  closing: null,
  ...over,
});
const closing: SeasonResult = { season: 'season-1', name: 'Temporada 1', endsAt: '2026-11-22T23:00:00.000Z', rank: 4, score: 2400, tier: 'silver', podium: false, rewards: [{ ...r({ coins: 500 }), kind: 'tier', tier: 'silver' } as never], claimed: false };

test('lo que hay por recoger: los escalones alcanzados sin recoger y el premio de cierre pendiente', () => {
  expect(seasonToCollect(undefined)).toBe(0);
  expect(seasonToCollect(view())).toBe(0);
  expect(seasonToCollect(view({ steps: [...view().steps.slice(0, 1), { at: 500, reward: r({}), reached: true, claimed: false }, { at: 800, reward: r({}), reached: true, claimed: false }] }))).toBe(2);
  expect(seasonToCollect(view({ closing }))).toBe(1);
  expect(seasonToCollect(view({ closing: { ...closing, claimed: true } }))).toBe(0);
});

for (const [label, data, dot] of [
  ['con un escalón por recoger', view({ steps: [{ at: 100, reward: r({ coins: 300 }), reached: true, claimed: false }] }), true],
  ['con el premio de cierre por recoger', view({ closing }), true],
  ['sin nada por recoger', view(), false],
] as const) {
  test(`la Tienda de temporada del inicio ${label} ${dot ? 'lleva' : 'no lleva'} la bolita roja`, async () => {
    const fetch = mockApi({
      'GET /galaxy/api/leaderboard?tab=general': () => jsonResponse(200, board),
      'GET /galaxy/api/season': () => jsonResponse(200, data),
    });
    renderAt('/', { '/': <SeasonSummary /> });
    const link = await screen.findByRole('link', { name: new RegExp(`^${t.route}`) });
    await waitFor(() => expect(fetch.mock.calls.map(([url]) => url)).toContain('/galaxy/api/season'));
    if (dot) {
      await waitFor(() => expect(link.querySelector('.alert-dot')).not.toBeNull());
      expect(link).toHaveAccessibleName(t.routeReady);
      expect(link).toHaveAttribute('title', t.routeReady);
    } else {
      await new Promise((res) => setTimeout(res, 50));
      expect(link.querySelector('.alert-dot')).toBeNull();
      expect(link).toHaveAccessibleName(t.route);
    }
    expect(link).toHaveAttribute('href', '/temporada');
  });
}

test('«Beta Cerrada» en el logo: el juego es solo por invitación (el propietario, 2026-11-24)', () => {
  expect(copy.beta).toBe('Beta Cerrada');
});
