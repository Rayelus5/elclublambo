import {
  DEFAULT_CLOSING_TIERS,
  DEFAULT_PODIUM,
  type Leaderboard,
  type RunResult,
  type TournamentCard,
  type TournamentDetail,
  type TournamentList,
  type TournamentMe,
  type TournamentRankRow,
  type TournamentRunRow,
} from '@galaxy/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import { TOURNAMENT_LIST_KEY } from '../../src/api/tournaments';
import { ResultsScreen } from '../../src/hangar/ResultsScreen';
import { Rail } from '../../src/hangar/lobby/Rail';
import { MainMenu } from '../../src/hub/MainMenu';
import { LeaderboardScreen } from '../../src/social/LeaderboardScreen';
import { TournamentScreen } from '../../src/tournaments/TournamentScreen';
import { TournamentsScreen } from '../../src/tournaments/TournamentsScreen';
import '../../src/styles/app.css';

// The tournaments in a real browser (plan «temporadas como fichas», part 5): the list with its cards and a tournament's
// page in each of its states (upcoming, running, in review, finished with a prize to collect, cancelled), at the four
// widths: the page never grows sideways, the hero, the ranking and the side column keep inside it, and the wide tables
// scroll inside their panels. Also the ways in (Jugar's corner, the lobby's rail) and the line after a run.
// VITE_TOURNAMENT_SHOTS=1 saves screenshots for review (apps/web/test/browser/__shots__/).

