import type { MissionsView } from '@galaxy/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { MissionsScreen } from '../src/missions/MissionsScreen';
import { copy } from '../src/copy/es';
import { jsonResponse, mockApi, renderAt } from './render';

// Missions and achievements (GDD §12.3; M7a): progress, what each gives, «Recoger» once reached.
afterEach(() => vi.unstubAllGlobals());
const t = copy.missions;
const view: MissionsView = {
  daily: { period: 'd:2026-11-08', endsAt: '2026-11-08T23:00:00.000Z', missions: [
    { id: 'd-runs3', name: 'Juega 3 incursiones', stat: 'runs', target: 3, progress: 3, claimed: false, reward: { coins: 150, dust: 0, signal: 0, xp: 50, points: 10 } },
    { id: 'd-kills300', name: 'Elimina 300 enemigos', stat: 'kills', target: 300, progress: 120, claimed: false, reward: { coins: 150, dust: 20, signal: 0, xp: 0, points: 10 } },
  ] },
  weekly: { period: 'w:2026-W45', endsAt: '2026-11-09T23:00:00.000Z', missions: [] },
  season: null,
  achievements: [{ id: 'a-first-run', name: 'Primer despegue', description: 'Juega tu primera incursión', tier: 'bronze', target: 1, progress: 1, unlocked: true, claimed: false, reward: { signal: 1, points: 20, title: 'Cadete', frame: null } }],
  ready: 2,
  cosmetics: { titles: [], frames: [], title: null, frame: null },
};

test('las misiones del día con su progreso; Recoger solo en la completa, y llama a recoger', async () => {
  const fetch = mockApi({ 'GET /galaxy/api/missions': () => jsonResponse(200, view), 'POST /galaxy/api/missions/d:2026-11-08/d-runs3/claim': () => jsonResponse(200, view) });
  renderAt('/misiones', { '/misiones': <MissionsScreen /> });
  const done = await screen.findByRole('button', { name: t.claimOf('Juega 3 incursiones') });
  expect(done).toBeEnabled();
  expect(screen.getByRole('button', { name: t.claimOf('Elimina 300 enemigos') })).toBeDisabled();
  expect(screen.getByRole('progressbar', { name: 'Elimina 300 enemigos' })).toHaveAttribute('aria-valuenow', '120');
  await userEvent.click(done);
  await waitFor(() => expect(fetch.mock.calls.some(([u, init]) => u === '/galaxy/api/missions/d:2026-11-08/d-runs3/claim' && init?.method === 'POST')).toBe(true));
});

test('los logros dicen qué dan', async () => {
  mockApi({ 'GET /galaxy/api/missions': () => jsonResponse(200, view) });
  renderAt('/misiones', { '/misiones': <MissionsScreen /> });
  await userEvent.click(await screen.findByRole('tab', { name: t.tabs.achievements }));
  const card = screen.getByText('Primer despegue').closest('li')!;
  expect(within(card).getByText(/el título Cadete/)).toBeInTheDocument();
  expect(within(card).getByRole('button', { name: t.claimOf('Primer despegue') })).toBeEnabled();
});
