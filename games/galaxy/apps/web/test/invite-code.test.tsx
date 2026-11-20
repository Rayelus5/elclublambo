import type { MyReferrals, Profile } from '@galaxy/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { copy } from '../src/copy/es';
import { ProfileScreen } from '../src/social/ProfileScreen';
import { jsonResponse, mockApi, renderAt } from './render';

// «Tu código de invitación» (plan «referidos», part R2): on the player's own profile, only when they own a code: the
// code with buttons to copy it and its link, how many came in, are waiting for the level or were rewarded, and what
// both get (the server's numbers, never the copy's). Nothing on anyone else's profile, nothing without a code.

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const t = copy.invite;

const profile = (username: string): Profile => ({
  username,
  since: '2026-11-03T10:00:00.000Z',
  level: 12,
  season: null,
  records: { maxDepth: 9, purges: 12, runs: 40 },
  collection: { total: 0, counts: { common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 0, mythic: 0 } },
  planetarium: { prestige: 0, exhibits: 0, cover: null },
  clan: null,
});
const mine: MyReferrals = {
  codes: [{ code: 'VEGA-7K2P', enabled: true, uses: 4, maxUses: 20, expiresAt: null }],
  joined: 4,
  waiting: 3,
  rewarded: 1,
  activationLevel: 9,
  ownerGifts: { coins: 321, signal: 2 },
  newcomerGifts: { dust: 75 },
};
const screens = { '/perfil/:username': <ProfileScreen /> };
const me = () => jsonResponse(200, { id: 'a1', username: 'vega', roles: [], mfa: false });

test('en mi perfil, con un código, enseño el código, cuántos entraron y qué recibimos los dos', async () => {
  mockApi({
    'GET /galaxy/api/auth/me': me,
    'GET /galaxy/api/profiles/vega': () => jsonResponse(200, profile('vega')),
    'GET /galaxy/api/referrals/mine': () => jsonResponse(200, mine),
  });
  const user = userEvent.setup();
  const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  renderAt('/perfil/vega', screens);
  const panel = await screen.findByRole('region', { name: t.title(1) });
  expect(panel).toHaveTextContent('VEGA-7K2P');
  expect(panel).toHaveTextContent(t.uses(4, 20));
  const facts = within(panel).getAllByRole('definition').map((d) => d.textContent);
  expect(facts).toEqual(['4', '3', '1']);
  expect(panel).toHaveTextContent(t.newcomerGets('75 de polvo estelar'));
  expect(panel).toHaveTextContent(t.youGet(9, '321 monedas y 2 señales de galaxia'));

  await user.click(within(panel).getByRole('button', { name: t.copyCodeOf('VEGA-7K2P') }));
  expect(write).toHaveBeenLastCalledWith('VEGA-7K2P');
  await user.click(within(panel).getByRole('button', { name: t.copyLinkOf('VEGA-7K2P') }));
  expect(write).toHaveBeenLastCalledWith(`${window.location.origin}/galaxy/crear-cuenta?ref=VEGA-7K2P`);
});

test('un código apagado lo dice y no se ofrece para copiar', async () => {
  mockApi({
    'GET /galaxy/api/auth/me': me,
    'GET /galaxy/api/profiles/vega': () => jsonResponse(200, profile('vega')),
    'GET /galaxy/api/referrals/mine': () => jsonResponse(200, { ...mine, codes: [{ ...mine.codes[0]!, enabled: false }] }),
  });
  renderAt('/perfil/vega', screens);
  const panel = await screen.findByRole('region', { name: t.title(1) });
  expect(panel).toHaveTextContent(t.states.off);
  expect(panel).toHaveTextContent(t.unusable);
  expect(within(panel).queryByRole('button', { name: t.copyCodeOf('VEGA-7K2P') })).toBeNull();
});

test('sin ningún código no aparece nada', async () => {
  const fetch = mockApi({
    'GET /galaxy/api/auth/me': me,
    'GET /galaxy/api/profiles/vega': () => jsonResponse(200, profile('vega')),
    'GET /galaxy/api/referrals/mine': () => jsonResponse(200, { ...mine, codes: [], joined: 0, waiting: 0, rewarded: 0 }),
  });
  renderAt('/perfil/vega', screens);
  await screen.findByRole('heading', { level: 1, name: 'vega' });
  await waitFor(() => expect(fetch.mock.calls.some(([u]) => u === '/galaxy/api/referrals/mine')).toBe(true));
  expect(screen.queryByRole('region', { name: t.title(1) })).toBeNull();
  expect(screen.queryByText('VEGA-7K2P')).toBeNull();
});

test('en el perfil de otro ni se pregunta', async () => {
  const fetch = mockApi({
    'GET /galaxy/api/auth/me': me,
    'GET /galaxy/api/profiles/orion': () => jsonResponse(200, profile('orion')),
  });
  renderAt('/perfil/orion', screens);
  await screen.findByRole('heading', { level: 1, name: 'orion' });
  await waitFor(() => expect(fetch.mock.calls.some(([u]) => u === '/galaxy/api/auth/me')).toBe(true));
  expect(fetch.mock.calls.some(([u]) => u === '/galaxy/api/referrals/mine')).toBe(false);
  expect(screen.queryByRole('region', { name: t.title(1) })).toBeNull();
});
