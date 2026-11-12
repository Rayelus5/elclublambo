import type { Leaderboard, LeaderRow } from '@galaxy/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { copy } from '../src/copy/es';
import { LeaderboardScreen } from '../src/social/LeaderboardScreen';
import { jsonResponse, mockApi, renderAt } from './render';

// The season leaderboard (GDD §14.1, §4; M5a): tabs General, Profundidad and Purgas (Clanes waits for the clans), in
// the address so they can be shared; a podium with the top three and a table with the rest, every name leading to
// its profile; your row marked, and pinned below when you are out of the top; the season with the days left and its
// tiers, yours marked.
afterEach(() => vi.unstubAllGlobals());

const t = copy.social;
const DAY = 86_400_000;
const season = { id: 'season-1', name: 'Temporada 1', startsAt: '2026-11-01T00:00:00.000Z', endsAt: new Date(Date.now() + 10 * DAY + 3_600_000).toISOString(), tiers: [500, 2000, 6000, 15000, 30000] };
const r = (rank: number, username: string, value: number, level = 3): LeaderRow => ({ rank, username, level, value });
const ROWS = [r(1, 'vega', 9000, 12), r(2, 'lyra', 4100), r(2, 'altair', 4100), r(4, 'deneb', 2400), r(5, 'rigel', 900)];
const board = (over: Partial<Leaderboard> = {}): Leaderboard => ({ season, tab: 'general', rows: ROWS, me: ROWS[3]!, total: 5, ...over });
const screens = { '/clasificacion': <LeaderboardScreen /> };

test('las pestañas son enlaces con la pestaña en la dirección, Clanes incluida (M5b-1)', async () => {
  const fetch = mockApi({
    'GET /galaxy/api/leaderboard?tab=general': () => jsonResponse(200, board()),
    'GET /galaxy/api/leaderboard?tab=depth': () => jsonResponse(200, board({ tab: 'depth', rows: [r(1, 'vega', 7), r(2, 'deneb', 5)], me: r(2, 'deneb', 5), total: 2 })),
  });
  const user = userEvent.setup();
  renderAt('/clasificacion', screens);
  const tabs = await screen.findByRole('navigation', { name: t.tabsLabel });
  expect(within(tabs).getByRole('link', { name: t.tabs.general })).toHaveAttribute('aria-current', 'page');
  expect(within(tabs).getByRole('link', { name: t.tabs.depth })).toHaveAttribute('href', '/clasificacion?pestana=profundidad');
  expect(within(tabs).getByRole('link', { name: t.tabs.purges })).toHaveAttribute('href', '/clasificacion?pestana=purgas');
  expect(within(tabs).getByRole('link', { name: t.tabs.clans })).toHaveAttribute('href', '/clasificacion?pestana=clanes');
  await user.click(within(tabs).getByRole('link', { name: t.tabs.depth }));
  expect(await screen.findByText(t.value.depth(7))).toBeInTheDocument();
  expect(within(tabs).getByRole('link', { name: t.tabs.depth })).toHaveAttribute('aria-current', 'page');
  expect(fetch.mock.calls.map(([url]) => url)).toContain('/galaxy/api/leaderboard?tab=depth');
  // The season's players do not change with the tab (M5a review).
  expect(screen.getByText(t.players(5))).toBeInTheDocument();
});

test('la pestaña En grupo: cada equipo con sus sondas, la capa, los núcleos y el tiempo; tu mejor grupo, fijado abajo (fase 7)', async () => {
  const g = (rank: number, names: string[], depth: number, cores: number, seconds: number) => ({ rank, players: names.map((username) => ({ username, probe: 'lumen' })), depth, cores, seconds, outcome: 'died' as const });
  mockApi({
    'GET /galaxy/api/leaderboard?tab=groups': () =>
      jsonResponse(200, board({ tab: 'groups', rows: [], me: null, total: 9, groups: [g(1, ['vega', 'lyra'], 6, 3, 667), g(1, ['altair', 'deneb', 'rigel'], 6, 3, 833)], myGroup: g(5, ['deneb', 'orion'], 2, 0, 300) })),
    'GET /galaxy/api/leaderboard?tab=general': () => jsonResponse(200, board()),
  });
  renderAt('/clasificacion?pestana=grupo', screens);
  const tabs = await screen.findByRole('navigation', { name: t.tabsLabel });
  expect(within(tabs).getByRole('link', { name: t.tabs.groups })).toHaveAttribute('aria-current', 'page');
  const table = await screen.findByRole('table', { name: t.tabs.groups });
  const lines = within(table).getAllByRole('row').slice(1);
  expect(lines).toHaveLength(2);
  expect(lines[0]).toHaveTextContent(t.value.depth(6));
  expect(lines[0]).toHaveTextContent(t.value.purges(3));
  expect(lines[0]).toHaveTextContent('11:07');
  expect(within(lines[0]!).getByRole('link', { name: 'vega' })).toHaveAttribute('href', '/perfil/vega');
  expect(within(lines[1]!).getAllByRole('link')).toHaveLength(3);
  const pinned = screen.getByRole('region', { name: t.yourGroup });
  expect(pinned).toHaveTextContent('orion');
  expect(pinned).toHaveTextContent(t.value.depth(2));
});

