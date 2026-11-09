import type { AdminStats, MeResponse } from '@galaxy/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { AdminLayout } from '../src/admin/AdminLayout';
import { StatsScreen } from '../src/admin/StatsScreen';
import { copy } from '../src/copy/es';
import { jsonResponse, mockApi, renderAt } from './render';

// Live statistics in the panel (GDD §16.6; M6d-2), admins only: the period, the tiles, runs as a bar chart (each bar
// named with its number, and a table), each currency's flows, rarities real against expected, the market, and a CSV per
// section.
afterEach(() => vi.unstubAllGlobals());

const t = copy.admin.stats;
const admin: MeResponse = { id: 'ad1', username: 'rayelus', roles: ['superadmin'], mfa: true, level: 30 };
const stats = (over: Partial<AdminStats> = {}): AdminStats => ({
  period: '24h',
  from: '2026-11-07T14:00:00.000Z',
  to: '2026-11-08T14:00:00.000Z',
  players: { online: 3, sockets: 5, newAccounts: 12, activeAccounts: 40 },
  runs: { buckets: Array.from({ length: 24 }, (_, i) => ({ at: new Date(Date.UTC(2026, 10, 7, 15 + i)).toISOString(), count: i === 23 ? 7 : 0 })), outcomes: { extracted: 4, died: 2, abandoned: 1, open: 0, unfinished: 9 } },
  currencies: [{ currency: 'coins', in: 1_500_000, out: 20_000, byReason: [{ reason: 'run_payout', in: 1_500_000, out: 0 }, { reason: 'gacha_pull', in: 0, out: 20_000 }] }],
  pulls: { total: 50, tiers: [40, 6, 3, 1, 0].map((count, tier) => ({ tier, count, expected: [0.6, 0.25, 0.1, 0.04, 0.01][tier]! })) },
  market: { listed: 9, sold: 4, coins: 12_000, commission: 840, tradesDone: 2, tradesCancelled: 1 },
  groups: { runs: 8, players: 22, extracted: 3, died: 5, interrupted: 0, avgDepth: 2.4, abandons: 4, idle: 1 },
  pending: { alerts: 2, reports: 3 },
  ...over,
});
const A = '/galaxy/api/admin/stats';

test('la barra lateral lleva a Estadísticas', async () => {
  mockApi({ 'GET /galaxy/api/auth/me': () => jsonResponse(200, admin) });
  renderAt('/admin', { '/admin': <AdminLayout /> });
  const nav = await screen.findByRole('navigation', { name: copy.admin.nav });
  expect(within(nav).getByRole('link', { name: copy.admin.sections.stats })).toHaveAttribute('href', '/admin/estadisticas');
});

test('las cifras de arriba, y el periodo cambia la consulta', async () => {
  const fetch = mockApi({
    'GET /galaxy/api/auth/me': () => jsonResponse(200, admin),
    [`GET ${A}?period=24h`]: () => jsonResponse(200, stats()),
    [`GET ${A}?period=7d`]: () => jsonResponse(200, stats({ period: '7d', runs: { buckets: [], outcomes: { extracted: 0, died: 0, abandoned: 0, open: 0, unfinished: 0 } } })),
  });
  renderAt('/admin/estadisticas', { '/admin/estadisticas': <StatsScreen /> });
  const online = await screen.findByRole('group', { name: t.tiles.online });
  expect(within(online).getByText('3')).toBeInTheDocument();
  expect(within(screen.getByRole('group', { name: t.tiles.pending })).getByText('5')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: t.periods['7d'] }));
  await waitFor(() => expect(fetch.mock.calls.some(([u]) => u === `${A}?period=7d`)).toBe(true));
});