const shots = !!import.meta.env['VITE_TOURNAMENT_SHOTS'];
const DAY = 86_400_000;
const at = (ms: number) => new Date(Date.now() + ms).toISOString();
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A banner as an admin would upload it (1600×600): a nebula in SVG, so the test needs no file. */
const banner = (a: string, b: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="600"><defs><radialGradient id="g" cx="72%" cy="40%" r="70%"><stop offset="0" stop-color="${a}"/><stop offset=".45" stop-color="${b}"/><stop offset="1" stop-color="#05060f"/></radialGradient></defs><rect width="1600" height="600" fill="url(#g)"/>${Array.from({ length: 90 }, (_, i) => `<circle cx="${(i * 137) % 1600}" cy="${(i * 89) % 600}" r="${1 + (i % 3)}" fill="#fff" opacity="${0.3 + (i % 5) / 8}"/>`).join('')}</svg>`,
  )}`;

const me = (over: Partial<TournamentMe> = {}): TournamentMe => ({ status: 'joined', joinedAt: at(-DAY), rank: 7, score: 4_860, runs: 9, eligible: true, rewards: null, claimed: false, refunded: false, reason: null, ...over });
const prizes: TournamentCard['prizes'] = [
  { from: 1, to: 1, gifts: [{ kind: 'currency', currency: 'coins', amount: 25_000 }, { kind: 'galaxy', tier: 'legendary', finish: 'holo', trait: null, count: 1 }, { kind: 'cosmetic', piece: 'title', id: 'Campeón de hielo' }], cash: { amountEur: 50, note: 'Por transferencia o tarjeta regalo' } },
  { from: 2, to: 3, gifts: [{ kind: 'currency', currency: 'coins', amount: 12_000 }, { kind: 'galaxy', tier: 'epic', finish: 'normal', trait: null, count: 1 }], cash: null },
  { from: 4, to: 10, gifts: [{ kind: 'currency', currency: 'dust', amount: 3_000 }, { kind: 'currency', currency: 'signal', amount: 3 }], cash: null },
  { from: 11, to: 50, gifts: [{ kind: 'currency', currency: 'coins', amount: 2_000 }], cash: null },
];
const card = (over: Partial<TournamentCard> = {}): TournamentCard => ({
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'copa-de-hielo',
  title: 'Copa de hielo',
  summary: 'Baja tan hondo como puedas en la Nebulosa y suma puntos con cada incursión que termines',
  seasonId: 'season-2',
  state: 'running',
  startsAt: at(-2 * DAY),
  endsAt: at(4 * DAY + 6 * 3_600_000),
  resultsAt: null,
  banner: banner('#6fe3ff', '#26389a'),
  exclusive: true,
  metric: 'points',
  filters: { sector: null, probe: null, mode: 'any', minLevel: null },
  entry: null,
  prizes,
  participation: { minRuns: 5, gifts: [{ kind: 'currency', currency: 'dust', amount: 500 }] },
  entrants: 214,
  maxEntrants: null,
  me: me(),
  join: { open: false, block: 'joined' },
  exclusiveWith: null,
  ...over,
});
const NAMES = ['vega', 'lyra_nova', 'altair', 'deneb', 'rigel_23', 'sirius', 'sonda_rayo', 'betelgeuse_x', 'antares', 'polaris', 'capella', 'aldebaran', 'procyon', 'spica'];
const ranking: TournamentRankRow[] = NAMES.map((username, i) => ({ rank: i + 1, username, avatar: null, frame: null, score: 12_400 - i * 610, eligible: username !== 'lyra_nova', place: i < 1 ? 1 : i === 1 ? null : i, me: username === 'sonda_rayo' }));
const runs: TournamentRunRow[] = Array.from({ length: 9 }, (_, i) => ({ id: `r${i}`, finishedAt: at(-(i + 1) * 5 * 3_600_000), sector: i % 2 ? 'outer-nebula' : 'frost-rings', probe: 'lumen', coop: i % 3 === 2, outcome: i % 4 === 0 ? 'extracted' : 'died', depth: 4 + (i % 5), kills: 700 + i * 37, cores: i % 3, points: 380 + i * 41, value: 380 + i * 41 }));
const page_ = (over: Partial<TournamentDetail> = {}): TournamentDetail => ({
  ...card(),
  rules: 'Vale cualquier sonda y cualquier sector.\nLas partidas en grupo también cuentan, con sus puntos repartidos.',
  details: null,
  reviewHours: 24,
  ranking,
  total: 214,
  mine: ranking[6]!,
  myRuns: runs,
  review: null,
  ...over,
});

const list: TournamentList = {
  running: [
    card(),
    card({ id: '2', slug: 'caza-de-nucleos', title: 'Caza de Núcleos', summary: 'Purga todos los Núcleos que puedas en solitario', metric: 'cores', banner: null, exclusive: false, me: null, join: { open: true, block: null }, entrants: 88, maxEntrants: 120, filters: { sector: null, probe: null, mode: 'solo', minLevel: 10 } }),
    card({ id: '3', slug: 'sprint-de-capas', title: 'Sprint de capas', summary: 'Una sola partida, la más honda', metric: 'depth', banner: banner('#ff9a3c', '#9c2238'), me: null, join: { open: false, block: 'exclusive' }, exclusiveWith: { slug: 'copa-de-hielo', title: 'Copa de hielo' }, entry: { currency: 'coins', amount: 500 }, prizes: prizes.map((p) => ({ ...p, cash: null })) }),
  ],
  upcoming: [card({ id: '4', slug: 'copa-de-fuego', title: 'Copa de fuego', state: 'scheduled', startsAt: at(5 * DAY), endsAt: at(10 * DAY), me: null, join: { open: true, block: null }, entry: { currency: 'coins', amount: 500 }, banner: null, entrants: 31, maxEntrants: 200, prizes: prizes.map((p) => ({ ...p, cash: null })) })],
  finished: [card({ id: '5', slug: 'copa-vieja', title: 'Copa de otoño', state: 'finished', startsAt: at(-12 * DAY), endsAt: at(-5 * DAY), resultsAt: at(-4 * DAY), me: me({ rank: 2, score: 9_100, rewards: { place: 2, gifts: prizes[1]!.gifts, cash: null, participation: false } }), join: { open: false, block: 'closed' } })],
  now: new Date().toISOString(),
};

const gacha = { banners: [], costs: { coins: 100, coinsFive: 475, coinsTen: 900, signals: 1 }, freePullAvailable: false, wallet: { coins: 18_450, dust: 2_310, signal: 7 } };

const STATES: Record<string, TournamentDetail> = {
  proximo: page_({ state: 'scheduled', startsAt: at(2 * DAY + 5 * 3_600_000), endsAt: at(9 * DAY), ranking: [], total: 0, mine: null, myRuns: [], me: null, join: { open: true, block: null }, entry: { currency: 'coins', amount: 500 }, banner: null, prizes: prizes.map((p) => ({ ...p, cash: null })) }),
  'en-curso': page_(),
  revision: page_({ state: 'review', endsAt: at(-5 * 3_600_000), resultsAt: at(19 * 3_600_000), review: { checks: 8, pending: 3 }, join: { open: false, block: 'closed' } }),
  terminado: page_({
    state: 'finished',
    endsAt: at(-3 * DAY),
    resultsAt: at(-2 * DAY),
    join: { open: false, block: 'closed' },
    me: me({ rank: 3, score: 11_180, rewards: { place: 2, gifts: [...prizes[1]!.gifts, { kind: 'currency', currency: 'dust', amount: 500 }], cash: null, participation: true } }),
    mine: { ...ranking[2]!, username: 'sonda_rayo', me: true },
    ranking: ranking.map((r, i) => (i === 2 ? { ...r, username: 'sonda_rayo', me: true } : r.me ? { ...r, username: 'antares_b', me: false } : r)),
    banner: banner('#b39dff', '#3a2a9a'),
  }),
  cancelado: page_({ state: 'cancelled', ranking: [], total: 0, mine: null, myRuns: [], me: me({ refunded: true, rank: null }), entry: { currency: 'coins', amount: 500 }, join: { open: false, block: 'closed' }, prizes: prizes.map((p) => ({ ...p, cash: null })) }),
};

let root: Root | null = null;
afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

function mount(el: ReactElement, path: string, routes: Record<string, unknown>, client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const key = Object.keys(routes).find((k) => url.endsWith(k));
      if (!key) return new Response(JSON.stringify({ error: 'not_found' }), { status: 404, headers: { 'content-type': 'application/json' } });
      return new Response(JSON.stringify(routes[key]), { status: 200, headers: { 'content-type': 'application/json' } });
    }),
  );
  const host = document.createElement('div');
  document.body.style.margin = '0';
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(createElement(QueryClientProvider, { client }, createElement(MemoryRouter, { initialEntries: [path] }, el)));
  return host;
}