test('el podio con los tres primeros y la tabla con el resto, cada nombre lleva a su perfil', async () => {
  mockApi({ 'GET /galaxy/api/leaderboard?tab=general': () => jsonResponse(200, board()) });
  renderAt('/clasificacion', screens);
  const podium = await screen.findByRole('list', { name: t.podium });
  const places = within(podium).getAllByRole('listitem');
  expect(places).toHaveLength(3);
  expect(within(podium).getByRole('link', { name: /vega/ })).toHaveAttribute('href', '/perfil/vega');
  expect(podium).toHaveTextContent(t.value.general(9000));
  expect(podium).toHaveTextContent(t.level(12));
  // Screen readers hear each place's rank, ties included (M5a review).
  expect(within(podium).getByText(t.rank(1))).toBeInTheDocument();
  expect(within(podium).getAllByText(t.rank(2))).toHaveLength(2);
  const table = screen.getByRole('table', { name: t.leaderboard });
  const lines = within(table).getAllByRole('row').slice(1);
  expect(lines.map((l) => l.textContent)).toEqual([expect.stringContaining('deneb'), expect.stringContaining('rigel')]);
  expect(within(lines[1]!).getByRole('link', { name: 'rigel' })).toHaveAttribute('href', '/perfil/rigel');
});

test('tu fila se marca, y fuera del top se fija debajo', async () => {
  mockApi({ 'GET /galaxy/api/leaderboard?tab=general': () => jsonResponse(200, board()) });
  const view = renderAt('/clasificacion', screens);
  const mine = (await screen.findByRole('table', { name: t.leaderboard })).querySelector('tr[aria-current="true"]')!;
  expect(mine).toHaveTextContent('deneb');
  expect(mine).toHaveTextContent(t.you);
  view.unmount();

  mockApi({ 'GET /galaxy/api/leaderboard?tab=general': () => jsonResponse(200, board({ me: r(140, 'sonda_rayo', 120), total: 300 })) });
  renderAt('/clasificacion', screens);
  const pinned = await screen.findByRole('region', { name: t.yourRow });
  expect(pinned).toHaveTextContent('140');
  expect(pinned).toHaveTextContent('sonda_rayo');
  expect(pinned).toHaveTextContent(t.value.general(120));
  expect(within(pinned).getAllByRole('columnheader')).toHaveLength(4);
});

test('la temporada dice su nombre, los días que quedan y sus tramos, con el tuyo marcado', async () => {
  mockApi({ 'GET /galaxy/api/leaderboard?tab=general': () => jsonResponse(200, board()) });
  renderAt('/clasificacion', screens);
  expect(await screen.findByRole('heading', { level: 2, name: season.name })).toBeInTheDocument();
  expect(screen.getByText(t.endsIn(10))).toBeInTheDocument();
  expect(t.endsIn(1)).toBe('Termina mañana');
  expect(t.endsIn(0)).toBe('Termina hoy');
  expect(screen.getByText(t.players(5))).toBeInTheDocument();
  const tiers = screen.getByRole('list', { name: t.tiersTitle });
  expect(within(tiers).getAllByRole('listitem')).toHaveLength(5);
  // 2400 points: Plata.
  const yours = within(tiers).getByText(t.tier.silver).closest('li')!;
  expect(yours).toHaveAttribute('aria-current', 'true');
  expect(yours).toHaveTextContent(t.yourTier);
  expect(tiers).toHaveTextContent(t.tierFrom(30000));
});

test('sin puntos invita a jugar, y sin temporada lo dice', async () => {
  mockApi({ 'GET /galaxy/api/leaderboard?tab=general': () => jsonResponse(200, board({ rows: [], me: null, total: 0 })) });
  const view = renderAt('/clasificacion', screens);
  expect(await screen.findByText(t.noPoints)).toBeInTheDocument();
  view.unmount();
  mockApi({ 'GET /galaxy/api/leaderboard?tab=general': () => jsonResponse(200, { season: null, tab: 'general', rows: [], me: null, total: 0 }) });
  renderAt('/clasificacion', screens);
  expect(await screen.findByText(copy.errors.season_closed)).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByRole('table')).toBeNull());
});

test('los emblemas van a escala entera: 32 o 64 píxeles para un arte de 32 (revisión M5a)', async () => {
  mockApi({ 'GET /galaxy/api/leaderboard?tab=general': () => jsonResponse(200, board()) });
  renderAt('/clasificacion', screens);
  await screen.findByRole('list', { name: t.tiersTitle });
  const sizes = [...document.querySelectorAll<HTMLElement>('.tier-art')].map((e) => e.style.getPropertyValue('--size'));
  expect(sizes.length).toBeGreaterThan(0);
  for (const size of sizes) expect(['32px', '64px']).toContain(size);
});

test('en la clasificación, el podio lleva los avatares grandes: el primero ocupa 96 px y los otros 72, con marco o sin él', async () => {
  mockApi({ 'GET /galaxy/api/leaderboard?tab=general': () => jsonResponse(200, board()) });
  const { container } = renderAt('/clasificacion', screens);
  await screen.findByRole('list', { name: t.podium });
  const box = (place: number) => container.querySelector<HTMLElement>(`.podium .place-${place} .avatar-box`)!;
  // Plan «escáner pro», part E: the size is the outer footprint; without a frame the avatar fills it (32 px × scale).
  expect([1, 2, 3].map((p) => box(p).dataset['fit'])).toEqual(['outer', 'outer', 'outer']);
  expect([1, 2, 3].map((p) => box(p).style.getPropertyValue('--s'))).toEqual(['3', '2.25', '2.25']);
});
