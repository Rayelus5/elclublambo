import { DEFAULT_CLOSING_TIERS, DEFAULT_PODIUM, type Leaderboard, type LeaderRow } from '@galaxy/shared';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { copy, fmt } from '../src/copy/es';
import { LeaderboardScreen } from '../src/social/LeaderboardScreen';
import { tierProgress } from '../src/social/parts';
import { SeasonCountdown } from '../src/social/SeasonCountdown';
import { jsonResponse, mockApi, renderAt } from './render';

// The season leaderboard (GDD §14.1, §4; M5a): tabs General, Profundidad and Purgas (Clanes waits for the clans), in
// the address so they can be shared; a podium with the top three and a table with the rest, every name leading to
// its profile; your row marked, and pinned below when you are out of the top; the season with the days left and its
// tiers, yours marked.
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const t = copy.social;
const DAY = 86_400_000;
// The close pays what the live config says: four on the podium here, so nothing in the copy can say three.
const closing = { tiers: [...DEFAULT_CLOSING_TIERS], podium: DEFAULT_PODIUM, podiumSize: 4 };
const season = { id: 'season-1', name: 'Temporada 1', startsAt: '2026-11-01T00:00:00.000Z', endsAt: new Date(Date.now() + 10 * DAY + 3_600_000).toISOString(), tiers: [500, 2000, 6000, 15000, 30000], closing };
const r = (rank: number, username: string, value: number, level = 3, runs = 4, bestDepth = 3): LeaderRow => ({ rank, username, level, value, runs, bestDepth });
const ROWS = [r(1, 'vega', 9000, 12, 31, 9), r(2, 'lyra', 4100), r(2, 'altair', 4100), r(4, 'deneb', 2400, 3, 17, 6), r(5, 'rigel', 900, 3, 1, 2)];
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
  // Puesto, Jugador, Nivel, Partidas, Mejor capa and Puntos, as in the table.
  expect(within(pinned).getAllByRole('columnheader')).toHaveLength(6);
});

