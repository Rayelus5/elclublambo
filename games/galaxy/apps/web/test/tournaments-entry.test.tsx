import { DEFAULT_CLOSING_TIERS, DEFAULT_PODIUM, type MailMessage, type MeResponse, type MyMailbox, type RunResult, type TournamentList } from '@galaxy/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import { TOURNAMENT_LIST_KEY } from '../src/api/tournaments';
import { copy } from '../src/copy/es';
import { ResultsScreen } from '../src/hangar/ResultsScreen';
import { Rail } from '../src/hangar/lobby/Rail';
import { MainMenu } from '../src/hub/MainMenu';
import { TopBar } from '../src/hub/TopBar';
import { TournamentsHubPanel } from '../src/tournaments/HubPanel';
import { LeaderboardScreen } from '../src/social/LeaderboardScreen';
import { jsonResponse, mockApi, renderAt } from './render';
import { at, card, DAY, list, me } from './tournament-fixtures';

// The ways into the tournaments (plan «temporadas como fichas», part 5): the title screen's panel under the season's
// (the owner, 2026-11-22) and «Torneos» in the lobby's rail, with a small dot while sign-up is open in one; the leaderboard's block with my place in each one
// running; the results letter's «Ver torneo»; and, after a run, one line with what it added and where I am now.
afterEach(() => vi.unstubAllGlobals());

const t = copy.tournaments;
const open = list({ running: [card()] });
const closed = list({ running: [card({ join: { open: false, block: 'joined' }, me: me() })] });

test('el panel de torneos del inicio lleva a todos, con un punto mientras hay inscripción abierta, y al torneo que importa', async () => {
  mockApi({ 'GET /galaxy/api/tournaments': () => jsonResponse(200, open) });
  renderAt('/', { '/': <TournamentsHubPanel /> });
  const region = await screen.findByRole('region', { name: t.title });
  const panel = within(region);
  expect(await panel.findByRole('link', { name: t.hub.allOpen })).toHaveAttribute('href', '/torneos');
  expect(region.querySelector('.tn-dot')).not.toBeNull();
  // Open to sign up: the panel invites, and the way in is the tournament's page (where the dialog explains first).
  const go = await panel.findByRole('link', { name: /Copa de hielo/ });
  expect(go).toHaveAttribute('href', '/torneos/copa-de-hielo');
  expect(go).toHaveTextContent(t.hub.cta.join);
  expect(panel.getByText(t.hub.openLine(t.entrants(42, null)))).toBeInTheDocument();
});

test('sin inscripción abierta el panel va sin punto, y en uno que juegas dice tu puesto', async () => {
  mockApi({ 'GET /galaxy/api/tournaments': () => jsonResponse(200, closed) });
  renderAt('/', { '/': <TournamentsHubPanel /> });
  const region = await screen.findByRole('region', { name: t.title });
  const panel = within(region);
  expect(await panel.findByRole('link', { name: t.hub.allLabel })).toHaveAttribute('href', '/torneos');
  expect(await panel.findByText('Vas 5.º con 1240 puntos')).toBeInTheDocument();
  expect(region.querySelector('.tn-dot')).toBeNull();
  expect(panel.getByRole('link', { name: /Copa de hielo/ })).toHaveTextContent(t.hub.cta.see);
});

test('sin ningún torneo el panel lo dice y sigue llevando a la lista', async () => {
  mockApi({ 'GET /galaxy/api/tournaments': () => jsonResponse(200, list()) });
  renderAt('/', { '/': <TournamentsHubPanel /> });
  const panel = within(await screen.findByRole('region', { name: t.title }));
  expect(await panel.findByText(t.hub.empty)).toBeInTheDocument();
  expect(panel.getByRole('link', { name: t.hub.allLabel })).toHaveAttribute('href', '/torneos');
});

test('Jugar ya no lleva Torneos en su esquina', async () => {
  mockApi({ 'GET /galaxy/api/tournaments': () => jsonResponse(200, open) });
  renderAt('/', { '/': <MainMenu galaxies={3} /> });
  expect(await screen.findByRole('link', { name: new RegExp(copy.hub.play) })).toHaveAttribute('href', '/incursion');
  expect(screen.queryByRole('link', { name: /Torneos/ })).toBeNull();
});

test('el raíl del lobby lleva a Torneos, con su punto cuando puedes inscribirte', async () => {
  mockApi({ 'GET /galaxy/api/tournaments': () => jsonResponse(200, open) });
  renderAt('/incursion', { '/incursion': <Rail /> });
  const link = await screen.findByRole('link', { name: copy.lobby.tournamentsOpen });
  expect(link).toHaveAttribute('href', '/torneos');
  expect(link.querySelector('.tn-dot')).not.toBeNull();
});

