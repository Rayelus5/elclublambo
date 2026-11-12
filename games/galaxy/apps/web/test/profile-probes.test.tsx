import type { Profile } from '@galaxy/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { copy } from '../src/copy/es';
import { ProfileScreen } from '../src/social/ProfileScreen';
import { jsonResponse, mockApi, renderAt } from './render';

// Plan «banda sonora, skins, perfil y entorno», part D: «Sondas» on a profile. The showcase the owner chose, with each
// probe's level and weapon, and every probe they have below; on my own profile, «Elegir sondas» picks up to three.
afterEach(() => vi.unstubAllGlobals());

const t = copy.social.probes;
const probes: NonNullable<Profile['probes']> = {
  showcase: [{ id: 'lumen', level: 4, skin: 'skin-lumen-coral', variant: 'pulse-twin' }],
  all: [
    { id: 'lumen', level: 4, skin: 'skin-lumen-coral', variant: 'pulse-twin' },
    { id: 'bastion', level: 2, skin: null, variant: null },
    { id: 'spark', level: 1, skin: null, variant: null },
    { id: 'prism', level: 1, skin: null, variant: null },
  ],
};
const profile = (over: Partial<Profile> = {}): Profile => ({
  username: 'vega',
  since: '2026-11-03T10:00:00.000Z',
  level: 7,
  season: null,
  records: { maxDepth: 9, purges: 12, runs: 40 },
  collection: { total: 0, counts: { common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 0 } },
  planetarium: { prestige: 0, exhibits: 0, cover: null },
  clan: null,
  probes,
  ...over,
});
const screens = { '/perfil/:username': <ProfileScreen /> };

test('el perfil de otro enseña su escaparate con nivel y arma, y todas sus sondas debajo; sin botón para elegir', async () => {
  mockApi({ 'GET /galaxy/api/profiles/vega': () => jsonResponse(200, profile()) });
  renderAt('/perfil/vega', screens);
  const showcase = await screen.findByRole('list', { name: t.showcase });
  const item = within(showcase).getByRole('listitem');
  expect(item).toHaveTextContent('Lumen');
  expect(item).toHaveTextContent(t.level(4));
  expect(item).toHaveTextContent('Pulso doble');
  expect(within(screen.getByRole('list', { name: t.all })).getAllByRole('listitem')).toHaveLength(4);
  expect(screen.queryByRole('button', { name: t.choose })).not.toBeInTheDocument();
});

test('sin escaparate lo dice', async () => {
  mockApi({ 'GET /galaxy/api/profiles/vega': () => jsonResponse(200, profile({ probes: { showcase: [], all: probes.all } })) });
  renderAt('/perfil/vega', screens);
  expect(await screen.findByText(t.empty)).toBeInTheDocument();
});

test('en mi perfil elijo hasta tres sondas, en el orden en que las marco, y se guardan', async () => {
  const fetch = mockApi({
    'GET /galaxy/api/auth/me': () => jsonResponse(200, { id: 'a1', username: 'vega', roles: [], mfa: false }),
    'GET /galaxy/api/profiles/vega': () => jsonResponse(200, profile()),
    'PUT /galaxy/api/profile/probes': (b) => jsonResponse(200, { showcase: (b as { probes: string[] }).probes.map((id) => probes.all.find((p) => p.id === id)!), all: probes.all }),
  });
  const user = userEvent.setup();
  renderAt('/perfil/vega', screens);
  await user.click(await screen.findByRole('button', { name: t.choose }));
  const dialog = await screen.findByRole('dialog', { name: t.chooserTitle });
  // Lumen is in already; two more fill it, and the fourth cannot be ticked.
  await user.click(within(dialog).getByRole('checkbox', { name: /Chispa/ }));
  await user.click(within(dialog).getByRole('checkbox', { name: /Bastión/ }));
  expect(within(dialog).getByRole('checkbox', { name: /Prisma/ })).toBeDisabled();
  expect(within(dialog).getByRole('status')).toHaveTextContent(t.count(3, 3));
  await user.click(within(dialog).getByRole('button', { name: t.save }));
  await waitFor(() => {
    const put = fetch.mock.calls.find(([u, init]) => u === '/galaxy/api/profile/probes' && init?.method === 'PUT');
    expect(JSON.parse(String(put![1]!.body))).toEqual({ probes: ['lumen', 'spark', 'bastion'] });
  });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});