const WIDTHS = [
  [1280, 720],
  [1600, 900],
  [1920, 1080],
  [2560, 1440],
] as const;

/** The screen as seen, then scrolled down a screen at a time (three more at most), so the review sees all of it. */
async function shoot(name: string) {
  if (!shots) return;
  await page.screenshot({ path: `__shots__/${name}.png` });
  const r = document.querySelector<HTMLElement>('.tn-root');
  if (!r) return;
  for (let i = 2, top = r.clientHeight * 0.85; i <= 4 && top < r.scrollHeight - r.clientHeight * 0.15; i++, top += r.clientHeight * 0.85) {
    r.scrollTop = top;
    await wait(200);
    await page.screenshot({ path: `__shots__/${name}-${i}.png` });
  }
}

/** Nothing grows sideways: the page, the screen and every panel stay inside the window. */
function inside(w: number) {
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(w);
  const screen = document.querySelector<HTMLElement>('.tn-root')!;
  expect(screen.scrollWidth).toBeLessThanOrEqual(screen.clientWidth + 1);
  for (const el of document.querySelectorAll<HTMLElement>('.tn-card, .tn-hero, .tn-moment, .tn-prizes, .tn-rules, .lb-scroll, .tn-podium')) {
    const box = el.getBoundingClientRect();
    expect(box.right, el.className).toBeLessThanOrEqual(w + 0.5);
  }
}