test('las partidas en grupo: cuántas, jugadores por partida, cómo acabaron, la capa media, abandonos e inactivos (fase 7)', async () => {
  mockApi({ 'GET /galaxy/api/auth/me': () => jsonResponse(200, admin), [`GET ${A}?period=24h`]: () => jsonResponse(200, stats()) });
  renderAt('/admin/estadisticas', { '/admin/estadisticas': <StatsScreen /> });
  const section = await screen.findByRole('region', { name: t.groupsTitle });
  expect(section).toHaveTextContent(t.groups.runs);
  expect(section).toHaveTextContent('2,8');
  expect(section).toHaveTextContent('2,4');
  expect(within(section).getByText(t.groups.abandons)).toBeInTheDocument();
  expect(within(section).getByRole('link', { name: t.csv })).toHaveAttribute('href', `${A}.csv?period=24h&section=groups`);
});

test('las partidas son barras con su número y una tabla, y salen cómo terminaron', async () => {
  mockApi({ 'GET /galaxy/api/auth/me': () => jsonResponse(200, admin), [`GET ${A}?period=24h`]: () => jsonResponse(200, stats()) });
  renderAt('/admin/estadisticas', { '/admin/estadisticas': <StatsScreen /> });
  const chart = await screen.findByRole('img', { name: t.runsChart });
  expect(chart.querySelectorAll('[data-bar]')).toHaveLength(24);
  expect(screen.getByRole('table', { name: t.runsTable })).toBeInTheDocument();
  expect(screen.getByText(t.outcomes.extracted(4))).toBeInTheDocument();
  expect(screen.getByText(t.outcomes.unfinished(9))).toBeInTheDocument();
});

test('las monedas dicen lo que entra y sale, con el número escrito y su desglose', async () => {
  mockApi({ 'GET /galaxy/api/auth/me': () => jsonResponse(200, admin), [`GET ${A}?period=24h`]: () => jsonResponse(200, stats()) });
  renderAt('/admin/estadisticas', { '/admin/estadisticas': <StatsScreen /> });
  const table = await screen.findByRole('table', { name: t.currenciesTitle });
  const row = within(table).getByRole('rowheader', { name: t.currency('coins') }).closest('tr')!;
  expect(within(row).getByText('1.500.000')).toBeInTheDocument();
  expect(within(row).getByText('20.000')).toBeInTheDocument();
  expect(screen.getByText('run_payout')).toBeInTheDocument();
});

test('las rarezas dicen lo real y lo esperado; sin tiradas lo dice', async () => {
  mockApi({ 'GET /galaxy/api/auth/me': () => jsonResponse(200, admin), [`GET ${A}?period=24h`]: () => jsonResponse(200, stats()) });
  const { unmount } = renderAt('/admin/estadisticas', { '/admin/estadisticas': <StatsScreen /> });
  const pulls = await screen.findByRole('table', { name: t.pullsTitle });
  const common = within(pulls).getByRole('rowheader', { name: copy.tiers.common }).closest('tr')!;
  expect(within(common).getByText('80 %')).toBeInTheDocument();
  expect(within(common).getByText('60 %')).toBeInTheDocument();
  // The welcome luck of new accounts lifts the legendaries above the standard expectation: the table says so.
  expect(screen.getByText(t.expectedNote)).toBeInTheDocument();
  unmount();
  mockApi({ 'GET /galaxy/api/auth/me': () => jsonResponse(200, admin), [`GET ${A}?period=24h`]: () => jsonResponse(200, stats({ pulls: { total: 0, tiers: [0, 1, 2, 3, 4].map((tier) => ({ tier, count: 0, expected: 0.2 })) } })) });
  renderAt('/admin/estadisticas', { '/admin/estadisticas': <StatsScreen /> });
  expect(await screen.findByText(t.noPulls)).toBeInTheDocument();
});

test('cada sección se exporta a CSV con el periodo elegido', async () => {
  mockApi({ 'GET /galaxy/api/auth/me': () => jsonResponse(200, admin), [`GET ${A}?period=24h`]: () => jsonResponse(200, stats()) });
  renderAt('/admin/estadisticas', { '/admin/estadisticas': <StatsScreen /> });
  await screen.findByRole('img', { name: t.runsChart });
  const links = screen.getAllByRole('link', { name: t.csv });
  expect(links.map((l) => l.getAttribute('href'))).toEqual(['runs', 'currencies', 'pulls', 'market', 'groups'].map((s) => `/galaxy/api/admin/stats.csv?period=24h&section=${s}`));
});