test('la temporada dice su nombre, lo que le queda en vivo y sus tramos, con el tuyo marcado', async () => {
  mockApi({ 'GET /galaxy/api/leaderboard?tab=general': () => jsonResponse(200, board()) });
  renderAt('/clasificacion', screens);
  expect(await screen.findByRole('heading', { level: 2, name: season.name })).toBeInTheDocument();
  const left = screen.getByText(/^Termina en 10 d \d+ h \d\d min$/);
  expect(left.closest('time')).toHaveAttribute('datetime', season.endsAt);
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

test('toda la temporada es un enlace a su ruta y su tienda, con tu puesto, tu tramo y lo que te falta para el siguiente', async () => {
  mockApi({ 'GET /galaxy/api/leaderboard?tab=general': () => jsonResponse(200, board()) });
  renderAt('/clasificacion', screens);
  const card = await screen.findByRole('region', { name: season.name });
  const link = within(card).getByRole('link', { name: t.seeRoute });
  expect(link).toHaveAttribute('href', '/temporada');
  // One link for the whole card: nothing else in it can be clicked or focused.
  expect(within(card).getAllByRole('link')).toHaveLength(1);
  expect(card).toHaveClass('lb-season');
  // 2400 points: fourth of five, Plata, 3600 to Oro (6000).
  expect(card).toHaveTextContent(t.rankOf(4, 5));
  expect(card).toHaveTextContent(t.value.general(2400));
  expect(card).toHaveTextContent(t.toNext(3600, t.tier.gold));
  const bar = within(card).getByRole('progressbar', { name: t.tierBar(t.tier.gold) });
  expect(bar).toHaveAttribute('aria-valuemin', '2000');
  expect(bar).toHaveAttribute('aria-valuemax', '6000');
  expect(bar).toHaveAttribute('aria-valuenow', '2400');
  // The players of the season, whatever the tab.
  expect(card).toHaveTextContent(t.players(5));
});

test('cada tramo dice lo que paga al cerrar, y el podio el suyo con cuántos puestos entran', async () => {
  mockApi({ 'GET /galaxy/api/leaderboard?tab=general': () => jsonResponse(200, board()) });
  renderAt('/clasificacion', screens);
  const tiers = await screen.findByRole('list', { name: t.tiersTitle });
  const stellar = within(tiers).getByText(t.tier.stellar).closest('li')!;
  expect(stellar).toHaveTextContent(t.prize(closing.tiers[4]!));
  // Every amount is drawn too: Estelar's 8000 coins and 3000 dust.
  expect(within(stellar).getByText(fmt(8000))).toBeInTheDocument();
  expect(within(stellar).getByText(fmt(3000))).toBeInTheDocument();
  const bronze = within(tiers).getByText(t.tier.bronze).closest('li')!;
  expect(bronze).toHaveTextContent(t.prize(closing.tiers[0]!));
  const podium = screen.getByRole('group', { name: t.podiumPrize });
  expect(podium).toHaveTextContent(t.podiumWho(4));
  expect(podium).toHaveTextContent(t.prize(closing.podium));
});

test('sin puntos, la temporada te pone en camino al primer tramo; en el más alto, lo dice', async () => {
  mockApi({ 'GET /galaxy/api/leaderboard?tab=general': () => jsonResponse(200, board({ me: null })) });
  const view = renderAt('/clasificacion', screens);
  const card = await screen.findByRole('region', { name: season.name });
  expect(card).toHaveTextContent(t.noTier);
  expect(card).toHaveTextContent(t.toNext(500, t.tier.bronze));
  expect(card).not.toHaveTextContent(/Puesto \d+ de/);
  view.unmount();
  mockApi({ 'GET /galaxy/api/leaderboard?tab=general': () => jsonResponse(200, board({ me: r(1, 'vega', 31000) })) });
  renderAt('/clasificacion', screens);
  const top = await screen.findByRole('region', { name: season.name });
  expect(top).toHaveTextContent(copy.season.allTiers);
  expect(within(top).queryByRole('progressbar')).toBeNull();
});

test('la general enseña las partidas y la mejor capa de cada uno; las otras pestañas no', async () => {
  mockApi({
    'GET /galaxy/api/leaderboard?tab=general': () => jsonResponse(200, board()),
    'GET /galaxy/api/leaderboard?tab=depth': () => jsonResponse(200, board({ tab: 'depth', rows: ROWS.map((x) => ({ rank: x.rank, username: x.username, level: x.level, value: 5 })), me: null })),
  });
  const view = renderAt('/clasificacion', screens);
  const table = await screen.findByRole('table', { name: t.leaderboard });
  const heads = within(table).getAllByRole('columnheader').map((h) => h.textContent);
  expect(heads).toEqual([t.columns.rank, t.columns.player, t.columns.level, t.columns.runs, t.columns.bestDepth, t.columns.value.general]);
  const deneb = within(table).getByRole('link', { name: 'deneb' }).closest('tr')!;
  const cells = within(deneb).getAllByRole('cell').map((c) => c.textContent);
  expect(cells).toEqual(['4', '3', '17', '6', t.value.general(2400)]);
  // The table scrolls inside its own box, never the page.
  expect(table.parentElement).toHaveClass('lb-scroll');
  // The podium says them too.
  const podium = screen.getByRole('list', { name: t.podium });
  expect(podium).toHaveTextContent(t.podiumRuns(31, 9));
  view.unmount();
  renderAt('/clasificacion?pestana=profundidad', screens);
  const depth = await screen.findByRole('table', { name: t.leaderboard });
  expect(within(depth).getAllByRole('columnheader')).toHaveLength(4);
});

test('la cuenta atrás de la temporada corre cada segundo y dice los días cuando quedan', () => {
  vi.useFakeTimers({ now: new Date('2026-11-21T10:00:00.000Z') });
  const view = render(<SeasonCountdown endsAt="2026-11-21T12:03:05.000Z" />);
  expect(t.seasonLeft(0, 2, 3, 5)).toBe('Termina en 2 h 03 min 05 s');
  expect(view.container).toHaveTextContent(t.seasonLeft(0, 2, 3, 5));
  act(() => vi.advanceTimersByTime(1000));
  expect(view.container).toHaveTextContent(t.seasonLeft(0, 2, 3, 4));
  view.unmount();
  const far = render(<SeasonCountdown endsAt="2026-12-01T11:30:01.000Z" />);
  expect(far.container).toHaveTextContent('Termina en 10 d 1 h 30 min');
  far.unmount();
  const done = render(<SeasonCountdown endsAt="2026-11-21T09:00:00.000Z" />);
  expect(done.container).toHaveTextContent(t.seasonEnding);
});

test('el progreso hacia el siguiente tramo va desde el tramo que tienes', () => {
  const tiers = [500, 2000, 6000, 15000, 30000];
  expect(tierProgress(2400, tiers)).toEqual({ tier: 'silver', next: { tier: 'gold', points: 3600 }, from: 2000, to: 6000, share: 0.1 });
  expect(tierProgress(0, tiers)).toEqual({ tier: null, next: { tier: 'bronze', points: 500 }, from: 0, to: 500, share: 0 });
  expect(tierProgress(31000, tiers)).toEqual({ tier: 'stellar', next: null, from: 30000, to: null, share: 1 });
});
