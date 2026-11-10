import type { MissionsView } from '@galaxy/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { MissionsButton, MissionsScreen } from '../src/missions/MissionsScreen';
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
  events: [],
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

const r = (x: object) => ({ coins: 0, dust: 0, signal: 0, xp: 0, points: 0, eventSignals: 0, ...x });
const withEvent: MissionsView = {
  ...view,
  events: [
    {
      id: 'cometas',
      name: 'Lluvia de cometas',
      description: 'Escanea el cielo mientras pasan los cometas',
      endsAt: '2026-11-15T22:00:00.000Z',
      period: 'e:cometas',
      inClan: false,
      goals: [
        { id: 'scan', name: 'Haz 10 tiradas', stat: 'pulls', target: 10, scope: 'personal', progress: 10, claimed: false, reward: r({ eventSignals: 3 }) },
        { id: 'together', name: 'Entre todo el clan, 15 tiradas', stat: 'pulls', target: 15, scope: 'clan', progress: 0, claimed: false, reward: r({ coins: 500 }) },
      ],
    },
  ],
};

test('la pestaña del evento dice cuántas señales de evento tienes y lleva a gastarlas en el escáner de evento', async () => {
  mockApi({
    'GET /galaxy/api/missions': () => jsonResponse(200, withEvent),
    'GET /galaxy/api/gacha': () => jsonResponse(200, { banners: [], costs: { coins: 100, coinsTen: 900, signals: 1 }, freePullAvailable: false, wallet: { coins: 0, dust: 0, signal: 0, 'signal:cometas': 3 } }),
  });
  renderAt('/misiones', { '/misiones': <MissionsScreen /> });
  await userEvent.click(await screen.findByRole('tab', { name: t.tabs.events }));
  const event = (await screen.findByRole('heading', { name: 'Lluvia de cometas' })).closest('section, article, li')!;
  expect(await within(event as HTMLElement).findByText(t.eventWallet(3))).toBeInTheDocument();
  expect(within(event as HTMLElement).getByRole('link', { name: t.useEventScanner })).toHaveAttribute('href', '/escaner?tipo=evento');
});

test('la pestaña del evento enseña sus metas: la personal se recoge y la de clan pide un clan (M7e-1)', async () => {
  const fetch = mockApi({ 'GET /galaxy/api/missions': () => jsonResponse(200, withEvent), 'POST /galaxy/api/missions/e:cometas/scan/claim': () => jsonResponse(200, withEvent) });
  renderAt('/misiones', { '/misiones': <MissionsScreen /> });
  await userEvent.click(await screen.findByRole('tab', { name: t.tabs.events }));
  expect(await screen.findByRole('heading', { name: 'Lluvia de cometas' })).toBeInTheDocument();
  expect(screen.getByText(t.reward.eventSignals(3))).toBeInTheDocument();
  expect(screen.getByText(t.clanNeeded)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: t.claimOf('Entre todo el clan, 15 tiradas') })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: t.claimOf('Haz 10 tiradas') }));
  await waitFor(() => expect(fetch.mock.calls.some(([url]) => url === '/galaxy/api/missions/e:cometas/scan/claim')).toBe(true));
});

test('sin eventos no hay pestaña de evento (M7e-1)', async () => {
  mockApi({ 'GET /galaxy/api/missions': () => jsonResponse(200, view) });
  renderAt('/misiones', { '/misiones': <MissionsScreen /> });
  await screen.findByRole('tab', { name: t.tabs.daily });
  expect(screen.queryByRole('tab', { name: t.tabs.events })).toBeNull();
});

// Collecting is easy to find and feels good (open beta): how many wait in each tab, the screen opening where they are,
// «Recoger todo», and what was collected said once.
const m = (id: string, progress: number, target: number, claimed = false, reward: object = {}) => ({ id, name: `Misión ${id}`, stat: 'runs' as const, target, progress, claimed, reward: { coins: 0, dust: 0, signal: 0, xp: 0, points: 0, ...reward } });
const waiting: MissionsView = {
  ...view,
  daily: { ...view.daily, missions: [m('d1', 1, 3)] },
  weekly: { ...view.weekly, missions: [m('w1', 5, 5, false, { coins: 1500 }), m('w2', 2, 9), m('w3', 9, 9, false, { signal: 2 })] },
  ready: 3,
};

test('cada pestaña dice cuántas recompensas tiene por recoger, y la pantalla se abre en la primera que tiene', async () => {
  mockApi({ 'GET /galaxy/api/missions': () => jsonResponse(200, waiting) });
  renderAt('/misiones', { '/misiones': <MissionsScreen /> });
  const weekly = await screen.findByRole('tab', { name: t.tabs.weekly });
  await waitFor(() => expect(weekly).toHaveAttribute('aria-selected', 'true'));
  expect(weekly).toHaveAccessibleDescription(t.readyCount(2));
  expect(screen.getByRole('tab', { name: t.tabs.achievements })).toHaveAccessibleDescription(t.readyCount(1));
  expect(screen.getByRole('tab', { name: t.tabs.daily })).not.toHaveAccessibleDescription();
});

test('Recoger todo recoge solo las listas, en orden, y dice lo que se ha recogido', async () => {
  const fetch = mockApi({
    'GET /galaxy/api/missions': () => jsonResponse(200, waiting),
    'POST /galaxy/api/missions/w:2026-W45/w1/claim': () => jsonResponse(200, { ...waiting, weekly: { ...waiting.weekly, missions: [m('w1', 5, 5, true, { coins: 1500 }), m('w2', 2, 9), m('w3', 9, 9, false, { signal: 2 })] }, ready: 2 }),
    'POST /galaxy/api/missions/w:2026-W45/w3/claim': () => jsonResponse(200, { ...waiting, weekly: { ...waiting.weekly, missions: [m('w1', 5, 5, true, { coins: 1500 }), m('w2', 2, 9), m('w3', 9, 9, true, { signal: 2 })] }, ready: 1 }),
  });
  renderAt('/misiones?pestana=semanales', { '/misiones': <MissionsScreen /> });
  await userEvent.click(await screen.findByRole('button', { name: t.claimAll(2) }));
  const posts = () => fetch.mock.calls.filter(([, init]) => init?.method === 'POST').map(([u]) => u);
  await waitFor(() => expect(posts()).toEqual(['/galaxy/api/missions/w:2026-W45/w1/claim', '/galaxy/api/missions/w:2026-W45/w3/claim']));
  expect(await screen.findByText(t.gained(`${t.reward.coins(1500)} y ${t.reward.signal(2)}`))).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Recoger todo/ })).not.toBeInTheDocument();
});

test('el botón de misiones dice dónde hay recompensas por recoger', async () => {
  mockApi({ 'GET /galaxy/api/missions': () => jsonResponse(200, waiting) });
  renderAt('/', { '/': <MissionsButton /> });
  expect(await screen.findByRole('link', { name: t.readyLabel({ daily: 0, weekly: 2, season: 0, events: 0, achievements: 1 }) })).toHaveAttribute('href', '/misiones');
  expect(t.readyLabel({ daily: 0, weekly: 2, season: 0, events: 0, achievements: 1 })).toBe('Misiones: 2 semanales y 1 logro por recoger');
});