for (const [w, h] of WIDTHS) {
  test(`torneos a ${w}×${h}`, async () => {
    await page.viewport(w, h);
    mount(createElement(Routes, null, createElement(Route, { path: '/torneos', element: createElement(TournamentsScreen) })), '/torneos', { '/tournaments': list, '/gacha': gacha });
    await expect.poll(() => document.querySelectorAll('.tn-card').length).toBe(3);
    await wait(900);
    inside(w);
    // The cards of a row share its height, their foot at the bottom.
    const feet = [...document.querySelectorAll<HTMLElement>('.tn-card-foot')].map((f) => Math.round(f.getBoundingClientRect().bottom));
    if (w >= 1600) expect(new Set(feet.slice(0, 2)).size).toBe(1);
    await shoot(`torneos-${w}`);
  }, 60_000);

  for (const [state, detail] of Object.entries(STATES)) {
    test(`torneo ${state} a ${w}×${h}`, async () => {
      await page.viewport(w, h);
      mount(createElement(Routes, null, createElement(Route, { path: '/torneos/:slug', element: createElement(TournamentScreen) })), '/torneos/copa-de-hielo', {
        '/tournaments/copa-de-hielo': detail,
        '/tournaments': list,
        '/gacha': gacha,
      });
      await expect.poll(() => document.querySelector('.tn-hero')).not.toBeNull();
      await wait(700);
      inside(w);
      // The hero's text stays on its left, over the veil; the side column beside the main one.
      const hero = document.querySelector<HTMLElement>('.tn-hero')!.getBoundingClientRect();
      expect(document.querySelector<HTMLElement>('.tn-hero-body')!.getBoundingClientRect().right).toBeLessThanOrEqual(hero.right + 0.5);
      const side = document.querySelector<HTMLElement>('.tn-side')!.getBoundingClientRect();
      const main = document.querySelector<HTMLElement>('.tn-main')!.getBoundingClientRect();
      expect(side.left).toBeGreaterThanOrEqual(main.right);
      await shoot(`torneo-${state}-${w}`);
    }, 60_000);
  }
}

test('inscribirse explica todo en su diálogo, y recoger el premio vuela a la barra y se celebra', async () => {
  await page.viewport(1600, 900);
  mount(createElement(Routes, null, createElement(Route, { path: '/torneos', element: createElement(TournamentsScreen) })), '/torneos?pestana=proximos', { '/tournaments': list, '/gacha': gacha });
  await expect.poll(() => document.querySelector('.tn-join')).not.toBeNull();
  await wait(700);
  document.querySelector<HTMLButtonElement>('.tn-join')!.click();
  await expect.poll(() => document.querySelector('.tn-dialog')).not.toBeNull();
  await wait(400);
  const dialog = document.querySelector<HTMLElement>('.tn-dialog')!.getBoundingClientRect();
  expect(dialog.right).toBeLessThanOrEqual(1600);
  if (shots) await page.screenshot({ path: '__shots__/torneos-inscribirse-1600.png' });
  root?.unmount();
  document.body.innerHTML = '';

  const won = STATES['terminado']!;
  mount(createElement(Routes, null, createElement(Route, { path: '/torneos/:slug', element: createElement(TournamentScreen) })), '/torneos/copa-de-hielo', {
    '/tournaments/copa-de-hielo': won,
    '/tournaments': list,
    '/gacha': gacha,
    '/claim': { items: won.me!.rewards!.gifts.map((gift) => ({ gift, outcome: 'granted' })), wallet: { coins: 30_450, dust: 2_810, signal: 7 } },
  });
  await expect.poll(() => document.querySelector('[data-claim="tournament"]')).not.toBeNull();
  await wait(500);
  document.querySelector<HTMLButtonElement>('[data-claim="tournament"]')!.click();
  await expect.poll(() => document.querySelectorAll('.claim-chip').length).toBeGreaterThan(0);
  expect(document.querySelector('.celebrate')).not.toBeNull();
  await wait(420);
  if (shots) await page.screenshot({ path: '__shots__/torneo-recoger-1600.png' });
}, 60_000);