test('la clasificación enseña los torneos en curso con tu puesto, cada uno con su enlace', async () => {
  const season = { id: 'season-1', name: 'Temporada 1', startsAt: '2026-11-01T00:00:00.000Z', endsAt: new Date(Date.now() + 10 * DAY).toISOString(), tiers: [500, 2000, 6000, 15000, 30000], closing: { tiers: [...DEFAULT_CLOSING_TIERS], podium: DEFAULT_PODIUM, podiumSize: 3 } };
  const rows = [{ rank: 1, username: 'vega', level: 9, value: 900, runs: 3, bestDepth: 4 }];
  mockApi({
    'GET /galaxy/api/leaderboard?tab=general': () => jsonResponse(200, { season, tab: 'general', rows, me: rows[0], total: 1 }),
    'GET /galaxy/api/tournaments': () =>
      jsonResponse(200, list({ running: [card({ me: me({ rank: 5 }) }), card({ id: 'b', slug: 'copa-de-fuego', title: 'Copa de fuego' })], upcoming: [card({ id: 'c', slug: 'copa-futura', title: 'Copa futura', state: 'scheduled', startsAt: at(DAY) })] })),
  });
  renderAt('/clasificacion', { '/clasificacion': <LeaderboardScreen /> });
  const block = within(await screen.findByRole('region', { name: t.sideTitle }));
  const ice = block.getByRole('link', { name: new RegExp('Copa de hielo') });
  expect(ice).toHaveAttribute('href', '/torneos/copa-de-hielo');
  expect(within(ice).getByText(t.rankNow(5))).toBeInTheDocument();
  expect(within(block.getByRole('link', { name: /Copa de fuego/ })).getByText(t.sideNotIn)).toBeInTheDocument();
  expect(block.queryByText('Copa futura')).toBeNull();
  expect(block.getByRole('link', { name: t.sideAll })).toHaveAttribute('href', '/torneos');
});

test('la carta de un torneo en el buzón lleva a su página con «Ver torneo»', async () => {
  const meResponse: MeResponse = { id: 'p1', username: 'vega', roles: [], mfa: false, level: 6 };
  const letter: MailMessage = {
    id: 'm1',
    type: 'tournament',
    title: 'Resultados de Copa de hielo',
    body: 'Quedaste 2.º',
    at: '2026-11-21T10:00:00.000Z',
    expiresAt: '2026-12-21T10:00:00.000Z',
    contents: { v: 2, items: [], packs: [] },
    granted: null,
    warn: false,
    archived: false,
    read: false,
    claimed: false,
    gifts: {},
    link: '/torneos/copa-de-hielo',
  } as MailMessage;
  const box: MyMailbox = { unread: 1, unclaimed: 0, next: null, names: { events: [], seasonCurrency: 'Esquirlas' }, messages: [letter] };
  mockApi({
    'GET /galaxy/api/mailbox': () => jsonResponse(200, box),
    'POST /galaxy/api/mailbox/m1/read': () => jsonResponse(200, { read: true }),
  });
  renderAt('/', { '/': <TopBar me={meResponse} wallet={{ coins: 10, dust: 2, signal: 1 }} freePull={false} onLogout={() => {}} leaving={false} /> });
  await userEvent.click(await screen.findByRole('button', { name: copy.mail.unread(1) }));
  const dialog = await screen.findByRole('dialog', { name: copy.mail.title });
  await userEvent.click(await within(dialog).findByRole('button', { name: /Resultados de Copa de hielo/ }));
  expect(await within(dialog).findByRole('link', { name: copy.mail.goTournament })).toHaveAttribute('href', '/torneos/copa-de-hielo');
});

// After a run.
const result: RunResult = {
  id: 'r1',
  outcome: 'extracted',
  ticks: 10 * 3600,
  depth: 5,
  kills: 900,
  level: 18,
  payout: { coins: 52, dust: 18, signals: 0, material: 0 },
  breakdown: { layers: [{ layer: 1, coins: 52, dust: 18, multiplier: 1 }], share: 1, daily: [] },
  wallet: { coins: 152, dust: 30, signal: 10 },
  progress: { xp: 120, level: 18, levelUp: false, points: 320 },
};

function showResults(before: TournamentList | undefined, r: RunResult = result) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (before) client.setQueryData(TOURNAMENT_LIST_KEY, before);
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ResultsScreen result={r} onAgain={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

test('al terminar una partida, una línea dice lo que sumó en tu torneo y tu puesto, con la flecha si subes', async () => {
  const fetch = mockApi({ 'GET /galaxy/api/tournaments': () => jsonResponse(200, list({ running: [card({ me: me({ score: 1560, rank: 5 }), join: { open: false, block: 'joined' } })] })) });
  showResults(list({ running: [card({ me: me({ score: 1240, rank: 8 }), join: { open: false, block: 'joined' } })] }));
  const line = await screen.findByRole('link', { name: new RegExp(t.runGain(t.value.points(320), 'Copa de hielo', 5).replace('+', '\\+')) });
  expect(line).toHaveAttribute('href', '/torneos/copa-de-hielo');
  expect(within(line).getByText(new RegExp(t.climbed(3)))).toBeInTheDocument();
  expect(line.querySelector('.tn-climb')).not.toBeNull();
  expect(line.textContent).not.toMatch(/[·:]/);
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('sin torneo en el que estés, o en una incursión de prueba, no hay línea ni se pregunta nada', async () => {
  const fetch = mockApi({ 'GET /galaxy/api/tournaments': () => jsonResponse(200, open) });
  showResults(open);
  await new Promise((r) => setTimeout(r, 30));
  expect(screen.queryByRole('link', { name: /Copa de hielo/ })).toBeNull();
  showResults(closed, { ...result, test: true });
  await new Promise((r) => setTimeout(r, 30));
  expect(fetch).not.toHaveBeenCalled();
});