test('Torneos en la esquina de Jugar y en el raíl, con su punto; y la línea al terminar una partida', async () => {
  await page.viewport(1600, 900);
  const host = mount(createElement('div', { className: 'hub-shot' }, createElement(MainMenu, { galaxies: 12 })), '/', { '/tournaments': list });
  host.style.width = '660px';
  host.style.padding = '24px';
  document.body.classList.add('ready', 'settled');
  await expect.poll(() => document.querySelector('.hub-tournaments .tn-dot')).not.toBeNull();
  await wait(1600);
  const play = document.querySelector<HTMLElement>('.play')!.getBoundingClientRect();
  const pill = document.querySelector<HTMLElement>('.hub-tournaments')!.getBoundingClientRect();
  // On Jugar's corner, inside it, and over nothing of its own (the ring on the left, the title at the foot).
  expect(pill.right).toBeLessThanOrEqual(play.right);
  expect(pill.top).toBeGreaterThanOrEqual(play.top);
  expect(pill.height).toBeGreaterThanOrEqual(44);
  const ring = document.querySelector<HTMLElement>('.play-ring')!.getBoundingClientRect();
  expect(pill.left).toBeGreaterThan(ring.right);
  if (shots) await page.screenshot({ path: '__shots__/torneos-menu-1600.png', element: document.querySelector<HTMLElement>('.menu')! });
  root?.unmount();
  document.body.innerHTML = '';

  mount(createElement(Rail), '/incursion', { '/tournaments': list });
  await expect.poll(() => document.querySelector('.lobby-zone .tn-dot')).not.toBeNull();
  await wait(800);
  if (shots) await page.screenshot({ path: '__shots__/torneos-rail-1600.png', element: document.querySelector<HTMLElement>('.lobby-rail')! });
  root?.unmount();
  document.body.innerHTML = '';

  const before = { ...list, running: [card({ me: me({ rank: 9, score: 4_540 }) }), ...list.running.slice(1)] };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(TOURNAMENT_LIST_KEY, before);
  const result: RunResult = {
    id: 'r1',
    outcome: 'extracted',
    ticks: 14 * 3600,
    depth: 7,
    kills: 1820,
    level: 24,
    payout: { coins: 640, dust: 210, signals: 0, material: 0 },
    breakdown: { layers: [{ layer: 1, coins: 640, dust: 210, multiplier: 1 }], share: 1, daily: [] },
    wallet: { coins: 19_090, dust: 2_520, signal: 7 },
    progress: { xp: 340, level: 24, levelUp: false, points: 320 },
  };
  mount(createElement('div', { className: 'screen-root' }, createElement(ResultsScreen, { result, onAgain: () => {} })), '/incursion', { '/tournaments': list }, client);
  await expect.poll(() => document.querySelector('.results-tournament')).not.toBeNull();
  await wait(1200);
  expect(document.querySelector('.results-tournament')!.textContent).toContain('+320 puntos en Copa de hielo, ahora 7.º');
  if (shots) await page.screenshot({ path: '__shots__/torneos-resultado-1600.png' });
  root?.unmount();
  document.body.innerHTML = '';

  // The leaderboard's block, under the season card.
  const rows = NAMES.slice(0, 8).map((username, i) => ({ rank: i + 1, username, level: 30 - i, value: 31_500 - i * 1450, runs: 120 - i * 5, bestDepth: 14 - i, avatar: null, frame: null }));
  const board: Leaderboard = {
    season: { id: 'season-2', name: 'Temporada 2', startsAt: at(-DAY), endsAt: at(27 * DAY), tiers: [500, 2000, 6000, 15000, 30000], closing: { tiers: [...DEFAULT_CLOSING_TIERS], podium: DEFAULT_PODIUM, podiumSize: 3 } },
    tab: 'general',
    rows,
    me: rows[6]!,
    total: 412,
  };
  for (const w of [1280, 1920]) {
    await page.viewport(w, w === 1280 ? 720 : 1080);
    mount(createElement(Routes, null, createElement(Route, { path: '/clasificacion', element: createElement(LeaderboardScreen) })), '/clasificacion', { 'tab=general': board, '/tournaments': list });
    await expect.poll(() => document.querySelector('.tn-side-card')).not.toBeNull();
    await wait(600);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(w);
    document.querySelector<HTMLElement>('.tn-side-card')!.scrollIntoView({ block: 'center' });
    await wait(200);
    if (shots) await page.screenshot({ path: `__shots__/torneos-clasificacion-${w}.png` });
    root?.unmount();
    root = null;
    document.body.innerHTML = '';
  }
}, 90_000);
